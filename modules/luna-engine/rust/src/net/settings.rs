//! Dated tax settings and per-payment revisions are resolved from source facts.
use super::annual_payment::{AnnualPaymentError, validate_annual_salary_payment_values};
use super::automation::pension_max_own_rate;
use super::{NetPayProfile, integer_in_range};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug)]
pub enum SettingsError {
    Profile,
    AutomationMissing,
    AutomationIncomplete,
    Annual(AnnualPaymentError),
    PaymentConflict,
}
impl std::fmt::Display for SettingsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
        Self::Profile => "Die monatlichen Steuer- oder Versicherungsangaben sind ungültig oder unvollständig.",
        Self::AutomationMissing => "Die Grundlagen der automatischen Netto-Prognose fehlen.",
        Self::AutomationIncomplete => "Die Grundlagen der automatischen Netto-Prognose sind unvollständig.",
        Self::PaymentConflict => "Widersprüchliche Versionen einer Sonderzahlung. Bitte die gespeicherten Angaben prüfen.",
        Self::Annual(error) => return error.fmt(f),
    })
    }
}
impl std::error::Error for SettingsError {}
impl From<AnnualPaymentError> for SettingsError {
    fn from(error: AnnualPaymentError) -> Self {
        Self::Annual(error)
    }
}

fn exact_keys(value: &Value, keys: &[&str]) -> bool {
    value.as_object().is_some_and(|object| {
        object.len() == keys.len() && keys.iter().all(|key| object.contains_key(*key))
    })
}

pub fn valid_settings_month(month: &str) -> bool {
    super::valid_month(month) && ("1900"..="4099").contains(&&month[..4])
}

fn pension_scheme(scheme: &str) -> bool {
    [
        "UNKNOWN",
        "NONE",
        "OTHER",
        "VBL_WEST",
        "VBL_EAST",
        "KZVK",
        "KZVK_DORTMUND",
        "EZVK_DARMSTADT",
        "EZVK_KARLSRUHE",
        "BVK_I",
        "BVK_II",
        "KVBW_I",
        "KVBW_II",
        "RZVK",
        "KVW_I",
        "KVW_II",
        "KVK_I",
        "ZVK_DARMSTADT_I",
        "ZVK_DARMSTADT_II",
        "KVBBG",
        "ZVK_SACHSEN",
        "ZVK_THUERINGEN",
    ]
    .contains(&scheme)
}

pub fn validate_net_pay_automation(value: &Value) -> Result<Value, SettingsError> {
    let object = value.as_object().ok_or(SettingsError::AutomationMissing)?;
    let mut keys = vec![
        "fullMonthAndPayConfirmed",
        "plannedWorkConfirmed",
        "additionalRecurringGrossCents",
        "additionalNetDeductionCents",
        "pensionScheme",
    ];
    if object.contains_key("pensionEmployeeRateBps") {
        keys.push("pensionEmployeeRateBps");
    }
    if object.contains_key("annualPayments") {
        keys.push("annualPayments");
    }
    let scheme = value["pensionScheme"].as_str().unwrap_or("");
    let own_valid = !object.contains_key("pensionEmployeeRateBps")
        || pension_max_own_rate(scheme).is_some_and(|maximum| {
            value["pensionEmployeeRateBps"].is_null()
                || integer_in_range(&value["pensionEmployeeRateBps"], 0, maximum).is_some()
        });
    if !exact_keys(value, &keys)
        || value["fullMonthAndPayConfirmed"] != true
        || value["plannedWorkConfirmed"] != true
        || !pension_scheme(scheme)
        || !own_valid
        || integer_in_range(&value["additionalRecurringGrossCents"], 0, 10_000_000).is_none()
        || integer_in_range(&value["additionalNetDeductionCents"], 0, 10_000_000).is_none()
    {
        return Err(SettingsError::AutomationIncomplete);
    }
    let mut result = value.clone();
    if object.contains_key("annualPayments") {
        result["annualPayments"] = validate_annual_salary_payment_values(&value["annualPayments"])?;
    }
    Ok(result)
}

