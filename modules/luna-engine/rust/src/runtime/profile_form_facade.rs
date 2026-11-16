//! Operation-specific frame retains exact form errors and structured rule failures.
use crate::{
    input::{profile_form::*, profile_form_command::ProfileFormCommand},
    rules::RuleResolver,
};
use serde_json::{Value, json};
use std::sync::OnceLock;
static RULES: OnceLock<Result<RuleResolver, String>> = OnceLock::new();
pub(crate) fn resolver() -> Result<&'static RuleResolver, String> {
    RULES
        .get_or_init(|| RuleResolver::bundled().map_err(|error| format!("{error:?}")))
        .as_ref()
        .map_err(Clone::clone)
}
fn run(command: &ProfileFormCommand, rules: &RuleResolver) -> Result<Value, ProfileFormError> {
    Ok(match command {
        ProfileFormCommand::OnboardingOptions {
            selection,
            federal_state,
            instant,
        } => crate::input::onboarding_editor::options(
            selection,
            federal_state.as_deref(),
            instant,
            rules,
        )?,
        ProfileFormCommand::OnboardingSummary { selection, gross } => {
            OnboardingSelection::try_from_raw(selection)?;
            json!({"grossCents":parse_manual_monthly_gross(&crate::input::onboarding_editor::normalize_gross(gross)),"training":is_training(selection["mode"].as_str())})
        }
        ProfileFormCommand::OnboardingAdvance { input } => {
            crate::input::onboarding_editor::advance(input, rules)?
        }
        ProfileFormCommand::OnboardingPrepare { input } => {
            crate::input::onboarding_editor::prepare(input, rules)?
        }
        ProfileFormCommand::ParseWeekly { text } => {
            json!(crate::input::form_number::parse_weekly_hours(text)?)
        }
        ProfileFormCommand::WeeklyError { text } => {
            json!(crate::input::form_number::weekly_hours_error(text))
        }
        ProfileFormCommand::NormalizeGross { text } => {
            json!(crate::input::onboarding_editor::normalize_gross(text))
        }
        ProfileFormCommand::Groups { mode } => json!(groups(mode.as_deref())),
        ProfileFormCommand::Levels { mode, group } => {
            json!(levels(mode.as_deref(), group.as_deref()))
        }
        ProfileFormCommand::Training { mode } => json!(is_training(mode.as_deref())),
        ProfileFormCommand::FullTime { selection, instant } => json!(full_time(
            &OnboardingSelection::try_from_raw(selection)?,
            &FormClock::from_instant(instant)?,
            rules
        )?),
        ProfileFormCommand::Errors {
            selection,
            weekly_minutes,
            instant,
        } => errors(
            &OnboardingSelection::try_from_raw(selection)?,
            *weekly_minutes,
            &FormClock::from_instant(instant)?,
            rules,
        )?,
        ProfileFormCommand::Draft {
            selection,
            weekly_minutes,
            instant,
        } => json!(salary_draft(
            &OnboardingSelection::try_from_raw(selection)?,
            *weekly_minutes,
            &FormClock::from_instant(instant)?,
            rules
        )?),
        ProfileFormCommand::RegionMismatch {
            mode,
            federal_state,
        } => json!(region_mismatch(mode.as_deref(), federal_state.as_deref())),
        ProfileFormCommand::Settings {
            profile,
            reference_date,
            instant,
        } => json!(settings_values(
            &ProfileFormSource::try_from_raw(profile)?,
            reference_date.as_deref(),
            &FormClock::from_instant(instant)?,
            rules
        )?),
        ProfileFormCommand::SettingsMode {
            profile,
            mode,
            reference_date,
            instant,
        } => json!(settings_values_for_mode(
            &ProfileFormSource::try_from_raw(profile)?,
            mode,
            reference_date.as_deref(),
            &FormClock::from_instant(instant)?,
            rules
        )?),
        ProfileFormCommand::TvalChoice {
            profile,
            reference_date,
            instant,
        } => json!(tval_workplace_choice(
            &ProfileFormSource::try_from_raw(profile)?,
            reference_date.as_deref(),
            &FormClock::from_instant(instant)?
        )?),
        ProfileFormCommand::TvalFields {
            choice,
            previous,
            changed,
        } => tval_workplace_fields(choice, previous.as_ref().filter(|v| !v.is_null()), *changed),
        ProfileFormCommand::ManualGross { text } => json!(parse_manual_monthly_gross(text)),
        ProfileFormCommand::ManualError { text } => json!(manual_monthly_gross_error(text)),
        ProfileFormCommand::Evidence { value } => json!(evidence_value(value.as_ref())),
        ProfileFormCommand::Clock { instant, time_zone } => {
            json!(FormClock::from_instant(instant)?.date_in(time_zone)?)
        }
    })
}
pub fn profile_form(command: &ProfileFormCommand) -> Value {
    let rules = match resolver() {
        Ok(rules) => rules,
        Err(message) => return json!({"state":"SOURCE_UNAVAILABLE","message":message}),
    };
    match run(command, rules) {
        Ok(value) => json!({"state":"READY","value":value}),
        Err(error) => {
            let mut frame =
                json!({"state":"FORM_ERROR","name":error.name(),"message":error.to_string()});
            if let Some(failure) = error.rule_failure() {
                frame["failure"] = json!(failure);
            }
            frame
        }
    }
}
