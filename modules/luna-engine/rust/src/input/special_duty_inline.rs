//! Raw special-duty inline event policies, separate from visual disclosure state.
use super::{InputError, form_number, special_duty, special_duty_draft};
use serde_json::{Value, json};
fn invalid() -> InputError {
    InputError::source(
        "Bitte prüfe die Zeiten und Angaben zum Sonderdienst.",
        "Error",
    )
}
fn number(value: &Value) -> Result<f64, InputError> {
    if value.is_null() {
        Ok(f64::NAN)
    } else {
        value.as_f64().ok_or_else(invalid)
    }
}
fn text(value: &Value) -> Result<&str, InputError> {
    value.as_str().ok_or_else(invalid)
}
fn array<'a>(value: &'a mut Value, key: &str) -> Result<&'a mut Vec<Value>, InputError> {
    value[key].as_array_mut().ok_or_else(invalid)
}
fn apply(input: &Value) -> Result<Value, InputError> {
    let state = &input["state"];
    let value = &state["value"];
    let arg = &input["arg"];
    let operation = text(&input["operation"])?;
    let index = input["index"]
        .as_u64()
        .filter(|v| *v < 64)
        .ok_or_else(invalid)? as usize;
    let mut next = value.clone();
    match operation {
        "PARENT_PART" => {
            next["endDay"] = json!((number(&arg["end"])? / 1440.0).floor());
            if value["kind"] == "ON_CALL" {
                next["calloutsComplete"] = json!(false);
            }
        }
        "PART_REPLACE" => {
            if !arg.is_object() {
                return Err(invalid());
            }
            if let Some(part) = array(&mut next, "parts")?.get_mut(index) {
                *part = arg.clone();
            }
        }
        "PART_REMOVE" => {
            let parts = array(&mut next, "parts")?;
            if index < parts.len() {
                parts.remove(index);
            }
        }
        "CALLOUT_KIND" | "CALLOUT_PART" | "TRAVEL_OUT" | "TRAVEL_RETURN" => {
            let call = value["callouts"]
                .as_array()
                .and_then(|v| v.get(index))
                .ok_or_else(invalid)?;
            let mut updated = call.clone();
            match operation {
                "CALLOUT_KIND" => {
                    updated["kind"] = json!(text(arg)?);
                    updated["departure"] = call["start"].clone();
                    updated["returned"] = call["end"].clone();
                }
                "CALLOUT_PART" => {
                    let target = updated.as_object_mut().ok_or_else(invalid)?;
                    for (key, value) in arg.as_object().ok_or_else(invalid)? {
                        target.insert(key.clone(), value.clone());
                    }
                    updated["departure"] = json!(
                        number(&arg["start"])?
                            - (number(&call["start"])? - number(&call["departure"])?)
                    );
                    updated["returned"] = json!(
                        number(&arg["end"])? + (number(&call["returned"])? - number(&call["end"])?)
                    );
                }
                "TRAVEL_OUT" => {
                    updated["departure"] =
                        json!(number(&call["start"])? - form_number::number(text(arg)?))
                }
                "TRAVEL_RETURN" => {
                    updated["returned"] =
                        json!(number(&call["end"])? + form_number::number(text(arg)?))
                }
                _ => return Err(invalid()),
            }
            array(&mut next, "callouts")?[index] = updated;
            next["calloutsComplete"] = json!(false);
        }
        "CALLOUT_REMOVE" => {
            let calls = array(&mut next, "callouts")?;
            if index < calls.len() {
                calls.remove(index);
            }
            next["calloutsComplete"] = json!(false);
        }
        "CALLOUT_ADD" => {
            let previous = value["callouts"]
                .as_array()
                .and_then(|v| v.last())
                .and_then(|v| v.get("returned"));
            let start = match previous {
                Some(v) => number(v)?,
                None => special_duty::clock(&state["startTime"])? as f64,
            };
            array(&mut next,"callouts")?.push(json!({"kind":"REMOTE","start":start,"end":start+15.0,"departure":start,"returned":start+15.0,"breakMinutes":0}));
            next["calloutsComplete"] = json!(false);
        }
        "CALLOUT_COMPLETE" => next["calloutsComplete"] = json!(text(arg)? == "COMPLETE"),
        "SETTLEMENT" => next["settlement"] = json!(text(arg)?),
        "STANDBY_LEVEL" => next["standbyLevel"] = json!(text(arg)?),
        _ => return Err(invalid()),
    }
    Ok(next)
}
pub fn execute(input: &Value) -> Result<Value, InputError> {
    if !input.as_object().is_some_and(|map| {
        map.len() == 4
            && ["state", "operation", "index", "arg"]
                .iter()
                .all(|key| map.contains_key(*key))
    }) {
        return Err(invalid());
    }
    special_duty_draft::validate_state(&input["state"])?;
    if input["state"]["value"].is_null() {
        return Err(invalid());
    }
    Ok(match apply(input) {
        Ok(value) => json!({"ok":true,"events":[{"field":"duty","value":value}]}),
        Err(_) => json!({"ok":false,"events":[]}),
    })
}
