use super::*;
pub fn components(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    let month = input["month"].as_str().unwrap_or("");
    let Ok(parsed) = crate::input::calendar::require_local_month(&input["month"]) else {
        return Ok(unavailable("INVALID_MONTH"));
    };
    let first = format!("{parsed}-01");
    let day = crate::calendar::parse_date(&first).map_err(|_| BaseError::InvalidCalculation)?;
    let last = format!("{parsed}-{:02}", day.days_in_month());
    if input["fullMonthEmploymentConfirmed"] != true {
        return Ok(unavailable("PARTIAL_EMPLOYMENT"));
    }
    if input["fullMonthlyBaseEntitlementConfirmed"] != true {
        return Ok(unavailable("BASE_ENTITLEMENT_UNCONFIRMED"));
    }
    for key in ["fixedAllowanceEntitlement", "careAllowanceEntitlement"] {
        if input[key] != "CONFIRMED" && input[key] != "NOT_ENTITLED" {
            return Ok(unavailable("ENTITLEMENT_UNCONFIRMED"));
        }
    }
    if pkg.status() != Some("DRAFT") || !validator.validate(pkg)? {
        return Ok(unavailable("INVALID_PACKAGE"));
    }
    if first < pkg.valid_from || pkg.valid_to.as_ref().is_some_and(|to| last > *to) {
        return Ok(unavailable("OUTSIDE_VALIDITY"));
    }
    let changes = |rule: &Value| {
        rule["variantId"] == input["variantId"]
            && rule["regionId"] == input["regionId"]
            && (rule["validFrom"]
                .as_str()
                .is_some_and(|s| s > first.as_str() && s <= last.as_str())
                || rule["validTo"]
                    .as_str()
                    .is_some_and(|s| s >= first.as_str() && s < last.as_str()))
    };
    if rows(pkg.rules(), "employmentWorkingTimeRules")
        .iter()
        .any(changes)
        || [
            ("fixedAllowanceEntitlement", "SECTION_12_3"),
            ("careAllowanceEntitlement", "SECTION_12_4"),
        ]
        .iter()
        .any(|(key, provision)| {
            input[*key] == "CONFIRMED"
                && rows(pkg.rules(), "caritasCareAllowanceRates")
                    .iter()
                    .any(|rate| rate["provisionId"] == *provision && changes(rate))
        })
    {
        return Ok(unavailable("MID_MONTH_RULE_CHANGE"));
    }
    let mut args = arguments(input, None);
    args["date"] = json!(first);
    let basis = personal_base::calculate(pkg, &args, validator)?;
    if bad(&basis) {
        return Ok(component(basis, "table-base", None));
    }
    let mut positions = vec![
        json!({"component":"table-base","amountCents":basis["personalMonthlyCents"],"sourceIds":basis["sourceIds"]}),
    ];
    for (key, provision, name) in [
        (
            "fixedAllowanceEntitlement",
            "SECTION_12_3",
            "care-allowance-12-3",
        ),
        (
            "careAllowanceEntitlement",
            "SECTION_12_4",
            "care-allowance-12-4",
        ),
    ] {
        if input[key] == "NOT_ENTITLED" {
            continue;
        }
        args["provisionId"] = json!(provision);
        args["entitlement"] = input[key].clone();
        let allowance = personal_allowances::care(pkg, &args, validator)?;
        if bad(&allowance) {
            return Ok(component(allowance, name, None));
        }
        positions.push(json!({"component":name,"amountCents":allowance["personalMonthlyCents"],"sourceIds":source_ids(&allowance["rateSourceIds"],&allowance["basisSourceIds"])}));
    }
    let Some(total) = position_sum(&positions) else {
        return Ok(unavailable("AMOUNT_OVERFLOW"));
    };
    Ok(
        json!({"kind":"draft-known-monthly-components","completeGross":false,"knownSubtotalCents":total,"packageId":pkg.package_id,"versionId":pkg.version_id,"month":month,"excludedComponents":["SHIFT_ALLOWANCES","TIME_PREMIUMS","OVERTIME","ANNUAL_PAYMENT","OTHER_LOCAL_TERMS"],"positions":positions}),
    )
}
pub(super) fn shift(
    pkg: &RulePackage,
    input: &Value,
    base: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    let mut args = arguments(input, None);
    args["allowanceType"] = input["shiftAllowanceType"].clone();
    args["entitlement"] = input["shiftEntitlement"].clone();
    let shift = personal_allowances::monthly_shift(pkg, &args, validator)?;
    if bad(&shift) {
        return Ok(component(shift, "monthly-shift-allowance", None));
    }
    let Some(total) = safe(
        base["knownSubtotalCents"].as_f64().unwrap()
            + shift["personalMonthlyCents"].as_f64().unwrap(),
    ) else {
        return Ok(unavailable("AMOUNT_OVERFLOW"));
    };
    let mut positions = rows(base, "positions").to_vec();
    positions.push(json!({"component":"monthly-shift-allowance","allowanceType":shift["allowanceType"],"amountCents":shift["personalMonthlyCents"],"sourceIds":source_ids(&shift["rateSourceIds"],&shift["workingTimeSourceIds"]),"rateSourceIds":shift["rateSourceIds"],"workingTimeSourceIds":shift["workingTimeSourceIds"]}));
    Ok(result(
        base,
        "draft-known-monthly-components-with-shift",
        total,
        positions,
        ["OTHER_SHIFT_ALLOWANCES", "TIME_PREMIUMS", "OVERTIME"],
    ))
}
