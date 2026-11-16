use super::*;
pub fn partial_basis(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    if input["referenceCase"] != "PARTIAL_MONTHS" && input["referenceCase"] != "SICK_PAY_SUPPLEMENT"
    {
        return Ok(unavailable("UNSUPPORTED_REFERENCE_CASE"));
    }
    if input["partialReferencePeriodConfirmed"] != true {
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
    for month in [7, 8, 9] {
        let expected = format!("{year}-{month:02}");
        let Some(item) = raw.iter().find(|m| m["month"] == expected) else {
            return Ok(unavailable("INVALID_REFERENCE_MONTHS"));
        };
        ordered.push(item);
    }
    let (mut paid_total, mut entgelt, mut sick, mut no_entgelt) = (0i64, 0i64, 0i64, 0i64);
    let mut paid_months = Vec::new();
    for (index, item) in ordered.into_iter().enumerate() {
        if item["calendarDayBreakdownConfirmed"] != true {
            return Ok(unavailable("CALENDAR_DAYS_UNCONFIRMED"));
        }
        if item["section16BasisConfirmed"] != true {
            return Ok(unavailable("MONTH_BASIS_UNCONFIRMED"));
        }
        if item["basisRegionId"] != annual["basisRegionId"]
            || item["basisPayTableId"] != annual["basisPayTableId"]
        {
            return Ok(unavailable("BASIS_IDENTITY_MISMATCH"));
        }
        let days = if index == 2 { 30 } else { 31 };
        let counts = [
            integer(&item["entgeltCalendarDays"], 0, days),
            integer(&item["sickPaySupplementCalendarDays"], 0, days),
            integer(&item["noEntgeltCalendarDays"], 0, days),
        ];
        let [Some(e), Some(s), Some(n)] = counts else {
            return Ok(unavailable("INVALID_CALENDAR_DAYS"));
        };
        if e + s + n != days {
            return Ok(unavailable("INVALID_CALENDAR_DAYS"));
        }
        let Some(amount) = integer(&item["personalPaidBasisCents"], 0, MAX_SAFE_INTEGER)
            .filter(|a| if e == 0 { *a == 0 } else { *a > 0 })
        else {
            return Ok(unavailable("INVALID_MONTH_BASIS"));
        };
        if paid_total > MAX_SAFE_INTEGER - amount {
            return Ok(unavailable("AMOUNT_OVERFLOW"));
        }
        paid_total += amount;
        entgelt += e;
        sick += s;
        no_entgelt += n;
        paid_months.push(json!({"month":item["month"],"personalPaidBasisCents":amount,"basisRegionId":item["basisRegionId"],"basisPayTableId":item["basisPayTableId"],"entgeltCalendarDays":e,"sickPaySupplementCalendarDays":s,"noEntgeltCalendarDays":n,"calendarDayBreakdownConfirmed":true,"section16BasisConfirmed":true}));
    }
    if entgelt == 92
        || (input["referenceCase"] == "PARTIAL_MONTHS" && sick != 0)
        || (input["referenceCase"] == "SICK_PAY_SUPPLEMENT" && sick == 0)
    {
        return Ok(unavailable("REFERENCE_CASE_MISMATCH"));
    }
    if entgelt < 30 {
        return Ok(unavailable("FALLBACK_REFERENCE_MONTH_REQUIRED"));
    }
    let mut denominator = entgelt * 100;
    let amount_divisor = gcd(paid_total, denominator);
    let reduced_amount = paid_total / amount_divisor;
    denominator /= amount_divisor;
    let factor_divisor = gcd(3067, denominator);
    let reduced_factor = 3067 / factor_divisor;
    denominator /= factor_divisor;
    let numerator = i128::from(reduced_amount) * i128::from(reduced_factor);
    if numerator > i128::from(MAX_SAFE_INTEGER) {
        return Ok(unavailable("AMOUNT_OVERFLOW"));
    }
    Ok(
        json!({"kind":"personal-annual-payment-partial-basis","draft":true,"completeGross":false,"entitlementYear":year,"groupIdAtSeptember1":input["groupIdAtSeptember1"],"groupReferenceDate":format!("{year}-09-01"),"septemberGroupConfirmed":true,"referenceCase":input["referenceCase"],"partialReferencePeriodConfirmed":true,"paidMonths":paid_months,"paidBasisTotalCents":paid_total,"entgeltCalendarDays":entgelt,"excludedSickPaySupplementCalendarDays":sick,"noEntgeltCalendarDays":no_entgelt,"normalizationFactor":{"numerator":3067,"denominator":100},"meanMonthlyBasis":{"numeratorCents":numerator as i64,"denominator":denominator},"annualRule":annual}),
    )
}
fn gcd(mut a: i64, mut b: i64) -> i64 {
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a
}
pub fn partial_amount(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    if input["parentalLeavePartTimeBasis"] != "NOT_APPLICABLE" {
        return Ok(unavailable("UNSUPPORTED_SPECIAL_BASIS"));
    }
    let basis = partial_basis(pkg, input, validator)?;
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
        .is_none_or(|s| s > format!("{year}-09-01").as_str())
        || entitlement["eligibility"]["eligible"] != true
        || entitlement["eligibility"]["reason"] != "EMPLOYED_ON_DECEMBER_1"
    {
        return Ok(unavailable("UNSUPPORTED_EMPLOYMENT_PERIOD"));
    }
    if !reference_facts_match(rows(&basis, "paidMonths"), &entitlement, year) {
        return Ok(unavailable("REFERENCE_MONTH_FACTS_MISMATCH"));
    }
    finish_amount(
        pkg,
        input,
        basis,
        entitlement,
        "personal-annual-payment-partial-amount",
    )
}
pub(super) fn reference_facts_match(reference: &[Value], entitlement: &Value, year: i32) -> bool {
    let start = utc_day(&entitlement["employmentStartDate"]).unwrap();
    let end = if entitlement["employmentEndDate"].is_null() {
        i64::MAX
    } else {
        utc_day(&entitlement["employmentEndDate"]).unwrap()
    };
    reference.iter().enumerate().all(|(index, month)| {
        let Some(facts) = rows(entitlement, "months")
            .iter()
            .find(|f| f["month"] == month["month"])
        else {
            return false;
        };
        let (first, last, _) = month_bounds(year, index as i8 + 7);
        let employment_days = (last.min(end) - first.max(start) + 1).max(0);
        let entgelt = month["entgeltCalendarDays"].as_i64().unwrap();
        let sick = month["sickPaySupplementCalendarDays"].as_i64().unwrap();
        facts["entgeltOrContinuationDays"].as_f64() == Some(entgelt as f64)
            && entgelt + sick <= employment_days
            && !(entgelt == 0
                && ((sick > 0 && facts["reductionException"]["kind"] != "SICK_PAY_SUPPLEMENT")
                    || (sick == 0 && facts["reductionException"]["kind"] == "SICK_PAY_SUPPLEMENT")))
    })
}
