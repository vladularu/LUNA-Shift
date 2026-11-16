//! Closed raw-draft commands; these never establish persisted source readiness.
use super::{
    InputError, duty_view,
    special_duty_clock::{self, DutyClockOperation},
    special_duty_draft, special_duty_inline, standby_fields,
};
use serde::Deserialize;
use serde_json::Value;
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum DutyFormCommand {
    Clock {
        operation: DutyClockOperation,
        input: Value,
    },
    Draft {
        input: Value,
    },
    Inline {
        input: Value,
    },
    StandbyFields {
        input: Value,
    },
    StandbyFieldsUi {
        input: Value,
    },
    View {
        input: Value,
    },
    ViewUi {
        input: Value,
    },
    ValidateParent {
        value: Value,
        parent: Value,
    },
}
impl DutyFormCommand {
    pub fn execute(&self) -> Result<Value, InputError> {
        match self {
            Self::Clock { operation, input } => special_duty_clock::execute(*operation, input),
            Self::Draft { input } => special_duty_draft::execute(input),
            Self::Inline { input } => special_duty_inline::execute(input),
            Self::StandbyFields { input } => standby_fields::execute(input),
            Self::StandbyFieldsUi { input } => standby_fields::execute_ui(input),
            Self::View { input } => duty_view::prepare(input),
            Self::ViewUi { input } => duty_view::prepare_ui(input),
            Self::ValidateParent { value, parent } => {
                let duty = super::special_duty::validate_special_duty(Some(value))?;
                super::special_duty::validate_duty_parent(duty.as_ref(), parent)?;
                Ok(serde_json::json!({"ok":true}))
            }
        }
    }
}
