//! Source-bound full calculation profile. The caller retains its result and
//! prepared target owner across jobs; this composition is never a monthly loop.
use super::{
    InputError, calendar_rows::RawCalendarEntries, employment::RawEmploymentHistory,
    personal_context::CheckedWorkPatternSettings, simple_profile::project_stored_simple_profile,
    stored_profile::OpaqueStoredWorkProfile, working_time_target::RawSavedWorkingTimeTarget,
};
use crate::target::InputStatus;
use serde_json::Value;
use std::sync::Arc;
/// Rust-created source states, not a deserializable caller Ready flag.
pub enum TargetProfileFacts<'a> {
    Loading,
    Error,
    Ready {
        saved: Option<&'a RawSavedWorkingTimeTarget>,
        calendar: &'a RawCalendarEntries,
    },
}
#[derive(Clone, Copy)]
pub struct YouthProtectionFacts {
    pub value: Option<bool>,
    pub status: InputStatus,
}
pub fn calculation_work_profile(
    stored: &OpaqueStoredWorkProfile,
    history: &RawEmploymentHistory,
    reference_date: &str,
    target: TargetProfileFacts<'_>,
    youth: YouthProtectionFacts,
) -> Result<Arc<Value>, InputError> {
    calculation_work_profile_with_settings(stored, history, reference_date, target, youth, None)
}
/// Provider-compatible fallback is applied to the small projected profile before
/// building its potentially large target context. A saved employment answer wins.
pub fn calculation_work_profile_with_settings(
    stored: &OpaqueStoredWorkProfile,
    history: &RawEmploymentHistory,
    reference_date: &str,
    target: TargetProfileFacts<'_>,
    youth: YouthProtectionFacts,
    settings: Option<&CheckedWorkPatternSettings>,
) -> Result<Arc<Value>, InputError> {
    let projected = project_stored_simple_profile(
        Some(stored.flat_profile()),
        history.profiles(),
        reference_date,
    )?
    .ok_or_else(|| InputError::validation("Das gespeicherte Arbeitsprofil ist nicht verfügbar."))?;
    let projected = if projected.get("workPattern").is_none_or(Value::is_null)
        && let Some(settings) = settings
    {
        let mut value = projected.as_ref().clone();
        let settings = settings.settings();
        value.as_object_mut().ok_or_else(|| InputError::validation("Das gespeicherte Arbeitsprofil ist nicht verfügbar."))?.insert(
            "workPattern".into(), serde_json::json!({"workplaceCoverage":settings.workplace_coverage,"assignment":settings.assignment}),
        );
        Arc::new(value)
    } else {
        projected
    };
    bind_calculation_profile(stored, history, projected.as_ref(), target, youth)
}
/// Bind the existing target/plan policy to a caller-selected native profile
/// role. The caller supplies a genuine private provider/calculation projection;
/// neither a wire Ready value nor a second compatibility projection is admitted.
pub(crate) fn bind_calculation_profile(
    stored: &OpaqueStoredWorkProfile,
    history: &RawEmploymentHistory,
    projected: &Value,
    target: TargetProfileFacts<'_>,
    youth: YouthProtectionFacts,
) -> Result<Arc<Value>, InputError> {
    let target_error = |error: crate::target::TargetError| {
        InputError::source(error.to_string(), "WorkingTimeTargetError")
    };
    let (status, snapshot) = match target {
        TargetProfileFacts::Loading => (InputStatus::Loading, None),
        TargetProfileFacts::Error => (InputStatus::Error, None),
        TargetProfileFacts::Ready { saved, calendar } => {
            // readPlan binds the original SQL timezone text, including spelling
            // and whitespace; display normalization must not repair signatures.
            let snapshot = crate::target::profile::project_saved_target_snapshot(
                saved.map(RawSavedWorkingTimeTarget::saved),
                stored.raw_profile()["time_zone"].as_str(),
                calendar.target_plan_rows(),
            )
            .map_err(target_error)?;
            (InputStatus::Ready, Some(snapshot))
        }
    };
    crate::target::profile::create_working_time_calculation_profile(
        projected,
        snapshot.as_ref(),
        history.profiles(),
        status,
        youth.value,
        youth.status,
    )
    .map(Arc::new)
    .map_err(target_error)
}
