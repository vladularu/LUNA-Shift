//! Raw special-duty display projections. No source admission, finance or saved status.
use super::{
    InputError,
    javascript_json::number_text,
    special_duty_clock::{self, DutyClockOperation as Clock},
    special_duty_feedback,
};
use crate::pay::duty_policy::{DutyTariffFamily, standby_levels};
use serde_json::{Value, json};
fn invalid() -> InputError {
    InputError::source(
        "Der Sonderdienstentwurf konnte nicht angezeigt werden.",
        "Error",
    )
}
fn number(value: &Value) -> f64 {
    value.as_f64().unwrap_or(f64::NAN)
}
fn clock(operation: Clock, input: Value) -> Result<Value, InputError> {
    let value = special_duty_clock::execute(operation, &input)?;
    if value["ok"] != true {
        return Err(invalid());
    }
    Ok(value["value"].clone())
}
fn duration(minutes: &Value) -> Result<Value, InputError> {
    clock(Clock::DurationLabel, json!({"minutes":minutes}))
}
fn block(
    title: String,
    part: &Value,
    max_day: i64,
    parent: Option<&Value>,
    hide_pause: bool,
    error: &Value,
) -> Result<Value, InputError> {
    if !(0..=14).contains(&max_day) {
        return Err(invalid());
    }
    let day = |key: &str| {
        let n = number(&part[key]);
        if n.is_finite() {
            (n / 1440.0).floor()
        } else {
            0.0
        }
    };
    let options=(0..=max_day).map(|n|Ok(json!({"value":number_text(n as f64),"label":clock(Clock::DayLabel,json!({"day":n}))?}))).collect::<Result<Vec<_>,InputError>>()?;
    let start = parent
        .map(|p| p["startTime"].clone())
        .map(Ok)
        .unwrap_or_else(|| clock(Clock::ClockLabel, json!({"minutes":part["start"]})))?;
    let end = parent
        .map(|p| p["endTime"].clone())
        .map(Ok)
        .unwrap_or_else(|| clock(Clock::ClockLabel, json!({"minutes":part["end"]})))?;
    let pause = if hide_pause {
        Value::Null
    } else {
        parent
            .map(|p| p["breakMinutes"].clone())
            .unwrap_or_else(|| json!(number_text(number(&part["breakMinutes"]))))
    };
    Ok(
        json!({"title":title,"startClock":start,"endClock":end,"startDay":if parent.is_some(){Value::Null}else{json!(number_text(day("start")))},"endDay":number_text(day("end")),"options":options,"pause":pause,"error":error}),
    )
}
pub fn prepare(input: &Value) -> Result<Value, InputError> {
    prepare_inner(input, false)
}
pub fn prepare_ui(input: &Value) -> Result<Value, InputError> {
    prepare_inner(input, true)
}
fn prepare_inner(input: &Value, with_roles: bool) -> Result<Value, InputError> {
    for key in ["startTime", "endTime", "breakMinutes", "timeZone"] {
        if !input[key].is_string() {
            return Err(invalid());
        }
    }
    let duty = &input["value"];
    let parent = clock(
        Clock::Parent,
        json!({"startTime":input["startTime"],"endTime":input["endTime"],"endDay":duty.get("endDay").unwrap_or(&json!(0)),"pause":input["breakMinutes"]}),
    )?;
    let date = input
        .get("date")
        .filter(|v| !v.is_null())
        .map(|v| v.as_str().ok_or_else(invalid))
        .transpose()?;
    let feedback = if duty.is_null() {
        Value::Null
    } else {
        special_duty_feedback::feedback(duty, &parent, date)?
    };
    let mut blocks = vec![];
    let mut gaps = vec![];
    let mut travel = vec![];
    let mut level = Value::Null;
    let mut work_duration = Value::Null;
    let mut block_roles = vec![];
    let mut travel_roles = vec![];
    let mut add_part = duty.is_null();
    let mut add_callout = false;
    if !duty.is_null() {
        let kind = duty["kind"].as_str().ok_or_else(invalid)?;
        let title = match kind {
            "SPLIT" => "Dienstteil 1",
            "ON_CALL" => "Rufbereitschaftszeitraum",
            "STANDBY" => "Bereitschaftszeitraum",
            _ => return Err(invalid()),
        };
        blocks.push(block(
            title.into(),
            &parent,
            if kind == "ON_CALL" { 14 } else { 1 },
            Some(input),
            kind == "ON_CALL",
            &feedback["parentError"],
        )?);
        block_roles.push(json!({"kind":"PARENT","index":null,"gap":null}));
        if kind == "SPLIT" {
            let parts = duty["parts"]
                .as_array()
                .filter(|v| v.len() <= 8)
                .ok_or_else(invalid)?;
            for (index, part) in parts.iter().enumerate() {
                let mut gap_label = Value::Null;
                let previous = if index == 0 {
                    &parent
                } else {
                    &parts[index - 1]
                };
                if !feedback["workMinutes"].is_null()
                    && number(&part["start"]) > number(&previous["end"])
                {
                    let gap = special_duty_feedback::interval(
                        number(&previous["end"]),
                        number(&part["start"]),
                        duty["timeZone"].as_str().ok_or_else(invalid)?,
                        date,
                    )?;
                    let label = duration(&json!(gap))?;
                    gap_label = json!(format!(
                        "{} Unterbrechung",
                        label.as_str().ok_or_else(invalid)?
                    ));
                    gaps.push(gap_label.clone());
                }
                blocks.push(block(
                    format!("Dienstteil {}", index + 2),
                    part,
                    1,
                    None,
                    false,
                    &feedback["partErrors"][index],
                )?);
                block_roles.push(json!({"kind":"PART","index":index,"gap":gap_label}));
            }
            add_part = parts.len() < 8;
            if !feedback["workMinutes"].is_null() {
                work_duration = duration(&feedback["workMinutes"])?;
            }
        }
        if kind == "ON_CALL" && input["template"] != true {
            let calls = duty["callouts"]
                .as_array()
                .filter(|v| v.len() <= 64)
                .ok_or_else(invalid)?;
            for (index, call) in calls.iter().enumerate() {
                blocks.push(block(
                    format!("Einsatz {}", index + 1),
                    call,
                    duty["endDay"]
                        .as_f64()
                        .filter(|day| {
                            day.is_finite() && day.fract() == 0.0 && (0.0..=14.0).contains(day)
                        })
                        .map(|day| day as i64)
                        .ok_or_else(invalid)?,
                    None,
                    false,
                    &feedback["calloutErrors"][index],
                )?);
                block_roles.push(json!({"kind":"CALLOUT","index":index,"gap":null}));
                if call["kind"] == "ON_SITE" {
                    travel.push(json!({"label":"Hinweg","value":number_text(number(&call["start"])-number(&call["departure"])),"accessibilityLabel":format!("Einsatz {}: Hinweg in Minuten",index+1)}));
                    travel.push(json!({"label":"Rückweg","value":number_text(number(&call["returned"])-number(&call["end"])),"accessibilityLabel":format!("Einsatz {}: Rückweg in Minuten",index+1)}));
                    travel_roles.push(json!({"index":index,"direction":"OUT"}));
                    travel_roles.push(json!({"index":index,"direction":"RETURN"}));
                }
            }
            add_callout = calls.len() < 64;
        }
        if kind == "STANDBY" {
            let raw = input
                .get("tariffFamily")
                .filter(|v| !v.is_null())
                .or_else(|| {
                    duty["standbyAgreement"]
                        .get("tariff")
                        .filter(|v| !v.is_null())
                });
            let family = raw
                .map(|v| {
                    serde_json::from_value::<DutyTariffFamily>(v.clone()).map_err(|_| invalid())
                })
                .transpose()?;
            let levels = standby_levels(family);
            let mut options = vec![json!({"value":"UNKNOWN","label":"Weiß ich noch nicht"})];
            options.extend(
                levels
                    .iter()
                    .map(|level| json!({"value":level,"label":format!("Stufe {level}")})),
            );
            level = json!({"value":if levels.contains(&duty["standbyLevel"].as_str().unwrap_or("")){duty["standbyLevel"].clone()}else{json!("UNKNOWN")},"options":options});
        }
    }
    let mut value = json!({"renderFailed":false,"value":{"parent":parent,"feedback":feedback,"blocks":blocks,"gaps":gaps,"travel":travel,"level":level,"workDurationLabel":work_duration}});
    if with_roles {
        value["roles"] = json!({"blocks":block_roles,"travel":travel_roles,"actions":{"addPart":add_part,"addCallout":add_callout}});
    }
    Ok(value)
}
