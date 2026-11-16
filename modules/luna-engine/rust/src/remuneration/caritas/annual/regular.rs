use super::*;
pub fn regular_basis(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    if input["referenceCase"] != "ORDINARY_FULL_MONTHS" {
        return Ok(unavailable("UNSUPPORTED_REFERENCE_CASE"));
    }
    if input["ordinaryReferencePeriodConfirmed"] != true {
        return Ok(unavailable("REFERENCE_CASE_UNCONFIRMED"));
    }
    if input["septemberGroupConfirmed"] != true {
        return Ok(unavailable("REFERENCE_GROUP_UNCONFIRMED"));
    }
    let annual = lookup_rule(pkg, input, validator)?;
    if bad(&annual) {
        return Ok(annual);
    }
    let Some(raw) = input["paidMonths"].as_array().filter(|r| r.len() == 3) else {
        return Ok(unavailable("INVALID_REFERENCE_MONTHS"));
    };
    let year = year(&input["entitlementYear"]).unwrap();
    let mut ordered = Vec::new();
    for m in [7, 8, 9] {
        let expected = format!("{year}-{m:02}");
        let Some(item) = raw.iter().find(|r| r["month"] == expected) else {
            return Ok(unavailable("INVALID_REFERENCE_MONTHS"));
        };
        ordered.push(item);
    }
    let mut numerator = 0i64;
    let mut paid_months = Vec::new();
    for item in ordered {
        if item["fullCalendarMonthEntgeltConfirmed"] != true {
            return Ok(unavailable("REFERENCE_MONTH_INCOMPLETE"));
        }
        if item["section16BasisConfirmed"] != true {
            return Ok(unavailable("MONTH_BASIS_UNCONFIRMED"));
        }
        if item["basisRegionId"] != annual["basisRegionId"]
            || item["basisPayTableId"] != annual["basisPayTableId"]
        {
            return Ok(unavailable("BASIS_IDENTITY_MISMATCH"));
        }
        let Some(amount) = integer(&item["personalPaidBasisCents"], 1, MAX_SAFE_INTEGER) else {
            return Ok(unavailable("INVALID_MONTH_BASIS"));
        };
        if numerator > MAX_SAFE_INTEGER - amount {
            return Ok(unavailable("AMOUNT_OVERFLOW"));
        }
        numerator += amount;
        paid_months.push(json!({"month":item["month"],"personalPaidBasisCents":amount,"basisRegionId":item["basisRegionId"],"basisPayTableId":item["basisPayTableId"],"fullCalendarMonthEntgeltConfirmed":true,"section16BasisConfirmed":true}));
    }
    Ok(
        json!({"kind":"personal-annual-payment-regular-basis","draft":true,"completeGross":false,"entitlementYear":year,"groupIdAtSeptember1":input["groupIdAtSeptember1"],"groupReferenceDate":format!("{year}-09-01"),"septemberGroupConfirmed":true,"referenceCase":"ORDINARY_FULL_MONTHS","ordinaryReferencePeriodConfirmed":true,"paidMonths":paid_months,"meanMonthlyBasis":{"numeratorCents":numerator,"denominator":3},"annualRule":annual}),
    )
}
pub fn regular_amount(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    if input["parentalLeavePartTimeBasis"] != "NOT_APPLICABLE" {
        return Ok(unavailable("UNSUPPORTED_SPECIAL_BASIS"));
    }
    let basis = regular_basis(pkg, input, validator)?;
    if bad(&basis) {
        return Ok(basis);
    }
    let entitlement = assess_entitlement(pkg, input, validator)?;
    if bad(&entitlement) {
        return Ok(entitlement);
    }
    let year = year(&input["entitlementYear"]).unwrap();
    if entitlement["employmentStartDate"]
        .as_str()
        .is_none_or(|s| s > format!("{year}-07-01").as_str())
        || entitlement["eligibility"]["eligible"] != true
        || entitlement["eligibility"]["reason"] != "EMPLOYED_ON_DECEMBER_1"
    {
        return Ok(unavailable("UNSUPPORTED_EMPLOYMENT_PERIOD"));
    }
    for (index, month) in rows(&basis, "paidMonths").iter().enumerate() {
        let facts = rows(&entitlement, "months")
            .iter()
            .find(|m| m["month"] == month["month"]);
        if facts.is_none_or(|f| {
            f["entgeltOrContinuationDays"].as_f64() != Some([31.0, 31.0, 30.0][index])
                || f["reductionException"]["kind"] != "NONE"
        }) {
            return Ok(unavailable("REFERENCE_MONTH_FACTS_MISMATCH"));
        }
    }
    finish_amount(
        pkg,
        input,
        basis,
        entitlement,
        "personal-annual-payment-regular-amount",
    )
}
