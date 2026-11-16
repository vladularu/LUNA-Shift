//! Bounded editor drafts over private snapshot sources. No annual/net/PAP call.
pub mod plan;
pub mod presentation;
pub mod setup;
pub mod source;
mod store;
use super::facts::SnapshotFacts;
use crate::input::{
    InputError,
    net_form::InitialNetSettings,
    payroll_form::{self, AnnualEditorSeed, AnnualUserDraft},
    payroll_form_command::PayrollFormCommand,
};
use crate::net::payment_schedule::validate_salary_payment_preferences;
use serde_json::{Value, json};
pub(crate) use store::PayrollFormStore;
use store::{Lookup, SeedSource};

fn error() -> InputError {
    InputError::user_facing_source("Bitte die Gehaltsangaben erneut laden.", "Error")
}
/// Called only by the Finance Payroll producer, after its native annual result.
pub(crate) fn retain_native_seed(
    facts: &SnapshotFacts,
    month: &str,
    profile: &Value,
    settings: Option<&Value>,
    annual: &Value,
    unavailable: Option<&'static str>,
) {
    let store = facts.payroll_form_store();
    if !matches!(store.lookup(month), Lookup::Missing) {
        return;
    }
    if let Some(code) = unavailable {
        store.unavailable(month, code);
        return;
    }
    let Some(settings) = settings else {
        store.unavailable(month, "NET_NOT_CONFIGURED");
        return;
    };
    let result = InitialNetSettings::try_from_raw(settings).and_then(|settings| {
        let seed = AnnualEditorSeed::new(
            month,
            profile,
            &settings,
            &annual["payments"],
            annual["automatic"].as_bool().ok_or_else(error)?,
        )?;
        let presentation =
            presentation::present(month, profile, &settings, &seed, annual).map_err(|_| error())?;
        Ok(SeedSource {
            seed,
            settings,
            presentation,
        })
    });
    match result {
        Ok(source) => store.retain(month, source),
        Err(_) => store.unavailable(month, "PAYROLL_FORM_UNAVAILABLE"),
    }
}
fn lookup(facts: &SnapshotFacts, month: &str) -> Lookup {
    facts
        .existing_payroll_form_store()
        .map_or(Lookup::Missing, |store| store.lookup(month))
}
fn waiting(value: &Lookup) -> Option<Value> {
    match value {
        Lookup::Missing => Some(json!({"state":"NEEDS_FINANCE"})),
        Lookup::Unavailable(code) => Some(json!({"state":"UNAVAILABLE","code":code})),
        Lookup::Seed(_) => None,
    }
}
/// Internal write preparation over a retained native Finance source. Neither
/// the source seed nor validated settings are deserialized from a UI reply.
pub(crate) enum PreparedAnnualWrite {
    NeedsFinance,
    Unavailable(&'static str),
    NoChange,
    Settings(InitialNetSettings),
}
pub(crate) fn prepare_annual_write(
    facts: &SnapshotFacts,
    month: &str,
    raw_form: &Value,
) -> Result<PreparedAnnualWrite, InputError> {
    if !crate::net::settings::valid_settings_month(month) {
        return Err(error());
    }
    match lookup(facts, month) {
        Lookup::Missing => Ok(PreparedAnnualWrite::NeedsFinance),
        Lookup::Unavailable(code) => Ok(PreparedAnnualWrite::Unavailable(code)),
        Lookup::Seed(source) => match prepare_annual_seed(&source, raw_form)? {
            None => Ok(PreparedAnnualWrite::NoChange),
            Some(settings) => Ok(PreparedAnnualWrite::Settings(settings)),
        },
    }
}
fn prepare_annual_seed(
    source: &SeedSource,
    raw_form: &Value,
) -> Result<Option<InitialNetSettings>, InputError> {
    let draft = AnnualUserDraft::try_from_raw(raw_form)?;
    payroll_form::prepare_annual_save(&source.seed, &source.settings, &draft, false)?
        .map(|settings| InitialNetSettings::try_from_raw(settings.settings()))
        .transpose()
}
pub fn calculate(facts: &SnapshotFacts, command: &PayrollFormCommand) -> Result<Value, InputError> {
    let month = command.month();
    if !crate::net::settings::valid_settings_month(month) {
        return Err(error());
    }
    match command {
        PayrollFormCommand::SetupSource { .. } => setup::from_facts(facts, month),
        PayrollFormCommand::AnnualSave { form, .. } => {
            Ok(match prepare_annual_write(facts, month, form)? {
                PreparedAnnualWrite::NeedsFinance => json!({"state":"NEEDS_FINANCE"}),
                PreparedAnnualWrite::Unavailable(code) => {
                    json!({"state":"UNAVAILABLE","code":code})
                }
                PreparedAnnualWrite::NoChange => json!({"state":"NO_CHANGE"}),
                PreparedAnnualWrite::Settings(settings) => {
                    json!({"state":"DRAFT","settings":settings.settings()})
                }
            })
        }
        PayrollFormCommand::AnnualBootstrap { .. } | PayrollFormCommand::AnnualEditor { .. } => {
            let found = lookup(facts, month);
            if let Some(waiting) = waiting(&found) {
                return Ok(waiting);
            }
            let Lookup::Seed(source) = found else {
                return Err(error());
            };
            match command {
                PayrollFormCommand::AnnualBootstrap { .. } => {
                    Ok(json!({"state":"READY","seed":source.seed.value()}))
                }
                PayrollFormCommand::AnnualEditor { .. } => Ok(
                    json!({"state":"READY","seed":source.seed.value(),"presentation":source.presentation}),
                ),
                _ => Err(error()),
            }
        }
        PayrollFormCommand::AnnualReset { .. } => {
            let year = month[..4].parse().map_err(|_| error())?;
            let timeline = facts.net_settings().map_err(|_| error())?;
            let settings: Result<Vec<_>, _> = timeline
                .timeline()
                .iter()
                .map(|row| InitialNetSettings::try_from_raw(&row["settings"]))
                .collect();
            Ok(
                json!({"state":"DRAFT","year":year,"settings":payroll_form::reset_annual_settings(year,&settings?)?}),
            )
        }
        PayrollFormCommand::TimingPrepare { choice, .. } => {
            let source = facts.salary_preferences().map_err(|_| error())?;
            let preferences =
                validate_salary_payment_preferences(source.preferences()).map_err(|_| error())?;
            Ok(
                json!({"state":"DRAFT","preferences":payroll_form::prepare_timing(&preferences,month,choice)?}),
            )
        }
    }
}
