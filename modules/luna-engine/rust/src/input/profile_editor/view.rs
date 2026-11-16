//! UI-only props from the genuine initial baseline and native current fields.
use super::{ProfileEditorSource, ProfileFormError, labels};
use crate::input::{profile, profile_form::shape_error};
use serde_json::{Value, json};
pub(super) fn metadata(
    source: &ProfileEditorSource<'_>,
    draft: &Value,
) -> Result<Value, ProfileFormError> {
    let initial_hours = source.initial["weeklyHours"]
        .as_str()
        .ok_or_else(shape_error)?;
    let federal_state = draft["federalState"].as_str().ok_or_else(shape_error)?;
    let options = profile::holiday_regions_for_state(federal_state)
        .iter()
        .map(|value| json!({"value":value,"label":labels::holiday(Some(value))}))
        .collect::<Vec<_>>();
    Ok(
        json!({"initialWeeklyHoursLabel":format!("{initial_hours} Std."),"salaryConflict":source.profile.get("salaryBasisConflict").is_some_and(crate::net::js_truthy),"holidayOptions":options}),
    )
}
