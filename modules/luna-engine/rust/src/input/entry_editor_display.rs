//! Raw render policy. Persisted profile admission remains in the private editor resource.
use super::{InputError, form_number};
use crate::{
    credit::duty,
    employment::profile_view::EmploymentProfileRef,
    net::js_truthy,
    pay::duty_policy,
    time::{self, ShiftTime},
};
use serde_json::{Value, json};
fn invalid() -> InputError {
    InputError::source("Der Eintragsentwurf konnte nicht gelesen werden.", "Error")
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, InputError> {
    value[key].as_str().ok_or_else(invalid)
}
fn duration(shift: &Value, zone: &str) -> Option<Value> {
    if js_truthy(&shift["specialDuty"]) {
        return duty::special_duty_work_minutes(shift).ok();
    }
    if js_truthy(&shift["allDay"]) || shift["startTime"].is_null() || shift["endTime"].is_null() {
        return Some(json!(0));
    }
    let input = ShiftTime {
        date: shift["date"].as_str()?.to_owned(),
        start_time: Some(shift["startTime"].as_str()?.to_owned()),
        end_time: Some(shift["endTime"].as_str()?.to_owned()),
        break_minutes: 0,
        all_day: false,
        special_duty: None,
    };
    let gross = time::shift_minutes(&input, zone).ok()?;
    let pause = shift["breakMinutes"].as_f64()?;
    Some(json!((gross - pause).max(0.0)))
}
pub fn prepare_raw(input: &Value) -> Result<Value, InputError> {
    prepare(
        &input["fields"],
        &input["profile"],
        text(input, "date")?,
        text(input, "mode")?,
        &input["initialShift"],
        &input["initialAppointment"],
    )
}
/// Native source resources borrow the genuine profile; never serialize/copy a full
/// 50k history merely to render editor flags or a duration.
pub fn prepare(
    fields: &Value,
    profile: &Value,
    date: &str,
    mode: &str,
    initial_shift: &Value,
    initial_appointment: &Value,
) -> Result<Value, InputError> {
    let zone = profile["timeZone"].as_str().unwrap_or("Europe/Berlin");
    let (display, failed) = match mode {
        "SHIFT" => {
            let absence = ["VACATION", "SICK", "FREE"].contains(&text(fields, "shiftType")?);
            let timed = !absence && !js_truthy(&fields["shiftAllDay"]);
            let raw = form_number::number(text(fields, "breakMinutes")?);
            let pause = if raw.is_nan() || raw == 0.0 { 0.0 } else { raw };
            let shift = json!({"date":initial_shift["date"].as_str().unwrap_or(date),"startTime":fields["startTime"],"endTime":fields["endTime"],"breakMinutes":pause,"allDay":false,"specialDuty":fields["specialDuty"]});
            let value = if timed {
                duration(&shift, zone).unwrap_or(Value::Null)
            } else {
                Value::Null
            };
            (
                json!({"shiftIsAbsence":absence,"shiftIsTimed":timed,"durationMinutes":value,"specialDutyVisible":timed&&fields["shiftType"]!="TRAINING","pauseValue":pause}),
                false,
            )
        }
        "APPOINTMENT" => {
            let all_day = js_truthy(&fields["allDay"]);
            let shift = json!({"date":date,"startTime":fields["appointmentStart"],"endTime":fields["appointmentEnd"],"breakMinutes":0,"allDay":false});
            let value = if all_day {
                Some(Value::Null)
            } else {
                duration(&shift, zone)
            };
            match value {
                Some(value) => (
                    json!({"durationMinutes":value,"isSeries":js_truthy(&initial_appointment["recurrence"])}),
                    false,
                ),
                None => (Value::Null, true),
            }
        }
        _ => return Err(invalid()),
    };
    let (tariff, tariff_error) = if profile.is_null() {
        (Value::Null, Value::Null)
    } else {
        let at = initial_shift["date"].as_str().unwrap_or(date);
        match EmploymentProfileRef::at(profile, at) {
            Ok(effective) => {
                let mut selected = serde_json::Map::new();
                for key in [
                    "tvUkNursingTariff",
                    "tvhKrTariff",
                    "tvalPflegeTariff",
                    "tvlKrTariff",
                    "nursingTrainingTariff",
                    "vkaETariff",
                    "tariff",
                ] {
                    if let Some(value) = effective.get(key) {
                        selected.insert(key.to_owned(), value.clone());
                    }
                }
                (
                    serde_json::to_value(duty_policy::duty_tariff_family(&Value::Object(selected)))
                        .map_err(|_| invalid())?,
                    Value::Null,
                )
            }
            Err(error) => {
                let error = super::employment::employment_error(error);
                (
                    Value::Null,
                    json!({"name":error.name(),"message":error.to_string()}),
                )
            }
        }
    };
    Ok(json!({"display":display,"renderFailed":failed,"tariff":tariff,"tariffError":tariff_error}))
}
