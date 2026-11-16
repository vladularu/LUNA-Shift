//! Existing payment-schedule policy on the bounded stateless presentation channel.
use crate::net::payment_schedule::validate_salary_payment_preferences;
use serde::Deserialize;
use serde_json::{Value, json};
#[derive(Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "SCREAMING_SNAKE_CASE",
    deny_unknown_fields
)]
enum Command {
    Validate {
        value: Value,
    },
    SetLag {
        value: Value,
        month: String,
        choice: String,
    },
}
pub fn execute(raw: &[u8]) -> Result<Value, &'static str> {
    let input: Command = serde_json::from_value(
        crate::contract::bounded_json(raw).map_err(|_| "INVALID_SALARY_TIMING_INPUT")?,
    )
    .map_err(|_| "INVALID_SALARY_TIMING_INPUT")?;
    let (value, timing) = match input {
        Command::Validate { value } => (value, None),
        Command::SetLag {
            value,
            month,
            choice,
        } => (value, Some((month, choice))),
    };
    let preferences = match validate_salary_payment_preferences(&value) {
        Ok(v) => v,
        Err(error) => {
            return Ok(
                json!({"state":"RECORD_ERROR","name":"SalaryPaymentValidationError","message":error.to_string(),"userFacing":false}),
            );
        }
    };
    let value = match timing {
        None => preferences,
        Some((month, choice)) => {
            match super::payroll_form::prepare_timing(&preferences, &month, &choice) {
                Ok(v) => v,
                Err(error) => {
                    return Ok(
                        json!({"state":"RECORD_ERROR","name":error.name(),"message":error.message(),"userFacing":true}),
                    );
                }
            }
        }
    };
    Ok(json!({"state":"VALUE","value":value}))
}
