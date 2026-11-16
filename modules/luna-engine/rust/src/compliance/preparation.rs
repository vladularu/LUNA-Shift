use super::{
    model::{ComplianceError, ComplianceInterval, minutes_between, number, text},
    window,
};
use crate::{
    EngineError,
    calendar::{parse_date, recurrence::CollationRanks},
    credit::duty::project_duty_shifts,
    rules::{RulePackage, RuleResolver},
    time::{self, ShiftTime},
};
use jiff::{ToSpan, civil::Date};
use serde_json::{Value, json};
use std::{collections::BTreeSet, sync::Arc};
/// Native normalized stored entries, before locale rank binding. This accepts
/// no precomputed intervals or findings and never clones the whole input plan.
pub fn check_collation_candidates(entries: &[Value]) -> Result<BTreeSet<String>, ComplianceError> {
    let mut candidates: BTreeSet<_> = crate::training::code_candidates()
        .iter()
        .map(|s| (*s).to_owned())
        .collect();
    for entry in entries.iter().filter(|entry| entry["kind"] == "SHIFT") {
        if entry.get("specialDuty").is_some_and(|duty| !duty.is_null()) {
            for projected in crate::credit::duty::project_duty_work(entry)? {
                candidates.insert(text(&projected, "id")?.to_owned());
            }
        } else {
            candidates.insert(text(entry, "id")?.to_owned());
        }
    }
    Ok(candidates)
}
/// No Deserialize implementation: no host may submit computed legal intervals.
pub struct PreparedCalendar<'a> {
    pub shifts: Arc<[Arc<Value>]>,
    pub reference_date: Date,
    pub first: Date,
    pub legal_package: &'a RulePackage,
    pub base_end: Date,
    pub short_assessment_start: Date,
    pub short_assessment_end: Date,
    pub start: String,
    pub end: String,
    pub intervals: Vec<ComplianceInterval>,
    pub calculation_shifts: Vec<Arc<Value>>,
}

/// Projection/timezone conversion is shared by all month checks in one immutable
/// native request. These fields cannot be deserialized from a host calculation.
pub struct PreparedShifts {
    shifts: Arc<[Arc<Value>]>,
    intervals: Vec<ComplianceInterval>,
}
impl PreparedShifts {
    pub fn new(
        shifts: &[Value],
        time_zone: &str,
        collation: &CollationRanks,
    ) -> Result<Self, ComplianceError> {
        let shifts: Arc<[Arc<Value>]> = project_duty_shifts(shifts)?
            .into_iter()
            .map(Arc::new)
            .collect::<Vec<_>>()
            .into();
        let mut intervals = Vec::new();
        for shift in shifts.iter() {
            if !is_relevant(shift) {
                continue;
            }
            let interval = to_interval(Arc::clone(shift), time_zone)?;
            let date = text(shift, "date")?.to_owned();
            let start = text(shift, "startTime")?.to_owned();
            let rank = collation.rank(text(shift, "id")?)?;
            intervals.push(((date, start, rank), interval));
        }
        intervals.sort_by(|left, right| left.0.cmp(&right.0));
        Ok(Self {
            shifts,
            intervals: intervals
                .into_iter()
                .map(|(_, interval)| interval)
                .collect(),
        })
    }
    pub fn shifts(&self) -> &[Arc<Value>] {
        &self.shifts
    }
    pub fn intervals(&self) -> &[ComplianceInterval] {
        &self.intervals
    }
}
fn is_relevant(shift: &Value) -> bool {
    shift.get("deletedAt").is_some_and(Value::is_null)
        && shift.get("allDay").and_then(Value::as_bool) != Some(true)
        && matches!(
            shift["type"].as_str(),
            Some("EARLY" | "LATE" | "NIGHT" | "DAY" | "TRAINING" | "CUSTOM")
        )
        && shift.get("startTime").is_some_and(|value| !value.is_null())
        && shift.get("endTime").is_some_and(|value| !value.is_null())
}
fn to_interval(shift: Arc<Value>, time_zone: &str) -> Result<ComplianceInterval, ComplianceError> {
    let projection = ShiftTime {
        date: text(&shift, "date")?.to_owned(),
        start_time: Some(text(&shift, "startTime")?.to_owned()),
        end_time: Some(text(&shift, "endTime")?.to_owned()),
        break_minutes: 0,
        all_day: false,
        special_duty: None,
    };
    let instants =
        time::shift_instants(&projection, time_zone)?.ok_or(ComplianceError::InvalidInput)?;
    let zone = time::zone(time_zone)?;
    let start = jiff::Timestamp::from_millisecond(instants.start_epoch_milliseconds)
        .map_err(|_| EngineError::InvalidTime)?
        .to_zoned(zone.clone());
    let end = jiff::Timestamp::from_millisecond(instants.end_epoch_milliseconds)
        .map_err(|_| EngineError::InvalidTime)?
        .to_zoned(zone);
    let gross_minutes = minutes_between(&start, &end)?.max(0.0);
    let net_minutes = (gross_minutes - number(&shift, "breakMinutes")?).max(0.0);
    Ok(ComplianceInterval {
        shift,
        start,
        end,
        gross_minutes,
        net_minutes,
        night_minutes_cache: Default::default(),
    })
}
impl PreparedCalendar<'_> {
    pub fn to_json(&self) -> Value {
        json!({"shifts":self.shifts.iter().map(Arc::as_ref).collect::<Vec<_>>(),"referenceDate":self.reference_date.to_string(),"first":self.first.to_string(),"legalPackage":self.legal_package,"rules":self.legal_package.rules(),"baseEnd":self.base_end.to_string(),"shortAssessmentStart":self.short_assessment_start.to_string(),"shortAssessmentEnd":self.short_assessment_end.to_string(),"start":self.start,"end":self.end,"intervals":self.intervals.iter().map(ComplianceInterval::to_json).collect::<Vec<_>>(),"calculationShifts":self.calculation_shifts.iter().map(Arc::as_ref).collect::<Vec<_>>()})
    }
}
pub fn prepare_calendar<'a>(
    month: &str,
    shifts: &[Value],
    time_zone: &str,
    options: &Value,
    clock_date: &str,
    resolver: &'a RuleResolver,
    collation: &CollationRanks,
) -> Result<PreparedCalendar<'a>, ComplianceError> {
    let prepared = PreparedShifts::new(shifts, time_zone, collation)?;
    prepare_calendar_from_input(month, &prepared, options, clock_date, resolver)
}

