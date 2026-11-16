//! Closed raw profile/onboarding intent. UI drafts never assert native readiness.
use serde::Deserialize;
use serde_json::Value;
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum ProfileFormCommand {
    OnboardingOptions {
        selection: Value,
        #[serde(rename = "federalState")]
        federal_state: Option<String>,
        instant: String,
    },
    OnboardingSummary {
        selection: Value,
        gross: String,
    },
    OnboardingAdvance {
        input: super::onboarding_editor::OnboardingEditorInput,
    },
    OnboardingPrepare {
        input: super::onboarding_editor::OnboardingEditorInput,
    },
    ParseWeekly {
        text: String,
    },
    WeeklyError {
        text: String,
    },
    NormalizeGross {
        text: String,
    },
    Groups {
        mode: Option<String>,
    },
    Levels {
        mode: Option<String>,
        group: Option<String>,
    },
    Training {
        mode: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    FullTime {
        selection: Value,
        instant: String,
    },
    #[serde(rename_all = "camelCase")]
    Errors {
        selection: Value,
        weekly_minutes: f64,
        instant: String,
    },
    #[serde(rename_all = "camelCase")]
    Draft {
        selection: Value,
        weekly_minutes: f64,
        instant: String,
    },
    #[serde(rename_all = "camelCase")]
    RegionMismatch {
        mode: Option<String>,
        federal_state: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Settings {
        profile: Value,
        reference_date: Option<String>,
        instant: String,
    },
    #[serde(rename_all = "camelCase")]
    SettingsMode {
        profile: Value,
        mode: String,
        reference_date: Option<String>,
        instant: String,
    },
    #[serde(rename_all = "camelCase")]
    TvalChoice {
        profile: Value,
        reference_date: Option<String>,
        instant: String,
    },
    TvalFields {
        choice: String,
        previous: Option<Value>,
        changed: bool,
    },
    ManualGross {
        text: String,
    },
    ManualError {
        text: String,
    },
    Evidence {
        #[serde(default, deserialize_with = "present_value")]
        value: Option<Value>,
    },
    #[serde(rename_all = "camelCase")]
    Clock {
        instant: String,
        time_zone: String,
    },
}

fn present_value<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Value>, D::Error> {
    Value::deserialize(deserializer).map(Some)
}
