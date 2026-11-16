//! Dated native compliance over one immutable source and one preparation per timezone.
use super::{
    average::add_days,
    model::ComplianceError,
    monthly::{self, AssessedMonth, PreparedComplianceSource},
    planning_weekends,
    profile::ComplianceProfile,
};
use crate::{
    calendar::{parse_date, recurrence::CollationRanks},
    rules::RuleResolver,
};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, Mutex},
};
pub struct PreparedDatedComplianceSource {
    original: Arc<[Value]>,
    collation: Arc<CollationRanks>,
    zones: Mutex<BTreeMap<String, Arc<PreparedComplianceSource>>>,
}
impl PreparedDatedComplianceSource {
    pub fn new(shifts: Arc<[Value]>, collation: CollationRanks) -> Self {
        Self::with_shared_collation(shifts, Arc::new(collation))
    }
    pub fn with_shared_collation(shifts: Arc<[Value]>, collation: Arc<CollationRanks>) -> Self {
        Self {
            original: shifts,
            collation,
            zones: Mutex::new(BTreeMap::new()),
        }
    }
    pub fn shifts(&self) -> &[Value] {
        &self.original
    }
    pub fn prepared_zone_count(&self) -> Result<usize, ComplianceError> {
        Ok(self
            .zones
            .lock()
            .map_err(|_| ComplianceError::InvalidInput)?
            .len())
    }
    fn for_zone(&self, zone: &str) -> Result<Arc<PreparedComplianceSource>, ComplianceError> {
        if let Some(source) = self
            .zones
            .lock()
            .map_err(|_| ComplianceError::InvalidInput)?
            .get(zone)
            .cloned()
        {
            return Ok(source);
        }
        // Projection is outside the cache lock; all legal calculations run after releasing it.
        let source = Arc::new(PreparedComplianceSource::new(
            Arc::clone(&self.original),
            zone,
            &self.collation,
        )?);
        let mut zones = self
            .zones
            .lock()
            .map_err(|_| ComplianceError::InvalidInput)?;
        // A source may span many historical zones; retain a bounded native cache.
        if zones.len() >= 32 && !zones.contains_key(zone) {
            return Ok(source);
        }
        Ok(Arc::clone(zones.entry(zone.into()).or_insert(source)))
    }
}
pub fn calculate_monthly_compliance(
    month: &str,
    source: &PreparedDatedComplianceSource,
    time_zone: &str,
    options: &Value,
    clock_date: &str,
    resolver: &RuleResolver,
) -> Result<AssessedMonth, ComplianceError> {
    calculate_for_profile(
        month,
        source,
        time_zone,
        options,
        clock_date,
        resolver,
        options
            .get("employmentProfile")
            .map(ComplianceProfile::from_raw),
    )
}
fn calculate_for_profile(
    month: &str,
    source: &PreparedDatedComplianceSource,
    time_zone: &str,
    options: &Value,
    clock_date: &str,
    resolver: &RuleResolver,
    profile: Option<ComplianceProfile<'_>>,
) -> Result<AssessedMonth, ComplianceError> {
    let dated = match profile.and_then(|p| p.get("employmentTimeline")) {
        None | Some(Value::Null) => false,
        Some(Value::Array(rows)) => rows
            .iter()
            .any(|r| crate::credit::summary::truthy(r.get("employment"))),
        _ => return Err(ComplianceError::InvalidInput),
    };
    if !dated {
        return monthly::calculate_monthly_core_with_profile(
            month,
            source.for_zone(time_zone)?.as_ref(),
            options,
            clock_date,
            resolver,
            profile,
        );
    }
    let profile = profile.ok_or(ComplianceError::InvalidInput)?;
    let first = parse_date(&format!("{month}-01"))?;
    let periods = profile.periods(month, &first.last_of_month().to_string())?;
    let mut first_result = None;
    let mut issues = Vec::<Value>::new();
    let mut issue_indices = BTreeMap::new();
    let mut coverage_start: Option<String> = None;
    let mut coverage_through: Option<String> = None;
    for period in periods {
        let fields = profile.fields_at(&period.from)?;
        let field = |key: &str| fields.get(key);
        let zone = field("timeZone")
            .and_then(Value::as_str)
            .ok_or(ComplianceError::InvalidInput)?;
        // Only small scalar options are copied. The complete original profile,
        // including saved target contexts and all timeline rows, stays borrowed.
        let mut scalar_options = options
            .as_object()
            .ok_or(ComplianceError::InvalidInput)?
            .iter()
            .filter(|(k, _)| k.as_str() != "employmentProfile")
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect::<serde_json::Map<_, _>>();
        scalar_options.insert("skipWeekendAssessment".into(), json!(true));
        scalar_options.insert(
            "employmentAssessmentPeriod".into(),
            json!({"from":period.from,"until":period.until}),
        );
        for key in [
            "federalState",
            "holidayRegion",
            "weeklyMinutes",
            "regularRotatingNightWork",
            "sundayHolidayWorkEligible",
            "allEmploymentWorkRecorded",
        ] {
            if let Some(value) = field(key) {
                scalar_options.insert(key.into(), value.clone());
            } else {
                scalar_options.remove(key);
            }
        }
        let scalar_options = Value::Object(scalar_options);
        let calculated = monthly::calculate_monthly_core_with_profile(
            month,
            source.for_zone(zone)?.as_ref(),
            &scalar_options,
            clock_date,
            resolver,
            Some(profile),
        )?
        .into_json();
        if let Some(from) = calculated["assessmentRange"]["from"].as_str()
            && coverage_start.as_deref().is_none_or(|old| from < old)
        {
            coverage_start = Some(from.into());
        }
        if let Some(through) = calculated["assessmentRange"]["through"].as_str()
            && coverage_through.as_deref().is_none_or(|old| through > old)
        {
            coverage_through = Some(through.into());
        }
        for issue in calculated["issues"]
            .as_array()
            .ok_or(ComplianceError::InvalidInput)?
        {
            let date = issue["date"]
                .as_str()
                .ok_or(ComplianceError::InvalidInput)?;
            if date < period.from.as_str()
                || period.until.as_deref().is_some_and(|until| date >= until)
            {
                continue;
            }
            let id = issue["id"].as_str().ok_or(ComplianceError::InvalidInput)?;
            if let Some(index) = issue_indices.get(id).copied() {
                issues[index] = issue.clone();
            } else {
                issue_indices.insert(id.to_owned(), issues.len());
                issues.push(issue.clone());
            }
        }
        if first_result.is_none() {
            first_result = Some(calculated);
        }
    }
    let coverage_start = coverage_start.ok_or(ComplianceError::InvalidInput)?;
    let coverage_end = add_days(
        parse_date(&coverage_through.ok_or(ComplianceError::InvalidInput)?)?,
        1,
    )?
    .to_string();
    let weekend = planning_weekends::check_planning_weekends_for_profile(
        month,
        source.shifts(),
        time_zone,
        options,
        Some((&coverage_start, &coverage_end)),
        Some(profile),
    )?;
    issues.extend(
        weekend["issues"]
            .as_array()
            .ok_or(ComplianceError::InvalidInput)?
            .iter()
            .cloned(),
    );
    let mut result = first_result.ok_or(ComplianceError::InvalidInput)?;
    let object = result
        .as_object_mut()
        .ok_or(ComplianceError::InvalidInput)?;
    object.insert("weekendAssessment".into(), weekend["assessment"].clone());
    for (key, severity) in [
        ("criticalCount", "critical"),
        ("warningCount", "warning"),
        ("infoCount", "info"),
    ] {
        object.insert(
            key.into(),
            json!(issues.iter().filter(|i| i["severity"] == severity).count()),
        );
    }
    let dates = issues
        .iter()
        .map(|i| i["date"].as_str().ok_or(ComplianceError::InvalidInput))
        .collect::<Result<BTreeSet<_>, _>>()?;
    object.insert("affectedDates".into(), json!(dates));
    object.insert("issues".into(), Value::Array(issues));
    Ok(AssessedMonth::from_native_result(result))
}

pub fn calculate_monthly_compliance_with_basis(
    month: &str,
    source: &PreparedDatedComplianceSource,
    time_zone: &str,
    options: &Value,
    clock_date: &str,
    resolver: &RuleResolver,
    basis: ComplianceProfile<'_>,
) -> Result<AssessedMonth, ComplianceError> {
    calculate_for_profile(
        month,
        source,
        time_zone,
        options,
        clock_date,
        resolver,
        Some(basis),
    )
}

#[cfg(test)]
mod sharing_tests {
    use super::*;
    #[test]
    fn reporting_windows_share_one_large_platform_rank_owner() {
        let ranks = Arc::new(CollationRanks::from(
            (0..50_000)
                .map(|i| (format!("entry-{i}"), i))
                .collect::<BTreeMap<_, _>>(),
        ));
        let first =
            PreparedDatedComplianceSource::with_shared_collation(Arc::from([]), Arc::clone(&ranks));
        let second =
            PreparedDatedComplianceSource::with_shared_collation(Arc::from([]), Arc::clone(&ranks));
        assert!(Arc::ptr_eq(&first.collation, &ranks));
        assert!(Arc::ptr_eq(&second.collation, &ranks));
        assert_eq!(Arc::strong_count(&ranks), 3);
    }
}
