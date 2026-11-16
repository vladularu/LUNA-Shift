use super::TrainingError;
use crate::{employment, input};
use serde_json::{Map, Value};
pub(super) fn exact<'a>(
    value: &'a Value,
    keys: &[&str],
) -> Result<&'a Map<String, Value>, TrainingError> {
    let object = value
        .as_object()
        .ok_or_else(|| TrainingError::invalid("Ungültige Ausbildungsdaten."))?;
    if object.len() != keys.len() || keys.iter().any(|k| !object.contains_key(*k)) {
        return Err(TrainingError::invalid(
            "Unbekanntes Format der Ausbildungsdaten.",
        ));
    }
    Ok(object)
}
pub(super) fn integer(value: &Value, min: i64, max: i64) -> Result<i64, TrainingError> {
    value
        .as_f64()
        .filter(|v| v.is_finite() && v.fract() == 0.0 && *v >= min as f64 && *v <= max as f64)
        .map(|v| v as i64)
        .ok_or_else(|| TrainingError::invalid("Ungültige Zahl in den Ausbildungsdaten."))
}
pub(super) fn date_error() -> TrainingError {
    TrainingError::source(
        "RemunerationProfileError",
        "Bitte ein gültiges Gültigkeitsdatum angeben.",
    )
}
pub(super) fn date(value: &Value) -> Result<String, TrainingError> {
    let text = value.as_str().ok_or_else(date_error)?;
    employment::require_remuneration_date(text).map_err(|_| date_error())?;
    Ok(text.into())
}
pub(super) fn query_date(date: &str) -> Result<(), TrainingError> {
    employment::require_remuneration_date(date).map_err(|_| date_error())
}
pub(super) fn instant(value: &Value, label: &str) -> Result<String, TrainingError> {
    input::require_instant(value, label)
        .map(str::to_owned)
        .map_err(|e| TrainingError::source("ValidationError", e.message()))
}
pub(super) fn millis(value: &Value) -> Option<i128> {
    input::javascript_instant_milliseconds(value.as_str()?)
}
pub(super) fn nullable_integer(value: &Value, min: i64, max: i64) -> Result<Value, TrainingError> {
    if value.is_null() {
        Ok(Value::Null)
    } else {
        integer(value, min, max).map(Value::from)
    }
}
pub(super) fn version(value: &Value) -> Option<i64> {
    value
        .get("version")?
        .as_f64()
        .filter(|v| v.is_finite() && v.fract() == 0.0 && *v >= 0.0 && *v <= 3.0)
        .map(|v| v as i64)
}
pub(super) fn temporal() -> TrainingError {
    TrainingError::source(
        "RangeError",
        "Ungültige Zeitangabe in den Ausbildungsdaten.",
    )
}
pub(super) fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(v)) => *v,
        Some(Value::Number(v)) => v.as_f64().is_some_and(|v| v != 0.0),
        Some(Value::String(v)) => !v.is_empty(),
        Some(Value::Array(_) | Value::Object(_)) => true,
    }
}
