//! Strict saved-row boundary. Contexts, stale roster evidence and target totals
//! are constructed later by native target::profile functions, never supplied
//! as already prepared input.
use crate::{
    contract::MAX_SAFE_REVISION,
    target::{self, TargetError},
};
use serde_json::{Value, json};
use std::sync::Arc;

fn header<'a>(row: &'a Value, json_key: &str) -> Result<(i64, &'a str, &'a str), TargetError> {
    let object = row.as_object().ok_or(TargetError::InvalidInput)?;
    if object.len() != 5
        || ["id", json_key, "revision", "created_at", "updated_at"]
            .iter()
            .any(|key| !object.contains_key(*key))
        || row["id"] != "singleton"
    {
        return Err(TargetError::InvalidInput);
    }
    let revision = row["revision"]
        .as_f64()
        .filter(|n| {
            n.is_finite() && n.fract() == 0.0 && *n >= 1.0 && *n <= MAX_SAFE_REVISION as f64
        })
        .ok_or(TargetError::InvalidInput)? as i64;
    let created = row["created_at"]
        .as_str()
        .ok_or(TargetError::InvalidInput)?;
    let updated = row["updated_at"]
        .as_str()
        .ok_or(TargetError::InvalidInput)?;
    let created_instant =
        super::precise_instant_nanoseconds(created).ok_or(TargetError::InvalidInput)?;
    let updated_instant =
        super::precise_instant_nanoseconds(updated).ok_or(TargetError::InvalidInput)?;
    if created_instant > updated_instant {
        return Err(TargetError::InvalidInput);
    }
    Ok((revision, created, updated))
}
fn mapped(settings: &Value, header: (i64, &str, &str)) -> Result<Value, TargetError> {
    let (revision, created, updated) = header;
    let settings = target::validate_saved_target_settings(settings)?;
    Ok(json!({"settings":settings,"revision":revision,"createdAt":created,"updatedAt":updated}))
}
/// Exact ordinary SQL row projection, with a bounded non-echoing error for
/// malformed/non-finite stored JSON instead of reflecting its contents.
pub fn map_working_time_target_row(row: &Value) -> Result<Value, TargetError> {
    if !row["settings_json"].is_string() {
        return Err(TargetError::InvalidInput);
    }
    let info = header(row, "settings_json")?;
    let parsed = super::raw_json::parse(row["settings_json"].as_str().unwrap())
        .map_err(|_| TargetError::InvalidInput)?;
    mapped(&parsed, info)
}
pub struct RawSavedWorkingTimeTarget(Arc<Value>);
impl RawSavedWorkingTimeTarget {
    /// The thin adapter splits the original settings_json into UTF-8 chunks;
    /// Rust performs JSON parsing, field validation and metadata comparisons.
    pub fn try_from_raw_row_chunks(row: &Value) -> Result<Self, TargetError> {
        let info = header(row, "settings_json_chunks")?;
        let parsed = super::raw_json::parse_chunks(&row["settings_json_chunks"])
            .map_err(|_| TargetError::InvalidInput)?;
        mapped(&parsed, info).map(|v| Self(Arc::new(v)))
    }
    pub fn saved(&self) -> &Value {
        &self.0
    }
    pub fn shared(&self) -> &Arc<Value> {
        &self.0
    }
}
