//! DRK E/P/S and apprentice full-month reference components; never complete gross.
use crate::{
    calendar::{MonthRange, month_range},
    net::js_truthy as truthy,
    remuneration::{
        base::round_remuneration_cents,
        context::{
            model::{ContextError, NativePackageValidator},
            selection::resolve_tariff_selection,
        },
    },
    rules::RulePackage,
};
use serde_json::{Value, json};
pub(super) fn unavailable(reason: &str) -> Value {
    json!({"kind":"unavailable","reason":reason})
}
pub(super) fn month_bounds(month: &str) -> Option<MonthRange> {
    month_range(month).ok()
}
fn safe(n: f64) -> bool {
    n.is_finite() && n.fract() == 0.0 && n.abs() <= crate::money::MAX_SAFE_INTEGER as f64
}
fn family(id: &str) -> Option<(&'static str, &'static str, &'static str)> {
    match id {
        "drk-rtv-e" => Some(("ANLAGE_A1", "drk-rtv-e-v1", "anlage-a1-e")),
        "drk-rtv-p" => Some(("ANLAGE_A2", "drk-rtv-p-v1", "anlage-a2-p")),
        "drk-rtv-s" => Some(("ANLAGE_A3", "drk-rtv-s-v1", "anlage-a3-s")),
        _ => None,
    }
}
pub(super) fn category(variant: &str) -> Option<&'static str> {
    match variant {
        "ANLAGE_3" => Some("anlage-3-general"),
        "ANLAGE_3A_A" => Some("anlage-3a-a"),
        "ANLAGE_3A_B" => Some("anlage-3a-b"),
        _ => None,
    }
}
pub fn calculate_employee_table_base(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, ContextError> {
    let Some((variant_id, engine_id, table_id)) = family(&pkg.package_id) else {
        return Ok(unavailable("INVALID_PACKAGE"));
    };
    if pkg.engine_contract_version != 17 || !validator.validate(pkg)? {
        return Ok(unavailable("INVALID_PACKAGE"));
    }
    let Some(bounds) = input["month"].as_str().and_then(month_bounds) else {
        return Ok(unavailable("INVALID_MONTH"));
    };
    if bounds.start < pkg.valid_from || pkg.valid_to.as_ref().is_some_and(|to| bounds.end > *to) {
        return Ok(unavailable("OUTSIDE_VALIDITY"));
    }
    for (flag, reason) in [
        ("drkApplicabilityConfirmed", "DRK_APPLICABILITY_UNCONFIRMED"),
        ("annexAssignmentConfirmed", "ANNEX_ASSIGNMENT_UNCONFIRMED"),
        ("payGroupAndStepConfirmed", "GROUP_OR_STAGE_UNCONFIRMED"),
    ] {
        if !truthy(&input[flag]) {
            return Ok(unavailable(reason));
        }
    }
    if !truthy(&input["weeklyTimeBasisConfirmed"])
        || input
            .get("contractedWeeklyMinutes")
            .is_some_and(Value::is_null)
        || input
            .get("fullTimeWeeklyMinutes")
            .is_some_and(Value::is_null)
    {
        return Ok(unavailable("WEEKLY_TIME_BASIS_UNCONFIRMED"));
    }
    if !truthy(&input["fullMonthBaseEntitlementConfirmed"]) {
        return Ok(unavailable("FULL_MONTH_ENTITLEMENT_UNCONFIRMED"));
    }
    let weekly = input["contractedWeeklyMinutes"].as_f64();
    let full = input["fullTimeWeeklyMinutes"].as_f64();
    let (Some(weekly), Some(full)) = (weekly, full) else {
        return Ok(unavailable("INVALID_WEEKLY_TIME"));
    };
    if !safe(weekly)
        || !safe(full)
        || weekly <= 0.0
        || full <= 0.0
        || weekly > full
        || full > 10080.0
    {
        return Ok(unavailable("INVALID_WEEKLY_TIME"));
    }
    let variant = input["variantId"].as_str().unwrap_or("");
    let selected = resolve_tariff_selection(pkg, variant, "BTG");
    if variant != variant_id
        || selected.as_ref().is_none_or(|s| {
            s.family_id != "drk-rtv"
                || s.engine_id != engine_id
                || s.employment_kind != "EMPLOYEE"
                || s.region["payTableId"] != table_id
                || s.capabilities
                    .as_object()
                    .is_none_or(|c| c.values().any(|v| v != "UNSUPPORTED"))
        })
    {
        return Ok(unavailable("UNKNOWN_SELECTION"));
    }
    let group = input["groupId"].as_str().unwrap_or("").to_lowercase();
    let step = &input["stepId"];
    let table = pkg.rules()["payTables"]
        .as_array()
        .and_then(|t| t.iter().find(|t| t["id"] == table_id));
    let entries: Vec<_> = table
        .and_then(|t| t["entries"].as_array())
        .into_iter()
        .flatten()
        .filter(|e| e["groupId"] == group && &e["stepId"] == step)
        .collect();
    if entries.len() != 1 {
        return Ok(unavailable("MISSING_TABLE_VALUE"));
    }
    let amount = entries[0]["monthlyCents"]
        .as_f64()
        .ok_or(ContextError::InvalidRule)?;
    let numerator = amount * weekly;
    if !safe(numerator) {
        return Ok(unavailable("AMOUNT_OVERFLOW"));
    }
    let personal =
        round_remuneration_cents(numerator, full).map_err(|_| ContextError::InvalidRule)?;
    Ok(
        json!({"kind":"draft-personal-table-base","completeGross":false,"fullTimeTableCents":entries[0]["monthlyCents"],"personalTableBaseCents":personal,"contractedWeeklyMinutes":weekly as i64,"fullTimeWeeklyMinutes":full as i64,"packageId":pkg.package_id,"versionId":pkg.version_id,"tableId":table_id,"groupId":group,"stepId":step,"sourceIds":table.expect("matched table")["sourceIds"],"excludedComponents":["PARTIAL_MONTH","TIME_PREMIUMS","ALLOWANCES","OVERTIME","ANNUAL_PAYMENT","READINESS_AND_ON_CALL"]}),
    )
}
pub fn calculate_training_table_base(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, ContextError> {
    if pkg.package_id != "drk-rtv-training"
        || pkg.engine_contract_version != 17
        || !validator.validate(pkg)?
    {
        return Ok(unavailable("INVALID_PACKAGE"));
    }
    let Some(bounds) = input["month"].as_str().and_then(month_bounds) else {
        return Ok(unavailable("INVALID_MONTH"));
    };
    if bounds.start < pkg.valid_from || pkg.valid_to.as_ref().is_some_and(|to| bounds.end > *to) {
        return Ok(unavailable("OUTSIDE_VALIDITY"));
    }
    for (flag, reason) in [
        ("drkApplicabilityConfirmed", "DRK_APPLICABILITY_UNCONFIRMED"),
        ("trainingCategoryConfirmed", "TRAINING_CATEGORY_UNCONFIRMED"),
    ] {
        if !truthy(&input[flag]) {
            return Ok(unavailable(reason));
        }
    }
    if !truthy(&input["trainingYearConfirmed"])
        || input.get("trainingYear").is_some_and(Value::is_null)
    {
        return Ok(unavailable("TRAINING_YEAR_UNCONFIRMED"));
    }
    for (flag, reason) in [
        (
            "fullMonthBaseEntitlementConfirmed",
            "FULL_MONTH_ENTITLEMENT_UNCONFIRMED",
        ),
        (
            "fullTimeTrainingConfirmed",
            "NON_FULL_TIME_SEPARATE_CALCULATION",
        ),
    ] {
        if !truthy(&input[flag]) {
            return Ok(unavailable(reason));
        }
    }
    let variant = input["variantId"].as_str().unwrap_or("");
    let category_id = category(variant);
    let selected = resolve_tariff_selection(pkg, variant, "BTG");
    if category_id.is_none()
        || selected.as_ref().is_none_or(|s| {
            s.family_id != "drk-rtv"
                || s.engine_id != "drk-rtv-training-v1"
                || s.employment_kind != "APPRENTICE"
                || s.region["payTableId"] != "training"
                || s.capabilities
                    .as_object()
                    .is_none_or(|c| c.values().any(|v| v != "UNSUPPORTED"))
        })
    {
        return Ok(unavailable("UNKNOWN_SELECTION"));
    }
    let year = input["trainingYear"].as_f64();
    if !year.is_some_and(|n| safe(n) && (1.0..=4.0).contains(&n)) {
        return Ok(unavailable("INVALID_TRAINING_YEAR"));
    }
    let year = year.expect("checked year") as i64;
    let step = format!("s{year}");
    let table = pkg.rules()["payTables"]
        .as_array()
        .and_then(|t| t.iter().find(|t| t["id"] == "training"));
    let category_id = category_id.expect("checked category");
    let entries: Vec<_> = table
        .and_then(|t| t["entries"].as_array())
        .into_iter()
        .flatten()
        .filter(|e| e["groupId"] == category_id && e["stepId"] == step)
        .collect();
    if entries.len() != 1 {
        return Ok(unavailable("MISSING_TABLE_VALUE"));
    }
    Ok(
        json!({"kind":"draft-full-month-training-table-base","completeGross":false,"monthlyCents":entries[0]["monthlyCents"],"packageId":"drk-rtv-training","versionId":pkg.version_id,"tableId":"training","variantId":variant,"categoryId":category_id,"trainingYear":year,"sourceIds":table.expect("matched table")["sourceIds"],"excludedComponents":["PARTIAL_MONTH","PART_TIME","TIME_PREMIUMS","ALLOWANCES","OVERTIME","ANNUAL_PAYMENT"]}),
    )
}
