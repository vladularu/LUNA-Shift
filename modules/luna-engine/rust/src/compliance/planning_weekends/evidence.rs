//! Civil weekend intersections from raw schedules; uncertainty is retained.
use crate::{
    EngineError,
    calendar::parse_date,
    compliance::{
        average::add_days,
        model::{ComplianceError, array, integer, number, text},
    },
    time,
};
use jiff::{
    Timestamp,
    civil::{Date, Time},
    tz::{Disambiguation, TimeZone},
};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Clone)]
pub(super) struct Evidence {
    pub occupied: bool,
    pub reason: &'static str,
}
pub(super) type EvidenceMap = BTreeMap<String, Evidence>;
pub(super) fn special(shift: &Value) -> Option<&Value> {
    shift
        .get("specialDuty")
        .filter(|v| crate::credit::summary::truthy(Some(v)))
}
pub(super) fn uncertain(shift: &Value, reason: &'static str) -> EvidenceMap {
    let compute = || -> Result<EvidenceMap, ComplianceError> {
        let date = parse_date(text(shift, "date")?)?;
        let duty = special(shift);
        let end_day = match duty.and_then(|d| d.get("endDay")) {
            None | Some(Value::Null) => 1,
            Some(v) => v.as_i64().ok_or(ComplianceError::InvalidInput)?,
        };
        let mut day = add_days(date, if duty.is_some() { -1 } else { 0 })?;
        let until = add_days(
            date,
            end_day
                .checked_add(if duty.is_some() { 1 } else { 0 })
                .ok_or(EngineError::Overflow)?,
        )?;
        let mut result = BTreeMap::new();
        while day <= until {
            let weekday = day.weekday().to_monday_one_offset();
            if weekday >= 6 {
                result.insert(
                    add_days(day, if weekday == 7 { -1 } else { 0 })?.to_string(),
                    Evidence {
                        occupied: false,
                        reason,
                    },
                );
            }
            day = add_days(day, 1)?;
        }
        Ok(result)
    };
    compute().unwrap_or_default()
}
pub(super) fn midnight(date: Date, zone: &TimeZone) -> Result<i64, ComplianceError> {
    // PlainDate.toZonedDateTime uses the first instant of the civil day.
    zone.to_ambiguous_zoned(date.to_datetime(Time::midnight()))
        .disambiguate(Disambiguation::Compatible)
        .and_then(|z| z.start_of_day())
        .map(|z| z.timestamp().as_millisecond())
        .map_err(|_| EngineError::InvalidTime.into())
}
fn local(ms: i64, zone: &TimeZone) -> Result<Date, ComplianceError> {
    Ok(Timestamp::from_millisecond(ms)
        .map_err(|_| EngineError::InvalidTime)?
        .to_zoned(zone.clone())
        .date())
}
struct Interval {
    start: i64,
    end: i64,
    pause: f64,
    known_pause: Option<(i64, i64)>,
    unresolved: bool,
}
fn ordinary(shift: &Value, date: Date, zone: &TimeZone) -> Result<Interval, ComplianceError> {
    let start_text = text(shift, "startTime")?;
    let end_text = text(shift, "endTime")?;
    let at = |day: Date, clock: &str| -> Result<i64, ComplianceError> {
        let clock = clock
            .parse::<Time>()
            .map_err(|_| EngineError::InvalidTime)?;
        zone.to_ambiguous_zoned(day.to_datetime(clock))
            .disambiguate(Disambiguation::Reject)
            .map(|z| z.timestamp().as_millisecond())
            .map_err(|_| EngineError::InvalidTime.into())
    };
    Ok(Interval {
        start: at(date, start_text)?,
        end: at(
            add_days(date, if end_text <= start_text { 1 } else { 0 })?,
            end_text,
        )?,
        pause: number(shift, "breakMinutes")?,
        known_pause: None,
        unresolved: false,
    })
}
fn intervals(shift: &Value, date: Date, zone: &TimeZone) -> Result<Vec<Interval>, ComplianceError> {
    let Some(duty) = special(shift) else {
        return Ok(vec![ordinary(shift, date, zone)?]);
    };
    let duty_zone = time::zone(text(duty, "timeZone")?)?;
    let start = time::clock(text(shift, "startTime")?)?;
    let end = time::clock(text(shift, "endTime")?)?;
    let start_minute = i64::from(start.hour()) * 60 + i64::from(start.minute());
    let end_minute = integer(duty, "endDay")?
        .checked_mul(1440)
        .and_then(|v| v.checked_add(i64::from(end.hour()) * 60 + i64::from(end.minute())))
        .ok_or(EngineError::Overflow)?;
    let mut parts = vec![(start_minute, end_minute, number(shift, "breakMinutes")?)];
    for part in array(duty, "parts")? {
        parts.push((
            integer(part, "start")?,
            integer(part, "end")?,
            number(part, "breakMinutes")?,
        ));
    }
    let on_call = text(duty, "kind")? == "ON_CALL";
    if on_call {
        for part in array(duty, "callouts")? {
            parts.push((
                integer(part, "departure")?,
                integer(part, "returned")?,
                number(part, "breakMinutes")?,
            ));
        }
    }
    let mut result = Vec::new();
    for (index, (start, end, pause)) in parts.into_iter().enumerate() {
        let start = time::duty_instant(&date.to_string(), start, &duty_zone)?;
        let end = time::duty_instant(&date.to_string(), end, &duty_zone)?;
        let known_pause = if index == 0
            && pause > 0.0
            && duty.get("breakStart").is_some_and(|v| !v.is_null())
        {
            let a =
                time::duty_instant(&date.to_string(), integer(duty, "breakStart")?, &duty_zone)?;
            if pause.fract() != 0.0 || pause > i32::MAX as f64 {
                return Err(ComplianceError::InvalidInput);
            }
            let b = a
                .checked_add(
                    (pause as i64)
                        .checked_mul(60_000)
                        .ok_or(EngineError::Overflow)?,
                )
                .ok_or(EngineError::Overflow)?;
            if a >= start && b <= end {
                Some((a, b))
            } else {
                None
            }
        } else {
            None
        };
        result.push(Interval {
            start,
            end,
            pause,
            known_pause,
            unresolved: index == 0
                && on_call
                && duty.get("calloutsComplete") != Some(&Value::Bool(true)),
        });
    }
    Ok(result)
}
fn compute(shift: &Value, time_zone: &str) -> Result<EvidenceMap, ComplianceError> {
    let date = parse_date(text(shift, "date")?)?;
    if special(shift).is_none() && date.weekday().to_monday_one_offset() <= 4 {
        return Ok(BTreeMap::new());
    }
    let zone = time::zone(time_zone)?;
    let mut weekends = BTreeMap::new();
    for part in intervals(shift, date, &zone)? {
        if part.end <= part.start {
            return Err(ComplianceError::InvalidInput);
        }
        let first = local(part.start, &zone)?;
        let weekday = i64::from(first.weekday().to_monday_one_offset());
        let mut saturday = add_days(first, if weekday == 7 { -1 } else { 6 - weekday })?;
        let last = local(part.end.checked_sub(1).ok_or(EngineError::Overflow)?, &zone)?;
        for _ in 0..4 {
            if saturday > last {
                break;
            }
            let lower = midnight(saturday, &zone)?;
            let upper = midnight(add_days(saturday, 2)?, &zone)?;
            let start = part.start.max(lower);
            let end = part.end.min(upper);
            let overlap = end.checked_sub(start).ok_or(EngineError::Overflow)? as f64 / 60_000.0;
            let pause = match part.known_pause {
                Some((a, b)) => ((b
                    .min(end)
                    .checked_sub(a.max(start))
                    .ok_or(EngineError::Overflow)? as f64)
                    / 60_000.0)
                    .max(0.0),
                None => part.pause,
            };
            if overlap > 0.0 {
                let evidence = if overlap > pause {
                    Some(Evidence {
                        occupied: !part.unresolved,
                        reason: if part.unresolved {
                            "UNRESOLVED_DUTY"
                        } else {
                            "WORK_RECORDED"
                        },
                    })
                } else if part.known_pause.is_none() && part.pause > 0.0 {
                    Some(Evidence {
                        occupied: false,
                        reason: "UNRESOLVED_DUTY",
                    })
                } else {
                    None
                };
                let key = saturday.to_string();
                if let Some(value) = evidence
                    && !weekends.get(&key).is_some_and(|v: &Evidence| v.occupied)
                {
                    weekends.insert(key, value);
                }
            }
            saturday = add_days(saturday, 7)?;
        }
    }
    Ok(weekends)
}
pub(super) fn weekend_evidence(shift: &Value, zone: &str) -> EvidenceMap {
    if !shift.get("deletedAt").is_some_and(Value::is_null)
        || matches!(
            shift.get("type").and_then(Value::as_str),
            Some("FREE" | "VACATION" | "SICK")
        )
    {
        return BTreeMap::new();
    }
    if shift.get("allDay") == Some(&Value::Bool(true))
        || ["startTime", "endTime"].iter().any(|k| {
            shift
                .get(k)
                .and_then(Value::as_str)
                .is_none_or(str::is_empty)
        })
    {
        return uncertain(shift, "UNRESOLVED_DUTY");
    }
    compute(shift, zone).unwrap_or_else(|_| uncertain(shift, "INVALID_DUTY"))
}
