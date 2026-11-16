use crate::employment::{EmploymentError, profile_view::EmploymentProfileRef};
use serde_json::{Map, Value};
/// Omit calculation-only owners before copying the exported metadata.
pub(super) fn metadata(profile: &Value, date: &str) -> Result<Value, EmploymentError> {
    let view = EmploymentProfileRef::at(profile, date)?;
    let mut out = Map::new();
    if let Some(original) = profile.as_object() {
        for (k, v) in original {
            if !["workingTimeTarget", "employmentTimeline"].contains(&k.as_str()) {
                out.insert(k.clone(), v.clone());
            }
        }
    }
    if let Some(overlay) = view.overlay().and_then(Value::as_object) {
        for (k, v) in overlay {
            if !["workingTimeTarget", "employmentTimeline"].contains(&k.as_str()) {
                out.insert(k.clone(), v.clone());
            }
        }
    }
    Ok(Value::Object(out))
}
