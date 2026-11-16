//! Session-only raw special-duty actions. These produce no source proof.
use super::{
    InputError,
    special_duty_clock::{self, DutyClockOperation as Clock},
};
use serde_json::{Value, json};

const KINDS: [&str; 4] = ["REGULAR", "SPLIT", "ON_CALL", "STANDBY"];
fn invalid() -> InputError {
    InputError::source(
        "Bitte prüfe die Zeiten und Angaben zum Sonderdienst.",
        "Error",
    )
}
fn exact(value: &Value, keys: &[&str]) -> bool {
    value
        .as_object()
        .is_some_and(|map| map.len() == keys.len() && keys.iter().all(|key| map.contains_key(*key)))
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, InputError> {
    value[key].as_str().ok_or_else(invalid)
}
fn numeric(value: &Value) -> Result<f64, InputError> {
    if value.is_null() {
        Ok(f64::NAN)
    } else {
        value.as_f64().ok_or_else(invalid)
    }
}
fn kind(value: &Value) -> Result<&str, InputError> {
    if value.is_null() {
        Ok("REGULAR")
    } else {
        let kind = text(value, "kind")?;
        if KINDS[1..].contains(&kind) {
            Ok(kind)
        } else {
            Err(invalid())
        }
    }
}
fn clock(operation: Clock, input: Value) -> Result<Value, InputError> {
    special_duty_clock::execute(operation, &input)?
        .get("value")
        .cloned()
        .ok_or_else(invalid)
}
fn new_duty(state: &Value, kind: &str) -> Result<Value, InputError> {
    clock(
        Clock::New,
        json!({"kind":kind,"startTime":state["startTime"],"endTime":state["endTime"],"timeZone":state["timeZone"]}),
    )
}
fn emit(events: &mut Vec<Value>, field: &str, value: Value) {
    events.push(json!({"field":field,"value":value}));
}
fn remember(state: &Value, drafts: &mut Value) -> Result<(), InputError> {
    drafts[kind(&state["value"])?] = json!({"duty":state["value"],"startTime":state["startTime"],"endTime":state["endTime"],"breakMinutes":state["breakMinutes"]});
    Ok(())
}
fn validate_duty(value: &Value) -> Result<(), InputError> {
    kind(value)?;
    if !value.is_null() {
        for (key, limit) in [("parts", 8), ("callouts", 64)] {
            if !value[key]
                .as_array()
                .is_some_and(|array| array.len() <= limit && array.iter().all(Value::is_object))
            {
                return Err(invalid());
            }
        }
    }
    Ok(())
}
fn validate(input: &Value) -> Result<(), InputError> {
    if !exact(input, &["state", "operation", "args"]) {
        return Err(invalid());
    }
    let state = &input["state"];
    validate_state(state)
}
pub(super) fn validate_state(state: &Value) -> Result<(), InputError> {
    if !exact(
        state,
        &[
            "value",
            "startTime",
            "endTime",
            "breakMinutes",
            "timeZone",
            "drafts",
        ],
    ) {
        return Err(invalid());
    }
    for key in ["startTime", "endTime", "breakMinutes", "timeZone"] {
        text(state, key)?;
    }
    validate_duty(&state["value"])?;
    let drafts = state["drafts"].as_object().ok_or_else(invalid)?;
    if drafts.len() > 4 {
        return Err(invalid());
    }
    for (key, draft) in drafts {
        if !KINDS.contains(&key.as_str())
            || !exact(draft, &["duty", "startTime", "endTime", "breakMinutes"])
        {
            return Err(invalid());
        }
        validate_duty(&draft["duty"])?;
        for key in ["startTime", "endTime", "breakMinutes"] {
            text(draft, key)?;
        }
    }
    Ok(())
}
fn apply(input: &Value, events: &mut Vec<Value>, drafts: &mut Value) -> Result<(), InputError> {
    let state = &input["state"];
    let value = &state["value"];
    let args = &input["args"];
    match text(input, "operation")? {
        "CHOOSE" => {
            if !exact(args, &["kind"]) {
                return Err(invalid());
            }
            let next_kind = text(args, "kind")?;
            if !KINDS.contains(&next_kind) {
                return Err(invalid());
            }
            if next_kind == kind(value)? {
                return Ok(());
            }
            remember(state, drafts)?;
            let saved = drafts.get(next_kind);
            let next = match saved.and_then(|v| v.get("duty")).filter(|v| !v.is_null()) {
                Some(duty) => duty.clone(),
                None if next_kind == "REGULAR" => Value::Null,
                None => new_duty(state, next_kind)?,
            };
            emit(events, "duty", next);
            emit(
                events,
                "startTime",
                saved.map_or_else(|| state["startTime"].clone(), |v| v["startTime"].clone()),
            );
            emit(
                events,
                "endTime",
                saved.map_or_else(|| state["endTime"].clone(), |v| v["endTime"].clone()),
            );
            emit(
                events,
                "breakMinutes",
                saved.map_or_else(
                    || {
                        if next_kind == "ON_CALL" {
                            json!("0")
                        } else {
                            state["breakMinutes"].clone()
                        }
                    },
                    |v| v["breakMinutes"].clone(),
                ),
            );
        }
        "ADD_PART" => {
            if !exact(args, &[]) {
                return Err(invalid());
            }
            if value.is_null() {
                remember(state, drafts)?;
            }
            let mut duty = if kind(value)? == "SPLIT" {
                value.clone()
            } else {
                new_duty(state, "SPLIT")?
            };
            let end = special_duty_clock::execute(
                Clock::Parent,
                &json!({"startTime":state["endTime"],"endTime":state["endTime"],"endDay":duty["endDay"],"pause":"0"}),
            )?;
            let mut start = end["value"]["end"].as_f64().ok_or_else(invalid)?;
            let parts = duty["parts"].as_array_mut().ok_or_else(invalid)?;
            for part in parts.iter() {
                let end = numeric(&part["end"])?;
                start = if start.is_nan() || end.is_nan() {
                    f64::NAN
                } else {
                    start.max(end)
                };
            }
            start += 60.0;
            parts.push(json!({"start":start,"end":start+240.0,"breakMinutes":0}));
            emit(events, "duty", duty);
        }
        "PARENT_CLOCK" => {
            if !exact(args, &["field", "time"]) {
                return Err(invalid());
            }
            let field = text(args, "field")?;
            let time = text(args, "time")?;
            if !["start", "end"].contains(&field) {
                return Err(invalid());
            }
            if value.is_null() {
                return Ok(());
            }
            emit(
                events,
                if field == "start" {
                    "startTime"
                } else {
                    "endTime"
                },
                json!(time),
            );
            let parent = clock(
                Clock::Parent,
                json!({"startTime":state["startTime"],"endTime":state["endTime"],"endDay":value["endDay"],"pause":state["breakMinutes"]}),
            )?;
            if let Ok(next) = clock(
                Clock::ChangeClock,
                json!({"part":parent,"field":field,"time":time}),
            ) && let Some(end) = next["end"].as_f64().filter(|v| v.is_finite())
            {
                emit(
                    events,
                    "endTime",
                    clock(Clock::ClockLabel, json!({"minutes":end}))?,
                );
                let mut next = value.clone();
                next["endDay"] = json!((end / 1440.0).floor());
                if kind(value)? == "ON_CALL" {
                    next["calloutsComplete"] = json!(false);
                }
                emit(events, "duty", next);
            }
        }
        "UPDATE_CALLOUT" => {
            if !exact(args, &["index", "next"]) {
                return Err(invalid());
            }
            if value.is_null() {
                return Ok(());
            }
            let index = args["index"].as_i64().ok_or_else(invalid)?;
            if !args["next"].is_object() {
                return Err(invalid());
            }
            let mut next = value.clone();
            next["calloutsComplete"] = json!(false);
            for (i, call) in next["callouts"]
                .as_array_mut()
                .ok_or_else(invalid)?
                .iter_mut()
                .enumerate()
            {
                if i64::try_from(i).ok() == Some(index) {
                    *call = args["next"].clone();
                }
            }
            emit(events, "duty", next);
        }
        _ => return Err(invalid()),
    }
    Ok(())
}
pub fn execute(input: &Value) -> Result<Value, InputError> {
    validate(input)?;
    let mut events = Vec::new();
    let mut drafts = input["state"]["drafts"].clone();
    let ok = apply(input, &mut events, &mut drafts).is_ok();
    Ok(json!({"ok":ok,"events":events,"drafts":drafts}))
}