pub fn prepare_calendar_from_input<'a>(
    month: &str,
    prepared: &PreparedShifts,
    options: &Value,
    clock_date: &str,
    resolver: &'a RuleResolver,
) -> Result<PreparedCalendar<'a>, ComplianceError> {
    let reference_date = parse_date(
        options
            .get("referenceDate")
            .filter(|value| !value.is_null())
            .map(|value| value.as_str().ok_or(ComplianceError::InvalidInput))
            .transpose()?
            .unwrap_or(clock_date),
    )?;
    let first = parse_date(&format!("{month}-01"))?;
    let legal_package = resolver.resolve_legal(&first.to_string())?;
    let calculation = window::legal_calculation_window(&first.to_string(), resolver)?;
    let base_start = first
        .checked_sub(calculation.lookback_days.days())
        .map_err(|_| EngineError::InvalidDate)?;
    let month_end = first.last_of_month();
    let short_assessment_start = first
        .checked_sub(calculation.short_assessment_lookback_days.days())
        .map_err(|_| EngineError::InvalidDate)?;
    let short_days = month_end
        .checked_add(calculation.short_assessment_lookahead_days.days())
        .map_err(|_| EngineError::InvalidDate)?;
    let short_months = month_end
        .checked_add(
            calculation
                .short_assessment_lookahead_calendar_months
                .months(),
        )
        .map_err(|_| EngineError::InvalidDate)?;
    let short_assessment_end = short_days.max(short_months);
    let base_end = window::calculation_end(month_end, &calculation)?;
    let year_start = Date::new(first.year(), 1, 1).map_err(|_| EngineError::InvalidDate)?;
    let year_end = Date::new(first.year(), 12, 31).map_err(|_| EngineError::InvalidDate)?;
    let legal_start = if calculation.calendar_year_coverage {
        base_start.min(year_start)
    } else {
        base_start
    }
    .to_string();
    let weekend_start = window::planning_weekend_coverage_start(month)?;
    let start = legal_start.min(weekend_start);
    let end = if calculation.calendar_year_coverage {
        base_end.max(year_end)
    } else {
        base_end
    }
    .to_string();
    let intervals = prepared
        .intervals
        .iter()
        .filter(|interval| {
            interval.shift["date"]
                .as_str()
                .is_some_and(|date| date >= start.as_str() && date <= end.as_str())
        })
        .cloned()
        .collect();
    let calculation_shifts = prepared
        .shifts
        .iter()
        .filter(|shift| {
            shift.get("deletedAt").is_some_and(Value::is_null)
                && shift["date"]
                    .as_str()
                    .is_some_and(|date| date >= start.as_str() && date <= end.as_str())
        })
        .cloned()
        .collect();
    Ok(PreparedCalendar {
        shifts: Arc::clone(&prepared.shifts),
        reference_date,
        first,
        legal_package,
        base_end,
        short_assessment_start,
        short_assessment_end,
        start,
        end,
        intervals,
        calculation_shifts,
    })
}
