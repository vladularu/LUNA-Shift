//! Effective cash-month preferences and raw-source dependency selection.
use super::integer_in_range;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PaymentGroup {
    Premiums,
    MonthlyAllowance,
    HourlyAllowance,
    Overtime,
    SpecialDuty,
}
pub const PAYMENT_GROUPS: [PaymentGroup; 5] = [
    PaymentGroup::Premiums,
    PaymentGroup::MonthlyAllowance,
    PaymentGroup::HourlyAllowance,
    PaymentGroup::Overtime,
    PaymentGroup::SpecialDuty,
];
impl PaymentGroup {
    pub fn label(self) -> &'static str {
        match self {
            Self::Premiums => "PREMIUMS",
            Self::MonthlyAllowance => "MONTHLY_ALLOWANCE",
            Self::HourlyAllowance => "HOURLY_ALLOWANCE",
            Self::Overtime => "OVERTIME",
            Self::SpecialDuty => "SPECIAL_DUTY",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentPeriod {
    pub effective_month: String,
    pub delays: BTreeMap<PaymentGroup, Option<u8>>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentPreferences {
    pub version: u8,
    pub periods: Vec<PaymentPeriod>,
    pub reviewed_empty_months: Vec<String>,
    pub social_insurance_attribution: String,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SalaryPerspective {
    Payout,
    Earned,
}

#[derive(Debug, Clone, Copy)]
pub struct ScheduleError;
impl std::fmt::Display for ScheduleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Die Angaben zu den Auszahlungsmonaten sind ungültig. Bitte erneut prüfen.")
    }
}
impl std::error::Error for ScheduleError {}

fn exact(value: &Value, keys: &[&str]) -> bool {
    value.as_object().is_some_and(|object| {
        object.len() == keys.len() && keys.iter().all(|key| object.contains_key(*key))
    })
}
pub fn require_salary_payment_month(month: &str) -> Result<&str, ScheduleError> {
    if super::valid_month(month) {
        Ok(month)
    } else {
        Err(ScheduleError)
    }
}
pub fn add_salary_payment_months(month: &str, delta: i32) -> Result<String, ScheduleError> {
    require_salary_payment_month(month)?;
    let year = month[..4].parse::<i64>().map_err(|_| ScheduleError)?;
    let number = month[5..].parse::<i64>().map_err(|_| ScheduleError)?;
    let index = year * 12 + number - 1 + i64::from(delta);
    let year = index.div_euclid(12);
    let number = index.rem_euclid(12) + 1;
    if !(-271_821..=275_760).contains(&year)
        || (year == -271_821 && number < 4)
        || (year == 275_760 && number > 9)
    {
        return Err(ScheduleError);
    }
    Ok(if year < 0 {
        format!("-{:06}-{number:02}", -year)
    } else if year > 9999 {
        format!("+{year:06}-{number:02}")
    } else {
        format!("{year:04}-{number:02}")
    })
}

pub fn validate_salary_payment_preferences(
    value: &Value,
) -> Result<PaymentPreferences, ScheduleError> {
    let object = value.as_object().ok_or(ScheduleError)?;
    let mut keys = vec!["version", "periods", "reviewedEmptyMonths"];
    if object.contains_key("socialInsuranceAttribution") {
        keys.push("socialInsuranceAttribution");
    }
    if !exact(value, &keys) || integer_in_range(&value["version"], 1, 1).is_none() {
        return Err(ScheduleError);
    }
    let attribution = match value.get("socialInsuranceAttribution") {
        None => "UNKNOWN",
        Some(value) => value
            .as_str()
            .filter(|value| ["UNKNOWN", "CASH_VARIABLE"].contains(value))
            .ok_or(ScheduleError)?,
    };
    let mut seen_periods = BTreeSet::new();
    let mut periods = value["periods"]
        .as_array()
        .filter(|values| values.len() <= 1200)
        .ok_or(ScheduleError)?
        .iter()
        .map(|period| {
            if !exact(period, &["effectiveMonth", "delays"])
                || !exact(
                    &period["delays"],
                    &[
                        "PREMIUMS",
                        "MONTHLY_ALLOWANCE",
                        "HOURLY_ALLOWANCE",
                        "OVERTIME",
                        "SPECIAL_DUTY",
                    ],
                )
            {
                return Err(ScheduleError);
            }
            let month = require_salary_payment_month(
                period["effectiveMonth"].as_str().ok_or(ScheduleError)?,
            )?;
            if !seen_periods.insert(month) {
                return Err(ScheduleError);
            }
            let delays = PAYMENT_GROUPS
                .into_iter()
                .map(|group| {
                    let value = &period["delays"][group.label()];
                    Ok((
                        group,
                        if value.is_null() {
                            None
                        } else {
                            Some(integer_in_range(value, 0, 2).ok_or(ScheduleError)? as u8)
                        },
                    ))
                })
                .collect::<Result<_, ScheduleError>>()?;
            Ok(PaymentPeriod {
                effective_month: month.into(),
                delays,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut seen_empty = BTreeSet::new();
    let mut reviewed_empty_months = value["reviewedEmptyMonths"]
        .as_array()
        .filter(|values| values.len() <= 2400)
        .ok_or(ScheduleError)?
        .iter()
        .map(|value| {
            let month = require_salary_payment_month(value.as_str().ok_or(ScheduleError)?)?;
            if !seen_empty.insert(month) {
                return Err(ScheduleError);
            }
            Ok(month.to_owned())
        })
        .collect::<Result<Vec<_>, _>>()?;
    periods.sort_by(|a, b| a.effective_month.cmp(&b.effective_month));
    reviewed_empty_months.sort();
    Ok(PaymentPreferences {
        version: 1,
        periods,
        reviewed_empty_months,
        social_insurance_attribution: attribution.into(),
    })
}

pub fn resolve_salary_payment_period<'a>(
    preferences: &'a PaymentPreferences,
    claim_month: &str,
) -> Result<Option<&'a PaymentPeriod>, ScheduleError> {
    require_salary_payment_month(claim_month)?;
    Ok(preferences
        .periods
        .iter()
        .filter(|period| period.effective_month.as_str() <= claim_month)
        .max_by(|a, b| a.effective_month.cmp(&b.effective_month)))
}
pub fn salary_component_payment_month(
    preferences: &PaymentPreferences,
    claim_month: &str,
    group: PaymentGroup,
) -> Result<Option<String>, ScheduleError> {
    let lag = match resolve_salary_payment_period(preferences, claim_month)? {
        None => Some(0),
        Some(period) => period.delays.get(&group).copied().ok_or(ScheduleError)?,
    };
    lag.map(|lag| add_salary_payment_months(claim_month, i32::from(lag)))
        .transpose()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentSources {
    pub months: Vec<String>,
    pub unresolved_months: Vec<String>,
}
pub fn salary_payment_sources(
    preferences: &PaymentPreferences,
    payment_month: &str,
    group: PaymentGroup,
) -> Result<PaymentSources, ScheduleError> {
    require_salary_payment_month(payment_month)?;
    let mut result = PaymentSources {
        months: vec![],
        unresolved_months: vec![],
    };
    for delta in [-2, -1, 0] {
        let month = add_salary_payment_months(payment_month, delta)?;
        match salary_component_payment_month(preferences, &month, group)? {
            None => result.unresolved_months.push(month),
            Some(target) if target == payment_month => result.months.push(month),
            Some(_) => {}
        }
    }
    Ok(result)
}
pub fn salary_payment_required_months(
    month: &str,
    preferences: &PaymentPreferences,
    perspective: SalaryPerspective,
) -> Result<Vec<String>, ScheduleError> {
    let mut result = vec![month.into()];
    let mut seen = BTreeSet::from([month.to_owned()]);
    if perspective == SalaryPerspective::Payout {
        for group in PAYMENT_GROUPS {
            for source in salary_payment_sources(preferences, month, group)?.months {
                if seen.insert(source.clone()) {
                    result.push(source);
                }
            }
        }
    }
    Ok(result)
}

pub fn set_salary_payment_period(
    preferences: &PaymentPreferences,
    period: &Value,
) -> Result<PaymentPreferences, ScheduleError> {
    let mut source = serde_json::to_value(preferences).map_err(|_| ScheduleError)?;
    let mut periods: Vec<_> = source["periods"]
        .as_array()
        .ok_or(ScheduleError)?
        .iter()
        .filter(|value| value["effectiveMonth"] != period["effectiveMonth"])
        .cloned()
        .collect();
    periods.push(period.clone());
    source["periods"] = Value::Array(periods);
    validate_salary_payment_preferences(&source)
}
pub fn set_salary_payment_empty_month(
    preferences: &PaymentPreferences,
    month: &str,
    reviewed: bool,
) -> Result<PaymentPreferences, ScheduleError> {
    require_salary_payment_month(month)?;
    let mut months: BTreeSet<String> = preferences.reviewed_empty_months.iter().cloned().collect();
    if reviewed {
        months.insert(month.into());
    } else {
        months.remove(month);
    }
    let mut source = serde_json::to_value(preferences).map_err(|_| ScheduleError)?;
    source["reviewedEmptyMonths"] = json!(months);
    validate_salary_payment_preferences(&source)
}
pub fn set_salary_payment_lag(
    preferences: &PaymentPreferences,
    payment_month: &str,
    lag: u8,
) -> Result<PaymentPreferences, ScheduleError> {
    if lag > 2 {
        return Err(ScheduleError);
    }
    let effective = add_salary_payment_months(payment_month, -2)?;
    let mut source = serde_json::to_value(preferences).map_err(|_| ScheduleError)?;
    let mut periods: Vec<_> = source["periods"]
        .as_array()
        .ok_or(ScheduleError)?
        .iter()
        .filter(|period| {
            period["effectiveMonth"]
                .as_str()
                .is_some_and(|month| month < effective.as_str())
        })
        .cloned()
        .collect();
    let delays: BTreeMap<_, _> = PAYMENT_GROUPS
        .into_iter()
        .map(|group| (group, lag))
        .collect();
    periods.push(json!({"effectiveMonth":effective,"delays":delays}));
    source["periods"] = Value::Array(periods);
    validate_salary_payment_preferences(&source)
}
