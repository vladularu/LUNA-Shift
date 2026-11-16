//! Actual editor policy, separate from the reusable profile form primitives.
mod changes;
mod labels;
mod model;
mod prepare;
mod preview;
mod save;
mod session;
mod validity;
mod view;
use crate::{
    input::profile_form::{FormClock, ProfileFormError, ProfileFormSource, settings_values},
    rules::RuleResolver,
};
pub use changes::{ProfileFields, change_lines, changed_fields};
pub use labels::{salary_label, work_label, work_salary_summary};
pub use prepare::{EditorSubmission, prepare};
pub(crate) use prepare::{NativeSubmissionPolicy, build_native, capture_native};
pub use save::ProfileSaveInput;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
pub(crate) use session::NativeEditorState;
pub use session::{EditorField, EditorIntent, EditorSession};
pub(crate) use validity::timeline_key;
pub use validity::{SaveScope, effective_date, prepare_validity, save_validity, undo_input};
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EditorSection {
    Work,
    Tariff,
    Personal,
    Employer,
    Employment,
    Model,
}
pub struct EditorDraftPatch<'a>(&'a Value);
impl<'a> EditorDraftPatch<'a> {
    pub fn try_from_raw(raw: &'a Value) -> Result<Self, ProfileFormError> {
        let Some(object) = raw.as_object() else {
            return Err(super::profile_form::shape_error().into());
        };
        for (key, value) in object {
            model::validate_field(key, value)?;
        }
        Ok(Self(raw))
    }
}
/// Retains the source profile by reference. No target/history tree is copied
/// into either form output or the native baseline.
pub struct ProfileEditorSource<'a> {
    profile: &'a Value,
    section: EditorSection,
    from_more: bool,
    reference_date: String,
    initial: Value,
}
/// Small baseline produced only by a checked native editor initialization.
#[derive(Clone)]
pub(crate) struct NativeEditorBaseline {
    section: EditorSection,
    from_more: bool,
    reference_date: String,
    initial: Value,
}
impl<'a> ProfileEditorSource<'a> {
    pub(crate) fn native_baseline(&self) -> NativeEditorBaseline {
        NativeEditorBaseline {
            section: self.section,
            from_more: self.from_more,
            reference_date: self.reference_date.clone(),
            initial: self.initial.clone(),
        }
    }
    pub(crate) fn from_native_baseline(
        profile: &'a Value,
        baseline: &NativeEditorBaseline,
    ) -> Self {
        Self {
            profile,
            section: baseline.section,
            from_more: baseline.from_more,
            reference_date: baseline.reference_date.clone(),
            initial: baseline.initial.clone(),
        }
    }
    /// Borrowed source for subsequent native save preparation. This is not a
    /// serialized form field or a constructor from a host-ready profile.
    pub fn original_profile(&self) -> &'a Value {
        self.profile
    }
    pub fn new(
        profile: &'a Value,
        section: EditorSection,
        from_more: bool,
        reference_date: &str,
        clock: &FormClock,
        resolver: &RuleResolver,
    ) -> Result<Self, ProfileFormError> {
        let form = ProfileFormSource::try_from_raw(profile)?;
        let values = serde_json::to_value(settings_values(
            &form,
            Some(reference_date),
            clock,
            resolver,
        )?)
        .map_err(|_| super::profile_form::shape_error())?;
        let initial = model::initial(profile, &values)?;
        Ok(Self {
            profile,
            section,
            from_more,
            reference_date: reference_date.into(),
            initial,
        })
    }
    pub fn bootstrap(&self, resolver: &RuleResolver) -> Result<Value, ProfileFormError> {
        // The reference day is retained separately from editable field values.
        let reference_date = &self.reference_date;
        let draft = self.initial.clone();
        Ok(
            json!({"draft":draft,"preview":preview::calculate(self,&draft,reference_date,resolver)?}),
        )
    }
    pub fn preview(
        &self,
        patch: &EditorDraftPatch<'_>,
        reference_date: &str,
        resolver: &RuleResolver,
    ) -> Result<Value, ProfileFormError> {
        let draft = self.current(patch)?;
        preview::calculate(self, &draft, reference_date, resolver)
    }
    pub fn editor_metadata(&self, patch: &EditorDraftPatch<'_>) -> Result<Value, ProfileFormError> {
        self.native_editor_metadata(&self.current(patch)?)
    }
    pub(crate) fn native_editor_metadata(&self, draft: &Value) -> Result<Value, ProfileFormError> {
        view::metadata(self, draft)
    }
    fn current(&self, patch: &EditorDraftPatch<'_>) -> Result<Value, ProfileFormError> {
        let mut draft = self.initial.clone();
        let object = draft
            .as_object_mut()
            .ok_or_else(super::profile_form::shape_error)?;
        for (key, value) in patch
            .0
            .as_object()
            .ok_or_else(super::profile_form::shape_error)?
        {
            object.insert(key.clone(), value.clone());
        }
        Ok(draft)
    }
}
