use super::*;
use crate::{
    remuneration::tariff_annual::{
        TariffAnnualError,
        basis::tariff_annual_basis,
        claim::validate_tariff_annual_claim,
        eligibility::tariff_annual_eligibility,
        model::{AnnualCalculationRule, ClaimVersion, ValidatedClaim},
        payment::round,
    },
    rules::{RuleKind, RuleResolver},
};
use num_bigint::BigInt;
use std::collections::BTreeSet;
fn empty(year: Option<i32>) -> Value {
    json!({"draftOnly":true,"status":"unavailable","amountCents":null,"eligible":null,"packageId":null,"versionId":null,"year":year,"payoutMonth":null,"sourceIds":[],"rateBasisPoints":null,"twelfths":null,"basisCents":null,"basisMethod":null,"basisMonths":[],"missing":[]})
}
fn missing(mut value: Value, keys: Vec<String>) -> Value {
    let mut seen = BTreeSet::new();
    value["missing"] = json!(
        keys.into_iter()
            .filter(|k| seen.insert(k.clone()))
            .collect::<Vec<_>>()
    );
    value
}
pub fn draft_claim(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, TariffAnnualError> {
    let Ok(claim) = validate_tariff_annual_claim(input) else {
        return Ok(missing(empty(None), vec!["claim.invalid".into()]));
    };
    draft_checked(pkg, &claim, validator)
}
pub(super) fn draft_checked(
    pkg: &RulePackage,
    claim: &ValidatedClaim,
    validator: &impl NativePackageValidator,
) -> Result<Value, TariffAnnualError> {
    let c = claim.data();
    let result = empty(Some(c.year));
    if !validator
        .validate(pkg)
        .map_err(|_| TariffAnnualError::ValidationUnavailable)?
        || pkg.kind != RuleKind::Tariff
        || pkg.engine_contract_version != 14
        || pkg.status() != Some("DRAFT")
        || pkg.package_id != c.selection.package_id
        || c.version != ClaimVersion::V3
    {
        return Ok(missing(result, vec!["rulePackage".into()]));
    }
    let Some(policy) = pkg
        .rules()
        .get("caritasAnnualPaymentPolicy")
        .filter(|p| !p.is_null() && **p != false)
    else {
        return Ok(missing(result, vec!["rulePeriod".into()]));
    };
    let month = integer(&policy["payoutMonth"], 1, 12).ok_or(TariffAnnualError::Rule)?;
    let payout_date = format!("{}-{month:02}-01", c.year);
    if policy["validFrom"]
        .as_str()
        .is_some_and(|s| s > payout_date.as_str())
        || policy["validTo"]
            .as_str()
            .is_some_and(|s| s < payout_date.as_str())
        || pkg.valid_from > payout_date
        || pkg.valid_to.as_ref().is_some_and(|to| *to < payout_date)
    {
        return Ok(missing(result, vec!["rulePeriod".into()]));
    }
    let selected = resolve_tariff_selection(pkg, &c.selection.variant, &c.selection.region);
    let bands: Vec<_> = rows(policy, "rateBands")
        .iter()
        .filter(|b| rows(b, "groupIds").iter().any(|g| *g == c.selection.group))
        .collect();
    if !c.selection.confirmed
        || selected.is_none_or(|s| !s.groups.iter().any(|g| g.id == c.selection.group))
        || bands.len() != 1
    {
        return Ok(missing(result, vec!["selection".into()]));
    }
    let rate = integer(&bands[0]["rateBasisPoints"], 0, MAX_SAFE_INTEGER)
        .ok_or(TariffAnnualError::Rule)?;
    let mut sourced = result;
    sourced["packageId"] = json!(pkg.package_id);
    sourced["versionId"] = json!(pkg.version_id);
    sourced["sourceIds"] = policy["sourceIds"].clone();
    sourced["rateBasisPoints"] = json!(rate);
    sourced["payoutMonth"] = if policy["earlyExitVariantId"] == c.selection.variant
        && c.employment
            .end
            .as_deref()
            .is_some_and(|end| end < format!("{}-12-01", c.year).as_str())
    {
        Value::Null
    } else {
        json!(format!("{}-{month:02}", c.year))
    };
    let rate_date = format!("{}-{}", c.year, text(policy, "rateDateMonthDay"));
    if c.selection.group_at_september1_confirmed != Some(true)
        || !c.employment.confirmed
        || c.employment
            .start
            .as_deref()
            .is_none_or(|s| s > rate_date.as_str())
        || c.employment
            .end
            .as_deref()
            .is_some_and(|s| s < rate_date.as_str())
    {
        return Ok(missing(sourced, vec!["selection.groupAtSeptember1".into()]));
    }
    if policy["eastTariff2025UsesWestTable"] == true && c.selection.region == "OST_TARIF_OST" {
        return Ok(missing(sourced, vec!["basis.ostWestTable".into()]));
    }
    let early = policy["earlyExitVariantId"] == c.selection.variant;
    let refs = rows(policy, "referenceMonths");
    let rule = AnnualCalculationRule::from_json(
        &json!({"eligibilityPolicy":if early{"CARITAS_31_EARLY_EXIT"}else{"EMPLOYED_DECEMBER_1"},"reductionPolicy":"CARITAS_16","basisPolicy":"CARITAS_16","earlyExitBasis":if early{policy["earlyExitBasis"].clone()}else{json!("NONE")},"referenceMonths":refs,"lateEntryAfterMonth":refs.get(2).ok_or(TariffAnnualError::Rule)?}),
    )?;
    let eligibility = tariff_annual_eligibility(claim, &rule)?;
    if !eligibility.missing.is_empty() || eligibility.eligible.is_none() {
        return Ok(missing(sourced, eligibility.missing));
    }
    if eligibility.eligible == Some(false) {
        sourced["status"] = json!("estimated");
        sourced["amountCents"] = json!(0);
        sourced["eligible"] = json!(false);
        return Ok(sourced);
    }
    let twelfths = eligibility
        .twelfths
        .as_ref()
        .ok_or(TariffAnnualError::Rule)?;
    sourced["eligible"] = json!(true);
    sourced["twelfths"] = serde_json::to_value(twelfths).map_err(|_| TariffAnnualError::Rule)?;
    if twelfths.numerator == 0 {
        sourced["status"] = json!("estimated");
        sourced["amountCents"] = json!(0);
        return Ok(sourced);
    }
    let basis = tariff_annual_basis(claim, &rule, &eligibility)?;
    let Some(basis) = basis.basis else {
        return Ok(missing(sourced, basis.missing));
    };
    let amount = round(
        &basis.numerator * BigInt::from(rate) * BigInt::from(twelfths.numerator),
        &basis.denominator
            * BigInt::from(10000)
            * BigInt::from(12)
            * BigInt::from(twelfths.denominator),
    )?;
    let basis_cents = round(basis.numerator, basis.denominator)?;
    sourced["status"] = json!("estimated");
    sourced["amountCents"] = json!(amount);
    sourced["basisCents"] = json!(basis_cents);
    sourced["basisMethod"] = json!(basis.method.text());
    sourced["basisMonths"] = json!(basis.months);
    Ok(sourced)
}
pub fn draft_from_resolver(
    resolver: &RuleResolver,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, TariffAnnualError> {
    let Ok(claim) = validate_tariff_annual_claim(input) else {
        return Ok(missing(empty(None), vec!["claim.invalid".into()]));
    };
    draft_from_checked(resolver, &claim, validator)
}
pub(super) fn draft_from_checked(
    resolver: &RuleResolver,
    claim: &ValidatedClaim,
    validator: &impl NativePackageValidator,
) -> Result<Value, TariffAnnualError> {
    match selection::select_checked(claim, resolver, validator)? {
        DraftSelection::Selected { package, .. } => draft_checked(package, claim, validator),
        DraftSelection::Unavailable { code } => {
            Ok(missing(empty(Some(claim.data().year)), vec![code.into()]))
        }
    }
}
