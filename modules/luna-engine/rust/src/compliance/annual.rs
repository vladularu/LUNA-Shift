//! Complete annual legal aggregation; money and time retain their independent native sections.
use super::{
    checks,
    dated::{self, PreparedDatedComplianceSource},
    model::ComplianceError,
    monthly::AssessedMonth,
    profile::ComplianceProfile,
    selection::PreparedComplianceEntries,
};
use crate::{
    calendar::recurrence::CollationRanks,
    rules::{RuleResolver, holidays::HolidayError},
    training::{
        self, PreparedTrainingProfiles, TrainingComplianceError, TrainingLoad, YouthSource,
    },
};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, VecDeque},
    sync::{Arc, Mutex, OnceLock},
};
type CachedMonth = Result<Option<Arc<AssessedMonth>>, AnnualComplianceError>;
#[derive(Default)]
struct MonthCache {
    cells: BTreeMap<String, Arc<OnceLock<CachedMonth>>>,
    order: VecDeque<String>,
}
pub struct AnnualComplianceSource {
    entries: PreparedComplianceEntries,
    profile: Arc<Value>,
    resolver: Arc<RuleResolver>,
    collation: Arc<CollationRanks>,
    reference_date: String,
    youth_protection: bool,
    months: Mutex<MonthCache>,
}
impl AnnualComplianceSource {
    /// Same immutable calculation input, sharing the existing calendar vector.
    /// No source admission or readiness policy is added by this constructor.
    pub fn from_shared_entries(
        entries: Arc<Vec<Value>>,
        profile: Arc<Value>,
        resolver: Arc<RuleResolver>,
        collation: Arc<CollationRanks>,
        reference_date: String,
        youth_protection: bool,
    ) -> Result<Self, AnnualComplianceError> {
        crate::calendar::parse_date(&reference_date).map_err(ComplianceError::from)?;
        Ok(Self {
            entries: PreparedComplianceEntries::from_shared(entries)?,
            profile,
            resolver,
            collation,
            reference_date,
            youth_protection,
            months: Mutex::new(MonthCache::default()),
        })
    }
    pub(crate) fn selected_shifts(&self, month: &str) -> Result<Vec<&Value>, ComplianceError> {
        self.entries.select(month, &self.resolver)
    }
    pub fn new(
        entries: Arc<[Value]>,
        profile: Arc<Value>,
        resolver: Arc<RuleResolver>,
        collation: CollationRanks,
        reference_date: String,
        youth_protection: bool,
    ) -> Result<Self, AnnualComplianceError> {
        Self::with_shared_collation(
            entries,
            profile,
            resolver,
            Arc::new(collation),
            reference_date,
            youth_protection,
        )
    }
    pub fn with_shared_collation(
        entries: Arc<[Value]>,
        profile: Arc<Value>,
        resolver: Arc<RuleResolver>,
        collation: Arc<CollationRanks>,
        reference_date: String,
        youth_protection: bool,
    ) -> Result<Self, AnnualComplianceError> {
        crate::calendar::parse_date(&reference_date).map_err(ComplianceError::from)?;
        Ok(Self {
            entries: PreparedComplianceEntries::new(entries)?,
            profile,
            resolver,
            collation,
            reference_date,
            youth_protection,
            months: Mutex::new(MonthCache::default()),
        })
    }
    /// The annual source gate deliberately requires a holiday package for the
    /// first day. General monthly callers retain their separate source policy.
    pub fn adult_month(&self, month: &str) -> CachedMonth {
        let cell = {
            let mut cache = self
                .months
                .lock()
                .map_err(|_| AnnualComplianceError::InvalidInput)?;
            if let Some(cell) = cache.cells.get(month) {
                Arc::clone(cell)
            } else {
                if cache.cells.len() >= 36
                    && let Some(old) = cache.order.pop_front()
                {
                    cache.cells.remove(&old);
                }
                let cell = Arc::new(OnceLock::new());
                cache.cells.insert(month.into(), Arc::clone(&cell));
                cache.order.push_back(month.into());
                cell
            }
        };
        // No cache mutex is held during projection, rule resolution or checks.
        cell.get_or_init(|| self.calculate_month(month)).clone()
    }
    fn calculate_month(&self, month: &str) -> CachedMonth {
        let date = format!("{month}-01");
        let basis = ComplianceProfile::at(&self.profile, &date)?;
        if self.resolver.resolve_holiday(&date).is_err() {
            return Ok(None);
        }
        let selected = match self.entries.select(month, &self.resolver) {
            Ok(shifts) => shifts,
            Err(error) => return capture_rule_error(error),
        };
        let source = PreparedDatedComplianceSource::with_shared_collation(
            selected.into_iter().cloned().collect::<Vec<_>>().into(),
            Arc::clone(&self.collation),
        );
        let mut options = serde_json::Map::new();
        options.insert("referenceDate".into(), json!(self.reference_date));
        options.insert("youthProtection".into(), json!(self.youth_protection));
        for key in [
            "federalState",
            "holidayRegion",
            "weeklyMinutes",
            "regularRotatingNightWork",
            "sundayHolidayWorkEligible",
            "allEmploymentWorkRecorded",
        ] {
            if let Some(value) = basis.get(key) {
                options.insert(key.into(), value.clone());
            }
        }
        let zone = basis
            .get("timeZone")
            .and_then(Value::as_str)
            .ok_or(AnnualComplianceError::InvalidInput)?;
        match dated::calculate_monthly_compliance_with_basis(
            month,
            &source,
            zone,
            &Value::Object(options),
            &self.reference_date,
            &self.resolver,
            basis,
        ) {
            Ok(value) => Ok(Some(Arc::new(value))),
            Err(error) => capture_rule_error(error),
        }
    }
}
fn capture_rule_error(error: ComplianceError) -> CachedMonth {
    match error {
        ComplianceError::Rules(_) | ComplianceError::Holiday(HolidayError::Resolution(_)) => {
            Ok(None)
        }
        error => Err(error.into()),
    }
}
pub enum AnnualTraining<'a> {
    Loading,
    Error(Option<&'a str>),
    Ready {
        shifts: Arc<[Value]>,
        details: Arc<[Value]>,
        profiles: &'a PreparedTrainingProfiles,
    },
    /// Same raw source/preparation owner used by monthly checks in this snapshot.
    Prepared {
        source: &'a YouthSource,
        profiles: &'a PreparedTrainingProfiles,
    },
}
#[derive(Debug, Clone)]
pub enum AnnualComplianceError {
    InvalidYear,
    InvalidInput,
    Compliance(Arc<ComplianceError>),
    Training(Arc<TrainingComplianceError>),
}
impl std::fmt::Display for AnnualComplianceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidYear => f.write_str("Ungültiges Berichtsjahr."),
            Self::InvalidInput => f.write_str("Die Angaben zur Arbeitszeitprüfung sind ungültig."),
            Self::Compliance(e) => std::fmt::Display::fmt(e, f),
            Self::Training(e) => std::fmt::Display::fmt(e, f),
        }
    }
}
impl std::error::Error for AnnualComplianceError {}
impl From<ComplianceError> for AnnualComplianceError {
    fn from(error: ComplianceError) -> Self {
        Self::Compliance(Arc::new(error))
    }
}
impl From<TrainingComplianceError> for AnnualComplianceError {
    fn from(error: TrainingComplianceError) -> Self {
        Self::Training(Arc::new(error))
    }
}
impl From<crate::training::TrainingError> for AnnualComplianceError {
    fn from(error: crate::training::TrainingError) -> Self {
        TrainingComplianceError::from(error).into()
    }
}
impl AnnualComplianceError {
    pub fn source_error_name(&self) -> &str {
        match self {
            Self::Compliance(e) => e.source_error_name(),
            Self::Training(e) => e.source_error_name(),
            _ => "Error",
        }
    }
}
pub struct AnnualLegalReport {
    result: Value,
}
impl AnnualLegalReport {
    pub fn result(&self) -> &Value {
        &self.result
    }
    pub fn into_json(self) -> Value {
        self.result
    }
}
pub fn calculate_annual_compliance(
    year: i32,
    source: &AnnualComplianceSource,
    training: Option<&AnnualTraining<'_>>,
    collation: &CollationRanks,
) -> Result<AnnualLegalReport, AnnualComplianceError> {
    if !(1900..=4099).contains(&year) {
        return Err(AnnualComplianceError::InvalidYear);
    }
    if let Some(AnnualTraining::Prepared { source: youth, .. }) = training
        && !youth.shares_source_owner(source.entries.entries(), &source.profile)
    {
        return Err(AnnualComplianceError::InvalidInput);
    }
    let youth_source = if let Some(AnnualTraining::Ready {
        shifts, details, ..
    }) = training
    {
        Some(YouthSource::new(
            Arc::clone(shifts),
            Arc::clone(details),
            Arc::clone(&source.profile),
        ))
    } else {
        None
    };
    let mut months = Vec::new();
    let (mut critical, mut warning, mut complete) = (0_u64, 0_u64, true);
    for index in 1..=12 {
        let month = format!("{year}-{index:02}");
        let adult = source.adult_month(&month)?;
        let reused_youth = match training {
            Some(AnnualTraining::Prepared { source, .. }) => Some(*source),
            _ => youth_source.as_ref(),
        };
        let prepared = if let Some(youth) = reused_youth {
            Some(youth.prepare(&month)?)
        } else {
            None
        };
        let projected = match training {
            None => None,
            Some(value) => {
                let state = match value {
                    AnnualTraining::Loading => TrainingLoad::Loading,
                    AnnualTraining::Error(error) => TrainingLoad::Error(*error),
                    AnnualTraining::Ready { profiles, .. }
                    | AnnualTraining::Prepared { profiles, .. } => TrainingLoad::Ready {
                        entries: prepared
                            .as_ref()
                            .ok_or(AnnualComplianceError::InvalidInput)?,
                        profiles,
                    },
                };
                training::calculate_training_compliance_for_state(
                    &month,
                    adult.as_deref(),
                    state,
                    &source.resolver,
                    collation,
                )?
            }
        };
        let report = if training.is_some() {
            projected.as_ref().map(|r| r.result())
        } else {
            adult.as_ref().map(|r| r.result())
        };
        let month_complete =
            report.is_some_and(|r| r.get("trainingComplete") != Some(&Value::Bool(false)));
        complete &= month_complete;
        let issues = match report {
            Some(r) => r["issues"]
                .as_array()
                .map(Vec::as_slice)
                .ok_or(AnnualComplianceError::InvalidInput)?,
            None => &[],
        };
        if let Some(report) = report {
            critical = critical
                .checked_add(
                    report["criticalCount"]
                        .as_u64()
                        .ok_or(AnnualComplianceError::InvalidInput)?,
                )
                .ok_or(AnnualComplianceError::InvalidInput)?;
            warning = warning
                .checked_add(
                    report["warningCount"]
                        .as_u64()
                        .ok_or(AnnualComplianceError::InvalidInput)?,
                )
                .ok_or(AnnualComplianceError::InvalidInput)?;
        }
        let counts = checks::count_checks(issues);
        let classified = checks::classify_checks(issues);
        let training_days = report
            .and_then(|r| r.get("trainingTimeDays"))
            .filter(|v| !v.is_null())
            .cloned()
            .unwrap_or_else(|| json!([]));
        let mut output = json!({"month":month,"complianceComplete":month_complete,"trainingTimeDays":training_days,"checkCounts":classified});
        output
            .as_object_mut()
            .ok_or(AnnualComplianceError::InvalidInput)?
            .extend(
                serde_json::to_value(counts)
                    .map_err(|_| AnnualComplianceError::InvalidInput)?
                    .as_object()
                    .ok_or(AnnualComplianceError::InvalidInput)?
                    .iter()
                    .map(|(k, v)| (k.clone(), v.clone())),
            );
        months.push(output);
    }
    Ok(AnnualLegalReport {
        result: json!({"year":year,"criticalCount":critical,"warningCount":warning,"complianceCoverageComplete":complete,"months":months}),
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prepared_training_cannot_cross_raw_plan_or_profile_owners() {
        let entries: Arc<[Value]> = Arc::from([]);
        let profile = Arc::new(
            json!({"timeZone":"Europe/Berlin","federalState":"NW","holidayRegion":"NONE","weeklyMinutes":2310,"allEmploymentWorkRecorded":true}),
        );
        let source = AnnualComplianceSource::new(
            Arc::clone(&entries),
            Arc::clone(&profile),
            Arc::new(RuleResolver::bundled().unwrap()),
            CollationRanks::default(),
            "2026-12-31".into(),
            false,
        )
        .unwrap();
        let profiles = PreparedTrainingProfiles::try_from_raw(&[]).unwrap();
        let matching = YouthSource::new(Arc::clone(&entries), Arc::from([]), Arc::clone(&profile));
        assert!(
            calculate_annual_compliance(
                2026,
                &source,
                Some(&AnnualTraining::Prepared {
                    source: &matching,
                    profiles: &profiles
                }),
                &CollationRanks::default()
            )
            .is_ok()
        );
        let foreign_profile = YouthSource::new(
            Arc::clone(&entries),
            Arc::from([]),
            Arc::new(profile.as_ref().clone()),
        );
        let foreign_plan = YouthSource::new(Arc::from([]), Arc::from([]), Arc::clone(&profile));
        for foreign in [&foreign_profile, &foreign_plan] {
            assert!(matches!(
                calculate_annual_compliance(
                    2026,
                    &source,
                    Some(&AnnualTraining::Prepared {
                        source: foreign,
                        profiles: &profiles
                    }),
                    &CollationRanks::default()
                ),
                Err(AnnualComplianceError::InvalidInput)
            ));
        }
    }
    #[test]
    fn repeated_annual_views_share_the_same_native_month_result() {
        let source=AnnualComplianceSource::new(Arc::from([]),Arc::new(json!({"timeZone":"Europe/Berlin","federalState":"NW","holidayRegion":"NONE","weeklyMinutes":2310,"allEmploymentWorkRecorded":true})),Arc::new(RuleResolver::bundled().unwrap()),CollationRanks::default(),"2026-12-31".into(),false).unwrap();
        let first = source.adult_month("2026-09").unwrap().unwrap();
        let second = source.adult_month("2026-09").unwrap().unwrap();
        assert!(Arc::ptr_eq(&first, &second));
        let a =
            calculate_annual_compliance(2026, &source, None, &CollationRanks::default()).unwrap();
        let b =
            calculate_annual_compliance(2026, &source, None, &CollationRanks::default()).unwrap();
        assert_eq!(a.result(), b.result());
        let third = source.adult_month("2026-09").unwrap().unwrap();
        assert!(Arc::ptr_eq(&first, &third));
        assert_eq!(source.months.lock().unwrap().cells.len(), 12);
    }
}
