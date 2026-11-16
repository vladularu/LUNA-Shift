//! Complete monthly compliance core over one immutable native source.
use super::{
    adult,
    average::{AverageContext, add_days},
    evidence,
    model::{self, ComplianceError, ComplianceInterval, text},
    night_average, planning_nights, planning_series, planning_weekends,
    preparation::{self, PreparedShifts},
    profile::ComplianceProfile,
    result, simple_youth,
    split::SplitDutyBreakCheck,
    sunday::{self, SundayContext},
    tariff,
};
use crate::{calendar::recurrence::CollationRanks, rules::RuleResolver};
use serde_json::{Value, json};
use std::sync::Arc;

/// Projection and split-duty evidence are calculated once, never accepted from a host.
pub struct PreparedComplianceSource {
    original: Arc<[Value]>,
    time_zone: String,
    prepared: PreparedShifts,
    split: SplitDutyBreakCheck,
}
impl PreparedComplianceSource {
    pub fn new(
        shifts: Arc<[Value]>,
        time_zone: &str,
        collation: &CollationRanks,
    ) -> Result<Self, ComplianceError> {
        let split = SplitDutyBreakCheck::new(&shifts)?;
        let prepared = PreparedShifts::new(&shifts, time_zone, collation)?;
        Ok(Self {
            original: shifts,
            time_zone: time_zone.into(),
            prepared,
            split,
        })
    }
    pub fn shifts(&self) -> &[Value] {
        &self.original
    }
    pub fn time_zone(&self) -> &str {
        &self.time_zone
    }
    pub fn projected_shifts(&self) -> &PreparedShifts {
        &self.prepared
    }
    pub fn split_breaks(&self) -> &SplitDutyBreakCheck {
        &self.split
    }
}
/// Only native assessment code can construct this result; no Deserialize boundary.
pub struct AssessedMonth {
    result: Value,
}
impl AssessedMonth {
    pub(super) fn from_native_result(result: Value) -> Self {
        Self { result }
    }
    pub fn result(&self) -> &Value {
        &self.result
    }
    pub fn into_json(self) -> Value {
        self.result
    }
}
pub fn calculate_monthly_core(
    month: &str,
    source: &PreparedComplianceSource,
    options: &Value,
    clock_date: &str,
    resolver: &RuleResolver,
) -> Result<AssessedMonth, ComplianceError> {
    calculate_monthly_core_with_profile(
        month,
        source,
        options,
        clock_date,
        resolver,
        options
            .get("employmentProfile")
            .map(ComplianceProfile::from_raw),
    )
}
/// Dated options copy only scalar facts. The original immutable profile remains borrowed.
pub(super) fn calculate_monthly_core_with_profile(
    month: &str,
    source: &PreparedComplianceSource,
    options: &Value,
    clock_date: &str,
    resolver: &RuleResolver,
    employment_profile: Option<ComplianceProfile<'_>>,
) -> Result<AssessedMonth, ComplianceError> {
    let duty_issues = evidence::special_duty_issues(source.shifts(), month)?;
    let context = preparation::prepare_calendar_from_input(
        month,
        source.projected_shifts(),
        options,
        clock_date,
        resolver,
    )?;
    let rules = context.legal_package.rules();
    let version = context.legal_package.engine_contract_version;
    let coverage_end = add_days(crate::calendar::parse_date(&context.end)?, 1)?.to_string();
    let weekend = if crate::credit::summary::truthy(options.get("skipWeekendAssessment")) {
        None
    } else {
        Some(planning_weekends::check_planning_weekends_for_profile(
            month,
            source.shifts(),
            source.time_zone(),
            options,
            Some((&context.start, &coverage_end)),
            employment_profile,
        )?)
    };
    let mut initial = duty_issues;
    if let Some(weekend) = &weekend {
        initial.extend(
            weekend["issues"]
                .as_array()
                .ok_or(ComplianceError::InvalidInput)?
                .iter()
                .cloned(),
        );
    }
    let assessment_start = context.short_assessment_start.to_string();
    let assessment_end = context.short_assessment_end.to_string();
    let assessment = select_intervals(&context.intervals, &assessment_start, &assessment_end)?;
    let calculated = if options.get("youthProtection") == Some(&Value::Bool(true)) {
        initial.extend(adult::check_duplicates(&assessment)?);
        initial.extend(adult::check_overlaps(&assessment)?);
        initial.extend(planning_series::check_planning_series(
            &assessment,
            rules,
            true,
        )?);
        simple_youth::calculate_simple_youth_compliance(
            month,
            &context.intervals,
            options,
            &initial,
            resolver,
        )?
    } else if context.shifts.is_empty() {
        initial.extend(evidence::check_evidence_completeness(
            month,
            &[],
            options,
            rules,
        )?);
        initial.extend(sunday::check_sunday_holiday_rest_with_profile(
            &SundayContext {
                month,
                intervals: &[],
                shifts: &[],
                options,
                reference_date: context.reference_date,
                rules,
                resolver,
                version,
                time_zone: source.time_zone(),
                coverage_start: &context.start,
                coverage_end: &context.end,
            },
            employment_profile,
        )?);
        result::finish_monthly_compliance(month, &initial, &context.start, &context.end)?
    } else {
        let night_worker = model::qualify_as_night_worker(
            &context.intervals,
            rules,
            version,
            context.first.year(),
            options,
        )?;
        initial.extend(tariff::check_tariff_working_time_with_profile(
            month,
            source.shifts(),
            source.time_zone(),
            options,
            &context.reference_date.to_string(),
            employment_profile,
        )?);
        let employment_intervals = employment_evidence_intervals(&assessment, options)?;
        initial.extend(evidence::check_evidence_completeness(
            month,
            &employment_intervals,
            options,
            rules,
        )?);
        initial.extend(adult::check_duplicates(&assessment)?);
        initial.extend(adult::check_overlaps(&assessment)?);
        initial.extend(adult::check_working_time(
            &assessment,
            rules,
            version,
            night_worker,
            source.split_breaks(),
        )?);
        let working_average = select_intervals(
            &context.intervals,
            &context.first.to_string(),
            &context.base_end.to_string(),
        )?;
        let average = AverageContext {
            month,
            intervals: &working_average,
            shifts: &context.shifts,
            options,
            reference_date: context.reference_date,
            rules,
            resolver,
            version,
            night_worker,
        };
        initial.extend(super::working_average::check_working_time_average(
            &average,
        )?);
        initial.extend(night_average::check_night_working_time_average(
            &AverageContext {
                intervals: &assessment,
                ..average
            },
        )?);
        let sector = options
            .get("sectorId")
            .filter(|v| !v.is_null())
            .map(|v| v.as_str().ok_or(ComplianceError::InvalidInput))
            .transpose()?
            .unwrap_or("care");
        initial.extend(adult::check_rest_and_sequence(
            &assessment,
            context.reference_date,
            rules,
            sector,
        )?);
        initial.extend(sunday::check_sunday_holiday_rest_with_profile(
            &SundayContext {
                month,
                intervals: &context.intervals,
                shifts: &context.calculation_shifts,
                options,
                reference_date: context.reference_date,
                rules,
                resolver,
                version,
                time_zone: source.time_zone(),
                coverage_start: &context.start,
                coverage_end: &context.end,
            },
            employment_profile,
        )?);
        let scientific_nights = sector == "care";
        initial.extend(planning_series::check_planning_series(
            &assessment,
            rules,
            !scientific_nights,
        )?);
        if scientific_nights {
            // These are the source's three scalar options; the original profile is borrowed above.
            let planning_options = json!({"allEmploymentWorkRecorded":options.get("allEmploymentWorkRecorded"),"coverageStart":context.start,"coverageEnd":context.end});
            initial.extend(planning_nights::check_planning_nights(
                &context.intervals,
                source.shifts(),
                source.time_zone(),
                &planning_options,
            )?);
        }
        result::finish_monthly_compliance(month, &initial, &context.start, &context.end)?
    };
    let result = with_weekends(calculated, weekend.as_ref(), &context.start, &context.end)?;
    Ok(AssessedMonth { result })
}

