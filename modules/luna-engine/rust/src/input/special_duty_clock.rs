//! Raw clock/block draft transitions. No saved-source or financial admission.
use super::{InputError, form_number, javascript_json::number_text, special_duty};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DutyClockOperation {
    Parent,
    ChangeClock,
    New,
    StartDay,
    EndDay,
    Pause,
    DurationLabel,
    ClockLabel,
    DayLabel,
}
impl DutyClockOperation {
    fn fields(self) -> &'static [&'static str] {
        match self {
            Self::Parent => &["startTime", "endTime", "endDay", "pause"],
            Self::ChangeClock => &["part", "field", "time"],
            Self::New => &["kind", "startTime", "endTime", "timeZone"],
            Self::StartDay | Self::EndDay | Self::Pause => &["part", "text"],
            Self::DurationLabel | Self::ClockLabel => &["minutes"],
            Self::DayLabel => &["day"],
        }
    }
}

fn invalid() -> InputError {
    InputError::source(
        "Bitte prüfe die Zeiten und Angaben zum Sonderdienst.",
        "Error",
    )
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, InputError> {
    value.get(key).and_then(Value::as_str).ok_or_else(invalid)
}
fn number(value: &Value) -> Result<f64, InputError> {
    // DutyPart's typed numeric fields use JSON null only for nonfinite drafts.
    // Preserve NaN during arithmetic; never silently turn a broken clock to 0.
    if value.is_null() {
        return Ok(f64::NAN);
    }
    value.as_f64().ok_or_else(invalid)
}
fn clock(value: &Value, key: &str) -> Result<f64, InputError> {
    special_duty::clock(&value[key]).map(|v| v as f64)
}
fn part(value: &Value) -> Result<Value, InputError> {
    if !value.is_object()
        || !["start", "end", "breakMinutes"]
            .iter()
            .all(|key| value.get(key).is_some())
    {
        return Err(invalid());
    }
    for key in ["start", "end", "breakMinutes"] {
        number(&value[key])?;
    }
    Ok(value.clone())
}
fn clock_label(minutes: f64) -> String {
    let value = ((minutes % 1440.0) + 1440.0) % 1440.0;
    format!(
        "{:0>2}:{:0>2}",
        number_text((value / 60.0).floor()),
        number_text(value % 60.0)
    )
}
fn calculate(operation: DutyClockOperation, input: &Value) -> Result<Value, InputError> {
    match operation {
        DutyClockOperation::Parent => {
            let pause = form_number::number(text(input, "pause")?);
            let clocks = clock(input, "startTime")
                .and_then(|start| clock(input, "endTime").map(|end| (start, end)));
            Ok(match clocks {
                Ok((start, end)) => {
                    json!({"start":start,"end":number(&input["endDay"])? * 1440.0 + end,"breakMinutes":pause})
                }
                Err(_) => json!({"start":null,"end":null,"breakMinutes":pause}),
            })
        }
        DutyClockOperation::ChangeClock => {
            let mut next = part(&input["part"])?;
            let field = text(input, "field")?;
            if field != "start" && field != "end" {
                return Err(invalid());
            }
            next[field] =
                json!((number(&next[field])? / 1440.0).floor() * 1440.0 + clock(input, "time")?);
            let start = number(&next["start"])?;
            let end = number(&next["end"])?;
            if end <= start {
                next["end"] = json!(((start / 1440.0).floor() + 1.0) * 1440.0 + end % 1440.0);
            }
            Ok(next)
        }
        DutyClockOperation::New => {
            let kind = text(input, "kind")?;
            if !["SPLIT", "ON_CALL", "STANDBY"].contains(&kind) {
                return Err(invalid());
            }
            Ok(
                json!({"version":1,"kind":kind,"timeZone":text(input,"timeZone")?,"endDay":if clock(input,"endTime")? <= clock(input,"startTime")? {1} else {0},"parts":[],"callouts":[],"calloutsComplete":false,"standbyLevel":"UNKNOWN","settlement":"UNKNOWN"}),
            )
        }
        DutyClockOperation::StartDay | DutyClockOperation::EndDay | DutyClockOperation::Pause => {
            let mut next = part(&input["part"])?;
            let value = form_number::number(text(input, "text")?);
            let start = number(&next["start"])?;
            let end = number(&next["end"])?;
            match operation {
                DutyClockOperation::StartDay => {
                    let day = if next["start"].as_f64().is_some_and(f64::is_finite) {
                        (start / 1440.0).floor()
                    } else {
                        0.0
                    };
                    let delta = (value - day) * 1440.0;
                    next["start"] = json!(start + delta);
                    next["end"] = json!(end + delta);
                }
                DutyClockOperation::EndDay => next["end"] = json!(value * 1440.0 + end % 1440.0),
                DutyClockOperation::Pause => next["breakMinutes"] = json!(value),
                _ => return Err(invalid()),
            }
            Ok(next)
        }
        DutyClockOperation::DurationLabel => {
            let minutes = number(&input["minutes"])?;
            let hours = (minutes / 60.0).floor();
            let rest = minutes % 60.0;
            Ok(json!(if hours != 0.0 {
                format!(
                    "{} Std.{}",
                    number_text(hours),
                    if rest != 0.0 {
                        format!(" {} Min.", number_text(rest))
                    } else {
                        String::new()
                    }
                )
            } else {
                format!("{} Min.", number_text(rest))
            }))
        }
        DutyClockOperation::ClockLabel => Ok(json!(clock_label(number(&input["minutes"])?))),
        DutyClockOperation::DayLabel => {
            let day = number(&input["day"])?;
            Ok(json!(if day == 0.0 {
                "Gleicher Tag".to_owned()
            } else if day == 1.0 {
                "Folgetag".to_owned()
            } else {
                format!("{} Tage später", number_text(day))
            }))
        }
    }
}

pub fn execute(operation: DutyClockOperation, input: &Value) -> Result<Value, InputError> {
    if !input.as_object().is_some_and(|map| {
        map.len() == operation.fields().len()
            && operation.fields().iter().all(|key| map.contains_key(*key))
    }) {
        return Err(invalid());
    }
    // Expected local clock parse failures are a typed draft outcome, never a
    // snapshot-ready result. The UI decides which raw field remains visible.
    Ok(match calculate(operation, input) {
        Ok(value) => json!({"ok":true,"value":value}),
        Err(_) => json!({"ok":false}),
    })
}
