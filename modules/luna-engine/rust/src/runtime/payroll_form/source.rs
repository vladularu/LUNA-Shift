//! Opaque small payroll editor sources extracted from genuine native facts.
use super::{
    setup::{self, CheckedSetupSource, SetupSourceOpen},
    store::{Lookup, SeedSource},
};
use crate::{
    input::{
        InputError,
        net_form::{self, InitialNetSettings, NetFormState, SetupInput},
    },
    net::settings::{SettingsError, valid_settings_month},
    report::cache_budget::serialized_bytes,
    runtime::{facts::SnapshotFacts, report::ReportIssue},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PayrollSourceMode {
    Annual,
    Setup,
    Timing,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PayrollSetupSubmit {
    pub form: Value,
    pub pension_scheme: Option<String>,
    pub additional_gross: String,
    pub additional_net: String,
    #[serde(default)]
    pub pension_employee_rate: String,
    pub effective_month: String,
}
#[derive(Debug)]
pub enum PayrollSourceOpen {
    Ready(PayrollSource),
    NeedsFinance,
    Unavailable(Value),
}
#[derive(Debug)]
enum SourceData {
    Annual {
        source: Arc<SeedSource>,
        view: Value,
    },
    Setup(CheckedSetupSource),
    Timing(Value),
}
/// No SnapshotFacts, raw plan or full work profile is retained after opening.
#[derive(Debug)]
pub struct PayrollSource {
    month: String,
    data: SourceData,
}
impl PayrollSource {
    pub fn open(
        facts: &SnapshotFacts,
        month: &str,
        mode: PayrollSourceMode,
    ) -> Result<PayrollSourceOpen, InputError> {
        if !valid_settings_month(month) {
            return Err(super::error());
        }
        let data = match mode {
            PayrollSourceMode::Annual => match super::lookup(facts, month) {
                Lookup::Missing => return Ok(PayrollSourceOpen::NeedsFinance),
                Lookup::Unavailable(code) => {
                    return Ok(PayrollSourceOpen::Unavailable(
                        json!({"state":"UNAVAILABLE","code":code}),
                    ));
                }
                Lookup::Seed(source) => {
                    let view = json!({"state":"READY","seed":source.seed.value(),"presentation":source.presentation});
                    SourceData::Annual { source, view }
                }
            },
            PayrollSourceMode::Setup => match setup::open_from_facts(facts, month)? {
                SetupSourceOpen::Ready(source) => SourceData::Setup(source),
                SetupSourceOpen::Unavailable(value) => {
                    return Ok(PayrollSourceOpen::Unavailable(value));
                }
            },
            PayrollSourceMode::Timing => {
                let read = || -> Result<Value, ReportIssue> {
                    if facts.test_months()?.months().contains(month) {
                        return Ok(json!({"state":"UNAVAILABLE","code":"TEST_MONTH"}));
                    }
                    let timing =
                        crate::runtime::financial_report::payroll::timing_source(facts, month)?;
                    Ok(json!({"state":"READY","month":month,"timing":timing}))
                };
                let view = match read() {
                    Ok(value) => value,
                    Err(reason) => {
                        return Ok(PayrollSourceOpen::Unavailable(
                            json!({"state":"UNAVAILABLE","code":reason.code,"reason":reason}),
                        ));
                    }
                };
                if view["state"] != "READY" {
                    return Ok(PayrollSourceOpen::Unavailable(view));
                }
                SourceData::Timing(view)
            }
        };
        Ok(PayrollSourceOpen::Ready(Self {
            month: month.into(),
            data,
        }))
    }
    pub fn month(&self) -> &str {
        &self.month
    }
    pub fn mode(&self) -> PayrollSourceMode {
        match &self.data {
            SourceData::Annual { .. } => PayrollSourceMode::Annual,
            SourceData::Setup(_) => PayrollSourceMode::Setup,
            SourceData::Timing(_) => PayrollSourceMode::Timing,
        }
    }
    pub fn view(&self) -> &Value {
        match &self.data {
            SourceData::Annual { view, .. } | SourceData::Timing(view) => view,
            SourceData::Setup(source) => &source.view,
        }
    }
    pub fn prepare_setup(
        &self,
        input: &PayrollSetupSubmit,
    ) -> Result<InitialNetSettings, InputError> {
        let SourceData::Setup(source) = &self.data else {
            return Err(super::error());
        };
        let mut form = input.form.clone();
        if !form.is_object() {
            return Err(InputError::user_facing_source(
                "Die Formularfelder sind unvollständig oder ungültig.",
                "Error",
            ));
        }
        // The actual component overrides this prop before calling its validator.
        form["worksInSaxony"] = Value::Bool(source.works_in_saxony);
        let form = NetFormState::try_from_raw(&form)?;
        let draft = net_form::prepare_setup(SetupInput {
            month: &self.month,
            form: &form,
            pension_scheme: input.pension_scheme.as_deref(),
            additional_gross: &input.additional_gross,
            additional_net: &input.additional_net,
            initial: source.initial.as_ref(),
            pension_employee_rate: &input.pension_employee_rate,
        })?;
        // Preserve original component validation before useNetPayProfile.save.
        if !valid_settings_month(&input.effective_month) {
            return Err(InputError::source(
                SettingsError::Profile.to_string(),
                "NetPayProfileValidationError",
            ));
        }
        if input.effective_month[..4] != self.month[..4] {
            return Err(InputError::user_facing_source(
                "Bitte einen Monat aus dem ausgewählten Jahr wählen.",
                "Error",
            ));
        }
        let mut settings = draft.into_settings();
        settings["month"] = Value::String(input.effective_month.clone());
        InitialNetSettings::try_from_raw(&settings)
    }
    pub fn prepare_annual(&self, input: &Value) -> Result<Option<InitialNetSettings>, InputError> {
        let SourceData::Annual { source, .. } = &self.data else {
            return Err(super::error());
        };
        super::prepare_annual_seed(source, input)
    }
    /// Conservative bounded retained-source weight, including shared seed data.
    pub fn retained_bytes(&self) -> Option<u64> {
        const LIMIT: u64 = 16 * 1024 * 1024;
        match &self.data {
            SourceData::Annual { source, view } => serialized_bytes(
                &(
                    &self.month,
                    view,
                    source.settings.settings(),
                    source.seed.value(),
                    &source.presentation,
                ),
                LIMIT,
            ),
            SourceData::Setup(source) => serialized_bytes(
                &(
                    &self.month,
                    &source.view,
                    source.initial.as_ref().map(InitialNetSettings::settings),
                ),
                LIMIT,
            ),
            SourceData::Timing(view) => serialized_bytes(&(&self.month, view), LIMIT),
        }
    }
}
