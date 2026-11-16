//! Individually confirmed draft allowances; absent answers never create entitlement.
use super::{
    lookup::{full_time_weekly_minutes, unavailable},
    personal_base::{self, text},
    rates,
    reference::{integer, product, rounded},
};
use crate::{
    calendar::month_range,
    remuneration::{base::BaseError, context::model::NativePackageValidator},
    rules::RulePackage,
};
use serde_json::{Value, json};
fn legacy_provision(
    pkg: &RulePackage,
    input: &Value,
    provision: &str,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    let base = personal_base::calculate_original(pkg, input, validator)?;
    if base["kind"] == "unavailable" {
        return Ok(base);
    }
    let rate = rates::care_allowance(
        pkg,
        text(input, "date"),
        text(input, "variantId"),
        text(input, "regionId"),
        provision,
        validator,
    )?;
    if rate["kind"] == "unavailable" {
        return Ok(rate);
    }
    let amount = integer(&rate["monthlyCents"])
        .zip(integer(&input["weeklyMinutes"]))
        .and_then(|(m, w)| product(m, w))
        .zip(integer(&base["fullTimeWeeklyMinutes"]))
        .and_then(|(n, d)| rounded(n, d))
        .ok_or(BaseError::InvalidCalculation)?;
    Ok(
        json!({"kind":"personal-care-allowance","provisionId":provision,"fullTimeMonthlyCents":rate["monthlyCents"],"personalMonthlyCents":amount,"weeklyMinutes":input["weeklyMinutes"],"fullTimeWeeklyMinutes":base["fullTimeWeeklyMinutes"],"packageId":base["packageId"],"versionId":base["versionId"],"rateId":rate["rateId"],"rateSourceIds":rate["sourceIds"],"basisSourceIds":base["sourceIds"]}),
    )
}
pub fn legacy_dynamic(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    legacy_provision(pkg, input, "SECTION_12_4", validator)
}
pub fn legacy_fixed(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    legacy_provision(pkg, input, "SECTION_12_3", validator)
}
pub fn care(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    if input["entitlement"] == "NOT_ENTITLED" {
        return Ok(unavailable("NOT_ENTITLED"));
    }
    if input["entitlement"] != "CONFIRMED" {
        return Ok(unavailable("ENTITLEMENT_UNCONFIRMED"));
    }
    let base = personal_base::calculate(pkg, input, validator)?;
    if base["kind"] == "unavailable" {
        return Ok(base);
    }
    let rate = rates::care_allowance(
        pkg,
        text(input, "date"),
        text(input, "variantId"),
        text(input, "regionId"),
        text(input, "provisionId"),
        validator,
    )?;
    if rate["kind"] == "unavailable" {
        return Ok(rate);
    }
    let amount = integer(&rate["monthlyCents"])
        .zip(integer(&input["weeklyMinutes"]))
        .and_then(|(m, w)| product(m, w))
        .zip(integer(&base["fullTimeWeeklyMinutes"]))
        .and_then(|(n, d)| rounded(n, d));
    let Some(amount) = amount else {
        return Ok(unavailable("AMOUNT_OVERFLOW"));
    };
    Ok(
        json!({"kind":"personal-care-allowance","completeGross":false,"entitlementConfirmed":true,"provisionId":rate["provisionId"],"fullTimeMonthlyCents":rate["monthlyCents"],"personalMonthlyCents":amount,"weeklyMinutes":input["weeklyMinutes"],"fullTimeWeeklyMinutes":base["fullTimeWeeklyMinutes"],"packageId":base["packageId"],"versionId":base["versionId"],"rateId":rate["rateId"],"tableId":base["tableId"],"workingTimeRuleId":base["workingTimeRuleId"],"rateSourceIds":rate["sourceIds"],"basisSourceIds":base["sourceIds"],"prorationProvision":"AVR_ANLAGE_31_32_12A"}),
    )
}
pub fn monthly_shift(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    if input["entitlement"] == "NOT_ENTITLED" {
        return Ok(unavailable("NOT_ENTITLED"));
    }
    if input["entitlement"] != "CONFIRMED_FULL_MONTH" {
        return Ok(unavailable("ENTITLEMENT_UNCONFIRMED"));
    }
    if input["fullMonthEmploymentConfirmed"] != true {
        return Ok(unavailable("PARTIAL_EMPLOYMENT"));
    }
    if input["fullMonthWeeklyTimeConfirmed"] != true {
        return Ok(unavailable("WEEKLY_TIME_UNCONFIRMED"));
    }
    if !matches!(
        input["allowanceType"].as_str(),
        Some("ALTERNATING_MONTHLY" | "SHIFT_MONTHLY")
    ) {
        return Ok(unavailable("UNKNOWN_ALLOWANCE_TYPE"));
    }
    let Ok(bounds) = month_range(text(input, "month")) else {
        return Ok(unavailable("INVALID_MONTH"));
    };
    if pkg.status() != Some("DRAFT") {
        return Ok(unavailable("INVALID_PACKAGE"));
    }
    let variant = text(input, "variantId");
    let region = text(input, "regionId");
    let start = rates::shift_allowance(pkg, &bounds.start, variant, region, validator)?;
    if start["kind"] == "unavailable" {
        return Ok(start);
    }
    let end = rates::shift_allowance(pkg, &bounds.end, variant, region, validator)?;
    if end["kind"] == "unavailable" {
        return Ok(end);
    }
    if start["rateId"] != end["rateId"] {
        return Ok(unavailable("MID_MONTH_RATE_CHANGE"));
    }
    let working = full_time_weekly_minutes(pkg, &bounds.start, variant, region, validator)?;
    if working["kind"] == "unavailable" {
        return Ok(working);
    }
    let working_end = full_time_weekly_minutes(pkg, &bounds.end, variant, region, validator)?;
    if working_end["kind"] == "unavailable" {
        return Ok(working_end);
    }
    if working["ruleId"] != working_end["ruleId"] {
        return Ok(unavailable("MID_MONTH_WORKING_TIME_CHANGE"));
    }
    let full = integer(&working["fullTimeWeeklyMinutes"]).ok_or(BaseError::InvalidCalculation)?;
    let Some(weekly) = integer(&input["weeklyMinutes"]).filter(|w| *w > 0 && *w <= full) else {
        return Ok(unavailable("INVALID_WEEKLY_TIME"));
    };
    let amount_key = if input["allowanceType"] == "ALTERNATING_MONTHLY" {
        "alternatingMonthlyCents"
    } else {
        "shiftMonthlyCents"
    };
    let amount = integer(&start[amount_key])
        .and_then(|m| product(m, weekly))
        .and_then(|n| rounded(n, full));
    let Some(amount) = amount else {
        return Ok(unavailable("AMOUNT_OVERFLOW"));
    };
    Ok(
        json!({"kind":"personal-monthly-shift-allowance","completeGross":false,"fullMonthEntitlementConfirmed":true,"month":input["month"],"allowanceType":input["allowanceType"],"fullTimeMonthlyCents":start[amount_key],"personalMonthlyCents":amount,"weeklyMinutes":weekly,"fullTimeWeeklyMinutes":full,"packageId":start["packageId"],"versionId":start["versionId"],"rateId":start["rateId"],"workingTimeRuleId":working["ruleId"],"rateSourceIds":start["sourceIds"],"workingTimeSourceIds":working["sourceIds"],"prorationProvision":"AVR_ANLAGE_31_32_12A"}),
    )
}
pub fn hourly_shift(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    if input["entitlement"] == "NOT_ENTITLED" {
        return Ok(unavailable("NOT_ENTITLED"));
    }
    if input["entitlement"] != "CONFIRMED_NONPERMANENT" {
        return Ok(unavailable("ENTITLEMENT_UNCONFIRMED"));
    }
    if input["hoursConfirmed"] != true {
        return Ok(unavailable("HOURS_UNCONFIRMED"));
    }
    if !matches!(
        input["allowanceType"].as_str(),
        Some("ALTERNATING_HOURLY" | "SHIFT_HOURLY")
    ) {
        return Ok(unavailable("UNKNOWN_ALLOWANCE_TYPE"));
    }
    let Some(hours) = integer(&input["payableWholeHours"]).filter(|h| (1..=24).contains(h)) else {
        return Ok(unavailable("INVALID_WHOLE_HOURS"));
    };
    if pkg.status() != Some("DRAFT") {
        return Ok(unavailable("INVALID_PACKAGE"));
    }
    let rate = rates::shift_allowance(
        pkg,
        text(input, "serviceDate"),
        text(input, "variantId"),
        text(input, "regionId"),
        validator,
    )?;
    if rate["kind"] == "unavailable" {
        return Ok(rate);
    }
    let key = if input["allowanceType"] == "ALTERNATING_HOURLY" {
        "alternatingHourlyCents"
    } else {
        "shiftHourlyCents"
    };
    let amount = integer(&rate[key]).and_then(|r| product(r, hours));
    let Some(amount) = amount else {
        return Ok(unavailable("AMOUNT_OVERFLOW"));
    };
    Ok(
        json!({"kind":"personal-hourly-shift-allowance","completeGross":false,"nonPermanentEntitlementConfirmed":true,"hoursConfirmed":true,"serviceDate":input["serviceDate"],"allowanceType":input["allowanceType"],"payableWholeHours":hours,"rateCentsPerHour":rate[key],"personalAmountCents":amount,"packageId":rate["packageId"],"versionId":rate["versionId"],"rateId":rate["rateId"],"sourceIds":rate["sourceIds"]}),
    )
}
