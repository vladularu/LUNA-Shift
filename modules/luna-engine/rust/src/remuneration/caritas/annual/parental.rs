use super::*;
use num_bigint::BigInt;
fn scope(value: &Value) -> Option<(i64, i64)> {
    let n = integer(&value["numerator"], 1, MAX_SAFE_INTEGER)?;
    let d = integer(&value["denominator"], 1, MAX_SAFE_INTEGER)?;
    (n <= d).then_some((n, d))
}
fn period_end(value: &Value) -> Option<i64> {
    if value.get("endDate") == Some(&Value::Null) {
        Some(i64::MAX)
    } else {
        utc_day(&value["endDate"])
    }
}
pub fn parental_amount(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    if input["referenceCase"] != "PARENTAL_LEAVE" {
        return Ok(unavailable("UNSUPPORTED_REFERENCE_CASE"));
    }
    if input["parentalLeavePartTimeBasis"] != "APPLICABLE"
        || input["parentalReferencePeriodConfirmed"] != true
    {
        return Ok(unavailable("SPECIAL_BASIS_UNCONFIRMED"));
    }
    if input["septemberGroupConfirmed"] != true {
        return Ok(unavailable("REFERENCE_GROUP_UNCONFIRMED"));
    }
    let annual = lookup_rule(pkg, input, validator)?;
    if bad(&annual) {
        return Ok(annual);
    }
    let entitlement = assess_entitlement(pkg, input, validator)?;
    if bad(&entitlement) {
        return Ok(entitlement);
    }
    let year = year(&input["entitlementYear"]).unwrap();
    if entitlement["eligibility"]["eligible"] != true
        || entitlement["eligibility"]["reason"] != "EMPLOYED_ON_DECEMBER_1"
        || entitlement["employmentStartDate"].as_str().unwrap() > format!("{year}-07-01").as_str()
    {
        return Ok(unavailable("UNSUPPORTED_EMPLOYMENT_PERIOD"));
    }
    let leave = &input["parentalLeave"];
    if leave["singlePeriodConfirmed"] != true {
        return Ok(unavailable("PARENTAL_PERIOD_UNCONFIRMED"));
    }
    let (birth, start, end) = (
        utc_day(&leave["birthDate"]),
        utc_day(&leave["startDate"]),
        period_end(leave),
    );
    let (Some(birth), Some(start), Some(end)) = (birth, start, end) else {
        return Ok(unavailable("INVALID_PARENTAL_PERIOD"));
    };
    if start < birth || end < start {
        return Ok(unavailable("INVALID_PARENTAL_PERIOD"));
    }
    if !leave["birthDate"]
        .as_str()
        .unwrap()
        .starts_with(&format!("{year}-"))
    {
        return Ok(unavailable("PARENTAL_BIRTH_YEAR_MISMATCH"));
    }
    let employment_start = utc_day(&entitlement["employmentStartDate"]).unwrap();
    let employment_end = if entitlement["employmentEndDate"].is_null() {
        i64::MAX
    } else {
        utc_day(&entitlement["employmentEndDate"]).unwrap()
    };
    let reference_start = month_bounds(year, 7).0;
    let reference_end = month_bounds(year, 9).1;
    if start > reference_start
        || end < reference_end
        || start - 1 < employment_start
        || end > employment_end
    {
        return Ok(unavailable("UNSUPPORTED_PARENTAL_REFERENCE_PERIOD"));
    }
    let before = &input["beforeLeaveScope"];
    if before["historicalScopeConfirmed"] != true || before["sameEmploymentConfirmed"] != true {
        return Ok(unavailable("PRE_LEAVE_SCOPE_UNCONFIRMED"));
    }
    let before_date = jiff::Timestamp::from_millisecond((start - 1) * 86400000)
        .map_err(|_| BaseError::InvalidCalculation)?
        .to_zoned(jiff::tz::TimeZone::UTC)
        .date()
        .to_string();
    if before["referenceDate"] != before_date {
        return Ok(unavailable("PRE_LEAVE_SCOPE_DATE_MISMATCH"));
    }
    let Some((before_n, before_d)) = scope(before) else {
        return Ok(unavailable("INVALID_EMPLOYMENT_SCOPE"));
    };
    let part = &input["referencePartTime"];
    if part["benefitPreservingConfirmed"] != true || part["singleScopePeriodConfirmed"] != true {
        return Ok(unavailable("PART_TIME_UNCONFIRMED"));
    }
    let Some((part_n, part_d)) = scope(part).filter(|(n, d)| n != d) else {
        return Ok(unavailable("INVALID_EMPLOYMENT_SCOPE"));
    };
    let (part_start, part_end) = (utc_day(&part["startDate"]), period_end(part));
    let (Some(part_start), Some(part_end)) = (part_start, part_end) else {
        return Ok(unavailable("INVALID_PART_TIME_PERIOD"));
    };
    if part_end < part_start || part_start < start || part_end > end {
        return Ok(unavailable("INVALID_PART_TIME_PERIOD"));
    }
    if part_start > reference_start || part_end < reference_end {
        return Ok(unavailable("UNSUPPORTED_PARENTAL_REFERENCE_PERIOD"));
    }
    let Some(raw) = input["adjustedMonths"].as_array().filter(|r| r.len() == 3) else {
        return Ok(unavailable("INVALID_REFERENCE_MONTHS"));
    };
    let mut ordered = Vec::new();
    for month in [7, 8, 9] {
        let expected = format!("{year}-{month:02}");
        let Some(item) = raw.iter().find(|m| m["month"] == expected) else {
            return Ok(unavailable("INVALID_REFERENCE_MONTHS"));
        };
        ordered.push(item);
    }
    let mut numerator = 0i64;
    let mut adjusted = Vec::new();
    for (index, item) in ordered.into_iter().enumerate() {
        if item["fullCalendarMonthEntgeltConfirmed"] != true {
            return Ok(unavailable("REFERENCE_MONTH_INCOMPLETE"));
        }
        if item["section16BasisConfirmed"] != true {
            return Ok(unavailable("MONTH_BASIS_UNCONFIRMED"));
        }
        if item["preLeaveScopeAppliedConfirmed"] != true {
            return Ok(unavailable("PRE_LEAVE_MONTH_BASIS_UNCONFIRMED"));
        }
        let Some((n, d)) = scope(&item["preLeaveScope"]).filter(|(n, d)| {
            BigInt::from(*n) * BigInt::from(before_d) == BigInt::from(before_n) * BigInt::from(*d)
        }) else {
            return Ok(unavailable("BASIS_SCOPE_MISMATCH"));
        };
        if item["basisRegionId"] != annual["basisRegionId"]
            || item["basisPayTableId"] != annual["basisPayTableId"]
        {
            return Ok(unavailable("BASIS_IDENTITY_MISMATCH"));
        }
        let Some(amount) = integer(
            &item["personalBasisAtPreLeaveScopeCents"],
            1,
            MAX_SAFE_INTEGER,
        ) else {
            return Ok(unavailable("INVALID_MONTH_BASIS"));
        };
        if numerator > MAX_SAFE_INTEGER - amount {
            return Ok(unavailable("AMOUNT_OVERFLOW"));
        }
        if rows(&entitlement, "months")
            .iter()
            .find(|f| f["month"] == item["month"])
            .is_none_or(|f| {
                f["entgeltOrContinuationDays"].as_f64() != Some([31.0, 31.0, 30.0][index])
                    || f["reductionException"]["kind"] != "NONE"
            })
        {
            return Ok(unavailable("REFERENCE_MONTH_FACTS_MISMATCH"));
        }
        numerator += amount;
        adjusted.push(json!({"month":item["month"],"personalBasisAtPreLeaveScopeCents":amount,"preLeaveScope":{"numerator":n,"denominator":d},"basisRegionId":item["basisRegionId"],"basisPayTableId":item["basisPayTableId"],"fullCalendarMonthEntgeltConfirmed":true,"section16BasisConfirmed":true,"preLeaveScopeAppliedConfirmed":true}));
    }
    for (index, facts) in rows(&entitlement, "months").iter().enumerate() {
        if facts["reductionException"]["kind"] != "PARENTAL_LEAVE_BIRTH_YEAR" {
            continue;
        }
        let (first, last, _) = month_bounds(year, index as i8 + 1);
        if facts["reductionException"]["birthDate"] != leave["birthDate"]
            || first < start
            || last > end
        {
            return Ok(unavailable("PARENTAL_MONTH_FACTS_MISMATCH"));
        }
    }
    let basis = json!({"groupIdAtSeptember1":input["groupIdAtSeptember1"],"groupReferenceDate":format!("{year}-09-01"),"referenceCase":"PARENTAL_LEAVE","parentalLeave":{"birthDate":leave["birthDate"],"startDate":leave["startDate"],"endDate":leave["endDate"],"singlePeriodConfirmed":true},"beforeLeaveScope":{"referenceDate":before["referenceDate"],"numerator":before_n,"denominator":before_d,"historicalScopeConfirmed":true,"sameEmploymentConfirmed":true},"referencePartTime":{"startDate":part["startDate"],"endDate":part["endDate"],"numerator":part_n,"denominator":part_d,"benefitPreservingConfirmed":true,"singleScopePeriodConfirmed":true},"adjustedMonths":adjusted,"meanMonthlyBasis":{"numeratorCents":numerator,"denominator":3},"annualRule":annual});
    let mut amount = finish_amount(
        pkg,
        input,
        basis,
        entitlement,
        "personal-annual-payment-parental-part-time-amount",
    )?;
    if bad(&amount) {
        return Ok(amount);
    }
    amount["parentalLeavePartTimeBasis"] = json!("APPLICABLE");
    amount["specialBasisEvidence"] = json!({"sourceId":amount["roundingEvidence"]["sourceId"],"sourceSection":if input["variantId"]=="ANLAGE_31"{"Anlage 31 § 16 Absatz 2 Satz 4"}else{"Anlage 32 § 16 Absatz 2 Satz 4"},"sourceSha256":amount["roundingEvidence"]["sourceSha256"]});
    Ok(amount)
}
