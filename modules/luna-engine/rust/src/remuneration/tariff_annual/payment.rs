use super::{
    TariffAnnualError, basis::tariff_annual_basis, claim::validate_tariff_annual_claim,
    eligibility::tariff_annual_eligibility, integer, model::*,
};
use crate::{
    remuneration::base::model::RemunerationStatus,
    rules::{RulePackage, validation::validate_tariff_package},
};
use num_bigint::BigInt;
use num_traits::ToPrimitive;
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeSet;
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TariffAnnualEstimate {
    pub claim_id: Option<String>,
    pub year: Option<i32>,
    pub payout_month: Option<String>,
    pub status: RemunerationStatus,
    pub amount_cents: Option<i64>,
    pub eligible: Option<bool>,
    pub rule_id: Option<String>,
    pub package_id: Option<String>,
    pub version_id: Option<String>,
    pub source_ids: Vec<String>,
    pub rate_basis_points: Option<i64>,
    pub twelfths: Option<Twelfths>,
    pub basis_cents: Option<i64>,
    pub basis_method: Option<BasisMethod>,
    pub basis_months: Vec<String>,
    pub missing: Vec<String>,
}
impl TariffAnnualEstimate {
    fn empty() -> Self {
        Self {
            claim_id: None,
            year: None,
            payout_month: None,
            status: RemunerationStatus::Unavailable,
            amount_cents: None,
            eligible: None,
            rule_id: None,
            package_id: None,
            version_id: None,
            source_ids: vec![],
            rate_basis_points: None,
            twelfths: None,
            basis_cents: None,
            basis_method: None,
            basis_months: vec![],
            missing: vec![],
        }
    }
}
fn unique(values: Vec<String>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    values
        .into_iter()
        .filter(|v| seen.insert(v.clone()))
        .collect()
}
/// Source BigInt HALF_UP; the displayed basis is never fed back into payment math.
pub(crate) fn round(numerator: BigInt, denominator: BigInt) -> Result<i64, TariffAnnualError> {
    if denominator <= BigInt::from(0) {
        return Err(TariffAnnualError::Rule);
    }
    let cents = (BigInt::from(2) * numerator + &denominator) / (BigInt::from(2) * denominator);
    if cents > BigInt::from(crate::money::MAX_SAFE_INTEGER) {
        return Err(TariffAnnualError::AmountOutsideSafeRange);
    }
    cents
        .to_i64()
        .ok_or(TariffAnnualError::AmountOutsideSafeRange)
}
pub fn calculate_tariff_annual_claim(
    package: &RulePackage,
    input: &Value,
) -> Result<TariffAnnualEstimate, TariffAnnualError> {
    let mut result = TariffAnnualEstimate::empty();
    let Ok(claim) = validate_tariff_annual_claim(input) else {
        result.missing.push("claim.invalid".into());
        return Ok(result);
    };
    calculate_checked_tariff_annual_claim(package, &claim)
}

/// Native saved-claim adapters reuse their immutable validated snapshot; no JSON round trip.
pub(crate) fn calculate_checked_tariff_annual_claim(
    package: &RulePackage,
    claim: &ValidatedClaim,
) -> Result<TariffAnnualEstimate, TariffAnnualError> {
    let mut result = TariffAnnualEstimate::empty();
    let c = claim.data();
    result.claim_id = Some(c.id.clone());
    result.year = Some(c.year);
    if !c.selection.confirmed {
        result.missing.push("selection.confirmed".into());
        return Ok(result);
    }
    let valid =
        validate_tariff_package(package).map_err(|_| TariffAnnualError::ValidationUnavailable)?;
    let rules = package.rules()["annualPaymentRules"].as_array();
    if !valid
        || ![11, 12, 13].contains(&package.engine_contract_version)
        || rules.is_none_or(Vec::is_empty)
        || package.package_id != c.selection.package_id
    {
        result.missing.push("rulePackage".into());
        return Ok(result);
    }
    let matches: Vec<&Value> = rules
        .into_iter()
        .flatten()
        .filter(|r| {
            r["variantId"] == c.selection.variant
                && r["regionIds"]
                    .as_array()
                    .is_some_and(|a| a.iter().any(|v| v == &c.selection.region))
                && r["payGroups"]
                    .as_array()
                    .is_some_and(|a| a.iter().any(|v| v == &c.selection.group))
                && r["firstEntitlementYear"]
                    .as_i64()
                    .is_some_and(|year| i64::from(c.year) >= year)
                && r["lastEntitlementYear"]
                    .as_i64()
                    .is_some_and(|year| i64::from(c.year) <= year)
        })
        .collect();
    if matches.len() != 1 {
        result.missing.push("ruleSelection".into());
        return Ok(result);
    }
    let rule = matches[0];
    let policy = AnnualCalculationRule::from_json(rule)?;
    let eligibility = tariff_annual_eligibility(claim, &policy)?;
    result.rule_id = rule["id"].as_str().map(str::to_owned);
    result.package_id = Some(package.package_id.clone());
    result.version_id = Some(package.version_id.clone());
    result.source_ids = rule["sourceIds"]
        .as_array()
        .ok_or(TariffAnnualError::Rule)?
        .iter()
        .map(|v| v.as_str().map(str::to_owned).ok_or(TariffAnnualError::Rule))
        .collect::<Result<Vec<_>, _>>()?;
    let rate = integer(&rule["rateBasisPoints"], 0, crate::money::MAX_SAFE_INTEGER)
        .map_err(|_| TariffAnnualError::Rule)?;
    result.rate_basis_points = Some(rate);
    result.payout_month = Some(format!(
        "{}-{:02}",
        c.year,
        integer(&rule["payoutMonth"], 1, 12).map_err(|_| TariffAnnualError::Rule)?
    ));
    result.eligible = eligibility.eligible;
    if !eligibility.missing.is_empty() || eligibility.eligible.is_none() {
        result.missing = unique(eligibility.missing);
        return Ok(result);
    }
    if eligibility.eligible == Some(false) {
        result.status = RemunerationStatus::Estimated;
        result.amount_cents = Some(0);
        return Ok(result);
    }
    let twelfths = eligibility
        .twelfths
        .clone()
        .ok_or(TariffAnnualError::Rule)?;
    if twelfths.numerator == 0 {
        result.status = RemunerationStatus::Estimated;
        result.amount_cents = Some(0);
        result.twelfths = Some(twelfths);
        return Ok(result);
    }
    let basis = tariff_annual_basis(claim, &policy, &eligibility)?;
    let Some(basis) = basis.basis else {
        result.twelfths = Some(twelfths);
        result.missing = unique(basis.missing);
        return Ok(result);
    };
    result.status = RemunerationStatus::Estimated;
    result.amount_cents = Some(round(
        &basis.numerator * BigInt::from(rate) * BigInt::from(twelfths.numerator),
        &basis.denominator
            * BigInt::from(10_000)
            * BigInt::from(12)
            * BigInt::from(twelfths.denominator),
    )?);
    result.basis_cents = Some(round(basis.numerator, basis.denominator)?);
    result.basis_method = Some(basis.method);
    result.basis_months = basis.months;
    result.twelfths = Some(twelfths);
    Ok(result)
}
