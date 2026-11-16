//! Small raw editor operations only. Financial reports use the admitted job lane.
use crate::input::{
    InputError,
    net_form::{self, InitialNetSettings, NetFormState, SetupInput, ValidatedNetDraft},
    net_form_command::NetFormCommand,
};
use serde::Serialize;
use serde_json::{Value, json};

fn output(value: impl Serialize) -> Result<Value, InputError> {
    serde_json::to_value(value).map_err(|_| {
        InputError::source(
            "Die Formularfelder sind unvollständig oder ungültig.",
            "Error",
        )
    })
}
fn initial(value: &Option<Value>) -> Result<Option<InitialNetSettings>, InputError> {
    value
        .as_ref()
        .filter(|v| !v.is_null())
        .map(InitialNetSettings::try_from_raw)
        .transpose()
}
pub fn net_form(command: &NetFormCommand) -> Result<Value, InputError> {
    match command {
        NetFormCommand::Values { initial: raw } => {
            output(net_form::form_values(initial(raw)?.as_ref())?)
        }
        NetFormCommand::SetupValues {
            initial: raw,
            federal_state,
        } => output(net_form::setup_values(
            initial(raw)?.as_ref(),
            federal_state.as_deref() == Some("SN"),
        )?),
        NetFormCommand::SetupEditor {
            initial: raw,
            federal_state,
            church_tax_default_percent,
        } => net_form::setup_editor(
            initial(raw)?.as_ref(),
            federal_state.as_deref() == Some("SN"),
            *church_tax_default_percent,
        ),
        NetFormCommand::PrepareMonthly { month, form } => {
            net_form::prepare_monthly(month, &NetFormState::try_from_raw(form)?)
                .map(ValidatedNetDraft::into_settings)
        }
        NetFormCommand::ValidateStep { month, step, form } => {
            net_form::validate_step(month, *step, &NetFormState::try_from_raw(form)?)
                .map(|_| json!({"validated":true}))
        }
        NetFormCommand::PrepareSetup {
            month,
            form,
            pension_scheme,
            additional_gross,
            additional_net,
            initial: raw,
            pension_employee_rate,
        } => {
            let initial = initial(raw)?;
            let form = NetFormState::try_from_raw(form)?;
            net_form::prepare_setup(SetupInput {
                month,
                form: &form,
                pension_scheme: pension_scheme.as_deref(),
                additional_gross,
                additional_net,
                initial: initial.as_ref(),
                pension_employee_rate,
            })
            .map(ValidatedNetDraft::into_settings)
        }
        NetFormCommand::ParseAmounts { form } => {
            let form = serde_json::from_value(form.clone()).map_err(|_| {
                InputError::source(
                    "Die Formularfelder sind unvollständig oder ungültig.",
                    "Error",
                )
            })?;
            output(net_form::parse_amounts(&form)?)
        }
    }
}
