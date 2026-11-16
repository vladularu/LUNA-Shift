//! Raw save policy only: not a saved-source admission or database write permit.
use super::{InputError, entry_editor_draft::EntryEditorMode, form_number};
use crate::time::{self, ShiftTime};
use serde_json::{Map, Value, json};
pub enum EntrySaveFailure {
    UserFacing(String),
    Internal,
}
impl EntrySaveFailure {
    pub fn from_input_error(error: &InputError) -> Self {
        error
            .user_facing_message()
            .map_or(Self::Internal, |message| {
                Self::UserFacing(message.to_owned())
            })
    }
}
pub struct RawSavePreparation {
    terminal: Option<Value>,
    events: Vec<Value>,
    write: Option<Value>,
    check_on_success: bool,
    close_after: bool,
}
fn invalid() -> InputError {
    InputError::source(
        "Der Eintragsentwurf konnte nicht gespeichert werden.",
        "Error",
    )
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, InputError> {
    value[key].as_str().ok_or_else(invalid)
}
fn flag(value: &Value, key: &str) -> Result<bool, InputError> {
    value[key].as_bool().ok_or_else(invalid)
}
fn event(kind: &str, value: Value) -> Value {
    json!({"kind":kind,"value":value})
}
fn returned(saved: bool, events: Vec<Value>, closed: bool) -> RawSavePreparation {
    RawSavePreparation {
        terminal: Some(
            json!({"state":"RETURNED","saved":saved,"events":events,"write":null,"checkRequested":false,"closed":closed}),
        ),
        events: Vec::new(),
        write: None,
        check_on_success: false,
        close_after: false,
    }
}
fn required(value: &str, label: &str) -> Option<String> {
    form_number::trim(value)
        .is_empty()
        .then(|| format!("{label} darf nicht leer sein."))
}
fn integer_error(value: &str, label: &str) -> Option<String> {
    let parsed = form_number::number(value);
    if form_number::trim(value).is_empty() || !parsed.is_finite() || parsed.fract() != 0.0 {
        Some(format!("{label} muss eine ganze Zahl sein."))
    } else if !(0.0..=1440.0).contains(&parsed) {
        Some(format!("{label} muss zwischen 0 und 1440 liegen."))
    } else {
        None
    }
}
fn identity(payload: &mut Map<String, Value>, origin: &Value) {
    if origin.is_null() {
        return;
    }
    if let Some(id) = origin.get("id") {
        payload.insert("id".into(), id.clone());
    }
    if let Some(revision) = origin.get("revision") {
        payload.insert("expectedRevision".into(), revision.clone());
    }
}
fn original_or(origin: &Value, key: &str, default: &Value) -> Value {
    origin
        .get(key)
        .filter(|v| !v.is_null())
        .unwrap_or(default)
        .clone()
}
impl RawSavePreparation {
    /// An intent is not a DB permit. The source-bound editor must bind and
    /// validate its private original row and source stamp before a real write.
    pub fn write_intent(&self) -> Option<&Value> {
        self.write.as_ref()
    }
    /// The native save policy decides whether the post-save check is needed.
    pub fn requires_review(&self) -> bool {
        self.write.is_some() && self.check_on_success
    }
    /// Original pre-IO events only. A pending submission is not a stored entry.
    pub fn begin(&self) -> Option<Value> {
        self.write
            .as_ref()
            .map(|_| json!({"state":"SAVE_PENDING","events":self.events,"stored":false}))
    }
    pub fn finish(mut self, error: Option<&EntrySaveFailure>) -> Value {
        if let Some(terminal) = self.terminal {
            return terminal;
        }
        let saved = error.is_none();
        let mut closed = false;
        if let Some(error) = error {
            self.events.push(json!({"kind":"WARNING_FEEDBACK"}));
            let message = match error {
                EntrySaveFailure::UserFacing(message) => message.as_str(),
                EntrySaveFailure::Internal => "Eintrag konnte nicht gespeichert werden.",
            };
            self.events.push(event("ERROR", json!(message)));
        } else if self.close_after {
            self.events.push(json!({"kind":"CLOSE"}));
            closed = true;
        }
        self.events.push(event("SAVING", json!(false)));
        json!({"state":"RETURNED","saved":saved,"events":self.events,"write":self.write,"checkRequested":saved&&self.check_on_success,"closed":closed})
    }
}
pub fn prepare_raw(input: &Value) -> Result<RawSavePreparation, InputError> {
    if flag(input, "busy")? {
        return Ok(returned(false, Vec::new(), false));
    }
    let close_after = flag(input, "closeAfterSave")?;
    if !flag(input, "hasChanges")? {
        return Ok(returned(
            true,
            if close_after {
                vec![json!({"kind":"CLOSE"})]
            } else {
                Vec::new()
            },
            close_after,
        ));
    }
    let mode: EntryEditorMode =
        serde_json::from_value(input["mode"].clone()).map_err(|_| invalid())?;
    let fields = &input["fields"];
    let absence = ["VACATION", "SICK", "FREE"].contains(&text(fields, "shiftType")?);
    let timed = !absence && !flag(fields, "shiftAllDay")?;
    let shift = mode == EntryEditorMode::Shift;
    let title_error = if shift {
        required(text(fields, "shiftTitle")?, "Bezeichnung")
    } else {
        None
    };
    let break_error = if shift && timed {
        integer_error(text(fields, "breakMinutes")?, "Pause")
    } else {
        None
    };
    let mut overtime_error = if shift && timed {
        integer_error(text(fields, "overtimeMinutes")?, "Überstunden")
    } else {
        None
    };
    let appointment_error = if !shift {
        required(text(fields, "appointmentTitle")?, "Titel")
    } else {
        None
    };
    let profile_zone = input["timeZone"].as_str();
    if overtime_error.is_none() && shift && timed && profile_zone.is_some() && break_error.is_none()
    {
        let time = ShiftTime {
            date: text(input, "date")?.to_owned(),
            start_time: Some(text(fields, "startTime")?.to_owned()),
            end_time: Some(text(fields, "endTime")?.to_owned()),
            break_minutes: form_number::number(text(fields, "breakMinutes")?) as i64,
            all_day: false,
            special_duty: None,
        };
        let net = match time::shift_minutes(&time, profile_zone.ok_or_else(invalid)?) {
            Ok(value) => value,
            Err(_) => {
                return Ok(RawSavePreparation {
                    terminal: Some(
                        json!({"state":"PRECHECK_TIME_ERROR","events":[],"write":null,"checkRequested":false,"closed":false}),
                    ),
                    events: Vec::new(),
                    write: None,
                    check_on_success: false,
                    close_after: false,
                });
            }
        };
        if form_number::number(text(fields, "overtimeMinutes")?) > net {
            overtime_error =
                Some("Überstunden dürfen die Nettoarbeitszeit nicht überschreiten.".into());
        }
    }
    let mut events = vec![
        event("BREAK_ERROR", json!(break_error)),
        event("APPOINTMENT_TITLE_ERROR", json!(appointment_error)),
    ];
    if let Some((field, message)) = [
        ("shiftTitle", title_error.as_ref()),
        ("breakMinutes", break_error.as_ref()),
        ("overtimeMinutes", overtime_error.as_ref()),
        ("appointmentTitle", appointment_error.as_ref()),
    ]
    .into_iter()
    .find_map(|(field, error)| error.map(|message| (field, message)))
    {
        events.push(event("ERROR", json!(message)));
        events.push(json!({"kind":"FOCUS","field":field,"message":message}));
        return Ok(returned(false, events, false));
    }
    events.push(event("SAVING", json!(true)));
    events.push(event("ERROR", Value::Null));
    let origin = if shift {
        &input["initialShift"]
    } else {
        &input["initialAppointment"]
    };
    let mut payload = Map::new();
    identity(&mut payload, origin);
    payload.insert("date".into(), original_or(origin, "date", &input["date"]));
    if shift {
        let overtime = if timed {
            form_number::number(text(fields, "overtimeMinutes")?)
        } else {
            0.0
        };
        let break_value = if timed {
            form_number::number(text(fields, "breakMinutes")?)
        } else {
            0.0
        };
        // Both original checks use identical immutable inputs. Reuse the first
        // native result instead of calculating the same elapsed time twice.
        let values = [
            ("specialDuty", fields["specialDuty"].clone()),
            (
                "templateId",
                if timed {
                    fields["selectedTemplateId"].clone()
                } else {
                    Value::Null
                },
            ),
            ("title", fields["shiftTitle"].clone()),
            ("type", fields["shiftType"].clone()),
            ("allDay", json!(absence || flag(fields, "shiftAllDay")?)),
            (
                "startTime",
                if absence {
                    Value::Null
                } else {
                    fields["startTime"].clone()
                },
            ),
            (
                "endTime",
                if absence {
                    Value::Null
                } else {
                    fields["endTime"].clone()
                },
            ),
            ("breakMinutes", json!(break_value)),
            ("color", fields["shiftColor"].clone()),
            ("symbol", fields["shiftSymbol"].clone()),
            ("note", fields["shiftNote"].clone()),
            ("notification", fields["shiftNotification"].clone()),
            (
                "alarmEnabled",
                json!(timed && flag(fields, "shiftAlarmEnabled")?),
            ),
            ("location", fields["shiftLocation"].clone()),
            ("overtimeMinutes", json!(overtime)),
            (
                "tariffOvertimeConfirmed",
                json!(overtime > 0.0 && flag(fields, "tariffOvertimeConfirmed")?),
            ),
            (
                "holidayPremiumMode",
                original_or(origin, "holidayPremiumMode", &json!("WITH_TIME_OFF")),
            ),
        ];
        for (key, value) in values {
            payload.insert(key.into(), value);
        }
    } else {
        let all_day = flag(fields, "allDay")?;
        let values = [
            ("title", fields["appointmentTitle"].clone()),
            ("allDay", json!(all_day)),
            (
                "startTime",
                if all_day {
                    Value::Null
                } else {
                    fields["appointmentStart"].clone()
                },
            ),
            (
                "endTime",
                if all_day {
                    Value::Null
                } else {
                    fields["appointmentEnd"].clone()
                },
            ),
            (
                "color",
                original_or(origin, "color", &input["appointmentColor"]),
            ),
            ("note", fields["appointmentNote"].clone()),
            ("recurrence", fields["appointmentRecurrence"].clone()),
            ("notification", fields["appointmentNotification"].clone()),
            ("location", fields["appointmentLocation"].clone()),
        ];
        for (key, value) in values {
            payload.insert(key.into(), value);
        }
    }
    Ok(RawSavePreparation {
        terminal: None,
        events,
        write: Some(json!({"kind":mode,"payload":payload})),
        check_on_success: shift && timed && profile_zone.is_some(),
        close_after,
    })
}
