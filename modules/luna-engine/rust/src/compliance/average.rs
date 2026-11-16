//! Native-only shared context for statutory average checks.
use super::model::{ComplianceError, ComplianceInterval, js_round, text};
use crate::{
    EngineError,
    rules::{
        RuleResolver,
        holidays::{HolidayError, holiday_calendar},
    },
};
use jiff::{ToSpan, civil::Date};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
/// No Deserialize or host constructor: intervals and qualification come from Rust.
pub struct AverageContext<'a> {
    pub month: &'a str,
    pub intervals: &'a [ComplianceInterval],
    pub shifts: &'a [Arc<Value>],
    pub options: &'a Value,
    pub reference_date: Date,
    pub rules: &'a Value,
    pub resolver: &'a RuleResolver,
    pub version: u32,
    pub night_worker: bool,
}

pub(crate) fn add_days(date: Date, days: i64) -> Result<Date, ComplianceError> {
    date.checked_add(days.days())
        .map_err(|_| EngineError::InvalidDate.into())
}
pub(crate) fn add_months(date: Date, months: i64) -> Result<Date, ComplianceError> {
    date.checked_add(months.months())
        .map_err(|_| EngineError::InvalidDate.into())
}
pub(crate) fn duration_label(minutes: f64) -> Result<String, ComplianceError> {
    let rounded = js_round(minutes)?.max(0.0);
    Ok(format!(
        "{:.0}:{:02.0} h",
        (rounded / 60.0).floor(),
        rounded % 60.0
    ))
}
pub(crate) fn date_label(date: Date) -> String {
    format!("{:02}.{:02}.{}", date.day(), date.month(), date.year())
}
pub(crate) fn groups(
    intervals: &[ComplianceInterval],
) -> Result<Vec<Vec<&ComplianceInterval>>, ComplianceError> {
    let mut by_date = BTreeMap::<&str, Vec<&ComplianceInterval>>::new();
    for item in intervals {
        by_date
            .entry(text(&item.shift, "date")?)
            .or_default()
            .push(item);
    }
    // Dates are canonical fixed-width ASCII; their locale order equals lexical order.
    Ok(by_date.into_values().collect())
}
pub(crate) fn known_holidays(
    start: Date,
    end: Date,
    options: &Value,
    resolver: &RuleResolver,
) -> Result<BTreeSet<String>, ComplianceError> {
    let Some(state) = options
        .get("federalState")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    else {
        return Ok(BTreeSet::new());
    };
    let region = options
        .get("holidayRegion")
        .and_then(Value::as_str)
        .unwrap_or("NONE");
    let mut dates = BTreeSet::new();
    let first = start.to_string();
    let last = end.to_string();
    for year in start.year()..=end.year() {
        match holiday_calendar(i32::from(year), state, region, resolver) {
            Ok(calendar) => {
                for holiday in calendar.entries() {
                    if holiday.date >= first && holiday.date <= last {
                        dates.insert(holiday.date.clone());
                    }
                }
            }
            Err(HolidayError::Resolution(_)) => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(dates)
}
pub(crate) fn statutory_workdays(
    start: Date,
    end: Date,
    holidays: &BTreeSet<String>,
    last_weekday: i64,
) -> Result<usize, ComplianceError> {
    let mut count = 0;
    let mut date = start;
    while date <= end {
        if i64::from(date.weekday().to_monday_one_offset()) <= last_weekday
            && !holidays.contains(&date.to_string())
        {
            count += 1;
        }
        if date == end {
            break;
        }
        date = add_days(date, 1)?;
    }
    Ok(count)
}
pub(crate) fn range(
    intervals: &[ComplianceInterval],
    start: Date,
    end: Date,
) -> Result<Vec<&ComplianceInterval>, ComplianceError> {
    let first = start.to_string();
    let last = end.to_string();
    intervals
        .iter()
        .filter_map(|item| match text(&item.shift, "date") {
            Ok(date) if date >= first.as_str() && date <= last.as_str() => Some(Ok(item)),
            Ok(_) => None,
            Err(e) => Some(Err(e)),
        })
        .collect()
}
