//! Source overtime reference components; entitlement and payable hours remain separate facts.
use super::{
    lookup::{care_table, full_time_weekly_minutes, unavailable},
    reference::{MONTHLY_FACTOR_THOUSANDTHS, integer, product, rounded},
};
use crate::{
    money::MAX_SAFE_INTEGER,
    remuneration::context::model::{ContextError, NativePackageValidator},
    rules::RulePackage,
};
use serde_json::{Value, json};
use std::collections::BTreeSet;
pub(super) fn source_ids(a: &Value, b: &Value) -> Value {
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for source in [a, b] {
        for id in source.as_array().into_iter().flatten() {
            if seen.insert(id.as_str().expect("validated source id")) {
                out.push(id.clone());
            }
        }
    }
    json!(out)
}
pub fn hourly_base(
    pkg: &RulePackage,
    date: &str,
    variant: &str,
    region: &str,
    group: &str,
    step: &str,
    validator: &impl NativePackageValidator,
) -> Result<Value, ContextError> {
    if pkg.status() != Some("DRAFT") {
        return Ok(unavailable("INVALID_PACKAGE"));
    }
    if step.len() != 1 || !(b'1'..=b'6').contains(&step.as_bytes()[0]) {
        return Ok(unavailable("INVALID_STEP"));
    }
    let personal = care_table(pkg, date, variant, region, group, step, validator)?;
    if personal["kind"] == "unavailable" {
        return Ok(personal);
    }
    let reference_step = if step > "4" { "4" } else { step };
    let table = if reference_step == step {
        personal
    } else {
        care_table(pkg, date, variant, region, group, reference_step, validator)?
    };
    if table["kind"] == "unavailable" {
        return Ok(table);
    }
    let weekly = full_time_weekly_minutes(pkg, date, variant, region, validator)?;
    if weekly["kind"] == "unavailable" {
        return Ok(weekly);
    }
    let weekly_minutes =
        integer(&weekly["fullTimeWeeklyMinutes"]).ok_or(ContextError::InvalidRule)?;
    if weekly_minutes <= 0 {
        return Ok(unavailable("INVALID_WORKING_TIME"));
    }
    let n = integer(&table["monthlyCents"]).and_then(|n| product(n, 60_000));
    let d = product(weekly_minutes, MONTHLY_FACTOR_THOUSANDTHS);
    let amount = n.zip(d).and_then(|(n, d)| rounded(n, d));
    let Some(amount) = amount else {
        return Ok(unavailable("AMOUNT_OVERFLOW"));
    };
    Ok(
        json!({"kind":"source-overtime-hourly-base","packageId":pkg.package_id,"versionId":pkg.version_id,"date":date,"variantId":variant,"regionId":region,"groupId":table["groupId"],"personalStepId":step,"referenceStepId":reference_step,"referenceMonthlyCents":table["monthlyCents"],"fullTimeWeeklyMinutes":weekly["fullTimeWeeklyMinutes"],"hourlyBaseCents":amount,"tableId":table["tableId"],"workingTimeRuleId":weekly["ruleId"],"sourceIds":source_ids(&table["sourceIds"],&weekly["sourceIds"]),"stepCapProvision":"AVR_ANLAGE_31_32_6_ABS_1_ANMERKUNG","divisorProvision":"AVR_ANLAGE_1_IIA_A_SATZ_4","roundingProvision":"AVR_ANLAGE_1_X_E"}),
    )
}
pub fn hourly_premium(
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
    let table = care_table(pkg, date, variant, region, group, "3", validator)?;
    if table["kind"] == "unavailable" {
        return Ok(table);
    }
    let weekly = full_time_weekly_minutes(pkg, date, variant, region, validator)?;
    if weekly["kind"] == "unavailable" {
        return Ok(weekly);
    }
    let basis_points = match table["groupId"].as_str() {
        Some("p4" | "p6" | "p7" | "p8" | "p9" | "p10" | "p11") => 3000,
        Some("p12" | "p13" | "p14" | "p15" | "p16") => 1500,
        _ => return Ok(unavailable("UNSUPPORTED_GROUP")),
    };
    let n = integer(&table["monthlyCents"]).and_then(|n| product(n, 60_000));
    let d = integer(&weekly["fullTimeWeeklyMinutes"])
        .and_then(|n| product(n, MONTHLY_FACTOR_THOUSANDTHS));
    let hourly = n
        .zip(d)
        .filter(|(_, d)| *d > 0)
        .and_then(|(n, d)| rounded(n, d));
    let Some(hourly) = hourly else {
        return Ok(unavailable("AMOUNT_OVERFLOW"));
    };
    let premium = product(hourly, basis_points).and_then(|n| rounded(n, 10_000));
    let Some(premium) = premium else {
        return Ok(unavailable("AMOUNT_OVERFLOW"));
    };
    Ok(
        json!({"kind":"source-overtime-hourly-premium","packageId":pkg.package_id,"versionId":pkg.version_id,"date":date,"variantId":variant,"regionId":region,"groupId":table["groupId"],"referenceStepId":"3","hourlyTableCents":hourly,"premiumBasisPoints":basis_points,"premiumCentsPerHour":premium,"tableId":table["tableId"],"workingTimeRuleId":weekly["ruleId"],"sourceIds":source_ids(&table["sourceIds"],&weekly["sourceIds"]),"rateProvision":"AVR_ANLAGE_31_32_6_ABS_1_A","divisorProvision":"AVR_ANLAGE_1_IIA_A_SATZ_4","roundingProvision":"AVR_ANLAGE_1_X_E"}),
    )
}
pub fn hourly_values(
    pkg: &RulePackage,
    date: &str,
    variant: &str,
    region: &str,
    group: &str,
    step: &str,
    validator: &impl NativePackageValidator,
) -> Result<Value, ContextError> {
    let base = hourly_base(pkg, date, variant, region, group, step, validator)?;
    if base["kind"] == "unavailable" {
        return Ok(base);
    }
    let premium = hourly_premium(pkg, date, variant, region, group, validator)?;
    if premium["kind"] == "unavailable" {
        return Ok(premium);
    }
    for field in [
        "packageId",
        "versionId",
        "tableId",
        "workingTimeRuleId",
        "groupId",
    ] {
        if base[field] != premium[field] {
            return Ok(unavailable("SOURCE_MISMATCH"));
        }
    }
    let base_amount = integer(&base["hourlyBaseCents"]).ok_or(ContextError::InvalidRule)?;
    let premium_amount =
        integer(&premium["premiumCentsPerHour"]).ok_or(ContextError::InvalidRule)?;
    let total = base_amount
        .checked_add(premium_amount)
        .filter(|n| n.unsigned_abs() <= MAX_SAFE_INTEGER as u64);
    let Some(total) = total else {
        return Ok(unavailable("AMOUNT_OVERFLOW"));
    };
    Ok(
        json!({"kind":"source-overtime-hourly-values","base":base,"premium":premium,"baseCentsPerHour":base_amount,"premiumCentsPerHour":premium_amount,"totalCentsPerHour":total,"sourceIds":source_ids(&base["sourceIds"],&premium["sourceIds"])}),
    )
}
