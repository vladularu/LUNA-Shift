use super::changes::{ProfileFields, capture};
use super::{ProfileFormError, ProfileSaveInput};
use crate::{
    employment,
    input::{javascript_json, profile_form},
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SaveScope {
    All,
    Date,
}
pub fn prepare_validity<'a>(
    before: &Value,
    input: &'a Value,
    scope: SaveScope,
    day: &str,
) -> Result<ProfileSaveInput<'a>, ProfileFormError> {
    let effective_from = effective_date(scope, day)?;
    let validity = save_validity(before, input, effective_from.as_deref())?;
    Ok(ProfileSaveInput::new(
        input,
        [("validity".into(), validity)].into_iter().collect(),
    ))
}
pub fn effective_date(scope: SaveScope, day: &str) -> Result<Option<String>, ProfileFormError> {
    if matches!(scope, SaveScope::All) {
        return Ok(None);
    }
    let day = if day.len() == 10
        && day.as_bytes()[2] == b'.'
        && day.as_bytes()[5] == b'.'
        && day
            .bytes()
            .enumerate()
            .all(|(i, b)| i == 2 || i == 5 || b.is_ascii_digit())
    {
        format!("{}-{}-{}", &day[6..], &day[3..5], &day[..2])
    } else {
        day.to_owned()
    };
    employment::require_remuneration_date(&day)?;
    Ok(Some(day))
}
pub(crate) fn timeline_key(profile: &impl ProfileFields) -> Result<String, ProfileFormError> {
    match profile.field("employmentTimeline").filter(|v| !v.is_null()) {
        Some(v) => javascript_json::stringify(v).map_err(|_| profile_form::shape_error().into()),
        None => Ok("[]".into()),
    }
}
pub fn save_validity(
    before: &impl ProfileFields,
    input: &impl ProfileFields,
    effective_from: Option<&str>,
) -> Result<Value, ProfileFormError> {
    let fields = super::changed_fields(before, input)?;
    let mut result = serde_json::json!({"effectiveFrom":effective_from,"fields":fields,"expectedTimeline":timeline_key(before)?,"baseline":capture(before)});
    if let Some(updated) = before.field("updatedAt") {
        result["expectedProfileUpdatedAt"] = updated.clone()
    }
    if effective_from.is_none() {
        result["correctionFields"] = serde_json::json!(fields)
    }
    Ok(result)
}
pub fn undo_input<'a>(
    before: &'a Value,
    saved: &Value,
) -> Result<ProfileSaveInput<'a>, ProfileFormError> {
    let mut validity = serde_json::json!({"effectiveFrom":null,"baseline":capture(saved),"expectedTimeline":timeline_key(saved)?,"restoreTimeline":before.get("employmentTimeline").filter(|v|!v.is_null()).cloned().unwrap_or_else(||serde_json::json!([]))});
    if let Some(updated) = saved.get("updatedAt") {
        validity["expectedProfileUpdatedAt"] = updated.clone()
    }
    let mut changes = Map::new();
    changes.insert("validity".into(), validity);
    Ok(ProfileSaveInput::new(before, changes))
}
