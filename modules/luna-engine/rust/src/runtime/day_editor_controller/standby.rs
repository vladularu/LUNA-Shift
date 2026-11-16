//! Component lifetime and controlled parent events remain in the native editor.
use super::*;
use crate::input::{form_number, standby_fields::StandbyFieldsState};
impl NativeDayController {
    fn standby_props(&self) -> Result<Option<Value>, DayEditorSourceError> {
        if self.source.mode() != EntryEditorMode::Shift {
            return Ok(None);
        }
        let presentation = self.source.display(&self.draft)?;
        let fields = self.draft.view()?["fields"].clone();
        if presentation["display"]["specialDutyVisible"] != true
            || !fields["specialDuty"].is_object()
        {
            return Ok(None);
        }
        let pause = form_number::number(
            fields["breakMinutes"]
                .as_str()
                .ok_or(DayEditorSourceError::InvalidSource)?,
        );
        Ok(Some(
            json!({"value":fields["specialDuty"],"tariffFamily":presentation["tariff"],"template":false,"initiallyOpen":self.appearance["billingFocus"]==true,"startTime":fields["startTime"],"endTime":fields["endTime"],"breakMinutes":pause}),
        ))
    }
    pub(super) fn sync_standby(&mut self) -> Result<(), DayEditorSourceError> {
        let Some(props) = self.standby_props()? else {
            self.standby = [None, None, None];
            return Ok(());
        };
        for index in 0..3 {
            let mounted = index == 2 || props["value"]["kind"] == "STANDBY";
            if !mounted {
                self.standby[index] = None;
            } else if self.standby[index].is_none() {
                // A partial raw clock can make the original break component fail to render.
                // Keep the input and expose an unavailable child; never invent a clock.
                self.standby[index] = StandbyFieldsState::new(index as u64, &props).ok();
            }
        }
        Ok(())
    }
    pub(super) fn standby_views(&self) -> Result<Value, DayEditorSourceError> {
        let Some(props) = self.standby_props()? else {
            return Ok(json!([null, null, null]));
        };
        let views: Vec<Value> = (0..3)
            .map(|index| {
                if index != 2 && props["value"]["kind"] != "STANDBY" {
                    return Value::Null;
                }
                match self.standby[index]
                    .as_ref()
                    .and_then(|state| state.view_ui(&props).ok())
                {
                    Some(value) => json!({"renderFailed":false,"value":value}),
                    None => json!({"renderFailed":true,"value":null}),
                }
            })
            .collect();
        Ok(json!(views))
    }
    pub fn standby_event(
        &mut self,
        component: usize,
        action: &Value,
    ) -> Result<(), DayEditorSourceError> {
        self.check()?;
        if component > 2
            || serde_json::to_vec(action)
                .map_err(|_| DayEditorSourceError::InvalidSource)?
                .len()
                > 256 * 1024
        {
            return Err(DayEditorSourceError::InvalidSource);
        }
        let props = self
            .standby_props()?
            .ok_or(DayEditorSourceError::InvalidSource)?;
        let state = self.standby[component]
            .as_mut()
            .ok_or(DayEditorSourceError::InvalidSource)?;
        let result = state.apply(&props, std::slice::from_ref(action))?;
        for event in result["events"]
            .as_array()
            .ok_or(DayEditorSourceError::InvalidSource)?
        {
            self.change_duty(event)?;
        }
        self.check()
    }
}
