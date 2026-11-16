//! Original onboarding component policy over raw text/selection intents.
use super::{
    form_number,
    profile_form::{self, FormClock, OnboardingSelection, ProfileFormError},
};
use crate::rules::RuleResolver;
use serde::Deserialize;
use serde_json::{Value, json};
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OnboardingEditorInput {
    pub step: u8,
    pub salary_mode: Option<String>,
    pub gross: String,
    pub selection: Value,
    pub weekly_hours: String,
    pub federal_state: Option<String>,
    pub holiday_region: String,
    pub instant: String,
}
fn decimal(text: &str, places: Option<usize>) -> bool {
    let mut pieces = text.split([',', '.']);
    let whole = pieces.next().unwrap_or_default();
    if whole.is_empty() || !whole.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    if let Some(part) = pieces.next()
        && (part.is_empty()
            || !part.bytes().all(|b| b.is_ascii_digit())
            || places.is_some_and(|limit| part.len() > limit))
    {
        return false;
    }
    pieces.next().is_none()
}
pub fn normalize_gross(text: &str) -> String {
    let text = form_number::trim(text);
    let mut parts = text.split(',');
    let whole = parts.next().unwrap_or_default();
    let fraction = parts.next();
    let valid_fraction = fraction
        .is_none_or(|v| !v.is_empty() && v.len() <= 2 && v.bytes().all(|b| b.is_ascii_digit()));
    let groups: Vec<_> = whole.split('.').collect();
    if parts.next().is_none()
        && valid_fraction
        && groups.len() > 1
        && (1..=3).contains(&groups[0].len())
        && groups[0].bytes().all(|b| b.is_ascii_digit())
        && groups[1..]
            .iter()
            .all(|v| v.len() == 3 && v.bytes().all(|b| b.is_ascii_digit()))
    {
        text.replace('.', "")
    } else {
        text.to_owned()
    }
}
pub fn options(
    selection: &Value,
    state: Option<&str>,
    instant: &str,
    rules: &RuleResolver,
) -> Result<Value, ProfileFormError> {
    let selected = OnboardingSelection::try_from_raw(selection)?;
    let clock = FormClock::from_instant(instant)?;
    let mode = selection["mode"].as_str();
    let groups = profile_form::groups(mode);
    let levels: serde_json::Map<String, Value> = groups
        .iter()
        .map(|group| {
            (
                (*group).to_owned(),
                json!(profile_form::levels(mode, Some(group))),
            )
        })
        .collect();
    Ok(
        json!({"groups":groups,"levelsByGroup":levels,"training":profile_form::is_training(mode),"regionMismatch":profile_form::region_mismatch(mode,state),"fullTime":profile_form::full_time(&selected,&clock,rules)?}),
    )
}
pub fn advance(
    input: &OnboardingEditorInput,
    rules: &RuleResolver,
) -> Result<Value, ProfileFormError> {
    let mut errors = json!({});
    if input.step == 3 {
        if input.salary_mode.as_deref().is_none_or(str::is_empty) {
            errors["salary"] = json!("Bitte wähle eine Gehaltsgrundlage aus.");
        }
        if input.salary_mode.as_deref() == Some("MANUAL")
            && let Some(error) =
                profile_form::manual_monthly_gross_error(&normalize_gross(&input.gross))
        {
            errors["gross"] = json!(error);
        }
        if input.salary_mode.as_deref() == Some("TARIFF") {
            let selected = OnboardingSelection::try_from_raw(&input.selection)?;
            let minutes = form_number::parse_weekly_hours(&input.weekly_hours)?;
            let clock = FormClock::from_instant(&input.instant)?;
            let value = profile_form::errors(&selected, minutes, &clock, rules)?;
            errors
                .as_object_mut()
                .unwrap()
                .extend(value.as_object().unwrap().clone());
        }
    }
    if input.step == 4 {
        let text = form_number::trim(&input.weekly_hours);
        let field = if decimal(text, Some(2)) {
            form_number::weekly_hours_error(text)
        } else {
            Some("Bitte gültige Wochenstunden angeben.")
        };
        if let Some(error) = field {
            errors["hours"] = json!(error);
        }
        let hours = form_number::number(&text.replacen(',', ".", 1));
        if errors.get("hours").is_none() && (!(1.0..=80.0).contains(&hours)) {
            errors["hours"] = json!("Die Wochenarbeitszeit muss zwischen 1 und 80 Stunden liegen.");
        }
        if input.federal_state.as_deref().is_none_or(str::is_empty) {
            errors["state"] = json!("Bitte wähle das Bundesland deines Arbeitsorts.");
        }
        if input
            .federal_state
            .as_deref()
            .is_some_and(|v| !v.is_empty())
            && input.holiday_region == "UNKNOWN"
        {
            errors["region"] = json!("Bitte die Feiertagsregion am Arbeitsort auswählen.");
        }
    }
    Ok(errors)
}
pub fn prepare(
    input: &OnboardingEditorInput,
    rules: &RuleResolver,
) -> Result<Value, ProfileFormError> {
    let minutes = form_number::parse_weekly_hours(&input.weekly_hours)?;
    let mut profile = json!({"industry":"HEALTHCARE","federalState":input.federal_state,"holidayRegion":input.holiday_region,"weeklyMinutes":minutes,"timeZone":"Europe/Berlin"});
    let salary = if input.salary_mode.as_deref() == Some("TARIFF") {
        serde_json::to_value(profile_form::salary_draft(
            &OnboardingSelection::try_from_raw(&input.selection)?,
            minutes,
            &FormClock::from_instant(&input.instant)?,
            rules,
        )?)
        .expect("validated JSON salary draft")
    } else {
        json!({"tariff":null,"manualMonthlyGrossCents":if input.salary_mode.as_deref()==Some("MANUAL"){profile_form::parse_manual_monthly_gross(&normalize_gross(&input.gross))}else{None}})
    };
    profile
        .as_object_mut()
        .unwrap()
        .extend(salary.as_object().unwrap().clone());
    Ok(profile)
}
