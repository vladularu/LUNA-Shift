//! Shared raw target projection. No source selection or readiness admission.
use super::sources::{RequiredCoverage, SourceReadError, ready_state};
use crate::{
    contract::SourceState,
    input::{
        personal_context::load_youth_protection_preference,
        working_time_target::RawSavedWorkingTimeTarget,
    },
    target::InputStatus,
};
use serde_json::Value;

// Validation already consumed saved-map/full-plan signatures. Move only the
// required context, preserving the original pointer and READY-none behavior.
pub(crate) fn retain_target_context(mut snapshot: Value) -> Option<Value> {
    let context = snapshot.as_object_mut()?.remove("context")?;
    let mut retained = serde_json::Map::new();
    retained.insert("context".into(), context);
    Some(Value::Object(retained))
}
pub(crate) fn target_snapshot(state: &SourceState) -> (InputStatus, Option<Value>) {
    match state {
        SourceState::NotRequested | SourceState::Loading => (InputStatus::Loading, None),
        SourceState::Failed { .. } => (InputStatus::Error, None),
        SourceState::Ready { .. } => {
            let result = (|| {
                let raw = ready_state(state, RequiredCoverage::AllHistory)
                    .and_then(|v| v.value())
                    .map_err(|_| crate::target::TargetError::InvalidInput)?;
                let object = raw
                    .as_object()
                    .filter(|v| {
                        v.len() == 3
                            && v.contains_key("savedRow")
                            && v.contains_key("timeZoneRow")
                            && v.contains_key("planRows")
                    })
                    .ok_or(crate::target::TargetError::InvalidInput)?;
                let saved = if object["savedRow"].is_null() {
                    None
                } else {
                    Some(RawSavedWorkingTimeTarget::try_from_raw_row_chunks(
                        &object["savedRow"],
                    )?)
                };
                let time_zone = if object["timeZoneRow"].is_null() {
                    None
                } else {
                    let row = object["timeZoneRow"]
                        .as_object()
                        .filter(|row| row.len() == 1 && row.contains_key("time_zone"))
                        .ok_or(crate::target::TargetError::InvalidInput)?;
                    match &row["time_zone"] {
                        Value::Null => None,
                        Value::String(text) => Some(text.as_str()),
                        _ => return Err(crate::target::TargetError::InvalidInput),
                    }
                };
                let plan = object["planRows"]
                    .as_array()
                    .ok_or(crate::target::TargetError::InvalidInput)?;
                crate::target::profile::project_saved_target_snapshot(
                    saved.as_ref().map(RawSavedWorkingTimeTarget::saved),
                    time_zone,
                    plan,
                )
            })();
            match result {
                Ok(value) => (InputStatus::Ready, retain_target_context(value)),
                Err(_) => (InputStatus::Error, None),
            }
        }
    }
}
pub(crate) fn youth_snapshot(state: &SourceState) -> (InputStatus, Option<bool>) {
    match ready_state(state, RequiredCoverage::AllHistory).and_then(|v| v.nullable()) {
        Ok(value) => match load_youth_protection_preference(value.unwrap_or(&Value::Null)) {
            Ok(value) => (InputStatus::Ready, Some(value)),
            Err(_) => (InputStatus::Error, None),
        },
        Err(SourceReadError::NotRequested | SourceReadError::Loading) => {
            (InputStatus::Loading, None)
        }
        Err(_) => (InputStatus::Error, None),
    }
}
