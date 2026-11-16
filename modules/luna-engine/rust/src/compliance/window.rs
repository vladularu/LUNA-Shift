//! Legal horizons are derived from the selected, validated rule package.
use super::model::{ComplianceError, array, integer, optional_integer};
use crate::{EngineError, calendar::parse_date, rules::RuleResolver};
use jiff::{ToSpan, civil::Date};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegalCalculationWindow {
    pub lookback_days: i64,
    pub lookahead_days: i64,
    pub short_assessment_lookback_days: i64,
    pub short_assessment_lookahead_days: i64,
    pub short_assessment_lookahead_calendar_months: i64,
    pub lookahead_calendar_months: i64,
    pub calendar_year_coverage: bool,
}
pub fn legal_calculation_window(
    date: &str,
    resolver: &RuleResolver,
) -> Result<LegalCalculationWindow, ComplianceError> {
    let package = resolver.resolve_legal(date)?;
    let rules = package.rules();
    let sunday = if package.engine_contract_version >= 5 {
        rules.get("sundayHolidayRest")
    } else {
        None
    };
    let replacement = if let Some(sunday) = sunday {
        integer(sunday, "sundayCompensationPeriodDays")?
            .max(integer(sunday, "weekdayHolidayCompensationPeriodDays")?)
            - 1
            + (integer(sunday, "connectedRestMinutes")? + 1439) / 1440
    } else {
        0
    };
    let planning = &rules["planning"];
    let short_back = integer(planning, "consecutiveWorkDaysWarning")?
        .max(integer(planning, "consecutiveNightShiftsWarning")?)
        .max(integer(planning, "consecutiveWeekendGapDays")?)
        + 1;
    let mut short_ahead = optional_integer(&rules["nightWork"], "averageWindowDays")?;
    let mut short_months = 0;
    for deviation in array(&rules["restPeriod"], "deviations")? {
        short_ahead = short_ahead.max(integer(deviation, "compensationWithinDays")?);
        short_months = short_months.max(optional_integer(
            deviation,
            "compensationWithinCalendarMonths",
        )?);
    }
    let average_months = if package.engine_contract_version >= 4 {
        rules["workingTime"]
            .get("standardAverage")
            .map(|value| optional_integer(value, "calendarMonths"))
            .transpose()?
            .unwrap_or(0)
    } else {
        0
    };
    Ok(LegalCalculationWindow {
        lookback_days: short_back.max(replacement),
        lookahead_days: short_ahead.max(replacement),
        short_assessment_lookback_days: short_back,
        short_assessment_lookahead_days: short_ahead,
        short_assessment_lookahead_calendar_months: short_months,
        lookahead_calendar_months: average_months.max(short_months),
        calendar_year_coverage: (package.engine_contract_version >= 3
            && rules["nightWork"].get("workerQualification").is_some())
            || sunday.is_some(),
    })
}
pub fn calculation_end(
    month_end: Date,
    window: &LegalCalculationWindow,
) -> Result<Date, ComplianceError> {
    let days = month_end
        .checked_add(window.lookahead_days.days())
        .map_err(|_| EngineError::InvalidDate)?;
    let months = month_end
        .checked_add(window.lookahead_calendar_months.months())
        .map_err(|_| EngineError::InvalidDate)?;
    Ok(days.max(months))
}
pub fn planning_weekend_coverage_start(month: &str) -> Result<String, ComplianceError> {
    let first = parse_date(&format!("{month}-01"))?;
    let offset = (7 - first.weekday().to_monday_one_offset()) % 7;
    first
        .checked_add(offset.days())
        .and_then(|sunday| sunday.checked_sub(41.days()))
        .map(|day| day.to_string())
        .map_err(|_| EngineError::InvalidDate.into())
}
