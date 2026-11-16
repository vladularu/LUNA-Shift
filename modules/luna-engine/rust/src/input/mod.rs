//! Native domain facts. Checked raw source records are opaque and cannot be
//! deserialized as trusted calculation results or Ready flags.
pub mod annual_rows;
pub mod backup_preferences;
pub mod backup_profile_parents;
pub mod calculation_profile;
pub mod calendar;
pub mod calendar_rows;
pub mod day_write;
pub mod draft_rows;
pub mod duty_view;
pub mod employment;
pub mod entry_editor_delete;
pub mod entry_editor_display;
pub mod entry_editor_draft;
pub mod entry_editor_preset;
pub mod entry_editor_save;
pub mod finance_rows;
pub mod form_number;
mod instant;
pub mod javascript_date;
pub mod javascript_json;
mod local_date;
pub mod net_form;
pub mod net_form_command;
pub mod onboarding_editor;
pub mod payroll_form;
pub mod payroll_form_command;
pub mod personal_context;
pub mod profile;
pub mod profile_clock;
pub mod profile_composition;
pub mod profile_editor;
pub mod profile_form;
pub mod profile_form_command;
pub mod profile_write;
pub(crate) mod raw_json;
pub mod record_rows;
pub mod remuneration_rows;
pub mod salary_payment_command;
pub mod saved_critical;
pub mod simple_profile;
pub mod special_duty;
pub mod special_duty_clock;
pub mod special_duty_command;
pub mod special_duty_draft;
pub mod special_duty_feedback;
pub mod special_duty_inline;
pub mod standby_fields;
pub mod standby_transfer;
pub mod stored_profile;
pub mod stored_rows;
pub mod template_actions;
pub mod template_editor;
pub mod template_write;
pub mod training_rows;
pub mod working_time_target;

use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InputError {
    message: String,
    name: &'static str,
    user_facing: bool,
}
impl InputError {
    pub(crate) fn source(message: impl Into<String>, name: &'static str) -> Self {
        Self {
            message: message.into(),
            name,
            user_facing: false,
        }
    }
    pub(crate) fn validation(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            name: "ValidationError",
            user_facing: true,
        }
    }
    pub fn message(&self) -> &str {
        &self.message
    }
    pub fn name(&self) -> &str {
        self.name
    }
    pub(crate) fn user_facing_source(message: impl Into<String>, name: &'static str) -> Self {
        Self {
            message: message.into(),
            name,
            user_facing: true,
        }
    }
    pub(crate) fn user_facing_message(&self) -> Option<&str> {
        self.user_facing.then_some(&self.message)
    }
}
impl From<crate::pay::families::profile::FamilyProfileError> for InputError {
    fn from(error: crate::pay::families::profile::FamilyProfileError) -> Self {
        Self {
            message: error.to_string(),
            name: "UserFacingError",
            user_facing: true,
        }
    }
}
impl std::fmt::Display for InputError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}
impl std::error::Error for InputError {}

pub(crate) fn trim_javascript(value: &str) -> &str {
    value.trim_matches(crate::remuneration::own_config::javascript_space)
}
pub(crate) fn precise_instant_nanoseconds(value: &str) -> Option<i128> {
    instant::nanoseconds(value)
}
pub(crate) fn javascript_instant_milliseconds(value: &str) -> Option<i128> {
    instant::javascript_milliseconds(value)
}
pub fn require_instant<'a>(value: &'a Value, label: &str) -> Result<&'a str, InputError> {
    let fail = || InputError::validation(format!("{label} enthält keinen gültigen Zeitstempel."));
    let text = value.as_str().ok_or_else(fail)?;
    precise_instant_nanoseconds(text).ok_or_else(fail)?;
    Ok(text)
}
