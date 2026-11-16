//! Stateless Template/QuickEntry business policy; no source, controller or write admission.
use super::{InputError, template_editor::planned};
use serde::Deserialize;
use serde_json::{Map, Value, json};
#[derive(Debug, Deserialize)]
#[serde(tag = "mode", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum TemplateActionCommand {
    #[serde(rename_all = "camelCase")]
    Form {
        action: super::template_editor::TemplateFormAction,
        quick_entry_date: Option<String>,
        existing: Value,
        appearance: Value,
        fields: Option<Value>,
        templates: Vec<Value>,
    },
    #[serde(rename_all = "camelCase")]
    SavePlan {
        input: Value,
        quick_entry_date: Option<String>,
        current_json: String,
        previous_json: Option<String>,
        previous_template: Value,
    },
    QuickInput {
        template: Value,
        date: String,
    },
    MatchIndices {
        template: Value,
        date: String,
        entries: Vec<Value>,
    },
    #[serde(rename_all = "camelCase")]
    StampPreview {
        template: Value,
        date: String,
        pending_id: String,
        color: String,
        symbol: String,
    },
}
fn invalid() -> InputError {
    InputError::source("Vorlagenaktion konnte nicht berechnet werden.", "Error")
}
pub(crate) fn reuses_previous(current: &str, previous: Option<&str>) -> bool {
    previous == Some(current)
}
pub(crate) fn calendar_date<'a>(input: &Value, date: Option<&'a str>) -> Option<&'a str> {
    date.filter(|date| !date.is_empty() && input.get("id").is_none())
}
pub(crate) fn matches_entry<'a>(
    template: &Value,
    date: &str,
    get: impl Fn(&str) -> Option<&'a Value>,
) -> bool {
    let absent = ["VACATION", "SICK", "FREE"]
        .iter()
        .any(|kind| template["type"] == *kind);
    get("kind").is_some_and(|v| v == "SHIFT")
        && get("deletedAt") == Some(&Value::Null)
        && get("date").is_some_and(|v| v == date)
        && (get("templateId") == template.get("id")
            || (get("templateId") == Some(&Value::Null)
                && absent
                && get("type") == template.get("type")))
}
fn copy_field(target: &mut Map<String, Value>, key: &str, source: &Value, source_key: &str) {
    if let Some(v) = source.get(source_key) {
        target.insert(key.into(), v.clone());
    } else {
        target.remove(key);
    }
}
pub(crate) fn quick_input(template: &Value, date: &str) -> Result<Value, InputError> {
    if !template.is_object() {
        return Err(invalid());
    }
    let mut input = Map::new();
    input.insert("date".into(), json!(date));
    for (key, source) in [
        ("templateId", "id"),
        ("title", "name"),
        ("type", "type"),
        ("allDay", "allDay"),
    ] {
        copy_field(&mut input, key, template, source);
    }
    if crate::net::js_truthy(&template["specialDuty"]) {
        input.insert("specialDuty".into(), planned(&template["specialDuty"])?);
    }
    for key in [
        "startTime",
        "endTime",
        "breakMinutes",
        "color",
        "symbol",
        "notification",
        "location",
    ] {
        copy_field(&mut input, key, template, key);
    }
    Ok(Value::Object(input))
}
impl TemplateActionCommand {
    pub fn execute(&self) -> Result<Value, InputError> {
        match self {
            Self::Form {
                action,
                quick_entry_date,
                existing,
                appearance,
                fields,
                templates,
            } => super::template_editor::form_action(
                action,
                existing,
                appearance,
                fields.as_ref(),
                templates,
                quick_entry_date.as_deref(),
            ),
            Self::SavePlan {
                input,
                quick_entry_date,
                current_json,
                previous_json,
                previous_template,
            } => {
                if !input.is_object() || (previous_json.is_some() && !previous_template.is_object())
                {
                    return Err(invalid());
                }
                if reuses_previous(current_json, previous_json.as_deref()) {
                    return Ok(
                        json!({"kind":"REUSE","createsCalendarEntry":calendar_date(input,quick_entry_date.as_deref()).is_some()}),
                    );
                }
                let mut plan = json!({"kind":"SAVE","createsCalendarEntry":calendar_date(input,quick_entry_date.as_deref()).is_some()});
                if previous_json.is_some() {
                    let mut overrides = Map::new();
                    copy_field(&mut overrides, "id", previous_template, "id");
                    copy_field(
                        &mut overrides,
                        "expectedRevision",
                        previous_template,
                        "revision",
                    );
                    plan["overrides"] = Value::Object(overrides);
                }
                Ok(plan)
            }
            Self::QuickInput { template, date } => quick_input(template, date),
            Self::MatchIndices {
                template,
                date,
                entries,
            } => {
                if entries.len() > 128
                    || !template.is_object()
                    || entries.iter().any(|v| !v.is_object())
                {
                    return Err(invalid());
                }
                Ok(json!(
                    entries
                        .iter()
                        .enumerate()
                        .filter_map(|(index, entry)| matches_entry(template, date, |key| entry
                            .get(key))
                        .then_some(index))
                        .collect::<Vec<_>>()
                ))
            }
            Self::StampPreview {
                template,
                date,
                pending_id,
                color,
                symbol,
            } => {
                let mut input = quick_input(template, date)?
                    .as_object()
                    .cloned()
                    .ok_or_else(invalid)?;
                input.insert("kind".into(), json!("SHIFT"));
                input.insert("id".into(), json!(pending_id));
                for (key, source) in [("templateId", "id"), ("title", "name"), ("type", "type")] {
                    copy_field(&mut input, key, template, source);
                }
                input.insert("specialDuty".into(), planned(&template["specialDuty"])?);
                for key in ["startTime", "endTime", "breakMinutes"] {
                    copy_field(&mut input, key, template, key);
                }
                input.insert("color".into(), json!(color));
                input.insert("symbol".into(), json!(symbol));
                input.insert("note".into(), Value::Null);
                input.insert("overtimeMinutes".into(), json!(0));
                input.insert("holidayPremiumMode".into(), json!("WITH_TIME_OFF"));
                input.insert("revision".into(), json!(0));
                input.insert("createdAt".into(), json!(""));
                input.insert("updatedAt".into(), json!(""));
                input.insert("deletedAt".into(), Value::Null);
                Ok(Value::Object(input))
            }
        }
    }
}
