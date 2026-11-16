//! Raw TemplateEditorForm policy. This helper grants no persisted-source or write admission.
mod finish;
mod stateless;
pub use stateless::{TemplateFormAction, form_action};
#[cfg(test)]
mod tests;
mod view;
use super::{InputError, form_number, javascript_json};
use serde_json::{Value, json};
pub use view::tariff_query;

const TYPES: [&str; 5] = ["CUSTOM", "TRAINING", "VACATION", "SICK", "FREE"];
const SHIFT_TYPES: [&str; 9] = [
    "CUSTOM", "TRAINING", "VACATION", "SICK", "FREE", "EARLY", "LATE", "NIGHT", "DAY",
];
fn invalid() -> InputError {
    InputError::source("Der Vorlagenentwurf konnte nicht gelesen werden.", "Error")
}
fn value(source: &Value, key: &str, default: Value) -> Value {
    source
        .get(key)
        .filter(|v| !v.is_null())
        .cloned()
        .unwrap_or(default)
}
fn absence(kind: &Value) -> bool {
    ["VACATION", "SICK", "FREE"].iter().any(|s| kind == *s)
}
pub(crate) fn planned(raw: &Value) -> Result<Value, InputError> {
    if raw.is_null() {
        return Ok(Value::Null);
    }
    let mut duty = raw.as_object().cloned().ok_or_else(invalid)?;
    duty.insert("callouts".into(), json!([]));
    duty.insert("calloutsComplete".into(), json!(false));
    if let Some(agreement) = duty
        .get_mut("standbyAgreement")
        .filter(|v| crate::net::js_truthy(v))
    {
        agreement
            .as_object_mut()
            .ok_or_else(invalid)?
            .insert("sequence".into(), Value::Null);
    }
    Ok(Value::Object(duty))
}
fn json_number(number: f64) -> Value {
    if number.is_finite() {
        serde_json::from_str(&javascript_json::number_text(number))
            .expect("native finite JavaScript number")
    } else {
        Value::Null
    }
}

/// Retains the actual Number(raw pause) separately from JSON.stringify's null
/// projection of NaN/infinity. It is raw intent, never validated/saved settings.
pub struct TemplateSubmission {
    input: Value,
    pause: f64,
}
impl TemplateSubmission {
    pub fn input(&self) -> &Value {
        &self.input
    }
    pub fn pause_number(&self) -> f64 {
        self.pause
    }
    pub fn input_json(&self) -> Result<String, InputError> {
        javascript_json::stringify(&self.input).map_err(|_| invalid())
    }
    pub(crate) fn into_parts(self) -> (Value, f64) {
        (self.input, self.pause)
    }
}
pub enum TemplateSubmitStart {
    Ignored,
    Blocked {
        field: &'static str,
        message: String,
    },
    Prepared(TemplateSubmission),
}

