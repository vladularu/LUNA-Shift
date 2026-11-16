//! Calendar distances and earlier-midnight boundaries derived exclusively in Rust.
use super::{
    average::add_days,
    model::{ComplianceError, integer, text},
    rest_kernel::{Day, Interval, Request, Shift},
    sunday::SundayContext,
};
use crate::{EngineError, calendar::parse_date, time};
use jiff::{
    Timestamp,
    civil::{Date, Time},
    tz::{Disambiguation, TimeZone},
};
use serde_json::Value;
use std::collections::BTreeSet;
const DAY_MS: i64 = 86_400_000;
pub(super) fn ordinal(date: Date) -> Result<i32, ComplianceError> {
    let midnight = TimeZone::UTC
        .to_ambiguous_zoned(date.to_datetime(Time::midnight()))
        .disambiguate(Disambiguation::Earlier)
        .map_err(|_| EngineError::InvalidDate)?;
    i32::try_from(midnight.timestamp().as_millisecond() / DAY_MS)
        .map_err(|_| ComplianceError::InvalidInput)
}
pub(super) fn date(day: i32) -> Result<Date, ComplianceError> {
    Ok(Timestamp::from_millisecond(i64::from(day) * DAY_MS)
        .map_err(|_| EngineError::InvalidDate)?
        .to_zoned(TimeZone::UTC)
        .date())
}
pub(super) fn sunday(day: i32) -> bool {
    (day + 4).rem_euclid(7) == 0
}
pub(super) fn bounds(date: Date, time_zone: &str) -> Result<(i64, i64), ComplianceError> {
    let zone = time::zone(time_zone)?;
    let midnight = |date: Date| {
        zone.to_ambiguous_zoned(date.to_datetime(Time::midnight()))
            .disambiguate(Disambiguation::Earlier)
            .map(|z| z.timestamp().as_millisecond())
            .map_err(|_| ComplianceError::Calculation(EngineError::InvalidTime))
    };
    Ok((midnight(date)?, midnight(add_days(date, 1)?)?))
}
pub(super) fn prepare_request(
    c: &SundayContext<'_>,
    holidays: &BTreeSet<String>,
) -> Result<Request, ComplianceError> {
    let coverage_start = ordinal(parse_date(c.coverage_start)?)?;
    let coverage_end = ordinal(parse_date(c.coverage_end)?)?;
    if coverage_start > coverage_end {
        return Err(ComplianceError::InvalidInput);
    }
    let mut first = coverage_start;
    let mut last = coverage_end;
    for item in c.intervals {
        first = first.min(ordinal(item.start.date())?);
        last = last.max(ordinal(item.end.date())?);
    }
    let mut days = vec![];
    for day in first..=last {
        let date = date(day)?;
        let (start_ms, end_ms) = bounds(date, c.time_zone)?;
        days.push(Day {
            day,
            date: date.to_string(),
            start_ms,
            end_ms,
        });
    }
    let optional = |shift: &Value, key: &str| -> Result<Option<String>, ComplianceError> {
        match shift.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(value) => value
                .as_str()
                .map(|v| Some(v.to_owned()))
                .ok_or(ComplianceError::InvalidInput),
        }
    };
    let shifts = c
        .shifts
        .iter()
        .map(|shift| {
            Ok(Shift {
                id: text(shift, "id")?.into(),
                date: text(shift, "date")?.into(),
                shift_type: text(shift, "type")?.into(),
                start_time: optional(shift, "startTime")?,
                end_time: optional(shift, "endTime")?,
                deleted_at: optional(shift, "deletedAt")?,
            })
        })
        .collect::<Result<_, ComplianceError>>()?;
    let intervals = c
        .intervals
        .iter()
        .map(|i| {
            Ok(Interval {
                shift_id: text(&i.shift, "id")?.into(),
                start_ms: i.start.timestamp().as_millisecond(),
                end_ms: i.end.timestamp().as_millisecond(),
            })
        })
        .collect::<Result<_, ComplianceError>>()?;
    let rules = &c.rules["sundayHolidayRest"];
    let sunday_period_days = i32::try_from(integer(rules, "sundayCompensationPeriodDays")?)
        .map_err(|_| ComplianceError::InvalidInput)?;
    let holiday_period_days =
        i32::try_from(integer(rules, "weekdayHolidayCompensationPeriodDays")?)
            .map_err(|_| ComplianceError::InvalidInput)?;
    let holidays = holidays
        .iter()
        .map(|v| ordinal(parse_date(v)?))
        .collect::<Result<_, ComplianceError>>()?;
    Ok(Request {
        coverage_start,
        coverage_end,
        sunday_period_days,
        holiday_period_days,
        required_rest_minutes: integer(rules, "replacementDayMinutes")?
            + integer(rules, "connectedRestMinutes")?,
        evidence_shift_type: text(rules, "evidenceShiftType")?.into(),
        days,
        holidays,
        shifts,
        intervals,
    })
}
