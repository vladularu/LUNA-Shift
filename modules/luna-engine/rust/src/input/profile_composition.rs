//! Financial profile composition from checked SQL/profile-history facts only.
use super::{
    InputError, employment::RawEmploymentHistory, simple_profile::project_stored_simple_profile,
    stored_profile::OpaqueStoredWorkProfile,
};
use serde_json::{Value, json};
use std::sync::Arc;
pub fn financial_work_profile(
    stored: &OpaqueStoredWorkProfile,
    history: &RawEmploymentHistory,
    reference_date: &str,
) -> Result<Arc<Value>, InputError> {
    let projected = project_stored_simple_profile(
        Some(stored.flat_profile()),
        history.profiles(),
        reference_date,
    )?
    .ok_or_else(|| InputError::validation("Das gespeicherte Arbeitsprofil ist nicht verfügbar."))?;
    let mut profile = projected.as_ref().clone();
    profile
        .as_object_mut()
        .ok_or_else(|| InputError::validation("Die gespeicherten Profilangaben sind ungültig."))?
        .insert(
            "employmentTimeline".into(),
            json!(history.profiles().as_ref()),
        );
    Ok(Arc::new(profile))
}
