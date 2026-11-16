//! Existing P-table selection and hourly-rate calculation, preserving legacy rounding.
use crate::rules::{RulePackage, RuleResolver};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TariffProfile {
    pub pay_group: String,
    pub pay_level: u8,
    pub sector: String,
    pub tariff_region: String,
    pub full_time_weekly_minutes: f64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TariffError(pub String);
impl std::fmt::Display for TariffError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for TariffError {}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TableEntry {
    group_id: String,
    step_id: String,
    monthly_cents: f64,
    hourly_cents: Option<f64>,
}
#[derive(Debug, Clone, Deserialize)]
struct PayTable {
    id: String,
    entries: Vec<TableEntry>,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Selector {
    pay_table_id: String,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WeeklyRule {
    sectors: Vec<String>,
    tariff_regions: Vec<String>,
    full_time_weekly_minutes: f64,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HourlyCalculation {
    monthly_factor_thousandths: f64,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OvertimeRule {
    maximum_step_id: Option<String>,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PremiumRule {
    rate_basis: String,
    reference_step_id: Option<String>,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TariffRules {
    selector: Selector,
    pay_tables: Vec<PayTable>,
    weekly_working_time_rules: Option<Vec<WeeklyRule>>,
    hourly_calculation: Option<HourlyCalculation>,
    overtime_base_rule: Option<OvertimeRule>,
    premium_rules: Vec<PremiumRule>,
}

fn body(p: &RulePackage) -> Result<&TariffRules, TariffError> {
    p.legacy_pay_rules
        .get_or_init(|| {
            TariffRules::deserialize(p.rules())
                .map_err(|_| TariffError("Invalid tariff rule data".to_owned()))
        })
        .as_ref()
        .map_err(Clone::clone)
}
fn table<'a>(p: &RulePackage, body: &'a TariffRules) -> Result<&'a PayTable, TariffError> {
    body.pay_tables
        .iter()
        .find(|t| t.id == body.selector.pay_table_id)
        .ok_or_else(|| {
            TariffError(format!(
                "Tariff package {}/{} has no selected pay table.",
                p.package_id, p.version_id
            ))
        })
}
fn entry<'a>(
    p: &RulePackage,
    body: &'a TariffRules,
    group: &str,
    step: &str,
) -> Result<Option<&'a TableEntry>, TariffError> {
    Ok(table(p, body)?
        .entries
        .iter()
        .find(|e| e.group_id == group.to_lowercase() && e.step_id == step.to_lowercase()))
}
fn monthly(
    p: &RulePackage,
    body: &TariffRules,
    group: &str,
    step: &str,
) -> Result<Option<f64>, TariffError> {
    Ok(entry(p, body, group, step)?.map(|e| e.monthly_cents / 100.0))
}
fn weekly(
    p: &RulePackage,
    body: &TariffRules,
    profile: &TariffProfile,
) -> Result<f64, TariffError> {
    let Some(ref rules) = body.weekly_working_time_rules else {
        return Ok(profile.full_time_weekly_minutes);
    };
    let mut found = rules.iter().filter(|r| {
        r.sectors.contains(&profile.sector) && r.tariff_regions.contains(&profile.tariff_region)
    });
    match (found.next(), found.next()) {
        (Some(rule), None) => Ok(rule.full_time_weekly_minutes),
        _ => Err(TariffError(format!(
            "Tariff package {}/{} has no unique weekly working time for {}/{}.",
            p.package_id, p.version_id, profile.sector, profile.tariff_region
        ))),
    }
}
fn hourly(
    p: &RulePackage,
    body: &TariffRules,
    profile: &TariffProfile,
    step: &str,
) -> Result<Option<f64>, TariffError> {
    if p.engine_contract_version < 3 && profile.pay_group != "P5" && profile.pay_group != "P6" {
        return Ok(entry(p, body, &profile.pay_group, step)?
            .and_then(|e| e.hourly_cents)
            .map(|v| v / 100.0));
    }
    let Some(amount) = monthly(p, body, &profile.pay_group, step)? else {
        return Ok(None);
    };
    let factor = body
        .hourly_calculation
        .as_ref()
        .map_or(4348.0, |r| r.monthly_factor_thousandths)
        / 1000.0;
    let hours = weekly(p, body, profile)? / 60.0;
    // Rates are positive in validated catalogs. This expression deliberately
    // follows the frozen JS operation order instead of changing tariff rounding.
    Ok(Some(
        ((amount / (factor * hours)) * 100.0 + 0.5).floor() / 100.0,
    ))
}
pub fn get_tariff_rule_package<'a>(
    date: &str,
    resolver: &'a RuleResolver,
) -> Option<&'a RulePackage> {
    resolver.resolve_tariff(date, None).ok()
}
pub fn get_monthly_table_amount(
    profile: &TariffProfile,
    date: &str,
    resolver: &RuleResolver,
) -> Result<Option<f64>, TariffError> {
    get_tariff_rule_package(date, resolver)
        .map(|p| get_monthly_table_amount_from_package(p, profile))
        .transpose()
        .map(Option::flatten)
}
/// Borrow an explicitly resolved dated package; never clone or rebind the full catalog.
pub fn get_monthly_table_amount_from_package(
    package: &RulePackage,
    profile: &TariffProfile,
) -> Result<Option<f64>, TariffError> {
    monthly(
        package,
        body(package)?,
        &profile.pay_group,
        &format!("s{}", profile.pay_level),
    )
}
pub fn get_individual_hourly_rate_from_package(
    package: &RulePackage,
    profile: &TariffProfile,
) -> Result<Option<f64>, TariffError> {
    get_hourly_table_amount_for_step_from_package(
        package,
        profile,
        &format!("s{}", profile.pay_level),
    )
}
pub fn get_hourly_table_amount_for_step_from_package(
    package: &RulePackage,
    profile: &TariffProfile,
    step: &str,
) -> Result<Option<f64>, TariffError> {
    hourly(package, body(package)?, profile, step)
}
pub fn get_tariff_full_time_weekly_minutes_from_package(
    package: &RulePackage,
    profile: &TariffProfile,
) -> Result<f64, TariffError> {
    weekly(package, body(package)?, profile)
}
pub fn get_individual_hourly_rate(
    profile: &TariffProfile,
    date: &str,
    resolver: &RuleResolver,
) -> Result<Option<f64>, TariffError> {
    get_hourly_table_amount_for_step(profile, date, &format!("s{}", profile.pay_level), resolver)
}
pub fn get_hourly_table_amount_for_step(
    profile: &TariffProfile,
    date: &str,
    step: &str,
    resolver: &RuleResolver,
) -> Result<Option<f64>, TariffError> {
    get_tariff_rule_package(date, resolver)
        .map(|p| get_hourly_table_amount_for_step_from_package(p, profile, step))
        .transpose()
        .map(Option::flatten)
}
pub fn get_tariff_full_time_weekly_minutes(
    profile: &TariffProfile,
    date: &str,
    resolver: &RuleResolver,
) -> Result<Option<f64>, TariffError> {
    get_tariff_rule_package(date, resolver)
        .map(|p| get_tariff_full_time_weekly_minutes_from_package(p, profile))
        .transpose()
}
pub fn get_overtime_base_hourly_rate(
    p: &RulePackage,
    profile: &TariffProfile,
    individual: f64,
) -> Result<f64, TariffError> {
    let body = body(p)?;
    let Some(step) = body
        .overtime_base_rule
        .as_ref()
        .and_then(|r| r.maximum_step_id.as_deref())
    else {
        return Ok(individual);
    };
    let rate = hourly(p, body, profile, step)?.ok_or_else(|| {
        TariffError(format!(
            "Tariff package {}/{} has no capped hourly rate for {}/{}.",
            p.package_id, p.version_id, profile.pay_group, step
        ))
    })?;
    Ok(individual.min(rate))
}
pub fn get_premium_hourly_rate(
    profile: &TariffProfile,
    date: &str,
    resolver: &RuleResolver,
) -> Result<Option<f64>, TariffError> {
    let Some(p) = get_tariff_rule_package(date, resolver) else {
        return Ok(None);
    };
    get_premium_hourly_rate_from_package(p, profile)
}
fn premium_reference_step<'a>(
    p: &RulePackage,
    body: &'a TariffRules,
) -> Result<&'a str, TariffError> {
    let steps: BTreeSet<&str> = body
        .premium_rules
        .iter()
        .filter(|r| r.rate_basis == "TABLE_STEP")
        .filter_map(|r| r.reference_step_id.as_deref())
        .collect();
    if steps.len() != 1 {
        return Err(TariffError(format!(
            "Tariff package {}/{} has no unique premium reference step.",
            p.package_id, p.version_id
        )));
    }
    steps
        .first()
        .copied()
        .ok_or_else(|| TariffError("Invalid premium reference step".to_owned()))
}
pub fn get_premium_hourly_rate_from_package(
    p: &RulePackage,
    profile: &TariffProfile,
) -> Result<Option<f64>, TariffError> {
    let body = body(p)?;
    hourly(p, body, profile, premium_reference_step(p, body)?)
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TariffVersion {
    pub id: String,
    pub label: String,
    pub valid_from: String,
    pub valid_to: Option<String>,
    pub monthly: BTreeMap<String, BTreeMap<String, Option<f64>>>,
}

pub fn get_tariff_version(
    date: &str,
    resolver: &RuleResolver,
) -> Result<Option<TariffVersion>, TariffError> {
    let Some(p) = get_tariff_rule_package(date, resolver) else {
        return Ok(None);
    };
    let body = body(p)?;
    let mut months = BTreeMap::new();
    for group in 5..=16 {
        let name = format!("P{group}");
        let mut levels = BTreeMap::new();
        for step in if group <= 6 { 1..=6 } else { 2..=6 } {
            levels.insert(
                step.to_string(),
                monthly(p, body, &name, &format!("s{step}"))?,
            );
        }
        months.insert(name, levels);
    }
    let label = p
        .label()
        .ok_or_else(|| TariffError("Invalid tariff label".to_owned()))?
        .to_owned();
    Ok(Some(TariffVersion {
        id: p.version_id.clone(),
        label,
        valid_from: p.valid_from.clone(),
        valid_to: p.valid_to.clone(),
        monthly: months,
    }))
}
