//! Dated published Caritas care, shift and time-premium rates; no assumed personal claims.
use super::lookup::{checked, rows, unavailable};
use crate::{
    remuneration::context::model::{ContextError, NativePackageValidator},
    rules::RulePackage,
};
use serde_json::{Value, json};
fn matches(rate: &Value, date: &str, variant: &str, region: &str) -> bool {
    rate["variantId"] == variant
        && rate["regionId"] == region
        && rate["validFrom"].as_str().is_some_and(|from| from <= date)
        && rate["validTo"].as_str().is_some_and(|to| date <= to)
}
pub fn care_allowance(
    pkg: &RulePackage,
    date: &str,
    variant: &str,
    region: &str,
    provision: &str,
    validator: &impl NativePackageValidator,
) -> Result<Value, ContextError> {
    if let Err(reason) = checked(pkg, date, variant, region, validator)? {
        return Ok(unavailable(reason));
    }
    if !matches!(provision, "SECTION_12_3" | "SECTION_12_4") {
        return Ok(unavailable("UNKNOWN_PROVISION"));
    }
    let found: Vec<_> = rows(pkg.rules(), "caritasCareAllowanceRates")
        .iter()
        .filter(|r| r["provisionId"] == provision && matches(r, date, variant, region))
        .collect();
    if found.len() != 1 {
        return Ok(unavailable("MISSING_CARE_ALLOWANCE_RATE"));
    }
    let rate = found[0];
    Ok(
        json!({"kind":"source-care-allowance-rate","packageId":pkg.package_id,"versionId":pkg.version_id,"rateId":rate["id"],"provisionId":rate["provisionId"],"variantId":rate["variantId"],"regionId":rate["regionId"],"monthlyCents":rate["monthlyCents"],"sourceIds":rate["sourceIds"]}),
    )
}
pub fn shift_allowance(
    pkg: &RulePackage,
    date: &str,
    variant: &str,
    region: &str,
    validator: &impl NativePackageValidator,
) -> Result<Value, ContextError> {
    if let Err(reason) = checked(pkg, date, variant, region, validator)? {
        return Ok(unavailable(reason));
    }
    let found: Vec<_> = rows(pkg.rules(), "caritasShiftAllowanceRates")
        .iter()
        .filter(|r| matches(r, date, variant, region))
        .collect();
    if found.len() != 1 {
        return Ok(unavailable("MISSING_SHIFT_ALLOWANCE_RATE"));
    }
    let rate = found[0];
    Ok(
        json!({"kind":"source-shift-allowance-rate","packageId":pkg.package_id,"versionId":pkg.version_id,"rateId":rate["id"],"variantId":rate["variantId"],"regionId":rate["regionId"],"alternatingMonthlyCents":rate["alternatingMonthlyCents"],"alternatingHourlyCents":rate["alternatingHourlyCents"],"shiftMonthlyCents":rate["shiftMonthlyCents"],"shiftHourlyCents":rate["shiftHourlyCents"],"sourceIds":rate["sourceIds"]}),
    )
}
pub fn time_premium(
    pkg: &RulePackage,
    date: &str,
    variant: &str,
    region: &str,
    validator: &impl NativePackageValidator,
) -> Result<Value, ContextError> {
    if let Err(reason) = checked(pkg, date, variant, region, validator)? {
        return Ok(unavailable(reason));
    }
    let found: Vec<_> = rows(pkg.rules(), "caritasTimePremiumRates")
        .iter()
        .filter(|r| matches(r, date, variant, region))
        .collect();
    if found.len() != 1 {
        return Ok(unavailable("MISSING_TIME_PREMIUM_RATE"));
    }
    let rate = found[0];
    let mut out = json!({"kind":"source-time-premium-rate","packageId":pkg.package_id,"versionId":pkg.version_id,"rateId":rate["id"],"variantId":rate["variantId"],"regionId":rate["regionId"],"referenceStepId":rate["referenceStepId"]});
    for key in [
        "nightBasisPoints",
        "sundayBasisPoints",
        "holidayWithTimeOffBasisPoints",
        "holidayWithoutTimeOffBasisPoints",
        "preHolidayBasisPoints",
        "saturdayBasisPoints",
        "sourceIds",
    ] {
        out[key] = rate[key].clone();
    }
    Ok(out)
}
