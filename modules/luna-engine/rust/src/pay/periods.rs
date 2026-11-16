//! Coalesce dated source periods by actual payroll inputs, not storage metadata.
use crate::employment::{
    EmploymentError, capture_employment_profile, employment_month_periods,
    resolve_remuneration_profile,
};
use crate::tax::Decimal;
use serde_json::{Value, json};

#[derive(Debug, Clone, Copy)]
pub enum PayrollPeriodsError {
    Employment(EmploymentError),
    InvalidLegacyProfile,
}
impl From<EmploymentError> for PayrollPeriodsError {
    fn from(error: EmploymentError) -> Self {
        Self::Employment(error)
    }
}
impl std::fmt::Display for PayrollPeriodsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Employment(error) => error.fmt(f),
            Self::InvalidLegacyProfile => {
                f.write_str("Das Vergütungsprofil ist ungültig oder wird noch nicht unterstützt.")
            }
        }
    }
}
impl std::error::Error for PayrollPeriodsError {}

fn integer(value: &Value, min: i64, max: i64) -> Result<i64, PayrollPeriodsError> {
    let number = value
        .as_number()
        .ok_or(PayrollPeriodsError::InvalidLegacyProfile)?;
    let number = Decimal::parse(&number.to_string())
        .map_err(|_| PayrollPeriodsError::InvalidLegacyProfile)?;
    let integer = number
        .trunc_i64()
        .map_err(|_| PayrollPeriodsError::InvalidLegacyProfile)?;
    if number != Decimal::from_i64(integer) || !(min..=max).contains(&integer) {
        return Err(PayrollPeriodsError::InvalidLegacyProfile);
    }
    Ok(integer)
}
fn identifier(value: &Value) -> Result<&str, PayrollPeriodsError> {
    value
        .as_str()
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 120
                && value.as_bytes()[0].is_ascii_alphanumeric()
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
        })
        .ok_or(PayrollPeriodsError::InvalidLegacyProfile)
}

/// Only the original version-one fallback is constructed here; richer dated
/// financial profiles are used losslessly from the selected source record.
fn remuneration_data_from_legacy(profile: &Value) -> Result<Value, PayrollPeriodsError> {
    let weekly = integer(&profile["weeklyMinutes"], 60, 4800)?;
    let tariff = profile
        .get("tariff")
        .ok_or(PayrollPeriodsError::InvalidLegacyProfile)?;
    let selection = if !tariff.is_null() {
        let level = match &tariff["payLevel"] {
            Value::String(value) => value.clone(),
            Value::Number(value) => {
                let decimal = Decimal::parse(&value.to_string())
                    .map_err(|_| PayrollPeriodsError::InvalidLegacyProfile)?;
                decimal.canonical()
            }
            _ => return Err(PayrollPeriodsError::InvalidLegacyProfile),
        };
        json!({"kind":"tariff","packageId":"tvoed-vka-bt-k","variant":identifier(&tariff["sector"])? ,"region":identifier(&tariff["tariffRegion"])? ,"group":identifier(&tariff["payGroup"])? ,"level":identifier(&json!(level))? ,"fullTimeWeeklyMinutes":integer(&tariff["fullTimeWeeklyMinutes"],60,4800)?})
    } else if !profile["manualMonthlyGrossCents"].is_null() {
        json!({"kind":"own-monthly","monthlyGrossCents":integer(&profile["manualMonthlyGrossCents"],1,10_000_000)?})
    } else {
        json!({"kind":"unconfigured"})
    };
    Ok(json!({"version":1,"weeklyMinutes":weekly,"selection":selection}))
}

fn normalize_numbers(value: &mut Value) {
    match value {
        Value::Number(number) if number.is_f64() => {
            if let Some(n) = number.as_f64().filter(|n| {
                n.is_finite()
                    && n.fract() == 0.0
                    && n.abs() <= crate::money::MAX_SAFE_INTEGER as f64
            }) {
                *value = json!(n as i64);
            }
        }
        Value::Object(object) => {
            for value in object.values_mut() {
                normalize_numbers(value);
            }
        }
        Value::Array(array) => {
            for value in array {
                normalize_numbers(value);
            }
        }
        _ => {}
    }
}

pub fn payroll_employment_periods(
    profile: &Value,
    month: &str,
    last_day: &str,
) -> Result<Value, PayrollPeriodsError> {
    let periods = employment_month_periods(profile, month, last_day)?;
    let periods = periods.as_array().ok_or(PayrollPeriodsError::Employment(
        EmploymentError::InvalidInput,
    ))?;
    if periods.len() < 2 {
        return Ok(Value::Array(periods.clone()));
    }
    let history = match profile.get("employmentTimeline") {
        None | Some(Value::Null) => &[][..],
        Some(Value::Array(values)) => values.as_slice(),
        _ => {
            return Err(PayrollPeriodsError::Employment(
                EmploymentError::InvalidInput,
            ));
        }
    };
    let mut result: Vec<Value> = vec![];
    let mut previous_key = None;
    for period in periods {
        let from = period["from"]
            .as_str()
            .ok_or(PayrollPeriodsError::Employment(
                EmploymentError::InvalidInput,
            ))?;
        let selected = resolve_remuneration_profile(history, from)?.profile;
        let remuneration = match selected
            .as_ref()
            .and_then(|profile| profile.get("data"))
            .filter(|data| !data.is_null())
        {
            Some(data) => data.clone(),
            None => remuneration_data_from_legacy(&period["profile"])?,
        };
        let mut key = json!({"employment":capture_employment_profile(&period["profile"])? ,"remuneration":remuneration});
        normalize_numbers(&mut key);
        if previous_key.as_ref() == Some(&key) && !result.is_empty() {
            if let Some(previous) = result.last_mut() {
                previous["until"] = period["until"].clone();
            }
        } else {
            result.push(period.clone());
        }
        previous_key = Some(key);
    }
    Ok(Value::Array(result))
}
