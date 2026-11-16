//! Profile form policy consumes raw selections/profile facts, never host totals.
mod clock;
mod onboarding;
mod settings;
use super::InputError;
use crate::{
    employment::EmploymentError, pay::families::FamilyError, rules::RuleResolutionFailure,
};
pub use clock::FormClock;
pub use onboarding::{
    OnboardingSalaryDraft, OnboardingSelection, errors, full_time, groups, is_training, levels,
    region_mismatch, salary_draft,
};
pub(crate) use settings::tval_workplace_from_values;
pub use settings::{
    ProfileFormSource, SettingsFormState, evidence_value, manual_monthly_gross_error,
    parse_manual_monthly_gross, settings_values, settings_values_for_mode, tval_workplace_choice,
    tval_workplace_fields,
};
#[derive(Debug)]
pub enum ProfileFormError {
    Input(InputError),
    Family(FamilyError),
    Employment(EmploymentError),
}
impl ProfileFormError {
    /// Preserve original UserFacingError ancestry, independently of displayed
    /// error names/messages. Generic errors retain the caller's safe fallback.
    pub(crate) fn user_facing_message(&self) -> Option<String> {
        match self {
            Self::Input(error) => error.user_facing_message().map(str::to_owned),
            Self::Employment(error) => Some(error.to_string()),
            Self::Family(FamilyError::Profile(error)) => Some(error.to_string()),
            Self::Family(_) => None,
        }
    }
    pub fn name(&self) -> &str {
        match self {
            Self::Input(error) => error.name(),
            Self::Employment(_) => "RemunerationProfileError",
            Self::Family(error) if error.rule_failure().is_some() => "RuleResolutionError",
            Self::Family(_) => "Error",
        }
    }
    pub fn rule_failure(&self) -> Option<&RuleResolutionFailure> {
        match self {
            Self::Family(error) => error.rule_failure(),
            _ => None,
        }
    }
}
impl std::fmt::Display for ProfileFormError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Input(e) => e.fmt(f),
            Self::Family(e) => e.fmt(f),
            Self::Employment(e) => e.fmt(f),
        }
    }
}
impl std::error::Error for ProfileFormError {}
impl From<InputError> for ProfileFormError {
    fn from(e: InputError) -> Self {
        Self::Input(e)
    }
}
impl From<FamilyError> for ProfileFormError {
    fn from(e: FamilyError) -> Self {
        Self::Family(e)
    }
}
impl From<EmploymentError> for ProfileFormError {
    fn from(e: EmploymentError) -> Self {
        Self::Employment(e)
    }
}
pub(super) fn shape_error() -> InputError {
    InputError::source(
        "Die Profilformular-Eingaben sind unvollständig oder ungültig.",
        "Error",
    )
}
pub(super) fn truthy(value: Option<&serde_json::Value>) -> bool {
    match value {
        None | Some(serde_json::Value::Null) => false,
        Some(serde_json::Value::Bool(v)) => *v,
        Some(serde_json::Value::String(v)) => !v.is_empty(),
        Some(serde_json::Value::Number(v)) => v.as_f64().is_some_and(|n| n != 0.0),
        _ => true,
    }
}
#[cfg(test)]
mod error_brand_tests {
    use super::*;
    #[test]
    fn original_user_facing_ancestry_is_independent_of_mutable_error_names() {
        let data: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../reference/profile-editor-error-brands-golden.json"
        ))
        .unwrap();
        assert_eq!(data["cases"].as_array().unwrap().len(), 9);
        for c in data["cases"].as_array().unwrap() {
            let i = &c["input"];
            let message = i["message"].as_str().unwrap();
            let name = match i["name"].as_str().unwrap() {
                "Error" => "Error",
                "ValidationError" => "ValidationError",
                "UserFacingError" => "UserFacingError",
                _ => panic!("source name"),
            };
            let mut input = match i["kind"].as_str().unwrap() {
                "ERROR" => InputError::source(message, name),
                "VALIDATION" => InputError::validation(message),
                "USER_FACING" => InputError::user_facing_source(message, name),
                _ => panic!("source kind"),
            };
            input.name = name;
            let error = ProfileFormError::Input(input);
            let actual = serde_json::json!({"name":error.name(),"message":error.user_facing_message().unwrap_or_else(||"Fallback.".into())});
            assert_eq!(actual, c["expected"]);
        }
    }
}
