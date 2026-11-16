use super::*;
pub(super) fn preflight(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Result<(MonthRange, f64), &'static str>, BaseError> {
    if pkg.engine_contract_version != 15
        || pkg.status() != Some("DRAFT")
        || !validator.validate(pkg)?
    {
        return Ok(Err("INVALID_PACKAGE"));
    }
    let Some(b) = input["workMonth"].as_str().and_then(bounds) else {
        return Ok(Err("INVALID_MONTH"));
    };
    if b.start < pkg.valid_from || pkg.valid_to.as_ref().is_some_and(|to| b.end > *to) {
        return Ok(Err("OUTSIDE_VALIDITY"));
    }
    if !js_truthy(&input["avrddApplicabilityConfirmed"]) {
        return Ok(Err("AVRDD_APPLICABILITY_UNCONFIRMED"));
    }
    if input["contractTimeMode"] == "UNKNOWN" {
        return Ok(Err("CONTRACT_TIME_UNKNOWN"));
    }
    if input["contractTimeMode"] != "STANDARD_39" {
        return Ok(Err("CORRIDOR_SEPARATE_CALCULATION_REQUIRED"));
    }
    let Some(w) = weekly(pkg, input) else {
        return Ok(Err("INVALID_WEEKLY_TIME"));
    };
    Ok(Ok((b, w)))
}
pub fn care(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    let (b, w) = match preflight(pkg, input, validator)? {
        Ok(v) => v,
        Err(e) => return Ok(unavailable(e)),
    };
    let s = selected(
        pkg,
        input["variantId"].as_str().unwrap_or(""),
        input["regionId"].as_str().unwrap_or(""),
    );
    if s.as_ref()
        .is_none_or(|s| !s.groups.iter().any(|g| g.id == input["groupId"]))
    {
        return Ok(unavailable("UNKNOWN_SELECTION"));
    }
    if input["groupId"] != "eg3" && input["groupId"] != "eg4" {
        return Ok(unavailable("GROUP_NOT_ELIGIBLE"));
    }
    if input.get("careAndSupportWorkConfirmed") == Some(&Value::Null) {
        return Ok(unavailable("CARE_WORK_UNCONFIRMED"));
    }
    if !js_truthy(&input["careAndSupportWorkConfirmed"]) {
        return Ok(unavailable("CARE_WORK_NOT_CONFIRMED"));
    }
    if input.get("relevantEmploymentStartDate") == Some(&Value::Null) {
        return Ok(unavailable("EMPLOYMENT_START_UNKNOWN"));
    }
    let Some(start) = input["relevantEmploymentStartDate"]
        .as_str()
        .filter(|s| real_date(s) && *s <= b.start.as_str())
    else {
        return Ok(unavailable("INVALID_EMPLOYMENT_START"));
    };
    if start >= "2012-10-01" {
        if input.get("recognizedEmploymentMonthsAtMonthStart") == Some(&Value::Null) {
            return Ok(unavailable("RECOGNIZED_SERVICE_UNKNOWN"));
        }
        let Some(months) = input["recognizedEmploymentMonthsAtMonthStart"]
            .as_f64()
            .filter(|n| safe(*n) && *n >= 0.0)
        else {
            return Ok(unavailable("INVALID_RECOGNIZED_SERVICE"));
        };
        if months < 96.0 {
            return Ok(unavailable("SERVICE_THRESHOLD_NOT_MET"));
        }
    }
    if !js_truthy(&input["fullMonthEntitlementConfirmed"]) {
        return Ok(unavailable("PARTIAL_MONTH_UNSUPPORTED"));
    }
    let rates: Vec<_> = rows(pkg.rules(), "avrddCareAllowanceRates")
        .iter()
        .filter(|r| {
            r["validFrom"]
                .as_str()
                .is_some_and(|d| d <= b.start.as_str())
                && (r["validTo"].is_null()
                    || r["validTo"].as_str().is_some_and(|d| b.end.as_str() <= d))
        })
        .collect();
    if rates.len() != 1 {
        return Ok(unavailable("MISSING_RATE"));
    }
    let rate = rates[0];
    let full = rate["monthlyCents"]
        .as_f64()
        .ok_or(BaseError::InvalidCalculation)?;
    let n = full * w;
    if !safe(n) {
        return Ok(unavailable("AMOUNT_OVERFLOW"));
    }
    Ok(
        json!({"kind":"draft-confirmed-care-allowance","status":"estimated","completeGross":false,"workMonth":input["workMonth"],"packageId":pkg.package_id,"versionId":pkg.version_id,"groupId":input["groupId"],"fullTimeMonthlyCents":full as i64,"amountCents":round_remuneration_cents(n,2340.0)?,"sourceIds":rate["sourceIds"]}),
    )
}
pub fn shift(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    let (b, w) = match preflight(pkg, input, validator)? {
        Ok(v) => v,
        Err(e) => return Ok(unavailable(e)),
    };
    if input["entitlement"] == "UNKNOWN" {
        return Ok(unavailable("ENTITLEMENT_UNCONFIRMED"));
    }
    if input["entitlement"] == "NONE_CONFIRMED" {
        return Ok(unavailable("NO_ENTITLEMENT_CONFIRMED"));
    }
    if !js_truthy(&input["fullMonthEntitlementConfirmed"]) {
        return Ok(unavailable("PARTIAL_MONTH_UNSUPPORTED"));
    }
    if input["readinessExclusion"] == "UNKNOWN" {
        return Ok(unavailable("READINESS_EXCLUSION_UNKNOWN"));
    }
    if input["readinessExclusion"] != "ABSENT_CONFIRMED" {
        return Ok(unavailable("READINESS_EXCLUSION_PRESENT"));
    }
    if selected(
        pkg,
        input["variantId"].as_str().unwrap_or(""),
        input["regionId"].as_str().unwrap_or(""),
    )
    .is_none()
    {
        return Ok(unavailable("UNKNOWN_SELECTION"));
    }
    let rates: Vec<_> = rows(pkg.rules(), "avrddShiftAllowanceRates")
        .iter()
        .filter(|r| {
            r["validFrom"]
                .as_str()
                .is_some_and(|d| d <= b.start.as_str())
                && (r["validTo"].is_null()
                    || r["validTo"].as_str().is_some_and(|d| b.end.as_str() <= d))
        })
        .collect();
    if rates.len() != 1 {
        return Ok(unavailable("MISSING_RATE"));
    }
    let rate = rates[0];
    let full = rate[if input["entitlement"] == "ALTERNATING_CONFIRMED" {
        "alternatingMonthlyCents"
    } else {
        "shiftMonthlyCents"
    }]
    .as_f64()
    .ok_or(BaseError::InvalidCalculation)?;
    let n = full * w;
    if !safe(n) {
        return Ok(unavailable("AMOUNT_OVERFLOW"));
    }
    Ok(
        json!({"kind":"draft-confirmed-shift-allowance","status":"estimated","completeGross":false,"workMonth":input["workMonth"],"packageId":pkg.package_id,"versionId":pkg.version_id,"entitlement":input["entitlement"],"fullTimeMonthlyCents":full as i64,"amountCents":round_remuneration_cents(n,2340.0)?,"sourceIds":rate["sourceIds"]}),
    )
}
