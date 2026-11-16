use super::{DisplayOptions, LabelMode, LabelPresentation};
use crate::{
    EngineError,
    credit::duty::duty_clock,
    report::time_display::format::minutes,
    time::{ShiftTime, shift_bounds},
};
use jiff::ToSpan;
use serde_json::Value;
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, EngineError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or(EngineError::InvalidCalendarEntry)
}
fn nullable_clock<'a>(value: &'a Value, key: &str) -> Result<&'a str, EngineError> {
    match value.get(key) {
        Some(Value::Null) => Ok("null"),
        Some(Value::String(v)) => Ok(v),
        _ => Err(EngineError::InvalidCalendarEntry),
    }
}
fn integer(value: &Value, key: &str, maximum: i64) -> Result<i64, EngineError> {
    let n = value
        .get(key)
        .and_then(Value::as_f64)
        .ok_or(EngineError::InvalidDuration)?;
    if !n.is_finite() || n.fract() != 0.0 || n < 0.0 || n > maximum as f64 {
        return Err(EngineError::InvalidDuration);
    }
    Ok(n as i64)
}
/// Complete original special-duty text. Describing a duty needs no pay/credit
/// calculation; inactive ordinary display flags do not suppress this text.
pub fn special_duty_description(entry: &Value) -> Result<Option<String>, EngineError> {
    let Some(duty) = entry.get("specialDuty").filter(|v| !v.is_null()) else {
        return Ok(None);
    };
    let result = match text(duty, "kind")? {
        "SPLIT" => {
            let parts = duty
                .get("parts")
                .and_then(Value::as_array)
                .ok_or(EngineError::InvalidCalendarEntry)?;
            if parts.len() > 100000 {
                return Err(EngineError::InvalidDuration);
            }
            let mut labels = vec![format!(
                "{}–{}",
                nullable_clock(entry, "startTime")?,
                nullable_clock(entry, "endTime")?
            )];
            for part in parts {
                let start = integer(part, "start", 15 * 1440)?;
                let end = integer(part, "end", 15 * 1440)?;
                labels.push(format!(
                    "{}–{}{}",
                    duty_clock(start),
                    duty_clock(end),
                    if start >= 1440 {
                        format!(" (+{} Tag)", start / 1440)
                    } else {
                        String::new()
                    }
                ));
            }
            labels.join(" / ")
        }
        "ON_CALL" => {
            let until = super::super::parse_date(text(entry, "date")?)?
                .checked_add(integer(duty, "endDay", 14)?.days())
                .map_err(|_| EngineError::InvalidDate)?;
            let calls = duty
                .get("callouts")
                .and_then(Value::as_array)
                .ok_or(EngineError::InvalidCalendarEntry)?;
            if calls.len() > 100000 {
                return Err(EngineError::InvalidDuration);
            }
            format!(
                "Rufbereitschaft · bis {until} {} · {} Einsätze{}",
                nullable_clock(entry, "endTime")?,
                calls.len(),
                if duty.get("calloutsComplete").and_then(Value::as_bool) == Some(true) {
                    ""
                } else {
                    " · offen"
                }
            )
        }
        "STANDBY" => {
            let level = text(duty, "standbyLevel")?;
            format!(
                "Bereitschaftsdienst · {}",
                if level == "UNKNOWN" {
                    "Stufe offen".to_owned()
                } else {
                    format!("Stufe {level}")
                }
            )
        }
        _ => return Err(EngineError::InvalidCalendarEntry),
    };
    Ok(Some(result))
}
pub fn shift_detail(
    entry: &Value,
    options: DisplayOptions,
    time_zone: &str,
) -> Result<Option<String>, EngineError> {
    if let Some(description) = special_duty_description(entry)? {
        return Ok(Some(description));
    }
    if entry.get("allDay").and_then(Value::as_bool) == Some(true)
        || (entry.get("startTime") == Some(&Value::Null)
            && entry.get("endTime") == Some(&Value::Null))
    {
        return Ok(
            (options.show_shift_times || options.show_shift_duration).then(|| "GT".to_owned())
        );
    }
    if entry.get("startTime") == Some(&Value::Null) || entry.get("endTime") == Some(&Value::Null) {
        return Ok(None);
    }
    let mut parts = Vec::new();
    if options.show_shift_times {
        parts.push(text(entry, "startTime")?.to_owned());
    }
    if options.show_shift_duration {
        let shift = ShiftTime {
            date: text(entry, "date")?.to_owned(),
            start_time: Some(text(entry, "startTime")?.to_owned()),
            end_time: Some(text(entry, "endTime")?.to_owned()),
            break_minutes: 0,
            all_day: false,
            special_duty: None,
        };
        let gross = shift_bounds(&shift, time_zone)?
            .ok_or(EngineError::InvalidDuration)?
            .gross_minutes as f64;
        let pause = entry
            .get("breakMinutes")
            .and_then(Value::as_f64)
            .filter(|v| v.is_finite())
            .ok_or(EngineError::InvalidDuration)?;
        parts.push(format!(
            "{} h",
            minutes((gross - pause).max(0.0)).map_err(|_| EngineError::InvalidDuration)?
        ));
    }
    Ok((!parts.is_empty()).then(|| parts.join(" · ")))
}
pub fn shared_shift_detail(
    entry: &Value,
    start_time: &str,
    options: DisplayOptions,
) -> Result<Option<String>, EngineError> {
    if !options.show_shift_times && !options.show_shift_duration {
        return Ok(None);
    }
    if entry.get("allDay").and_then(Value::as_bool) == Some(true) {
        return Ok(Some("GT".to_owned()));
    }
    let mut parts = Vec::new();
    if options.show_shift_times {
        parts.push(start_time.to_owned());
    }
    if options.show_shift_duration {
        let parsed = || {
            let start = text(entry, "startsAt")
                .ok()?
                .parse::<jiff::Timestamp>()
                .ok()?
                .as_millisecond();
            let end = text(entry, "endsAt")
                .ok()?
                .parse::<jiff::Timestamp>()
                .ok()?
                .as_millisecond();
            let gross = crate::input::form_number::round(end.checked_sub(start)? as f64 / 60000.0);
            let pause = entry.get("breakMinutes")?.as_f64()?;
            (pause.is_finite()
                && pause.fract() == 0.0
                && (0.0..=2880.0).contains(&pause)
                && gross.is_finite()
                && gross > 0.0
                && gross <= 2880.0)
                .then_some((gross - pause).max(0.0))
        };
        parts.push(match parsed() {
            Some(value) => format!(
                "{} h",
                minutes(value).map_err(|_| EngineError::InvalidDuration)?
            ),
            None => "–".to_owned(),
        });
    }
    Ok(Some(parts.join(" · ")))
}
pub fn label(entry: &Value, mode: LabelMode) -> Result<LabelPresentation, EngineError> {
    let kind = text(entry, "kind")?;
    if !matches!(kind, "SHIFT" | "APPOINTMENT") {
        return Err(EngineError::InvalidCalendarEntry);
    }
    label_for_kind(entry, mode, kind == "APPOINTMENT")
}
/// The existing public sharing format predates `kind`; the Original renderer
/// treats every non-APPOINTMENT row as a service, including an absent kind.
pub fn shared_label(entry: &Value, mode: LabelMode) -> Result<LabelPresentation, EngineError> {
    label_for_kind(
        entry,
        mode,
        entry.get("kind").and_then(Value::as_str) == Some("APPOINTMENT"),
    )
}
fn label_for_kind(
    entry: &Value,
    mode: LabelMode,
    appointment: bool,
) -> Result<LabelPresentation, EngineError> {
    let show_symbol = !appointment && matches!(mode, LabelMode::Symbol);
    let title = text(entry, "title")?;
    if title.len() > 300000 {
        return Err(EngineError::InvalidCalendarEntry);
    }
    let text = if show_symbol {
        None
    } else if !appointment && matches!(mode, LabelMode::Short) {
        Some(title.encode_utf16().take(1).collect())
    } else {
        Some(title.encode_utf16().collect())
    };
    Ok(LabelPresentation { show_symbol, text })
}
