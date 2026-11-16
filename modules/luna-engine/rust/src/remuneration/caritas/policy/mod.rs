//! Original candidate-only policies; source half-up amounts and first-seen positions remain exact.
pub mod overtime;
pub mod shift;
pub mod time;
use super::{lookup::rows, reference::rounded};
use crate::{
    money::MAX_SAFE_INTEGER,
    remuneration::{base::BaseError, context::model::NativePackageValidator},
    rules::RulePackage,
};
use serde_json::{Value, json};
fn package(
    pkg: &RulePackage,
    draft: bool,
    validator: &impl NativePackageValidator,
) -> Result<bool, BaseError> {
    Ok(pkg.engine_contract_version == 14
        && (!draft || pkg.status() == Some("DRAFT"))
        && validator.validate(pkg)?)
}
fn money(n: Option<i64>, d: Option<i64>) -> Result<i64, BaseError> {
    n.zip(d)
        .and_then(|(n, d)| rounded(n, d))
        .ok_or(BaseError::InvalidCalculation)
}
fn sum(values: impl Iterator<Item = i64>) -> Value {
    let sum = values.fold(0.0, |sum, n| sum + n as f64);
    if sum.fract() == 0.0 && sum.abs() <= MAX_SAFE_INTEGER as f64 {
        json!(sum as i64)
    } else {
        json!(sum)
    }
}
fn working_rules<'a>(
    pkg: &'a RulePackage,
    date: &str,
    variant: &str,
    region: &str,
    open_end: bool,
) -> Vec<&'a Value> {
    rows(pkg.rules(), "employmentWorkingTimeRules")
        .iter()
        .filter(|r| {
            r["variantId"] == variant
                && r["regionId"] == region
                && r["validFrom"].as_str().is_some_and(|from| from <= date)
                && ((open_end && r["validTo"].is_null())
                    || r["validTo"].as_str().is_some_and(|to| date <= to))
        })
        .collect()
}
