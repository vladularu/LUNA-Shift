use super::*;
pub fn fallback_basis(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    if input["referenceCase"] != "PARTIAL_MONTHS" && input["referenceCase"] != "SICK_PAY_SUPPLEMENT"
    {
        return Ok(unavailable("UNSUPPORTED_REFERENCE_CASE"));
    }
    let reference = partial_basis(pkg, input, validator)?;
    if !bad(&reference) {
        return Ok(unavailable("FALLBACK_NOT_REQUIRED"));
    }
    if reference["reason"] != "FALLBACK_REFERENCE_MONTH_REQUIRED" {
        return Ok(reference);
    }
    let annual = lookup_rule(pkg, input, validator)?;
    if bad(&annual) {
        return Ok(annual);
    }
    let year = year(&input["entitlementYear"]).unwrap();
    let replacement = &input["replacementMonth"];
    let month = replacement["month"].as_str().unwrap_or("");
    if crate::input::calendar::require_local_month(&replacement["month"]).is_err()
        || !month[..4].parse::<i32>().is_ok_and(|y| y >= 1900)
        || month >= format!("{year}-07").as_str()
    {
        return Ok(unavailable("INVALID_REPLACEMENT_MONTH"));
    }
    for (key, reason) in [
        (
            "fullCalendarMonthEntgeltConfirmed",
            "REPLACEMENT_FULL_MONTH_UNCONFIRMED",
        ),
        (
            "historicalSection16BasisConfirmed",
            "HISTORICAL_BASIS_UNCONFIRMED",
        ),
        ("sameEmploymentConfirmed", "EMPLOYMENT_IDENTITY_UNCONFIRMED"),
        (
            "lastApplicableFullMonthConfirmed",
            "LAST_FULL_MONTH_UNCONFIRMED",
        ),
    ] {
        if replacement[key] != true {
            return Ok(unavailable(reason));
        }
    }
    if replacement["basisRegionId"] != annual["basisRegionId"] {
        return Ok(unavailable("BASIS_IDENTITY_MISMATCH"));
    }
    let Some(amount) = integer(
        &replacement["personalMonthlyBasisCents"],
        1,
        MAX_SAFE_INTEGER,
    ) else {
        return Ok(unavailable("INVALID_MONTH_BASIS"));
    };
    let mut reference_months: Vec<Value> = rows(input, "paidMonths")
        .iter()
        .map(|m| {
            let mut r = serde_json::Map::new();
            for k in [
                "month",
                "personalPaidBasisCents",
                "basisRegionId",
                "basisPayTableId",
                "entgeltCalendarDays",
                "sickPaySupplementCalendarDays",
                "noEntgeltCalendarDays",
            ] {
                r.insert(k.to_owned(), m[k].clone());
            }
            r.insert("calendarDayBreakdownConfirmed".into(), json!(true));
            r.insert("section16BasisConfirmed".into(), json!(true));
            Value::Object(r)
        })
        .collect();
    reference_months.sort_by(|a, b| a["month"].as_str().cmp(&b["month"].as_str()));
    let sum = |key: &str| {
        reference_months
            .iter()
            .map(|m| integer(&m[key], 0, MAX_SAFE_INTEGER).unwrap())
            .sum::<i64>()
    };
    let entgelt = sum("entgeltCalendarDays");
    let sick = sum("sickPaySupplementCalendarDays");
    let paid = sum("personalPaidBasisCents");
    Ok(
        json!({"kind":"personal-annual-payment-fallback-basis","draft":true,"completeGross":false,"entitlementYear":year,"groupIdAtSeptember1":input["groupIdAtSeptember1"],"groupReferenceDate":format!("{year}-09-01"),"septemberGroupConfirmed":true,"referenceCase":input["referenceCase"],"partialReferencePeriodConfirmed":true,"referenceMonths":reference_months,"referenceEntgeltCalendarDays":entgelt,"referenceExcludedSickPaySupplementCalendarDays":sick,"referencePaidBasisTotalCents":paid,"replacementMonth":{"month":month,"personalMonthlyBasisCents":amount,"basisRegionId":replacement["basisRegionId"],"fullCalendarMonthEntgeltConfirmed":true,"historicalSection16BasisConfirmed":true,"sameEmploymentConfirmed":true,"lastApplicableFullMonthConfirmed":true},"meanMonthlyBasis":{"numeratorCents":amount,"denominator":1},"annualRule":annual}),
    )
}
pub fn fallback_amount(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    if input["parentalLeavePartTimeBasis"] != "NOT_APPLICABLE" {
        return Ok(unavailable("UNSUPPORTED_SPECIAL_BASIS"));
    }
    let basis = fallback_basis(pkg, input, validator)?;
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
    let start = utc_day(&entitlement["employmentStartDate"]).unwrap();
    let end = if entitlement["employmentEndDate"].is_null() {
        i64::MAX
    } else {
        utc_day(&entitlement["employmentEndDate"]).unwrap()
    };
    let replacement = &basis["replacementMonth"];
    let month = replacement["month"].as_str().unwrap();
    let replacement_year = month[..4].parse::<i32>().unwrap();
    let number = month[5..7].parse::<i8>().unwrap();
    let (first, last, days) = month_bounds(replacement_year, number);
    if first < start || last > end {
        return Ok(unavailable("REPLACEMENT_OUTSIDE_EMPLOYMENT"));
    }
    let year = year(&input["entitlementYear"]).unwrap();
    if replacement_year == year
        && rows(&entitlement, "months")
            .iter()
            .find(|f| f["month"] == month)
            .is_none_or(|f| f["entgeltOrContinuationDays"].as_f64() != Some(days as f64))
    {
        return Ok(unavailable("REPLACEMENT_MONTH_FACTS_MISMATCH"));
    }
    for (index, facts) in rows(&entitlement, "months").iter().enumerate() {
        let on = facts["month"].as_str().unwrap();
        if on > month
            && on < format!("{year}-07").as_str()
            && facts["entgeltOrContinuationDays"].as_f64()
                == Some(month_bounds(year, index as i8 + 1).2 as f64)
        {
            return Ok(unavailable("REPLACEMENT_MONTH_FACTS_MISMATCH"));
        }
    }
    if !partial::reference_facts_match(rows(&basis, "referenceMonths"), &entitlement, year) {
        return Ok(unavailable("REFERENCE_MONTH_FACTS_MISMATCH"));
    }
    finish_amount(
        pkg,
        input,
        basis,
        entitlement,
        "personal-annual-payment-fallback-amount",
    )
}
