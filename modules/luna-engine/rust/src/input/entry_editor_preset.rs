//! Raw default/preset selection, separate from template/source admission.
use super::InputError;
use crate::net::js_truthy;
use serde_json::{Value, json};
fn invalid() -> InputError {
    InputError::source("Die Dienstvorgabe konnte nicht gelesen werden.", "Error")
}
pub fn resolve(kind: &str, templates: &[Value], appearance: &Value) -> Result<Value, InputError> {
    let (start, end, pause, symbol) = match kind {
        "CUSTOM" => (Some("08:00"), Some("16:00"), 30, "D"),
        "EARLY" => (Some("06:00"), Some("14:12"), 30, "F"),
        "LATE" => (Some("13:18"), Some("21:30"), 30, "S"),
        "NIGHT" => (Some("21:00"), Some("07:30"), 60, "N"),
        "DAY" => (Some("08:00"), Some("16:12"), 30, "T"),
        "TRAINING" => (Some("09:00"), Some("17:00"), 30, "F"),
        "VACATION" => (None, None, 0, "U"),
        "SICK" => (None, None, 0, "K"),
        "FREE" => (None, None, 0, "–"),
        _ => return Err(invalid()),
    };
    if let Some(template) = templates.iter().find(|candidate| {
        candidate.get("deletedAt") == Some(&Value::Null)
            && candidate["type"].as_str() == Some(kind)
            && !js_truthy(&candidate["specialDuty"])
    }) {
        let all_day = template
            .get("allDay")
            .filter(|v| !v.is_null())
            .cloned()
            .unwrap_or_else(|| json!(template.get("startTime") == Some(&Value::Null)));
        return Ok(
            json!({"templateId":template["id"],"title":template["name"],"allDay":all_day,"startTime":template["startTime"],"endTime":template["endTime"],"breakMinutes":template["breakMinutes"],"color":template["color"],"symbol":template["symbol"]}),
        );
    }
    let title = appearance["labels"][kind].as_str().ok_or_else(invalid)?;
    let color = appearance["colors"][kind].as_str().ok_or_else(invalid)?;
    Ok(
        json!({"templateId":null,"title":title,"allDay":start.is_none(),"startTime":start,"endTime":end,"breakMinutes":pause,"color":color,"symbol":symbol}),
    )
}
