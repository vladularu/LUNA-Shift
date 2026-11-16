//! Sourced contract-14 table and weekly-time facts, without personal entitlement.
use crate::{
    calendar::parse_date,
    remuneration::context::{
        model::{ContextError, NativePackageValidator},
        selection::resolve_tariff_selection,
    },
    rules::RulePackage,
};
use serde_json::{Value, json};
pub(super) fn unavailable(reason: &str) -> Value {
    json!({"kind":"unavailable","reason":reason})
}
pub(super) fn checked<'a>(
    pkg: &'a RulePackage,
    date: &str,
    variant: &str,
    region: &str,
    validator: &impl NativePackageValidator,
) -> Result<Result<&'a Value, &'static str>, ContextError> {
    if pkg.engine_contract_version != 14 || !validator.validate(pkg)? {
        return Ok(Err("INVALID_PACKAGE"));
    }
    if parse_date(date).is_err()
        || date < pkg.valid_from.as_str()
        || pkg.valid_to.as_deref().is_some_and(|to| date > to)
    {
        return Ok(Err("OUTSIDE_VALIDITY"));
    }
    let Some(selection) = resolve_tariff_selection(pkg, variant, region) else {
        return Ok(Err("UNKNOWN_SELECTION"));
    };
    if selection.family_id != "avr-caritas-p"
        || selection.engine_id != "avr-caritas-p-v1"
        || selection.region.get("payTableId").is_none()
        || selection
            .capabilities
            .as_object()
            .is_none_or(|c| c.values().any(|v| v != "UNSUPPORTED"))
    {
        return Ok(Err("UNKNOWN_SELECTION"));
    }
    Ok(Ok(selection.region))
}
pub(super) fn rows<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value[key].as_array().map_or(&[], Vec::as_slice)
}
pub fn care_table(
    pkg: &RulePackage,
    date: &str,
    variant: &str,
    region: &str,
    group: &str,
    step: &str,
    validator: &impl NativePackageValidator,
) -> Result<Value, ContextError> {
    let selection = match checked(pkg, date, variant, region, validator)? {
        Ok(value) => value,
        Err(reason) => return Ok(unavailable(reason)),
    };
    let table = rows(pkg.rules(), "payTables")
        .iter()
        .find(|t| t["id"] == selection["payTableId"]);
    let group = group.to_lowercase();
    let matches: Vec<_> = table
        .map_or(&[][..], |t| rows(t, "entries"))
        .iter()
        .filter(|e| e["groupId"] == group && e["stepId"] == step)
        .collect();
    if matches.len() != 1 {
        return Ok(unavailable("MISSING_TABLE_VALUE"));
    }
    let table = table.expect("matched table");
    let entry = matches[0];
    Ok(
        json!({"kind":"source-table","packageId":pkg.package_id,"versionId":pkg.version_id,"tableId":table["id"],"monthlyCents":entry["monthlyCents"],"groupId":entry["groupId"],"stepId":entry["stepId"],"sourceIds":table["sourceIds"]}),
    )
}
pub fn full_time_weekly_minutes(
    pkg: &RulePackage,
    date: &str,
    variant: &str,
    region: &str,
    validator: &impl NativePackageValidator,
) -> Result<Value, ContextError> {
    if let Err(reason) = checked(pkg, date, variant, region, validator)? {
        return Ok(unavailable(reason));
    }
    let matches: Vec<_> = rows(pkg.rules(), "employmentWorkingTimeRules")
        .iter()
        .filter(|r| {
            r["variantId"] == variant
                && r["regionId"] == region
                && r["validFrom"].as_str().is_some_and(|from| from <= date)
                && (r["validTo"].is_null() || r["validTo"].as_str().is_some_and(|to| date <= to))
        })
        .collect();
    if matches.len() != 1 {
        return Ok(unavailable("MISSING_WORKING_TIME_RULE"));
    }
    let rule = matches[0];
    Ok(
        json!({"kind":"source-working-time","packageId":pkg.package_id,"versionId":pkg.version_id,"ruleId":rule["id"],"fullTimeWeeklyMinutes":rule["fullTimeWeeklyMinutes"],"sourceIds":rule["sourceIds"]}),
    )
}
