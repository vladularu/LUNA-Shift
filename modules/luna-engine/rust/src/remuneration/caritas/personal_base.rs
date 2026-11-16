//! Personal draft table component; original and delivered weekly-time boundaries remain separate.
use super::{
    lookup::{care_table, full_time_weekly_minutes, unavailable},
    overtime::source_ids,
    reference::{integer, product, rounded},
};
use crate::{
    remuneration::{base::BaseError, context::model::NativePackageValidator},
    rules::RulePackage,
};
use serde_json::{Value, json};
pub(super) fn text<'a>(input: &'a Value, key: &str) -> &'a str {
    input[key].as_str().unwrap_or("")
}
pub fn calculate(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    if pkg.status() != Some("DRAFT") {
        return Ok(unavailable("INVALID_PACKAGE"));
    }
    let date = text(input, "date");
    let variant = text(input, "variantId");
    let region = text(input, "regionId");
    let table = care_table(
        pkg,
        date,
        variant,
        region,
        text(input, "groupId"),
        text(input, "stepId"),
        validator,
    )?;
    if table["kind"] == "unavailable" {
        return Ok(table);
    }
    let working = full_time_weekly_minutes(pkg, date, variant, region, validator)?;
    if working["kind"] == "unavailable" {
        return Ok(working);
    }
    let full = integer(&working["fullTimeWeeklyMinutes"]).ok_or(BaseError::InvalidCalculation)?;
    let weekly = integer(&input["weeklyMinutes"]);
    let Some(weekly) = weekly.filter(|n| *n > 0 && *n <= full) else {
        return Ok(unavailable("INVALID_WEEKLY_TIME"));
    };
    let amount = integer(&table["monthlyCents"])
        .and_then(|m| product(m, weekly))
        .and_then(|n| rounded(n, full));
    let Some(amount) = amount else {
        return Ok(unavailable("AMOUNT_OVERFLOW"));
    };
    Ok(
        json!({"kind":"personal-table-base","completeGross":false,"fullTimeMonthlyCents":table["monthlyCents"],"personalMonthlyCents":amount,"weeklyMinutes":weekly,"fullTimeWeeklyMinutes":full,"packageId":table["packageId"],"versionId":table["versionId"],"tableId":table["tableId"],"workingTimeRuleId":working["ruleId"],"groupId":table["groupId"],"stepId":table["stepId"],"sourceIds":source_ids(&table["sourceIds"],&working["sourceIds"]),"prorationProvision":"AVR_ANLAGE_31_32_12A"}),
    )
}
pub fn calculate_original(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    let result = calculate(pkg, input, validator)?;
    if result["kind"] != "unavailable" && integer(&input["weeklyMinutes"]).is_some_and(|n| n < 60) {
        return Ok(unavailable("INVALID_WEEKLY_TIME"));
    }
    Ok(result)
}
