use super::*;
pub fn lookup_rule(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    if pkg.engine_contract_version != 14 || !validator.validate(pkg)? {
        return Ok(unavailable("INVALID_PACKAGE"));
    }
    let Some(year) = year(&input["entitlementYear"]).filter(|y| in_year(pkg, *y)) else {
        return Ok(unavailable("OUTSIDE_ENTITLEMENT_YEAR"));
    };
    let Some(selection) = selection(pkg, input) else {
        return Ok(unavailable("UNKNOWN_SELECTION"));
    };
    let table = rows(pkg.rules(), "payTables")
        .iter()
        .find(|t| t["id"] == selection["payTableId"]);
    if table.is_none_or(|t| {
        !rows(t, "entries")
            .iter()
            .any(|r| r["groupId"] == input["groupIdAtSeptember1"])
    }) {
        return Ok(unavailable("UNKNOWN_PAY_GROUP"));
    }
    let matches: Vec<_> = rows(pkg.rules(), "caritasAnnualPaymentRules")
        .iter()
        .filter(|r| {
            r["entitlementYear"].as_f64() == Some(year as f64)
                && r["variantId"] == input["variantId"]
                && r["regionId"] == input["regionId"]
                && rows(r, "payGroups")
                    .iter()
                    .any(|g| *g == input["groupIdAtSeptember1"])
        })
        .collect();
    if matches.len() != 1 {
        return Ok(unavailable("MISSING_ANNUAL_PAYMENT_RULE"));
    }
    let rule = matches[0];
    let basis = rows(&pkg.rules()["selection"], "variants")
        .iter()
        .find(|v| v["id"] == input["variantId"])
        .and_then(|v| {
            rows(v, "regions")
                .iter()
                .find(|r| r["id"] == rule["basisRegionId"])
        })
        .and_then(|r| r.get("payTableId"));
    let Some(basis) = basis else {
        return Ok(unavailable("INVALID_PACKAGE"));
    };
    let mut result = rule.clone();
    result["kind"] = json!("source-annual-payment-rule");
    result["packageId"] = json!(pkg.package_id);
    result["versionId"] = json!(pkg.version_id);
    result["basisPayTableId"] = basis.clone();
    result["referenceMonths"] = json!([7, 8, 9]);
    result["draft"] = json!(true);
    result["completeGross"] = json!(false);
    Ok(result)
}
