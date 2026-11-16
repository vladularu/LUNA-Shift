//! Raw block actions use the already ported original clock/inline kernels.
//! A structural fence prevents a delayed control from editing a different part after removal.
use super::*;
use crate::input::{
    InputError,
    special_duty_clock::{self, DutyClockOperation as Clock},
    special_duty_inline,
};
use serde::Deserialize;
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum DutyBlockTarget {
    Parent,
    Part { index: usize },
    Callout { index: usize },
}
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DutyBlockOperation {
    StartClock,
    EndClock,
    StartDay,
    EndDay,
    Pause,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DutyBlockEdit {
    pub target: DutyBlockTarget,
    pub operation: DutyBlockOperation,
    pub text: String,
    pub structure_revision: u64,
}
impl NativeDayController {
    pub(super) fn duty_structure(&self) -> Result<Value, DayEditorSourceError> {
        let view = self.draft.view()?;
        let duty = &view["fields"]["specialDuty"];
        Ok(json!([
            duty["kind"],
            duty["parts"].as_array().map(Vec::len),
            duty["callouts"].as_array().map(Vec::len)
        ]))
    }
    pub(super) fn finish_duty_structure(
        &mut self,
        before: &Value,
    ) -> Result<(), DayEditorSourceError> {
        if &self.duty_structure()? != before {
            self.duty_structure_revision = self
                .duty_structure_revision
                .checked_add(1)
                .filter(|v| *v <= 9_007_199_254_740_991)
                .ok_or(DayEditorSourceError::InvalidSource)?;
        }
        self.sync_standby()
    }
    fn check_duty_control(&self, revision: u64) -> Result<(), DayEditorSourceError> {
        self.check()?;
        if self.source.mode() != EntryEditorMode::Shift {
            return Err(DayEditorSourceError::InvalidSource);
        }
        if self.duty_structure_revision != revision {
            return Err(InputError::validation(
                "Die Dienstteile wurden inzwischen geändert. Bitte prüfe deine Auswahl.",
            )
            .into());
        }
        Ok(())
    }
    fn duty_state(&self) -> Result<Value, DayEditorSourceError> {
        let fields = self.draft.view()?["fields"].clone();
        let zone = self
            .source
            .profile()
            .and_then(|profile| profile["timeZone"].as_str())
            .unwrap_or("Europe/Berlin");
        Ok(
            json!({"value":fields["specialDuty"],"startTime":fields["startTime"],"endTime":fields["endTime"],"breakMinutes":fields["breakMinutes"],"timeZone":zone,"drafts":self.duty_drafts}),
        )
    }
    pub fn duty_inline_event(
        &mut self,
        operation: &str,
        index: usize,
        arg: &Value,
        structure_revision: u64,
    ) -> Result<bool, DayEditorSourceError> {
        self.check_duty_control(structure_revision)?;
        if index >= 64
            || serde_json::to_vec(arg)
                .map_err(|_| DayEditorSourceError::InvalidSource)?
                .len()
                > 256 * 1024
        {
            return Err(DayEditorSourceError::InvalidSource);
        }
        let before = self.duty_structure()?;
        let result = special_duty_inline::execute(
            &json!({"state":self.duty_state()?,"operation":operation,"index":index,"arg":arg}),
        )?;
        for event in result["events"]
            .as_array()
            .ok_or(DayEditorSourceError::InvalidSource)?
        {
            if event["field"] != "duty" {
                return Err(DayEditorSourceError::InvalidSource);
            }
            self.draft.change_duty(&event["value"])?;
        }
        self.finish_duty_structure(&before)?;
        self.check()?;
        result["ok"]
            .as_bool()
            .ok_or(DayEditorSourceError::InvalidSource)
    }
    pub fn duty_block_event(&mut self, event: DutyBlockEdit) -> Result<bool, DayEditorSourceError> {
        self.check_duty_control(event.structure_revision)?;
        if event.text.len() > 256 * 1024 {
            return Err(DayEditorSourceError::InvalidSource);
        }
        let state = self.duty_state()?;
        if state["value"].is_null() {
            return Err(DayEditorSourceError::InvalidSource);
        }
        if matches!(event.target, DutyBlockTarget::Parent) {
            match event.operation{
                DutyBlockOperation::StartClock|DutyBlockOperation::EndClock=>return self.duty_draft_event("PARENT_CLOCK",&json!({"field":if matches!(event.operation,DutyBlockOperation::StartClock){"start"}else{"end"},"time":event.text})),
                DutyBlockOperation::Pause=>{if state["value"]["kind"]=="ON_CALL"{return Err(DayEditorSourceError::InvalidSource);}self.set("breakMinutes",json!(event.text))?;return Ok(true);},
                DutyBlockOperation::StartDay=>return Err(DayEditorSourceError::InvalidSource),
                DutyBlockOperation::EndDay=>{}
            }
        }
        let part = match event.target {
            DutyBlockTarget::Parent => {
                let end_day = state["value"]
                    .get("endDay")
                    .filter(|v| !v.is_null())
                    .cloned()
                    .unwrap_or_else(|| json!(0));
                let result = special_duty_clock::execute(
                    Clock::Parent,
                    &json!({"startTime":state["startTime"],"endTime":state["endTime"],"endDay":end_day,"pause":state["breakMinutes"]}),
                )?;
                if result["ok"] != true {
                    return Ok(false);
                }
                result["value"].clone()
            }
            DutyBlockTarget::Part { index } => {
                if state["value"]["kind"] != "SPLIT" {
                    return Err(DayEditorSourceError::InvalidSource);
                }
                state["value"]["parts"]
                    .as_array()
                    .and_then(|v| v.get(index))
                    .cloned()
                    .ok_or(DayEditorSourceError::InvalidSource)?
            }
            DutyBlockTarget::Callout { index } => {
                if state["value"]["kind"] != "ON_CALL" {
                    return Err(DayEditorSourceError::InvalidSource);
                }
                state["value"]["callouts"]
                    .as_array()
                    .and_then(|v| v.get(index))
                    .cloned()
                    .ok_or(DayEditorSourceError::InvalidSource)?
            }
        };
        let (operation, input) = match event.operation {
            DutyBlockOperation::StartClock | DutyBlockOperation::EndClock => (
                Clock::ChangeClock,
                json!({"part":part,"field":if matches!(event.operation,DutyBlockOperation::StartClock){"start"}else{"end"},"time":event.text}),
            ),
            DutyBlockOperation::StartDay => {
                (Clock::StartDay, json!({"part":part,"text":event.text}))
            }
            DutyBlockOperation::EndDay => (Clock::EndDay, json!({"part":part,"text":event.text})),
            DutyBlockOperation::Pause => (Clock::Pause, json!({"part":part,"text":event.text})),
        };
        let result = special_duty_clock::execute(operation, &input)?;
        if result["ok"] != true {
            return Ok(false);
        }
        let (operation, index) = match event.target {
            DutyBlockTarget::Parent => ("PARENT_PART", 0),
            DutyBlockTarget::Part { index } => ("PART_REPLACE", index),
            DutyBlockTarget::Callout { index } => ("CALLOUT_PART", index),
        };
        self.duty_inline_event(operation, index, &result["value"], event.structure_revision)
    }
}
