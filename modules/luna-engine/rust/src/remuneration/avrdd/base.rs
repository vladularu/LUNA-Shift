use super::*;
pub fn base(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    if pkg.engine_contract_version != 15 || !validator.validate(pkg)? {
        return Ok(unavailable("INVALID_PACKAGE"));
    }
    let Some(date) = input["date"].as_str().filter(|d| real_date(d)) else {
        return Ok(unavailable("INVALID_DATE"));
    };
    if date < pkg.valid_from.as_str() || pkg.valid_to.as_deref().is_some_and(|to| date > to) {
        return Ok(unavailable("OUTSIDE_VALIDITY"));
    }
    if !js_truthy(&input["avrddApplicabilityConfirmed"]) {
        return Ok(unavailable("AVRDD_APPLICABILITY_UNCONFIRMED"));
    }
    if !js_truthy(&input["fullMonthBaseEntitlementConfirmed"]) {
        return Ok(unavailable("FULL_MONTH_ENTITLEMENT_UNCONFIRMED"));
    }
    if input["contractTimeMode"] == "UNKNOWN" {
        return Ok(unavailable("CONTRACT_TIME_UNKNOWN"));
    }
    if input["contractTimeMode"] == "INDIVIDUAL_FULL_TIME_CORRIDOR" {
        return Ok(unavailable("CORRIDOR_SEPARATE_CALCULATION_REQUIRED"));
    }
    let Some(weekly) = weekly(pkg, input) else {
        return Ok(unavailable("INVALID_WEEKLY_TIME"));
    };
    let Some(selection) =
        selected(pkg, "ANLAGE_1", "AVR_DD").filter(|s| s.region.get("payTableId").is_some())
    else {
        return Ok(unavailable("UNKNOWN_SELECTION"));
    };
    let table = rows(pkg.rules(), "payTables")
        .iter()
        .find(|t| t["id"] == selection.region["payTableId"]);
    let group = input["groupId"]
        .as_str()
        .ok_or(BaseError::InvalidCalculation)?
        .to_lowercase();
    let matches: Vec<_> = table
        .map_or(&[][..], |t| rows(t, "entries"))
        .iter()
        .filter(|e| e["groupId"] == group && e["stepId"] == input["stepId"])
        .collect();
    if matches.len() != 1 {
        return Ok(unavailable("MISSING_TABLE_VALUE"));
    }
    let table = table.expect("matching entry");
    let amount = matches[0]["monthlyCents"]
        .as_f64()
        .ok_or(BaseError::InvalidCalculation)?;
    let numerator = amount * weekly;
    if !safe(numerator) {
        return Ok(unavailable("AMOUNT_OVERFLOW"));
    }
    let mut sources = Vec::<&Value>::new();
    for s in rows(table, "sourceIds")
        .iter()
        .chain(rows(&pkg.rules()["avrddStagePolicy"], "sourceIds"))
    {
        if !sources.contains(&s) {
            sources.push(s);
        }
    }
    Ok(
        json!({"kind":"draft-personal-table-base","completeGross":false,"fullTimeTableCents":amount as i64,"personalTableBaseCents":round_remuneration_cents(numerator,2340.0)?,"contractedWeeklyMinutes":weekly as i64,"standardFullTimeWeeklyMinutes":2340,"packageId":pkg.package_id,"versionId":pkg.version_id,"tableId":table["id"],"groupId":group,"stepId":input["stepId"],"sourceIds":sources,"excludedComponents":["TIME_PREMIUMS","ALLOWANCES","OVERTIME","ANNUAL_PAYMENT","OTHER_LOCAL_TERMS"]}),
    )
}