pub fn validate_monthly_net_pay_settings(value: &Value) -> Result<Value, SettingsError> {
    let version = integer_in_range(&value["version"], 1, 2).ok_or(SettingsError::Profile)?;
    let mut keys = vec![
        "version",
        "month",
        "profile",
        "specialCases",
        "sfnBasicHourlyPayCents",
    ];
    if version == 2 {
        keys.push("automation");
    }
    if !exact_keys(value, &keys) {
        return Err(SettingsError::Profile);
    }
    let month = value["month"]
        .as_str()
        .filter(|month| valid_settings_month(month))
        .ok_or(SettingsError::Profile)?;
    let raw_profile = &value["profile"];
    let profile_keys = [
        "birthDate",
        "taxClass",
        "factorPermille",
        "churchTaxRatePercent",
        "childAllowanceHalfUnits",
        "isParent",
        "childrenUnder25",
        "worksInSaxony",
        "healthAdditionalRateBps",
        "monthlyTaxAllowanceCents",
    ];
    if !exact_keys(raw_profile, &profile_keys) {
        return Err(SettingsError::Profile);
    }
    let profile = NetPayProfile::parse(raw_profile).ok_or(SettingsError::Profile)?;
    if profile.birth_date.as_str() < "1900-01-01" || profile.birth_date > format!("{month}-01") {
        return Err(SettingsError::Profile);
    }
    let cases = value["specialCases"]
        .as_array()
        .ok_or(SettingsError::Profile)?;
    let allowed = [
        "PRIVATE_INSURANCE",
        "MINIJOB",
        "MIDIJOB",
        "MULTIPLE_EMPLOYMENTS",
        "ONE_OFF_PAYMENT",
        "ADDITIONAL_DEDUCTIONS",
        "PARTIAL_MONTH",
        "PENSIONER",
        "APPRENTICE",
        "OTHER_INSURANCE_STATUS",
    ];
    let mut seen = BTreeSet::new();
    if cases.iter().any(|value| {
        value
            .as_str()
            .is_none_or(|value| !allowed.contains(&value) || !seen.insert(value))
    }) {
        return Err(SettingsError::Profile);
    }
    if !value["sfnBasicHourlyPayCents"].is_null()
        && integer_in_range(&value["sfnBasicHourlyPayCents"], 1, 10_000_000).is_none()
    {
        return Err(SettingsError::Profile);
    }
    let mut result = json!({"version":version,"month":month,"profile":raw_profile,"specialCases":cases,"sfnBasicHourlyPayCents":value["sfnBasicHourlyPayCents"]});
    if version == 2 {
        result["automation"] = validate_net_pay_automation(&value["automation"])?;
    }
    Ok(result)
}

fn payment_content(payment: &Value) -> Value {
    let basis: BTreeMap<_, _> = payment["netBasis"]
        .as_object()
        .map(|object| {
            object
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect()
        })
        .unwrap_or_default();
    json!([payment["grossCents"], basis.into_iter().collect::<Vec<_>>()])
}

/// Rows reaching this operation have already passed the monthly settings gate.
pub fn collect_annual_salary_payments(timeline: &[Value]) -> Result<Value, SettingsError> {
    let mut payments: BTreeMap<String, Value> = BTreeMap::new();
    for row in timeline {
        let Some(values) = row["settings"]["automation"].get("annualPayments") else {
            continue;
        };
        if values.is_null() {
            continue;
        }
        for payment in values.as_array().ok_or(SettingsError::Profile)? {
            let month = payment["payoutMonth"]
                .as_str()
                .ok_or(SettingsError::Profile)?;
            let revision = integer_in_range(&payment["revision"], 1, 1_000_000_000)
                .ok_or(SettingsError::Profile)?;
            if let Some(previous) = payments.get(month) {
                let previous_revision = integer_in_range(&previous["revision"], 1, 1_000_000_000)
                    .ok_or(SettingsError::Profile)?;
                if previous_revision == revision
                    && payment_content(previous) != payment_content(payment)
                {
                    return Err(SettingsError::PaymentConflict);
                }
                if previous_revision >= revision {
                    continue;
                }
            }
            payments.insert(month.into(), payment.clone());
        }
    }
    Ok(Value::Array(payments.into_values().collect()))
}

pub fn resolve_net_pay_settings(month: &str, timeline: &[Value]) -> Result<Value, SettingsError> {
    if !valid_settings_month(month) {
        return Err(SettingsError::Profile);
    }
    let mut seen = BTreeSet::new();
    for row in timeline {
        let settings = validate_monthly_net_pay_settings(&row["settings"])?;
        let month = settings["month"]
            .as_str()
            .ok_or(SettingsError::Profile)?
            .to_owned();
        if !seen.insert(month) {
            return Err(SettingsError::Profile);
        }
    }
    let exact = timeline
        .iter()
        .find(|row| row["settings"]["month"] == month);
    let selected = exact.or_else(|| {
        timeline
            .iter()
            .filter(|row| {
                row["settings"]["version"] == 2
                    && row["settings"]["month"]
                        .as_str()
                        .is_some_and(|source| source <= month)
            })
            .max_by(|a, b| {
                a["settings"]["month"]
                    .as_str()
                    .cmp(&b["settings"]["month"].as_str())
            })
    });
    let payments = collect_annual_salary_payments(timeline)?;
    let Some(selected) = selected else {
        return Ok(Value::Null);
    };
    if !super::js_truthy(&selected["settings"]["automation"])
        || payments.as_array().is_none_or(Vec::is_empty)
    {
        return Ok(selected.clone());
    }
    let mut result = selected.clone();
    result["settings"]["automation"]["annualPayments"] = payments;
    Ok(result)
}
