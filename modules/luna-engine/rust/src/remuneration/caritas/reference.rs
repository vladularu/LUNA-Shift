//! Exact sourced hourly references, preserving table-first then percentage rounding.
use super::{
    lookup::{care_table, full_time_weekly_minutes, unavailable},
    rates,
};
use crate::{
    money::{MAX_SAFE_INTEGER, round_ratio},
    remuneration::context::model::{ContextError, NativePackageValidator},
    rules::RulePackage,
};
use serde_json::{Value, json};
pub(super) const MONTHLY_FACTOR_THOUSANDTHS: i64 = 4348;
pub(super) fn integer(value: &Value) -> Option<i64> {
    value
        .as_f64()
        .filter(|n| n.is_finite() && n.fract() == 0.0 && n.abs() <= MAX_SAFE_INTEGER as f64)
        .map(|n| n as i64)
}
pub(super) fn product(a: i64, b: i64) -> Option<i64> {
    a.checked_mul(b)
        .filter(|n| n.unsigned_abs() <= MAX_SAFE_INTEGER as u64)
}
pub(super) fn rounded(numerator: i64, denominator: i64) -> Option<i64> {
    round_ratio(numerator, denominator).ok()
}
pub fn time_premium(
    pkg: &RulePackage,
    date: &str,
    variant: &str,
    region: &str,
    group: &str,
    validator: &impl NativePackageValidator,
) -> Result<Value, ContextError> {
    if pkg.status() != Some("DRAFT") {
        return Ok(unavailable("INVALID_PACKAGE"));
    }
    let rate = rates::time_premium(pkg, date, variant, region, validator)?;
    if rate["kind"] == "unavailable" {
        return Ok(rate);
    }
    let table = care_table(
        pkg,
        date,
        variant,
        region,
        group,
        rate["referenceStepId"]
            .as_str()
            .ok_or(ContextError::InvalidRule)?,
        validator,
    )?;
    if table["kind"] == "unavailable" {
        return Ok(table);
    }
    let weekly = full_time_weekly_minutes(pkg, date, variant, region, validator)?;
    if weekly["kind"] == "unavailable" {
        return Ok(weekly);
    }
    let mut out = json!({"kind":"source-time-premium-reference","packageId":rate["packageId"],"versionId":rate["versionId"],"variantId":rate["variantId"],"regionId":rate["regionId"],"groupId":table["groupId"],"referenceStepId":rate["referenceStepId"],"tableId":table["tableId"],"workingTimeRuleId":weekly["ruleId"],"rateId":rate["rateId"],"fullTimeMonthlyCents":table["monthlyCents"],"fullTimeWeeklyMinutes":weekly["fullTimeWeeklyMinutes"]});
    for key in [
        "nightBasisPoints",
        "sundayBasisPoints",
        "holidayWithTimeOffBasisPoints",
        "holidayWithoutTimeOffBasisPoints",
        "preHolidayBasisPoints",
        "saturdayBasisPoints",
    ] {
        out[key] = rate[key].clone();
    }
    out["tableSourceIds"] = table["sourceIds"].clone();
    out["workingTimeSourceIds"] = weekly["sourceIds"].clone();
    out["rateSourceIds"] = rate["sourceIds"].clone();
    Ok(out)
}
pub fn hourly_ratio(
    pkg: &RulePackage,
    date: &str,
    variant: &str,
    region: &str,
    group: &str,
    validator: &impl NativePackageValidator,
) -> Result<Value, ContextError> {
    let reference = time_premium(pkg, date, variant, region, group, validator)?;
    if reference["kind"] == "unavailable" {
        return Ok(reference);
    }
    let numerator = integer(&reference["fullTimeMonthlyCents"]).and_then(|n| product(n, 60_000));
    let denominator = integer(&reference["fullTimeWeeklyMinutes"])
        .and_then(|n| product(n, MONTHLY_FACTOR_THOUSANDTHS));
    let (Some(numerator), Some(denominator)) = (numerator, denominator) else {
        return Ok(unavailable("RATIO_OVERFLOW"));
    };
    if denominator <= 0 {
        return Ok(unavailable("RATIO_OVERFLOW"));
    }
    Ok(
        json!({"kind":"source-hourly-table-ratio","reference":reference,"monthlyFactorThousandths":MONTHLY_FACTOR_THOUSANDTHS,"hourlyCentsNumerator":numerator,"hourlyCentsDenominator":denominator,"divisorProvision":"AVR_ANLAGE_1_IIA_A_SATZ_4"}),
    )
}
pub fn hourly_values(
    pkg: &RulePackage,
    date: &str,
    variant: &str,
    region: &str,
    group: &str,
    validator: &impl NativePackageValidator,
) -> Result<Value, ContextError> {
    let ratio = hourly_ratio(pkg, date, variant, region, group, validator)?;
    if ratio["kind"] == "unavailable" {
        return Ok(ratio);
    }
    let n = integer(&ratio["hourlyCentsNumerator"]).ok_or(ContextError::InvalidRule)?;
    let d = integer(&ratio["hourlyCentsDenominator"]).ok_or(ContextError::InvalidRule)?;
    let Some(hourly) = rounded(n, d) else {
        return Ok(unavailable("ROUNDING_OVERFLOW"));
    };
    let mut out =
        json!({"kind":"source-hourly-premium-values","ratio":ratio,"hourlyTableCents":hourly});
    for (output, rate) in [
        ("nightCentsPerHour", "nightBasisPoints"),
        ("sundayCentsPerHour", "sundayBasisPoints"),
        (
            "holidayWithTimeOffCentsPerHour",
            "holidayWithTimeOffBasisPoints",
        ),
        (
            "holidayWithoutTimeOffCentsPerHour",
            "holidayWithoutTimeOffBasisPoints",
        ),
        ("preHolidayCentsPerHour", "preHolidayBasisPoints"),
        ("saturdayCentsPerHour", "saturdayBasisPoints"),
    ] {
        let amount = integer(&ratio["reference"][rate])
            .and_then(|r| product(hourly, r))
            .and_then(|n| rounded(n, 10_000));
        let Some(amount) = amount else {
            return Ok(unavailable("ROUNDING_OVERFLOW"));
        };
        out[output] = json!(amount);
    }
    out["roundingProvision"] = json!("AVR_ANLAGE_1_X_E");
    out["roundingOrder"] = json!("HOURLY_TABLE_CENTS_THEN_PERCENTAGE");
    Ok(out)
}
