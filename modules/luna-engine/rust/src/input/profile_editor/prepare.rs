//! Original submit order as explicit UI state deltas and a borrowed save intent.
use super::{
    EditorSection, EditorSession, ProfileFormError, ProfileSaveInput, model, preview, save,
};
use crate::{
    input::{form_number, profile, profile_form},
    rules::RuleResolver,
};
use serde_json::{Map, Value, json};
#[derive(Clone, Copy)]
enum Kind {
    Blocked,
    Direct,
    Request,
}
pub struct EditorSubmission<'a> {
    profile: &'a Value,
    draft: &'a Value,
    initial: &'a Value,
    section: EditorSection,
    touched: bool,
    kind: Kind,
    delta: Map<String, Value>,
    focus: Value,
    direct: Map<String, Value>,
}
#[derive(Clone)]
pub(crate) struct NativeSubmissionPolicy {
    touched: bool,
    kind: Kind,
    delta: Map<String, Value>,
    focus: Value,
    direct: Map<String, Value>,
}
impl NativeSubmissionPolicy {
    pub(crate) fn feedback(&self) -> Value {
        json!({"delta":self.delta,"focus":self.focus,"kind":match self.kind{Kind::Blocked=>"BLOCKED",Kind::Direct=>"DIRECT",Kind::Request=>"REQUEST"}})
    }
}
pub(crate) fn capture_native(
    profile: &Value,
    baseline: &super::NativeEditorBaseline,
    state: &super::NativeEditorState,
    date: &str,
    resolver: &RuleResolver,
) -> Result<NativeSubmissionPolicy, ProfileFormError> {
    let source = super::ProfileEditorSource::from_native_baseline(profile, baseline);
    let session = EditorSession::from_native(&source, state.clone());
    let value = prepare(&session, date, resolver)?;
    Ok(NativeSubmissionPolicy {
        touched: value.touched,
        kind: value.kind,
        delta: value.delta,
        focus: value.focus,
        direct: value.direct,
    })
}
pub(crate) fn build_native<'a>(
    profile: &'a Value,
    baseline: &'a super::NativeEditorBaseline,
    state: &'a super::NativeEditorState,
    policy: &NativeSubmissionPolicy,
    date: &str,
    final_stage: bool,
    resolver: &RuleResolver,
) -> Result<Option<ProfileSaveInput<'a>>, ProfileFormError> {
    EditorSubmission {
        profile,
        draft: &state.draft,
        initial: &baseline.initial,
        section: baseline.section,
        touched: policy.touched,
        kind: policy.kind,
        delta: policy.delta.clone(),
        focus: policy.focus.clone(),
        direct: policy.direct.clone(),
    }
    .build(date, final_stage, resolver)
}
impl<'a> EditorSubmission<'a> {
    pub fn feedback(&self) -> Value {
        json!({"delta":self.delta,"focus":self.focus,"kind":match self.kind{Kind::Blocked=>"BLOCKED",Kind::Direct=>"DIRECT",Kind::Request=>"REQUEST"}})
    }
    pub fn build(
        &self,
        date: &str,
        final_stage: bool,
        resolver: &RuleResolver,
    ) -> Result<Option<ProfileSaveInput<'a>>, ProfileFormError> {
        match self.kind {
            Kind::Blocked => Ok(None),
            Kind::Direct => Ok(Some(ProfileSaveInput::new(
                self.profile,
                self.direct.clone(),
            ))),
            Kind::Request => save::build(
                save::SaveDraft {
                    profile: self.profile,
                    draft: self.draft,
                    initial: self.initial,
                    section: self.section,
                    touched: self.touched,
                },
                date,
                final_stage,
                resolver,
            )
            .map(Some),
        }
    }
    fn block(&mut self, error: &str, clear_message: bool, focus: Option<&str>) {
        self.kind = Kind::Blocked;
        self.delta.insert("error".into(), json!(error));
        if clear_message {
            self.delta.insert("message".into(), Value::Null);
        }
        if let Some(field) = focus {
            self.focus = json!({"field":field,"message":error});
        }
    }
}
pub fn prepare<'a>(
    session: &'a EditorSession<'_, '_>,
    date: &str,
    resolver: &RuleResolver,
) -> Result<EditorSubmission<'a>, ProfileFormError> {
    let source = session.source;
    let draft = &session.draft;
    let section = source.section;
    let mut submission = EditorSubmission {
        profile: source.original_profile(),
        draft,
        initial: &source.initial,
        section,
        touched: false,
        kind: Kind::Request,
        delta: Map::new(),
        focus: Value::Null,
        direct: Map::new(),
    };
    if matches!(section, EditorSection::Personal | EditorSection::Employer) {
        let result = (|| {
            let name = if matches!(section, EditorSection::Personal) {
                json!(profile::require_profile_text(
                    &draft["displayName"],
                    "Name",
                    80
                )?)
            } else {
                source
                    .original_profile()
                    .get("displayName")
                    .cloned()
                    .unwrap_or(Value::Null)
            };
            let employer = json!(profile::require_profile_text(
                &draft["employerName"],
                "Arbeitgeber",
                160
            )?);
            Ok::<_, crate::input::InputError>((name, employer))
        })();
        match result {
            Ok((name, employer)) => {
                submission.kind = Kind::Direct;
                submission.delta.insert("error".into(), Value::Null);
                if source.original_profile().get("displayName").is_some()
                    || matches!(section, EditorSection::Personal)
                {
                    submission.direct.insert("displayName".into(), name);
                }
                submission.direct.insert("employerName".into(), employer);
            }
            Err(error) => submission.block(error.message(), false, None),
        };
        return Ok(submission);
    }
    let view = preview::calculate(source, draft, date, resolver)?;
    let touched = view["tariffTouched"]
        .as_bool()
        .ok_or_else(profile_form::shape_error)?;
    submission.touched = touched;
    let mode = model::text(draft, "salaryMode");
    let training = view["isTraining"] == true;
    let confirmed = draft["confirmedGroups"]
        .as_array()
        .ok_or_else(profile_form::shape_error)?
        .iter()
        .any(|value| value.as_str() == Some(mode));
    if touched && mode != "MANUAL" && mode != "UNSET" && !training && !confirmed {
        submission.block("Bitte eine gültige Entgeltgruppe für den gewählten Tarif wählen. Gruppe und Stufe werden nicht automatisch ersetzt.",false,None);
        return Ok(submission);
    }
    if touched
        && !training
        && mode != "MANUAL"
        && mode != "UNSET"
        && view["activeLevel"] != "UNSET"
        && !view["activeLevels"]
            .as_array()
            .ok_or_else(profile_form::shape_error)?
            .contains(&view["activeLevel"])
    {
        submission.block(
            "Bitte eine gültige Stufe für die gewählte Gruppe wählen.",
            false,
            None,
        );
        return Ok(submission);
    }
    let weekly = if model::edit_work(section) {
        form_number::weekly_hours_error(model::text(draft, "weeklyHours"))
    } else {
        None
    };
    let salary_mode = if matches!(section, EditorSection::Tariff) && mode == "UNSET" {
        Some("Bitte eine Gehaltsgrundlage wählen.")
    } else {
        None
    };
    let manual = if touched && mode == "MANUAL" {
        profile_form::manual_monthly_gross_error(model::text(draft, "manualMonthlyGross"))
    } else {
        None
    };
    submission
        .delta
        .insert("weeklyHoursError".into(), json!(weekly));
    submission
        .delta
        .insert("manualMonthlyGrossError".into(), json!(manual));
    if let Some(error) = weekly {
        submission.block(error, true, Some("weeklyHours"));
        return Ok(submission);
    }
    if let Some(error) = salary_mode {
        submission.block(error, true, None);
        return Ok(submission);
    }
    if let Some(error) = manual {
        submission.block(error, true, Some("manualMonthlyGross"));
        return Ok(submission);
    }
    let unset = touched
        && ((["TVOED_P", "TVOED_E", "TVL_KR"].contains(&mode) && draft["payLevel"] == "UNSET")
            || (mode == "TVH_KR" && draft["tvhPayLevel"] == "UNSET")
            || (mode == "TVUK_NURSING" && draft["tvUkPayLevel"] == "UNSET"));
    if unset {
        submission.block(
            "Bitte eine gültige Stufe für die gewählte Gruppe wählen.",
            true,
            None,
        );
        return Ok(submission);
    }
    if touched
        && ["TVAOED_PFLEGE", "TVAL_PFLEGE"].contains(&mode)
        && draft["trainingYear"] == "UNSET"
    {
        submission.block("Bitte das Ausbildungsjahr wählen.", true, None);
        return Ok(submission);
    }
    submission.delta.insert("error".into(), Value::Null);
    submission.delta.insert("message".into(), Value::Null);
    Ok(submission)
}
