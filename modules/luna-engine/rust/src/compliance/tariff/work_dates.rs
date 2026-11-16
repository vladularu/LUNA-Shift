//! Conservative recorded work uses compatible ordinary timestamps and actual duty parts.
use crate::compliance::{
    average::add_days,
    holiday_coverage::truthy,
    model::{ComplianceError, text},
};
use crate::{EngineError, calendar::parse_date, credit::duty, time};
use jiff::{
    Timestamp,
    civil::{Date, Time},
    tz::{Disambiguation, TimeZone},
};
use num_traits::ToPrimitive;
use serde_json::Value;
use std::collections::BTreeSet;
fn midnight(date: Date, zone: &TimeZone) -> Result<i64, ComplianceError> {
    zone.to_ambiguous_zoned(date.to_datetime(Time::midnight()))
        .disambiguate(Disambiguation::Compatible)
        .map(|z| z.timestamp().as_millisecond())
        .map_err(|_| EngineError::InvalidTime.into())
}
fn calculate(shift: &Value, zone_name: &str) -> Result<Vec<String>, ComplianceError> {
    let zone = time::zone(zone_name)?;
    let date = text(shift, "date")?;
    let mut intervals = vec![];
    if let Some(special) = shift.get("specialDuty").filter(|v| truthy(v)) {
        let duty_zone = time::zone(text(special, "timeZone")?)?;
        for part in duty::parts(shift)? {
            intervals.push((
                time::duty_instant(date, part.start, &duty_zone)?,
                time::duty_instant(date, part.end, &duty_zone)?,
                part.break_minutes
                    .to_f64()
                    .ok_or(ComplianceError::InvalidInput)?,
            ));
        }
    } else {
        let start = text(shift, "startTime")?;
        let end = text(shift, "endTime")?;
        let day = parse_date(date)?;
        let instant = |day: Date, clock: &str| -> Result<i64, ComplianceError> {
            let clock = clock
                .parse::<Time>()
                .map_err(|_| EngineError::InvalidTime)?;
            zone.to_ambiguous_zoned(day.to_datetime(clock))
                .disambiguate(Disambiguation::Compatible)
                .map(|z| z.timestamp().as_millisecond())
                .map_err(|_| EngineError::InvalidTime.into())
        };
        intervals.push((
            instant(day, start)?,
            instant(add_days(day, i64::from(end <= start))?, end)?,
            shift["breakMinutes"]
                .as_f64()
                .ok_or(ComplianceError::InvalidInput)?,
        ));
    }
    let mut dates = BTreeSet::new();
    for (start, end, pause) in intervals {
        if end <= start {
            continue;
        }
        let mut day = Timestamp::from_millisecond(start)
            .map_err(|_| EngineError::InvalidDate)?
            .to_zoned(zone.clone())
            .date();
        let last = Timestamp::from_millisecond(end - 1)
            .map_err(|_| EngineError::InvalidDate)?
            .to_zoned(zone.clone())
            .date();
        for _ in 0..16 {
            if day > last {
                break;
            }
            let lower = start.max(midnight(day, &zone)?);
            let upper = end.min(midnight(add_days(day, 1)?, &zone)?);
            if (upper - lower) as f64 / 60_000.0 > pause {
                dates.insert(day.to_string());
            }
            day = add_days(day, 1)?;
        }
    }
    Ok(dates.into_iter().collect())
}
pub fn recorded_work_dates(shift: &Value, time_zone: &str) -> Vec<String> {
    if shift.get("deletedAt") != Some(&Value::Null)
        || shift.get("allDay").is_some_and(truthy)
        || matches!(
            shift.get("type").and_then(Value::as_str),
            Some("FREE" | "VACATION" | "SICK")
        )
        || !shift.get("startTime").is_some_and(truthy)
        || !shift.get("endTime").is_some_and(truthy)
    {
        return vec![];
    }
    // Exact source boundary: invalid timestamps establish neither work nor freedom.
    calculate(shift, time_zone).unwrap_or_default()
}
