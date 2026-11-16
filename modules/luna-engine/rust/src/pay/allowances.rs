use super::{
    conditions::{RuleConditions, conditions_match},
    tariff::{TariffError, TariffProfile},
};
use crate::rules::RulePackage;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AllowanceRule {
    pub allowance_type: String,
    pub valid_from: String,
    pub valid_to: Option<String>,
    pub amount_kind: String,
    pub amount_cents: f64,
    pub prorate_by_part_time: bool,
    pub conditions: RuleConditions,
}
pub struct AllowanceCalculationInput<'a> {
    pub date: &'a str,
    pub full_time_weekly_minutes: f64,
    pub tariff: Option<&'a TariffProfile>,
    pub weekly_minutes: f64,
    pub federal_state: &'a str,
    pub rule_package: &'a RulePackage,
    pub status: Option<&'a str>,
    pub work_minutes: f64,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyAllowanceAmounts {
    pub allowance_amount: f64,
    pub care_allowance_amount: f64,
    pub tvoed_allowance_amount: f64,
}
pub fn configured_allowance_amount(
    rule: &AllowanceRule,
    work_minutes: f64,
    tariff: Option<&TariffProfile>,
    weekly_minutes: f64,
    full_time_weekly_minutes: f64,
) -> f64 {
    if tariff.is_none() {
        return 0.0;
    }
    let amount = if rule.amount_kind == "FIXED_HOURLY" {
        (work_minutes / 60.0) * (rule.amount_cents / 100.0)
    } else {
        rule.amount_cents / 100.0
    };
    let factor = if rule.prorate_by_part_time {
        weekly_minutes / full_time_weekly_minutes
    } else {
        1.0
    };
    (((amount * factor + f64::EPSILON) * 100.0) + 0.5).floor() / 100.0
}
pub fn applicable_allowance_rules<'a>(
    kind: &str,
    input: &AllowanceCalculationInput<'_>,
    rules: &'a [AllowanceRule],
) -> Vec<&'a AllowanceRule> {
    rules
        .iter()
        .filter(|r| {
            r.allowance_type == kind
                && r.valid_from.as_str() <= input.date
                && r.valid_to.as_deref().is_none_or(|to| input.date <= to)
                && conditions_match(
                    &r.conditions,
                    input.tariff,
                    input.federal_state,
                    input.date,
                    None,
                    input.status,
                )
        })
        .collect()
}
fn matching_amount(
    kind: &str,
    input: &AllowanceCalculationInput<'_>,
    rules: &[AllowanceRule],
) -> Result<f64, TariffError> {
    if input.tariff.is_none() || kind.contains("shift") && input.status.is_none() {
        return Ok(0.0);
    }
    let candidates = applicable_allowance_rules(kind, input, rules);
    if candidates.len() != 1 {
        return Err(TariffError(format!(
            "Expected one {kind} allowance rule on {}, found {}.",
            input.date,
            candidates.len()
        )));
    }
    Ok(configured_allowance_amount(
        candidates[0],
        input.work_minutes,
        input.tariff,
        input.weekly_minutes,
        input.full_time_weekly_minutes,
    ))
}
pub fn calculate_monthly_allowance_amounts(
    input: &AllowanceCalculationInput<'_>,
) -> Result<MonthlyAllowanceAmounts, TariffError> {
    let rules: Vec<AllowanceRule> = Vec::deserialize(
        input
            .rule_package
            .rules()
            .get("allowanceRules")
            .ok_or_else(|| TariffError("Invalid allowance rules".to_owned()))?,
    )
    .map_err(|_| TariffError("Invalid allowance rules".to_owned()))?;
    let allowance = match input.status {
        None | Some("NONE") => 0.0,
        Some(status) => matching_amount(
            if status.starts_with("ALTERNATING") {
                "alternating-shift"
            } else {
                "shift"
            },
            input,
            &rules,
        )?,
    };
    Ok(MonthlyAllowanceAmounts {
        allowance_amount: allowance,
        care_allowance_amount: matching_amount("care", input, &rules)?,
        tvoed_allowance_amount: matching_amount("tvoed", input, &rules)?,
    })
}
