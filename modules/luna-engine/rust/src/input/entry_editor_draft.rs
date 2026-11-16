//! Raw entry-editor state policies. No saved source can be admitted by this helper.
use super::{InputError, javascript_json};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EntryEditorMode {
    Shift,
    Appointment,
}
const SHIFT_SIGNATURE: [&str; 16] = [
    "shiftType",
    "specialDuty",
    "shiftAllDay",
    "selectedTemplateId",
    "shiftTitle",
    "startTime",
    "endTime",
    "breakMinutes",
    "shiftColor",
    "shiftSymbol",
    "shiftNote",
    "shiftNotification",
    "shiftAlarmEnabled",
    "shiftLocation",
    "overtimeMinutes",
    "tariffOvertimeConfirmed",
];
const APPOINTMENT_SIGNATURE: [&str; 8] = [
    "appointmentTitle",
    "allDay",
    "appointmentStart",
    "appointmentEnd",
    "appointmentNote",
    "appointmentRecurrence",
    "appointmentNotification",
    "appointmentLocation",
];
fn invalid() -> InputError {
    InputError::source("Der Eintragsentwurf konnte nicht gelesen werden.", "Error")
}
fn value(source: &Value, key: &str, default: Value) -> Value {
    source
        .get(key)
        .filter(|v| !v.is_null())
        .cloned()
        .unwrap_or(default)
}
fn numeric_text(value: Value) -> Result<Value, InputError> {
    Ok(json!(javascript_json::number_text(
        value.as_f64().ok_or_else(invalid)?
    )))
}
pub struct EntryEditorDraft {
    fields: Map<String, Value>,
    mode: EntryEditorMode,
    new_shift: bool,
    initial_signature: String,
}
impl EntryEditorDraft {
    /// Raw helper only. A later source-bound resource owns validated originals,
    /// owner/dataset leases and save permits; this constructor grants none.
    pub fn new_raw(
        shift: &Value,
        appointment: &Value,
        mode: EntryEditorMode,
        default_shift_color: &str,
    ) -> Result<Self, InputError> {
        if ![shift, appointment]
            .iter()
            .all(|v| v.is_object() || v.is_null())
        {
            return Err(invalid());
        }
        let fields = [
            ("specialDuty", value(shift, "specialDuty", Value::Null)),
            ("shiftType", value(shift, "type", json!("CUSTOM"))),
            ("shiftAllDay", value(shift, "allDay", json!(false))),
            (
                "selectedTemplateId",
                value(shift, "templateId", Value::Null),
            ),
            ("shiftTitle", value(shift, "title", json!("Dienst"))),
            ("startTime", value(shift, "startTime", json!("08:00"))),
            ("endTime", value(shift, "endTime", json!("16:00"))),
            (
                "breakMinutes",
                numeric_text(value(shift, "breakMinutes", json!(30)))?,
            ),
            (
                "shiftColor",
                value(shift, "color", json!(default_shift_color)),
            ),
            ("shiftSymbol", value(shift, "symbol", json!("D"))),
            ("shiftNote", value(shift, "note", json!(""))),
            (
                "shiftNotification",
                value(shift, "notification", Value::Null),
            ),
            (
                "shiftAlarmEnabled",
                value(shift, "alarmEnabled", json!(false)),
            ),
            ("shiftLocation", value(shift, "location", Value::Null)),
            (
                "overtimeMinutes",
                numeric_text(value(shift, "overtimeMinutes", json!(0)))?,
            ),
            (
                "tariffOvertimeConfirmed",
                value(shift, "tariffOvertimeConfirmed", json!(false)),
            ),
            (
                "appointmentTitle",
                value(appointment, "title", json!("Ohne Titel")),
            ),
            ("allDay", value(appointment, "allDay", json!(false))),
            (
                "appointmentStart",
                value(appointment, "startTime", json!("12:00")),
            ),
            (
                "appointmentEnd",
                value(appointment, "endTime", json!("13:00")),
            ),
            ("appointmentNote", value(appointment, "note", json!(""))),
            (
                "appointmentRecurrence",
                value(appointment, "recurrence", Value::Null),
            ),
            (
                "appointmentNotification",
                value(appointment, "notification", Value::Null),
            ),
            (
                "appointmentLocation",
                value(appointment, "location", Value::Null),
            ),
        ]
        .into_iter()
        .map(|(key, value)| (key.to_owned(), value))
        .collect();
        let mut draft = Self {
            fields,
            mode,
            new_shift: shift.is_null(),
            initial_signature: String::new(),
        };
        draft.initial_signature = draft.signature()?;
        Ok(draft)
    }
    fn signature(&self) -> Result<String, InputError> {
        let keys: &[&str] = match self.mode {
            EntryEditorMode::Shift => &SHIFT_SIGNATURE,
            EntryEditorMode::Appointment => &APPOINTMENT_SIGNATURE,
        };
        javascript_json::stringify(&Value::Array(
            keys.iter().map(|key| self.fields[*key].clone()).collect(),
        ))
        .map_err(|_| invalid())
    }
    pub fn initial_signature(&self) -> &str {
        &self.initial_signature
    }
    pub(crate) fn special_duty(&self) -> &Value {
        self.fields.get("specialDuty").unwrap_or(&Value::Null)
    }
    pub fn view(&self) -> Result<Value, InputError> {
        Ok(
            json!({"hasChanges":(self.mode==EntryEditorMode::Shift&&self.new_shift)||self.signature()?!=self.initial_signature,"fields":self.fields}),
        )
    }
    pub fn set_raw(&mut self, field: &str, value: Value) -> Result<(), InputError> {
        let target = self.fields.get_mut(field).ok_or_else(invalid)?;
        *target = value;
        Ok(())
    }
    pub fn choose_type(
        &mut self,
        kind: &str,
        templates: &[Value],
        appearance: &Value,
    ) -> Result<(), InputError> {
        let preset = super::entry_editor_preset::resolve(kind, templates, appearance)?;
        let break_text = numeric_text(preset["breakMinutes"].clone())?;
        let fields = [
            ("specialDuty", Value::Null),
            ("shiftType", json!(kind)),
            ("shiftAllDay", preset["allDay"].clone()),
            ("selectedTemplateId", preset["templateId"].clone()),
            ("shiftTitle", preset["title"].clone()),
            ("startTime", value(&preset, "startTime", json!("08:00"))),
            ("endTime", value(&preset, "endTime", json!("16:00"))),
            ("breakMinutes", break_text),
            ("shiftColor", preset["color"].clone()),
            ("shiftSymbol", preset["symbol"].clone()),
        ];
        for (key, value) in fields {
            self.set_raw(key, value)?;
        }
        Ok(())
    }
    pub fn change_duty(&mut self, next: &Value) -> Result<(), InputError> {
        let next_kind = if next.is_null() {
            None
        } else {
            Some(next["kind"].as_str().ok_or_else(invalid)?)
        };
        let title = match next_kind {
            None => "Dienst",
            Some("SPLIT") => "Geteilter Dienst",
            Some("ON_CALL") => "Rufbereitschaft",
            Some("STANDBY") => "Bereitschaftsdienst",
            Some(_) => return Err(invalid()),
        };
        let previous = self.fields["specialDuty"]
            .get("kind")
            .and_then(Value::as_str);
        if next_kind != previous {
            self.fields["shiftType"] = json!("CUSTOM");
            self.fields["shiftTitle"] = json!(title);
        }
        self.fields["specialDuty"] = next.clone();
        if next_kind == Some("ON_CALL") {
            self.fields["breakMinutes"] = json!("0");
        }
        if let Some(kind) = next_kind {
            if kind != "SPLIT" {
                self.fields["overtimeMinutes"] = json!("0");
                self.fields["tariffOvertimeConfirmed"] = json!(false);
            }
            self.fields["selectedTemplateId"] = Value::Null;
        }
        Ok(())
    }
}