pub struct TemplateEditorDraft {
    fields: Value,
    existing: Value,
    appearance: Value,
    busy: bool,
}
impl TemplateEditorDraft {
    /// Pure raw helper, like EntryEditorDraft. A source-bound runtime must select
    /// the genuine stored template and provider role before using any write path.
    pub fn new_raw(existing: &Value, appearance: &Value) -> Result<Self, InputError> {
        if !existing.is_null() && !existing.is_object() {
            return Err(invalid());
        }
        for key in ["colors", "symbols", "labels"] {
            for kind in SHIFT_TYPES {
                if !appearance[key][kind].is_string() {
                    return Err(invalid());
                }
            }
        }
        if !appearance["defaultTemplateColor"].is_string() {
            return Err(invalid());
        }
        let pause = value(existing, "breakMinutes", json!(30))
            .as_f64()
            .ok_or_else(invalid)?;
        let fields = json!({"name":value(existing,"name",json!("Neuer Dienst")),"type":value(existing,"type",json!("CUSTOM")),"allDay":value(existing,"allDay",json!(false)),"specialDuty":value(existing,"specialDuty",Value::Null),"startTime":value(existing,"startTime",json!("08:00")),"endTime":value(existing,"endTime",json!("16:00")),"breakMinutes":javascript_json::number_text(pause),"color":value(existing,"color",appearance["defaultTemplateColor"].clone()),"symbol":value(existing,"symbol",appearance["symbols"]["CUSTOM"].clone()),"notification":value(existing,"notification",Value::Null),"location":value(existing,"location",Value::Null),"appearanceExpanded":false,"typePickerExpanded":false,"notificationOpen":false,"nameError":null,"symbolError":null,"error":null,"saving":false});
        Ok(Self {
            fields,
            existing: existing.clone(),
            appearance: appearance.clone(),
            busy: false,
        })
    }
    pub fn fields(&self) -> &Value {
        &self.fields
    }
    pub fn entry_type(&self) -> &str {
        self.fields["type"]
            .as_str()
            .filter(|s| TYPES.contains(s))
            .unwrap_or("CUSTOM")
    }
    pub fn set_field(&mut self, field: &str, next: &Value) -> Result<(), InputError> {
        let valid = match field {
            "name" | "startTime" | "endTime" | "breakMinutes" | "color" | "symbol" => {
                next.is_string()
            }
            "allDay" | "appearanceExpanded" | "typePickerExpanded" | "notificationOpen" => {
                next.is_boolean()
            }
            "specialDuty" | "notification" | "location" => next.is_null() || next.is_object(),
            _ => false,
        };
        if !valid || serde_json::to_vec(next).map_err(|_| invalid())?.len() > 262_144 {
            return Err(invalid());
        }
        self.fields[field] = next.clone();
        match field {
            "name" => self.fields["nameError"] = Value::Null,
            "symbol" => self.fields["symbolError"] = Value::Null,
            "specialDuty" if next["kind"] == "ON_CALL" => self.fields["breakMinutes"] = json!("0"),
            _ => {}
        }
        Ok(())
    }
    pub fn choose_type(&mut self, candidate: &str) -> Result<(), InputError> {
        if !SHIFT_TYPES.contains(&candidate) {
            return Err(invalid());
        }
        if candidate == self.entry_type() {
            self.fields["typePickerExpanded"] = json!(false);
            return Ok(());
        }
        let current = self.fields["type"].as_str().ok_or_else(invalid)?;
        let color = self.existing.is_null()
            && (self.fields["color"] == self.appearance["colors"][current]
                || self.fields["color"] == self.appearance["defaultTemplateColor"]);
        let symbol =
            self.existing.is_null() && self.fields["symbol"] == self.appearance["symbols"][current];
        self.fields["type"] = json!(candidate);
        self.fields["typePickerExpanded"] = json!(false);
        if color {
            self.fields["color"] = self.appearance["colors"][candidate].clone();
        }
        if symbol {
            self.fields["symbol"] = self.appearance["symbols"][candidate].clone();
        }
        Ok(())
    }
    pub fn open_type_picker(&mut self, ios: bool, dark: bool) -> Option<Value> {
        if ios {
            let mut options = TYPES
                .iter()
                .map(|s| self.appearance["labels"][*s].clone())
                .collect::<Vec<_>>();
            options.push(json!("Abbrechen"));
            Some(
                json!({"kind":"TYPE_PICKER","options":{"cancelButtonIndex":5,"options":options,"title":"Eintragsart","userInterfaceStyle":if dark {"dark"} else {"light"}}}),
            )
        } else {
            self.fields["typePickerExpanded"] =
                json!(!self.fields["typePickerExpanded"].as_bool().unwrap_or(false));
            None
        }
    }
    pub fn prepare_submit(
        &mut self,
        templates: &[Value],
    ) -> Result<TemplateSubmitStart, InputError> {
        self.prepare_submit_borrowed(templates.iter())
    }
    /// The live native collection can be borrowed without copying its saved
    /// template trees. The immutable selected template remains on this draft.
    pub fn prepare_submit_borrowed<'a>(
        &mut self,
        templates: impl IntoIterator<Item = &'a Value>,
    ) -> Result<TemplateSubmitStart, InputError> {
        if self.busy {
            return Ok(TemplateSubmitStart::Ignored);
        }
        let name = self.fields["name"].as_str().ok_or_else(invalid)?;
        let symbol = self.fields["symbol"].as_str().ok_or_else(invalid)?;
        let name_error = form_number::trim(name)
            .is_empty()
            .then(|| "Titel darf nicht leer sein.".to_owned());
        let symbol_error = form_number::trim(symbol)
            .is_empty()
            .then(|| "Symbol darf nicht leer sein.".to_owned());
        self.fields["nameError"] = json!(name_error);
        self.fields["symbolError"] = json!(symbol_error);
        if symbol_error.is_some() {
            self.fields["appearanceExpanded"] = json!(true);
        }
        if let Some(message) = name_error.as_ref().or(symbol_error.as_ref()) {
            self.fields["error"] = json!(message);
            return Ok(TemplateSubmitStart::Blocked {
                field: if name_error.is_some() {
                    "name"
                } else {
                    "symbol"
                },
                message: message.clone(),
            });
        }
        let absent = absence(&self.fields["type"]);
        let pause = if absent {
            0.0
        } else {
            form_number::number(self.fields["breakMinutes"].as_str().ok_or_else(invalid)?)
        };
        let mut input = serde_json::Map::new();
        if !self.existing.is_null() {
            input.insert("id".into(), self.existing["id"].clone());
            input.insert("expectedRevision".into(), self.existing["revision"].clone());
        }
        input.insert("name".into(), self.fields["name"].clone());
        input.insert("type".into(), self.fields["type"].clone());
        input.insert(
            "allDay".into(),
            json!(absent || self.fields["allDay"] == true),
        );
        input.insert(
            "specialDuty".into(),
            if absent || self.fields["allDay"] == true || self.fields["type"] == "TRAINING" {
                Value::Null
            } else {
                planned(&self.fields["specialDuty"])?
            },
        );
        input.insert(
            "startTime".into(),
            if absent {
                Value::Null
            } else {
                self.fields["startTime"].clone()
            },
        );
        input.insert(
            "endTime".into(),
            if absent {
                Value::Null
            } else {
                self.fields["endTime"].clone()
            },
        );
        input.insert("breakMinutes".into(), json_number(pause));
        for key in ["color", "symbol", "notification", "location"] {
            input.insert(key.into(), self.fields[key].clone());
        }
        let order = if !self.existing["sortOrder"].is_null() {
            self.existing["sortOrder"].clone()
        } else {
            let mut maximum = 0.0f64;
            for template in templates {
                maximum = maximum.max(template["sortOrder"].as_f64().ok_or_else(invalid)?);
            }
            json_number(maximum + 10.0)
        };
        input.insert("sortOrder".into(), order);
        self.busy = true;
        self.fields["saving"] = json!(true);
        self.fields["error"] = Value::Null;
        Ok(TemplateSubmitStart::Prepared(TemplateSubmission {
            input: Value::Object(input),
            pause,
        }))
    }
    pub fn delete_confirmation(&self) -> Option<Value> {
        (!self.existing.is_null()).then(||json!({"kind":"CONFIRM_DELETE","title":"Vorlage löschen?","message":format!("„{}“ wird aus der Schnellauswahl entfernt. Eingetragene Dienste bleiben bestehen.",self.existing["name"].as_str().unwrap_or(""))}))
    }
}
