use super::*;
pub fn late_basis(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    for (key, expected, reason) in [
        (
            "referenceCase",
            json!("LATE_ENTRY"),
            "UNSUPPORTED_REFERENCE_CASE",
        ),
        (
            "lateEntryReferencePeriodConfirmed",
            json!(true),
            "REFERENCE_CASE_UNCONFIRMED",
        ),
        (
            "employmentStartConfirmed",
            json!(true),
            "EMPLOYMENT_START_UNCONFIRMED",
        ),
        (
            "sameEmploymentConfirmed",
            json!(true),
            "EMPLOYMENT_IDENTITY_UNCONFIRMED",
        ),
    ] {
        if input[key] != expected {
            return Ok(unavailable(reason));
        }
    }
    if pkg.engine_contract_version != 14 || !validator.validate(pkg)? {
        return Ok(unavailable("INVALID_PACKAGE"));
    }
    let Some(year) = year(&input["entitlementYear"]).filter(|y| in_year(pkg, *y)) else {
        return Ok(unavailable("OUTSIDE_ENTITLEMENT_YEAR"));
    };
    if selection(pkg, input).is_none() {
        return Ok(unavailable("UNKNOWN_SELECTION"));
    }
    let rules: Vec<_> = rows(pkg.rules(), "caritasAnnualPaymentRules")
        .iter()
        .filter(|r| {
            r["entitlementYear"].as_f64() == Some(year as f64)
                && r["variantId"] == input["variantId"]
                && r["regionId"] == input["regionId"]
        })
        .collect();
    let Some(rule) = rules.first() else {
        return Ok(unavailable("MISSING_ANNUAL_PAYMENT_RULE"));
    };
    let table = rows(&pkg.rules()["selection"], "variants")
        .iter()
        .find(|v| v["id"] == input["variantId"])
        .and_then(|v| {
            rows(v, "regions")
                .iter()
                .find(|r| r["id"] == rule["basisRegionId"])
        })
        .and_then(|r| r.get("payTableId"));
    let Some(table) = table.filter(|_| {
        !rules.iter().any(|r| {
            ["basisRegionId", "basisPolicy", "basisTablePolicy"]
                .iter()
                .any(|k| r[*k] != rule[*k])
        })
    }) else {
        return Ok(unavailable("INVALID_PACKAGE"));
    };
    let start = input["employmentStartDate"].as_str().unwrap_or("");
    let Ok(date) = crate::calendar::parse_date(start) else {
        return Ok(unavailable("INVALID_EMPLOYMENT_START"));
    };
    if i32::from(date.year()) != year {
        return Ok(unavailable("INVALID_EMPLOYMENT_START"));
    }
    if date.month() <= 9 {
        return Ok(unavailable("NOT_LATE_ENTRY"));
    }
    let first_month = date.month() + i8::from(date.day() != 1);
    if first_month > 12 {
        return Ok(unavailable("FIRST_FULL_MONTH_OUTSIDE_YEAR"));
    }
    let expected = format!("{year}-{first_month:02}");
    let paid = &input["firstFullMonth"];
    if paid["month"] != expected {
        return Ok(unavailable("INVALID_REFERENCE_MONTH"));
    }
    let days = month_bounds(year, first_month).2;
    if format!("{expected}-01") < pkg.valid_from
        || pkg
            .valid_to
            .as_ref()
            .is_some_and(|to| format!("{expected}-{days:02}") > *to)
    {
        return Ok(unavailable("REFERENCE_MONTH_OUTSIDE_PACKAGE"));
    }
    if paid["fullCalendarMonthEntgeltConfirmed"] != true {
        return Ok(unavailable("REFERENCE_MONTH_INCOMPLETE"));
    }
    if paid["section16BasisConfirmed"] != true {
        return Ok(unavailable("MONTH_BASIS_UNCONFIRMED"));
    }
    if paid["basisRegionId"] != rule["basisRegionId"] || paid["basisPayTableId"] != *table {
        return Ok(unavailable("BASIS_IDENTITY_MISMATCH"));
    }
    let Some(amount) = integer(&paid["personalPaidBasisCents"], 1, MAX_SAFE_INTEGER) else {
        return Ok(unavailable("INVALID_MONTH_BASIS"));
    };
    let mut source_ids = Vec::new();
    for rule in &rules {
        for source in rows(rule, "sourceIds") {
            if !source_ids.contains(source) {
                source_ids.push(source.clone());
            }
        }
    }
    Ok(
        json!({"kind":"personal-annual-payment-late-entry-basis","draft":true,"completeGross":false,"entitlementYear":year,"referenceCase":"LATE_ENTRY","lateEntryReferencePeriodConfirmed":true,"employmentStartDate":start,"employmentStartConfirmed":true,"sameEmploymentConfirmed":true,"firstFullMonth":{"month":paid["month"],"personalPaidBasisCents":amount,"basisRegionId":paid["basisRegionId"],"basisPayTableId":paid["basisPayTableId"],"fullCalendarMonthEntgeltConfirmed":true,"section16BasisConfirmed":true},"meanMonthlyBasis":{"numeratorCents":amount,"denominator":1},"sourceBasis":{"packageId":pkg.package_id,"versionId":pkg.version_id,"entitlementYear":year,"variantId":input["variantId"],"regionId":input["regionId"],"basisRegionId":rule["basisRegionId"],"basisPayTableId":table,"basisPolicy":rule["basisPolicy"],"basisTablePolicy":rule["basisTablePolicy"],"basisRuleIds":rules.iter().map(|r|&r["id"]).collect::<Vec<_>>(),"sourceIds":source_ids}}),
    )
}
pub fn late_assessment(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    if input["parentalLeavePartTimeBasis"] != "NOT_APPLICABLE" {
        return Ok(unavailable("UNSUPPORTED_SPECIAL_BASIS"));
    }
    let basis = late_basis(pkg, input, validator)?;
    if bad(&basis) {
        return Ok(basis);
    }
    let entitlement = assess_entitlement(pkg, input, validator)?;
    if bad(&entitlement) {
        return Ok(entitlement);
    }
    if entitlement["eligibility"]["eligible"] != true
        || entitlement["eligibility"]["reason"] != "EMPLOYED_ON_DECEMBER_1"
    {
        return Ok(unavailable("UNSUPPORTED_EMPLOYMENT_PERIOD"));
    }
    let month = basis["firstFullMonth"]["month"].as_str().unwrap();
    let year = year(&input["entitlementYear"]).unwrap();
    let number = month[5..7].parse::<i8>().unwrap();
    let days = month_bounds(year, number).2;
    if rows(&entitlement, "months")
        .iter()
        .find(|f| f["month"] == month)
        .is_none_or(|f| {
            f["entgeltOrContinuationDays"].as_f64() != Some(days as f64)
                || f["reductionException"]["kind"] != "NONE"
        })
    {
        return Ok(unavailable("REFERENCE_MONTH_FACTS_MISMATCH"));
    }
    Ok(
        json!({"kind":"personal-annual-payment-late-entry-assessment","draft":true,"completeGross":false,"entitlementYear":year,"basis":basis,"entitlement":entitlement,"parentalLeavePartTimeBasis":"NOT_APPLICABLE","annualAmount":{"kind":"unavailable","reason":"LATE_ENTRY_RATE_REFERENCE_UNRESOLVED"}}),
    )
}
