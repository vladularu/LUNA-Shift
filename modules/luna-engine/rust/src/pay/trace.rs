//! Universal tariff-to-SFN trace dispatch. Financial policies live in their family kernels.
use super::families::{self, Family, FamilyError, FamilyShiftOptions};
use super::legacy::{self, PayError};
use crate::net::premium_trace::{premium_category, premium_kind};
use crate::rules::RuleResolver;
use serde::Serialize;
use serde_json::{Value, json};

#[derive(Debug, Clone)]
pub struct TariffPayrollOptions {
    pub allowance_status: String,
    pub saturday_shift_work: bool,
    pub regular_shift_work: bool,
}
impl Default for TariffPayrollOptions {
    fn default() -> Self {
        Self {
            allowance_status: "NONE".into(),
            saturday_shift_work: false,
            regular_shift_work: false,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PayrollTrace {
    pub breakdown: Value,
    pub trace: Value,
    pub night_compensatory_minutes: f64,
}

#[derive(Debug)]
pub enum TraceError {
    Family(FamilyError),
    Legacy(PayError),
    MissingTariff,
    MissingTrace,
    InvalidMoney,
}
impl From<FamilyError> for TraceError {
    fn from(error: FamilyError) -> Self {
        Self::Family(error)
    }
}
impl From<PayError> for TraceError {
    fn from(error: PayError) -> Self {
        Self::Legacy(error)
    }
}
impl std::fmt::Display for TraceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Family(error) => error.fmt(f),
            Self::Legacy(error) => error.fmt(f),
            Self::MissingTariff => {
                f.write_str("Für diese Gehaltsbasis fehlt eine vollständige Tarifberechnung.")
            }
            Self::MissingTrace => {
                f.write_str("Die Zuschläge konnten nicht vollständig berechnet werden.")
            }
            Self::InvalidMoney => f.write_str("Die Zuschlagszeitspur ist unvollständig."),
        }
    }
}
impl std::error::Error for TraceError {}

fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64().is_some_and(|value| value != 0.0),
        Value::String(value) => !value.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}
fn cents(value: &Value) -> Result<i64, TraceError> {
    let amount = value.as_f64().ok_or(TraceError::InvalidMoney)? * 100.0;
    let rounded = if amount.fract() == -0.5 {
        amount.ceil()
    } else {
        amount.round()
    };
    if !rounded.is_finite() || rounded.abs() > crate::money::MAX_SAFE_INTEGER as f64 {
        return Err(TraceError::InvalidMoney);
    }
    Ok(rounded as i64)
}

pub fn tariff_payroll_trace(
    shift: &Value,
    profile: &Value,
    options: &TariffPayrollOptions,
    resolver: &RuleResolver,
) -> Result<PayrollTrace, TraceError> {
    // This is the existing dispatch order, including its conflict precedence.
    let family = [
        ("tvalPflegeTariff", Family::Tval),
        ("tvhKrTariff", Family::Tvh),
        ("tvUkNursingTariff", Family::Tvuk),
        ("tvlKrTariff", Family::Tvl),
        ("vkaETariff", Family::VkaE),
        ("nursingTrainingTariff", Family::Training),
    ]
    .into_iter()
    .find_map(|(field, family)| truthy(&profile[field]).then_some(family));
    let mut legacy_trace = None;
    let mut breakdown = if let Some(family) = family {
        families::calculate_shift_breakdown(
            family,
            shift,
            profile,
            resolver,
            &FamilyShiftOptions {
                allowance_status: options.allowance_status.clone(),
                saturday_shift_work: options.saturday_shift_work,
                regular_shift_work: options.regular_shift_work,
                ..FamilyShiftOptions::default()
            },
            true,
        )?
    } else if truthy(&profile["tariff"]) {
        let dated = legacy::calculate_shift_premium_trace_for_profile(shift, profile, resolver)?;
        let premiums = dated["premiums"]
            .as_array()
            .ok_or(TraceError::MissingTrace)?;
        let payments = premiums.iter().map(|premium| {
            let kind = premium["premiumType"].as_str().ok_or(TraceError::MissingTrace)?;
            let id = premium["ruleId"].as_str().ok_or(TraceError::MissingTrace)?;
            let shift_id = shift["id"].as_str().ok_or(TraceError::MissingTrace)?;
            Ok(json!({"id":format!("{shift_id}:{id}"),"kind":premium_kind(kind),"category":premium_category(kind),"amountCents":cents(&premium["line"]["amount"])? ,"additionalToBasicPay":true,"periods":premium["periods"]}))
        }).collect::<Result<Vec<_>,TraceError>>()?;
        legacy_trace = Some(
            json!({"id":shift["id"],"start":dated["start"],"end":dated["end"],"unpaidBreaks":dated["unpaidBreaks"],"payments":payments}),
        );
        dated["breakdown"].clone()
    } else {
        return Err(TraceError::MissingTariff);
    };
    let night_compensatory_minutes = if family == Some(Family::Tvuk) {
        breakdown["nightCompensatoryMinutes"]
            .as_f64()
            .ok_or(TraceError::MissingTrace)?
    } else {
        0.0
    };
    let payroll_trace = breakdown
        .as_object_mut()
        .ok_or(TraceError::MissingTrace)?
        .remove("payrollTrace")
        .filter(|value| !value.is_null());
    let trace = payroll_trace
        .or(legacy_trace)
        .ok_or(TraceError::MissingTrace)?;
    Ok(PayrollTrace {
        breakdown,
        trace,
        night_compensatory_minutes,
    })
}
