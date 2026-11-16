use super::*;
use serde::Deserialize;
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum TemplateFormAction {
    View,
    Type { candidate: String },
    Submit,
    Apply { events: Vec<Value> },
}
/// Rehydrates editable raw strings/checkboxes for one pure calculation only.
/// No form readiness, source authority or persisted write state is deserialized.
pub fn form_action(
    action: &TemplateFormAction,
    existing: &Value,
    appearance: &Value,
    fields: Option<&Value>,
    templates: &[Value],
    quick_date: Option<&str>,
) -> Result<Value, InputError> {
    if templates.len() > 50_000 {
        return Err(invalid());
    }
    let mut draft = TemplateEditorDraft::new_raw(existing, appearance)?;
    if let Some(fields) = fields {
        let object = fields.as_object().ok_or_else(invalid)?;
        for (key, value) in object {
            if key == "type" {
                if !value.as_str().is_some_and(|v| SHIFT_TYPES.contains(&v)) {
                    return Err(invalid());
                }
            } else {
                draft.set_field(key, value)?;
            }
        }
        // Validation above does not replay callbacks: the raw UI fields already
        // include earlier callback effects, such as a subsequently edited pause.
        for (key, value) in object {
            draft.fields[key] = value.clone();
        }
    }
    match action {
        TemplateFormAction::View => {}
        TemplateFormAction::Type { candidate } => draft.choose_type(candidate)?,
        TemplateFormAction::Apply { events } => {
            if events.len() > 4 {
                return Err(invalid());
            }
            for event in events {
                if !event.as_object().is_some_and(|object| {
                    object.len() == 2
                        && object.contains_key("field")
                        && object.contains_key("value")
                }) {
                    return Err(invalid());
                }
                let field = match event["field"].as_str() {
                    Some("duty") => "specialDuty",
                    Some("startTime") => "startTime",
                    Some("endTime") => "endTime",
                    Some("breakMinutes") => "breakMinutes",
                    _ => return Err(invalid()),
                };
                draft.set_field(field, &event["value"])?;
            }
        }
        TemplateFormAction::Submit => {
            return match draft.prepare_submit(templates)? {
                TemplateSubmitStart::Ignored => Err(invalid()),
                TemplateSubmitStart::Blocked { field, message } => Ok(
                    json!({"kind":"BLOCKED","fields":draft.fields(),"field":field,"message":message}),
                ),
                TemplateSubmitStart::Prepared(submission) => {
                    let pause = submission.pause_number();
                    let special = if pause.is_finite() {
                        None
                    } else if pause.is_nan() {
                        Some("NAN")
                    } else if pause.is_sign_positive() {
                        Some("POSITIVE_INFINITY")
                    } else {
                        Some("NEGATIVE_INFINITY")
                    };
                    Ok(
                        json!({"kind":"PREPARED","input":submission.input(),"nonFinitePause":special}),
                    )
                }
            };
        }
    }
    Ok(json!({"fields":draft.fields(),"flags":draft.form_flags(quick_date)}))
}
