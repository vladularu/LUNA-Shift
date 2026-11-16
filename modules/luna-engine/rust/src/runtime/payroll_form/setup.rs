//! Raw saved setup selection and editor metadata; no Finance calculation.
use crate::{
    employment::employment_overlay_at,
    input::{
        InputError,
        finance_rows::RawNetPayTimeline,
        net_form::{self, InitialNetSettings},
    },
    net::settings::valid_settings_month,
    runtime::{facts::SnapshotFacts, report::ReportIssue},
};
use serde_json::{Value, json};

#[derive(Debug)]
pub(super) struct CheckedSetupSource {
    pub(super) initial: Option<InitialNetSettings>,
    pub(super) works_in_saxony: bool,
    pub(super) view: Value,
}
pub(super) enum SetupSourceOpen {
    Ready(CheckedSetupSource),
    Unavailable(Value),
}
impl SetupSourceOpen {
    fn into_view(self) -> Value {
        match self {
            Self::Ready(source) => source.view,
            Self::Unavailable(value) => value,
        }
    }
}

pub fn prepare(
    month: &str,
    profile: Option<&Value>,
    timeline: &RawNetPayTimeline,
    blocked: bool,
) -> Result<Value, InputError> {
    open_values(month, profile, timeline, blocked).map(SetupSourceOpen::into_view)
}
fn open_values(
    month: &str,
    profile: Option<&Value>,
    timeline: &RawNetPayTimeline,
    blocked: bool,
) -> Result<SetupSourceOpen, InputError> {
    if !valid_settings_month(month) {
        return Err(InputError::user_facing_source(
            "Bitte einen gültigen Abrechnungsmonat wählen.",
            "Error",
        ));
    }
    let overlay = profile
        .map(|profile| employment_overlay_at(profile, &format!("{month}-01")))
        .transpose()
        .map_err(|e| InputError::source(e.to_string(), "RemunerationProfileError"))?
        .flatten();
    if blocked {
        return Ok(SetupSourceOpen::Unavailable(
            json!({"state":"UNAVAILABLE","code":"TEST_MONTH"}),
        ));
    }
    let Some(profile) = profile else {
        return Ok(SetupSourceOpen::Unavailable(
            json!({"state":"UNAVAILABLE","code":"PROFILE_REQUIRED"}),
        ));
    };
    let state = overlay
        .and_then(|value| value.get("federalState"))
        .or_else(|| profile.get("federalState"))
        .and_then(Value::as_str);
    let works_in_saxony = state == Some("SN");
    let church_tax_default_percent = if matches!(state, Some("BW" | "BY")) {
        8
    } else {
        9
    };
    let saved = timeline.resolve(month)?;
    let initial = if saved.is_null() {
        None
    } else {
        Some(InitialNetSettings::try_from_raw(&saved["settings"])?)
    };
    let editor = net_form::setup_editor(
        initial.as_ref(),
        works_in_saxony,
        church_tax_default_percent,
    )?;
    let view = json!({"state":"READY","month":month,
        "initial":initial.as_ref().map(InitialNetSettings::settings),
        "firstSetup":timeline.timeline().is_empty(),"worksInSaxony":works_in_saxony,
        "churchTaxDefaultPercent":church_tax_default_percent,"editor":editor});
    Ok(SetupSourceOpen::Ready(CheckedSetupSource {
        initial,
        works_in_saxony,
        view,
    }))
}

pub(super) fn from_facts(facts: &SnapshotFacts, month: &str) -> Result<Value, InputError> {
    open_from_facts(facts, month).map(SetupSourceOpen::into_view)
}
pub(super) fn open_from_facts(
    facts: &SnapshotFacts,
    month: &str,
) -> Result<SetupSourceOpen, InputError> {
    let read = || -> Result<SetupSourceOpen, ReportIssue> {
        let profile = facts.financial_profile()?;
        let blocked = facts.test_months()?.months().contains(month);
        // Test-data and successfully absent profile views never require Net IO.
        if blocked {
            return Ok(SetupSourceOpen::Unavailable(
                json!({"state":"UNAVAILABLE","code":"TEST_MONTH"}),
            ));
        }
        let Some(profile) = profile else {
            return Ok(SetupSourceOpen::Unavailable(
                json!({"state":"UNAVAILABLE","code":"PROFILE_REQUIRED"}),
            ));
        };
        open_values(month, Some(profile.as_ref()), facts.net_settings()?, false)
            .map_err(|_| ReportIssue::new("NET_SETUP_INVALID"))
    };
    Ok(match read() {
        Ok(value) => value,
        Err(reason) => SetupSourceOpen::Unavailable(
            json!({"state":"UNAVAILABLE","code":reason.code,"reason":reason}),
        ),
    })
}
