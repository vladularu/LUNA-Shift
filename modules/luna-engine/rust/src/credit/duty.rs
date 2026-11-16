use super::{decimal, number, string, zero, zone};
use crate::{EngineError, calendar::parse_date, time::duty_instant};
use bigdecimal::BigDecimal;
use jiff::{Span, civil::Time, tz::TimeZone};
use serde_json::{Value, json};

#[derive(Debug, Clone)]
pub struct DutyPart {
    pub start: i64,
    pub end: i64,
    pub break_minutes: BigDecimal,
}

fn duty(entry: &Value) -> Option<&Value> {
    entry.get("specialDuty").filter(|value| !value.is_null())
}

fn integer(value: &Value, field: &str) -> Result<i64, EngineError> {
    // Native editor arithmetic can produce 480.0 without a JSON/JS round trip.
    // JavaScript has one Number type; preserve integer values, not token spelling.
    value
        .get(field)
        .and_then(|number| {
            number.as_i64().or_else(|| {
                number
                    .as_f64()
                    .filter(|value| {
                        value.is_finite()
                            && value.fract() == 0.0
                            && (i64::MIN as f64..-(i64::MIN as f64)).contains(value)
                    })
                    .map(|value| value as i64)
            })
        })
        .ok_or(EngineError::InvalidDuration)
}

fn clock_minute(text: &str) -> Result<i64, EngineError> {
    let time: Time = text.parse().map_err(|_| EngineError::InvalidTime)?;
    Ok(i64::from(time.hour()) * 60 + i64::from(time.minute()))
}

pub(crate) fn duty_clock(minute: i64) -> String {
    let minute = minute.rem_euclid(1440);
    format!("{:02}:{:02}", minute / 60, minute % 60)
}

fn date_at(date: &str, minute: i64) -> Result<String, EngineError> {
    let span = Span::new()
        .try_days(minute.div_euclid(1440))
        .map_err(|_| EngineError::Overflow)?;
    parse_date(date)?
        .checked_add(span)
        .map(|date| date.to_string())
        .map_err(|_| EngineError::InvalidDate)
}

pub fn parts(entry: &Value) -> Result<Vec<DutyPart>, EngineError> {
    let Some(duty) = duty(entry) else {
        return Ok(Vec::new());
    };
    let (Some(start), Some(end)) = (
        entry
            .get("startTime")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty()),
        entry
            .get("endTime")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty()),
    ) else {
        return Ok(Vec::new());
    };
    if string(duty, "kind")? == "ON_CALL" {
        return duty["callouts"]
            .as_array()
            .ok_or(EngineError::InvalidCalendarEntry)?
            .iter()
            .map(|call| {
                Ok(DutyPart {
                    start: integer(call, "departure")?,
                    end: integer(call, "returned")?,
                    break_minutes: decimal(&call["breakMinutes"])?,
                })
            })
            .collect();
    }
    let end_clock = clock_minute(end)?;
    let mut result = vec![DutyPart {
        start: clock_minute(start)?,
        end: integer(duty, "endDay")?
            .checked_mul(1440)
            .and_then(|value| value.checked_add(end_clock))
            .ok_or(EngineError::Overflow)?,
        break_minutes: decimal(&entry["breakMinutes"])?,
    }];
    for part in duty["parts"]
        .as_array()
        .ok_or(EngineError::InvalidCalendarEntry)?
    {
        result.push(DutyPart {
            start: integer(part, "start")?,
            end: integer(part, "end")?,
            break_minutes: decimal(&part["breakMinutes"])?,
        });
    }
    Ok(result)
}

pub fn duty_work_parts(entry: &Value) -> Result<Value, EngineError> {
    parts(entry)?.iter().map(|part| Ok(json!({ "start":part.start,"end":part.end,"breakMinutes":number(&part.break_minutes)? }))).collect::<Result<Vec<_>,_>>().map(Value::Array)
}

fn elapsed_minutes(
    date: &str,
    start: i64,
    end: i64,
    tz: &TimeZone,
) -> Result<BigDecimal, EngineError> {
    let elapsed = duty_instant(date, end, tz)?
        .checked_sub(duty_instant(date, start, tz)?)
        .ok_or(EngineError::Overflow)?;
    Ok(BigDecimal::from(elapsed) / BigDecimal::from(60_000))
}

pub fn special_duty_work_minutes(entry: &Value) -> Result<Value, EngineError> {
    let Some(duty) = duty(entry) else {
        return Ok(Value::from(0));
    };
    let parts = parts(entry)?;
    // The TS reduction never touches date/timezone when the part list is empty.
    if parts.is_empty() {
        return Ok(Value::from(0));
    }
    let tz = zone(string(duty, "timeZone")?)?;
    let mut total = zero();
    for part in parts {
        total += (elapsed_minutes(string(entry, "date")?, part.start, part.end, &tz)?
            - part.break_minutes)
            .max(zero());
    }
    number(&total)
}