fn select_intervals(
    intervals: &[ComplianceInterval],
    from: &str,
    through: &str,
) -> Result<Vec<ComplianceInterval>, ComplianceError> {
    intervals
        .iter()
        .filter_map(|item| match text(&item.shift, "date") {
            Ok(date) if date >= from && date <= through => Some(Ok(item.clone())),
            Ok(_) => None,
            Err(e) => Some(Err(e)),
        })
        .collect()
}
fn employment_evidence_intervals(
    intervals: &[ComplianceInterval],
    options: &Value,
) -> Result<Vec<ComplianceInterval>, ComplianceError> {
    let Some(period) = options
        .get("employmentAssessmentPeriod")
        .filter(|v| crate::credit::summary::truthy(Some(v)))
    else {
        return Ok(intervals.to_vec());
    };
    let from = text(period, "from")?;
    let until = period
        .get("until")
        .filter(|v| crate::credit::summary::truthy(Some(v)))
        .map(|v| v.as_str().ok_or(ComplianceError::InvalidInput))
        .transpose()?;
    intervals
        .iter()
        .filter_map(|item| match text(&item.shift, "date") {
            Ok(date) if date >= from && until.is_none_or(|until| date < until) => {
                Some(Ok(item.clone()))
            }
            Ok(_) => None,
            Err(e) => Some(Err(e)),
        })
        .collect()
}
fn with_weekends(
    mut result: Value,
    weekend: Option<&Value>,
    start: &str,
    end: &str,
) -> Result<Value, ComplianceError> {
    let from = result["assessmentRange"]["from"]
        .as_str()
        .map_or(start, |v| v.min(start))
        .to_owned();
    let through = result["assessmentRange"]["through"]
        .as_str()
        .map_or(end, |v| v.max(end))
        .to_owned();
    let object = result
        .as_object_mut()
        .ok_or(ComplianceError::InvalidInput)?;
    if let Some(weekend) = weekend {
        object.insert("weekendAssessment".into(), weekend["assessment"].clone());
    }
    object.insert(
        "assessmentRange".into(),
        json!({"from":from,"through":through}),
    );
    Ok(result)
}
