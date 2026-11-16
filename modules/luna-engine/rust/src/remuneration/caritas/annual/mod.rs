//! Sourced, independently confirmed Caritas annual candidates; no complete-salary readiness.
mod draft;
mod early;
mod entitlement;
mod fallback;
mod late;
mod parental;
mod partial;
mod payout;
mod regular;
mod rounding;
mod rule;
mod selection;
use super::{
    lookup::{rows, unavailable},
    personal_base::text,
};
use crate::{
    money::MAX_SAFE_INTEGER,
    remuneration::{
        base::BaseError,
        context::{model::NativePackageValidator, selection::resolve_tariff_selection},
    },
    rules::RulePackage,
};
pub use draft::{draft_claim, draft_from_resolver};
pub use early::early_exit_amount;
pub use entitlement::assess_entitlement;
pub use fallback::{fallback_amount, fallback_basis};
pub use late::{late_assessment, late_basis};
pub use parental::parental_amount;
pub use partial::{partial_amount, partial_basis};
pub use payout::{payout_month, payout_month_checked};
pub use regular::{regular_amount, regular_basis};
pub use rounding::round_amount;
pub use rule::lookup_rule;
pub use selection::{DraftSelection, select_draft};
use serde_json::{Value, json};
fn bad(value: &Value) -> bool {
    value["kind"] == "unavailable"
}
fn integer(value: &Value, min: i64, max: i64) -> Option<i64> {
    value
        .as_f64()
        .filter(|n| n.fract() == 0.0 && *n >= min as f64 && *n <= max as f64)
        .map(|n| n as i64)
}
fn year(value: &Value) -> Option<i32> {
    integer(value, 2025, 2026).map(|n| n as i32)
}
fn in_year(pkg: &RulePackage, year: i32) -> bool {
    let date = format!("{year}-09-01");
    date >= pkg.valid_from && pkg.valid_to.as_ref().is_none_or(|to| date <= *to)
}
fn selection<'a>(pkg: &'a RulePackage, input: &Value) -> Option<&'a Value> {
    let s = resolve_tariff_selection(pkg, text(input, "variantId"), text(input, "regionId"))?;
    if s.family_id != "avr-caritas-p"
        || s.engine_id != "avr-caritas-p-v1"
        || s.region.get("payTableId").is_none()
        || s.capabilities
            .as_object()
            .is_none_or(|m| m.values().any(|v| v != "UNSUPPORTED"))
    {
        None
    } else {
        Some(s.region)
    }
}
fn utc_day(value: &Value) -> Option<i64> {
    let text = value.as_str()?;
    crate::employment::require_remuneration_date(text).ok()?;
    crate::calendar::parse_date(text)
        .ok()?
        .to_zoned(jiff::tz::TimeZone::UTC)
        .ok()
        .map(|z| z.timestamp().as_millisecond() / 86400000)
}
fn month_bounds(year: i32, month: i8) -> (i64, i64, i64) {
    let date = jiff::civil::date(year as i16, month, 1);
    let first = date
        .to_zoned(jiff::tz::TimeZone::UTC)
        .expect("valid source year")
        .timestamp()
        .as_millisecond()
        / 86400000;
    let days = i64::from(date.days_in_month());
    (first, first + days - 1, days)
}
fn finish_amount(
    pkg: &RulePackage,
    input: &Value,
    basis: Value,
    entitlement: Value,
    kind: &str,
) -> Result<Value, BaseError> {
    let mut amount = round_amount(
        pkg,
        &input["entitlementYear"],
        &basis,
        &entitlement["reductionFactor"],
    )?;
    if bad(&amount) {
        return Ok(amount);
    }
    amount["kind"] = json!(kind);
    amount["draft"] = json!(true);
    amount["completeGross"] = json!(false);
    amount["entitlementYear"] =
        json!(year(&input["entitlementYear"]).ok_or(BaseError::InvalidCalculation)?);
    amount["basis"] = basis;
    amount["entitlement"] = entitlement;
    amount["parentalLeavePartTimeBasis"] = json!("NOT_APPLICABLE");
    Ok(amount)
}
