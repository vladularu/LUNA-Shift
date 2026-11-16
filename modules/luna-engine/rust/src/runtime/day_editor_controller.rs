//! Stateful day form composed from native source, draft, presentation and save policy.
//! This prepares an intent only. The shared form resource owns SQL permits and ACKs.
use super::day_editor_source::{DayEditorSourceError, NativeDayEditorSource};
use crate::input::{
    entry_editor_draft::{EntryEditorDraft, EntryEditorMode},
    entry_editor_save::{self, RawSavePreparation},
    special_duty_draft,
};
use serde_json::{Value, json};
use std::sync::Arc;
mod duty;
mod standby;
pub use duty::{DutyBlockEdit, DutyBlockOperation, DutyBlockTarget};

pub struct NativeDayController {
    source: Arc<NativeDayEditorSource>,
    draft: EntryEditorDraft,
    appearance: Value,
    duty_drafts: Value,
    duty_structure_revision: u64,
    standby: [Option<crate::input::standby_fields::StandbyFieldsState>; 3],
}
impl NativeDayController {
    pub fn new(
        source: Arc<NativeDayEditorSource>,
        appearance: Value,
    ) -> Result<Self, DayEditorSourceError> {
        if serde_json::to_vec(&appearance)
            .map_err(|_| DayEditorSourceError::InvalidSource)?
            .len()
            > 16 * 1024
        {
            return Err(DayEditorSourceError::InvalidSource);
        }
        let default_color = appearance["defaultShiftColor"]
            .as_str()
            .ok_or(DayEditorSourceError::InvalidSource)?;
        if !appearance["appointmentColor"].is_string() || !appearance["presets"].is_object() {
            return Err(DayEditorSourceError::InvalidSource);
        }
        let draft = source.new_draft(default_color)?;
        let mut controller = Self {
            source,
            draft,
            appearance,
            duty_drafts: json!({}),
            duty_structure_revision: 1,
            standby: [None, None, None],
        };
        controller.sync_standby()?;
        controller.check()?;
        Ok(controller)
    }
    fn check(&self) -> Result<(), DayEditorSourceError> {
        if self.source.is_current()? {
            Ok(())
        } else {
            Err(DayEditorSourceError::OwnerChanged)
        }
    }
    pub fn source(&self) -> &Arc<NativeDayEditorSource> {
        &self.source
    }
    pub(crate) fn special_duty(&self) -> &Value {
        self.draft.special_duty()
    }
    pub(crate) fn billing_focus(&self) -> bool {
        self.appearance["billingFocus"] == true
    }
    pub fn set(&mut self, field: &str, value: Value) -> Result<(), DayEditorSourceError> {
        self.check()?;
        if serde_json::to_vec(&value)
            .map_err(|_| DayEditorSourceError::InvalidSource)?
            .len()
            > 256 * 1024
        {
            return Err(DayEditorSourceError::InvalidSource);
        }
        let structure = self.duty_structure()?;
        self.draft.set_raw(field, value)?;
        self.finish_duty_structure(&structure)?;
        self.check()
    }
    pub fn choose_type(&mut self, kind: &str) -> Result<(), DayEditorSourceError> {
        self.check()?;
        if self.source.mode() != EntryEditorMode::Shift {
            return Err(DayEditorSourceError::InvalidSource);
        }
        let structure = self.duty_structure()?;
        self.draft.choose_type(
            kind,
            self.source
                .templates()
                .ok_or(DayEditorSourceError::InvalidSource)?,
            &self.appearance["presets"],
        )?;
        self.finish_duty_structure(&structure)?;
        self.check()
    }
    pub fn change_duty(&mut self, value: &Value) -> Result<(), DayEditorSourceError> {
        self.check()?;
        if self.source.mode() != EntryEditorMode::Shift {
            return Err(DayEditorSourceError::InvalidSource);
        }
        if serde_json::to_vec(value)
            .map_err(|_| DayEditorSourceError::InvalidSource)?
            .len()
            > 256 * 1024
        {
            return Err(DayEditorSourceError::InvalidSource);
        }
        let structure = self.duty_structure()?;
        self.draft.change_duty(value)?;
        self.finish_duty_structure(&structure)?;
        self.check()
    }
    pub fn duty_draft_event(
        &mut self,
        operation: &str,
        args: &Value,
    ) -> Result<bool, DayEditorSourceError> {
        self.check()?;
        if self.source.mode() != EntryEditorMode::Shift
            || serde_json::to_vec(args)
                .map_err(|_| DayEditorSourceError::InvalidSource)?
                .len()
                > 256 * 1024
        {
            return Err(DayEditorSourceError::InvalidSource);
        }
        let structure = self.duty_structure()?;
        let fields = self.draft.view()?["fields"].clone();
        let zone = self
            .source
            .profile()
            .and_then(|profile| profile["timeZone"].as_str())
            .unwrap_or("Europe/Berlin");
        let result = special_duty_draft::execute(
            &json!({"state":{"value":fields["specialDuty"],"startTime":fields["startTime"],"endTime":fields["endTime"],"breakMinutes":fields["breakMinutes"],"timeZone":zone,"drafts":self.duty_drafts},"operation":operation,"args":args}),
        )?;
        for event in result["events"]
            .as_array()
            .ok_or(DayEditorSourceError::InvalidSource)?
        {
            match event["field"].as_str() {
                Some("duty") => self.draft.change_duty(&event["value"])?,
                Some(field @ ("startTime" | "endTime" | "breakMinutes")) => {
                    self.draft.set_raw(field, event["value"].clone())?
                }
                _ => return Err(DayEditorSourceError::InvalidSource),
            }
        }
        self.duty_drafts = result["drafts"].clone();
        self.finish_duty_structure(&structure)?;
        self.check()?;
        result["ok"]
            .as_bool()
            .ok_or(DayEditorSourceError::InvalidSource)
    }
    pub fn view(&self) -> Result<Value, DayEditorSourceError> {
        self.check()?;
        let initial = self.source.initial();
        let shift = self.source.mode() == EntryEditorMode::Shift;
        let date = if shift {
            initial
                .and_then(|value| value["date"].as_str())
                .unwrap_or(&self.source.request().date)
        } else {
            &self.source.request().date
        };
        let time_zone = self
            .source
            .profile()
            .and_then(|profile| profile["timeZone"].as_str())
            .unwrap_or("Europe/Berlin");
        let appointment_color = initial
            .filter(|value| value["kind"] == "APPOINTMENT")
            .and_then(|value| value.get("color"))
            .unwrap_or(&self.appearance["appointmentColor"]);
        let draft = self.draft.view()?;
        let presentation = self.source.display(&self.draft)?;
        let special_duty_view = if shift && presentation["display"]["specialDutyVisible"] == true {
            let fields = &draft["fields"];
            Some(crate::input::duty_view::prepare_ui(
                &json!({"value":fields["specialDuty"],"startTime":fields["startTime"],"endTime":fields["endTime"],"breakMinutes":fields["breakMinutes"],"timeZone":time_zone,"date":date,"template":false,"tariffFamily":presentation["tariff"]}),
            )?)
        } else {
            None
        };
        let value = json!({"draft":draft,"presentation":presentation,"specialDutyView":special_duty_view,"standbyViews":self.standby_views()?,"dutyStructureRevision":self.duty_structure_revision,"context":{"mode":self.source.mode(),"date":date,"routeDate":self.source.request().date,"timeZone":time_zone,"appointmentColor":appointment_color,"canDelete":initial.is_some()}});
        self.check()?;
        Ok(value)
    }
    pub fn initial_signature(&self) -> Result<&str, DayEditorSourceError> {
        self.check()?;
        Ok(self.draft.initial_signature())
    }
    pub fn prepare_save(
        &self,
        busy: bool,
        close_after_save: bool,
    ) -> Result<RawSavePreparation, DayEditorSourceError> {
        self.check()?;
        let view = self.draft.view()?;
        let empty = Value::Null;
        let initial = self.source.initial().unwrap_or(&empty);
        let shift = self.source.mode() == EntryEditorMode::Shift;
        let time_zone = self
            .source
            .profile()
            .and_then(|profile| profile.get("timeZone"))
            .unwrap_or(&empty);
        let prepared = entry_editor_save::prepare_raw(&json!({
            "busy":busy,"closeAfterSave":close_after_save,
            "hasChanges":view["hasChanges"],"fields":view["fields"],
            "mode":if shift {"SHIFT"} else {"APPOINTMENT"},
            "date":self.source.request().date,"timeZone":time_zone,
            "initialShift":if shift {initial} else {&empty},
            "initialAppointment":if shift {&empty} else {initial},
            "appointmentColor":self.appearance["appointmentColor"]
        }))?;
        self.check()?;
        Ok(prepared)
    }
}