fn projected(
    entry: &Value,
    start: i64,
    end: i64,
    pause: &BigDecimal,
    keep_overtime: bool,
) -> Result<Value, EngineError> {
    let mut value = entry.clone();
    let map = value
        .as_object_mut()
        .ok_or(EngineError::InvalidCalendarEntry)?;
    map.insert("specialDuty".into(), Value::Null);
    map.insert(
        "date".into(),
        Value::from(date_at(string(entry, "date")?, start)?),
    );
    map.insert("startTime".into(), Value::from(duty_clock(start)));
    map.insert("endTime".into(), Value::from(duty_clock(end)));
    map.insert("breakMinutes".into(), number(pause)?);
    if !keep_overtime {
        map.insert("overtimeMinutes".into(), Value::from(0));
        map.insert("tariffOvertimeConfirmed".into(), Value::Bool(false));
    }
    Ok(value)
}

pub fn project_duty_work(entry: &Value) -> Result<Vec<Value>, EngineError> {
    let Some(duty) = duty(entry) else {
        return Ok(vec![entry.clone()]);
    };
    let split = string(duty, "kind")? == "SPLIT";
    parts(entry)?
        .iter()
        .enumerate()
        .map(|(index, part)| {
            projected(
                entry,
                part.start,
                part.end,
                &part.break_minutes,
                split && index == 0,
            )
        })
        .collect()
}

pub fn project_duty_shifts(entries: &[Value]) -> Result<Vec<Value>, EngineError> {
    let mut result = Vec::new();
    for entry in entries {
        result.extend(project_duty_work(entry)?);
    }
    Ok(result)
}

pub fn project_duty_calendar_days(entries: &[Value]) -> Result<Vec<Value>, EngineError> {
    let mut result = Vec::new();
    for entry in entries {
        if let Some(parts) = project_duty_calendar_day_parts(entry)? {
            result.extend(parts);
        } else {
            result.push(entry.clone());
        }
    }
    Ok(result)
}
/// None means the original record is unchanged and can be retained by reference.
/// Owned records are only the exact already-established duty day projections.
pub(crate) fn project_duty_calendar_day_parts(
    entry: &Value,
) -> Result<Option<Vec<Value>>, EngineError> {
    let Some(duty) = duty(entry) else {
        return Ok(None);
    };
    let parts = parts(entry)?;
    if parts.is_empty() {
        return Ok(Some(Vec::new()));
    }
    let tz = zone(string(duty, "timeZone")?)?;
    let mut result = Vec::new();
    for part in parts {
        let mut remaining_break = part.break_minutes;
        let mut start = part.start;
        while start < part.end {
            let midnight = start
                .div_euclid(1440)
                .checked_add(1)
                .and_then(|day| day.checked_mul(1440))
                .ok_or(EngineError::Overflow)?;
            let end = part.end.min(midnight);
            let elapsed = elapsed_minutes(string(entry, "date")?, start, end, &tz)?;
            let pause = remaining_break.clone().min(elapsed);
            remaining_break -= &pause;
            result.push(projected(entry, start, end, &pause, false)?);
            start = end;
        }
    }
    Ok(Some(result))
}

pub fn duty_calendar_dates(entry: &Value) -> Result<Vec<String>, EngineError> {
    let date = string(entry, "date")?;
    let Some(duty) = duty(entry) else {
        return Ok(vec![date.to_owned()]);
    };
    let (Some(start), Some(end)) = (
        entry.get("startTime").and_then(Value::as_str),
        entry.get("endTime").and_then(Value::as_str),
    ) else {
        return Ok(vec![date.to_owned()]);
    };
    if start.is_empty() || end.is_empty() {
        return Ok(vec![date.to_owned()]);
    }
    let end_clock = clock_minute(end)?;
    let mut last = integer(duty, "endDay")?
        .checked_mul(1440)
        .and_then(|value| value.checked_add(end_clock))
        .ok_or(EngineError::Overflow)?;
    for part in duty["parts"]
        .as_array()
        .ok_or(EngineError::InvalidCalendarEntry)?
    {
        last = last.max(integer(part, "end")?);
    }
    let days = (last.div_euclid(1440) + i64::from(last.rem_euclid(1440) != 0)).max(0);
    // Validated duties span at most fourteen days after their start clock and
    // therefore touch at most fifteen civil dates. Reject malformed allocation sizes.
    if days > 15 {
        return Err(EngineError::InvalidDuration);
    }
    (0..days)
        .map(|index| {
            index
                .checked_mul(1440)
                .ok_or(EngineError::Overflow)
                .and_then(|minute| date_at(date, minute))
        })
        .collect()
}

pub fn project_regular_pay_shifts(entries: &[Value]) -> Result<Vec<Value>, EngineError> {
    let mut result = Vec::new();
    for entry in entries {
        let Some(duty) = duty(entry) else {
            result.push(entry.clone());
            continue;
        };
        if string(duty, "kind")? != "SPLIT" {
            continue;
        }
        for (index, mut part) in project_duty_work(entry)?.into_iter().enumerate() {
            part.as_object_mut()
                .ok_or(EngineError::InvalidCalendarEntry)?
                .insert(
                    "id".into(),
                    Value::from(format!("{}:part:{index}", string(entry, "id")?)),
                );
            result.push(part);
        }
    }
    Ok(result)
}
