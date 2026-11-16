//! Compatibility error adapter; the shared serializer lives in input.
use super::PresentationError;
use serde_json::Value;
pub fn stringify(value: &Value) -> Result<String, PresentationError> {
    crate::input::javascript_json::stringify(value).map_err(|_| PresentationError)
}
