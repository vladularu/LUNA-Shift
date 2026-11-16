//! Cash only for exact explicit hour/category/entitlement facts, without a complete-salary claim.
use super::{
    lookup::unavailable,
    overtime as overtime_reference,
    personal_base::text,
    reference::{self, integer, product},
};
use crate::{
    money::MAX_SAFE_INTEGER,
    remuneration::{base::BaseError, context::model::NativePackageValidator},
    rules::RulePackage,
};
use serde_json::{Value, json};
pub fn time_premium(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    if input["entitlement"] == "NOT_ENTITLED" {
        return Ok(unavailable("NOT_ENTITLED"));
    }
    if input["entitlement"] != "CONFIRMED_CASH" {
        return Ok(unavailable("ENTITLEMENT_UNCONFIRMED"));
    }
    if input["hoursConfirmed"] != true {
        return Ok(unavailable("HOURS_UNCONFIRMED"));
    }
    if input["categoryAndOverlapConfirmed"] != true {
        return Ok(unavailable("CATEGORY_OR_OVERLAP_UNCONFIRMED"));
    }
    let Some(hours) = integer(&input["payableWholeHours"]).filter(|h| (1..=24).contains(h)) else {
        return Ok(unavailable("INVALID_WHOLE_HOURS"));
    };
    if pkg.status() != Some("DRAFT") {
        return Ok(unavailable("INVALID_PACKAGE"));
    }
    let hourly = reference::hourly_values(
        pkg,
        text(input, "serviceDate"),
        text(input, "variantId"),
        text(input, "regionId"),
        text(input, "groupId"),
        validator,
    )?;
    if hourly["kind"] == "unavailable" {
        return Ok(hourly);
    }
    let key = match input["premiumType"].as_str() {
        Some("NIGHT") => "nightCentsPerHour",
        Some("SUNDAY") => "sundayCentsPerHour",
        Some("HOLIDAY_WITH_TIME_OFF") => "holidayWithTimeOffCentsPerHour",
        Some("HOLIDAY_WITHOUT_TIME_OFF") => "holidayWithoutTimeOffCentsPerHour",
        Some("PRE_HOLIDAY") => "preHolidayCentsPerHour",
        Some("SATURDAY") => "saturdayCentsPerHour",
        _ => return Ok(unavailable("UNKNOWN_PREMIUM_TYPE")),
    };
    let amount = integer(&hourly[key]).and_then(|r| product(r, hours));
    let Some(amount) = amount else {
        return Ok(unavailable("AMOUNT_OVERFLOW"));
    };
    Ok(
        json!({"kind":"personal-time-premium","completeGross":false,"serviceDate":input["serviceDate"],"premiumType":input["premiumType"],"payableWholeHours":hours,"rateCentsPerHour":hourly[key],"personalAmountCents":amount,"cashEntitlementConfirmed":true,"hoursConfirmed":true,"categoryAndOverlapConfirmed":true,"hourlyValues":hourly}),
    )
}
pub fn overtime(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    if input["overtimeConfirmed"] != true {
        return Ok(unavailable("OVERTIME_UNCONFIRMED"));
    }
    if input["baseEntitlement"] == "NOT_ENTITLED" {
        return Ok(unavailable("BASE_NOT_ENTITLED"));
    }
    if input["baseEntitlement"] != "CONFIRMED_CASH" {
        return Ok(unavailable("BASE_ENTITLEMENT_UNCONFIRMED"));
    }
    if input["premiumEntitlement"] == "NOT_ENTITLED" {
        return Ok(unavailable("PREMIUM_NOT_ENTITLED"));
    }
    if input["premiumEntitlement"] != "CONFIRMED_CASH" {
        return Ok(unavailable("PREMIUM_ENTITLEMENT_UNCONFIRMED"));
    }
    if input["hoursConfirmed"] != true {
        return Ok(unavailable("HOURS_UNCONFIRMED"));
    }
    let Some(hours) = integer(&input["payableWholeHours"]).filter(|h| (1..=24).contains(h)) else {
        return Ok(unavailable("INVALID_WHOLE_HOURS"));
    };
    let hourly = overtime_reference::hourly_values(
        pkg,
        text(input, "serviceDate"),
        text(input, "variantId"),
        text(input, "regionId"),
        text(input, "groupId"),
        text(input, "personalStepId"),
        validator,
    )?;
    if hourly["kind"] == "unavailable" {
        return Ok(hourly);
    }
    let base = integer(&hourly["baseCentsPerHour"]).and_then(|r| product(r, hours));
    let premium = integer(&hourly["premiumCentsPerHour"]).and_then(|r| product(r, hours));
    let total = base
        .zip(premium)
        .and_then(|(b, p)| b.checked_add(p))
        .filter(|n| n.unsigned_abs() <= MAX_SAFE_INTEGER as u64);
    let (Some(base), Some(premium), Some(total)) = (base, premium, total) else {
        return Ok(unavailable("AMOUNT_OVERFLOW"));
    };
    Ok(
        json!({"kind":"personal-overtime","completeGross":false,"serviceDate":input["serviceDate"],"payableWholeHours":hours,"baseAmountCents":base,"premiumAmountCents":premium,"personalAmountCents":total,"overtimeConfirmed":true,"cashBaseEntitlementConfirmed":true,"cashPremiumEntitlementConfirmed":true,"hoursConfirmed":true,"hourlyValues":hourly}),
    )
}
