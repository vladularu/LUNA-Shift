use super::*;
pub fn early_exit_amount(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    if input["referenceCase"] != "EARLY_EXIT" {
        return Ok(unavailable("UNSUPPORTED_REFERENCE_CASE"));
    }
    if input["earlyExitReferencePeriodConfirmed"] != true {
        return Ok(unavailable("REFERENCE_CASE_UNCONFIRMED"));
    }
    if input["septemberGroupConfirmed"] != true {
        return Ok(unavailable("REFERENCE_GROUP_UNCONFIRMED"));
    }
    if input["parentalLeavePartTimeBasis"] != "NOT_APPLICABLE" {
        return Ok(unavailable("UNSUPPORTED_SPECIAL_BASIS"));
    }
    let entitlement = assess_entitlement(pkg, input, validator)?;
    if bad(&entitlement) {
        return Ok(entitlement);
    }
    if input["variantId"] != "ANLAGE_31"
        || entitlement["eligibility"]["eligible"] != true
        || entitlement["eligibility"]["reason"] != "ANLAGE_31_EARLY_EXIT"
        || entitlement["employmentEndDate"].is_null()
    {
        return Ok(unavailable("UNSUPPORTED_EARLY_EXIT"));
    }
    let year = year(&input["entitlementYear"]).unwrap();
    let group_reference = format!("{year}-09-01");
    let start = entitlement["employmentStartDate"].as_str().unwrap();
    let end = entitlement["employmentEndDate"].as_str().unwrap();
    if start > group_reference.as_str() || end < group_reference.as_str() {
        return Ok(unavailable("EARLY_EXIT_RATE_REFERENCE_UNRESOLVED"));
    }
    let annual = lookup_rule(pkg, input, validator)?;
    if bad(&annual) {
        return Ok(annual);
    }
    let end_date = crate::calendar::parse_date(end)?;
    let reference_month = end_date.month() - i8::from(end_date.day() != end_date.days_in_month());
    let month = format!("{year}-{reference_month:02}");
    let days = month_bounds(year, reference_month).2;
    let first = format!("{month}-01");
    let last = format!("{month}-{days:02}");
    if first.as_str() < start {
        return Ok(unavailable("NO_FULL_EMPLOYMENT_MONTH"));
    }
    let paid = &input["lastFullMonth"];
    if paid["month"] != month {
        return Ok(unavailable("INVALID_REFERENCE_MONTH"));
    }
    if first < pkg.valid_from || pkg.valid_to.as_ref().is_some_and(|to| last > *to) {
        return Ok(unavailable("REFERENCE_MONTH_OUTSIDE_PACKAGE"));
    }
    if paid["fullCalendarMonthEntgeltConfirmed"] != true {
        return Ok(unavailable("REFERENCE_MONTH_INCOMPLETE"));
    }
    if paid["section16Paragraph6ComponentsConfirmed"] != true {
        return Ok(unavailable("MONTH_COMPONENTS_UNCONFIRMED"));
    }
    if paid["basisRegionId"] != annual["basisRegionId"]
        || paid["basisPayTableId"] != annual["basisPayTableId"]
    {
        return Ok(unavailable("BASIS_IDENTITY_MISMATCH"));
    }
    let table = integer(&paid["personalTablePayCents"], 1, MAX_SAFE_INTEGER);
    let fixed = integer(
        &paid["personalFixedMonthlyAllowancesCents"],
        0,
        MAX_SAFE_INTEGER,
    );
    let (Some(table), Some(fixed)) = (table, fixed) else {
        return Ok(unavailable("INVALID_MONTH_COMPONENTS"));
    };
    if table > MAX_SAFE_INTEGER - fixed {
        return Ok(unavailable("AMOUNT_OVERFLOW"));
    }
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
    let basis = json!({"kind":"personal-annual-payment-early-exit-basis","draft":true,"completeGross":false,"entitlementYear":year,"groupIdAtSeptember1":input["groupIdAtSeptember1"],"groupReferenceDate":group_reference,"septemberGroupConfirmed":true,"referenceCase":"EARLY_EXIT","earlyExitReferencePeriodConfirmed":true,"lastFullMonth":{"month":paid["month"],"personalTablePayCents":table,"personalFixedMonthlyAllowancesCents":fixed,"basisRegionId":paid["basisRegionId"],"basisPayTableId":paid["basisPayTableId"],"fullCalendarMonthEntgeltConfirmed":true,"section16Paragraph6ComponentsConfirmed":true},"meanMonthlyBasis":{"numeratorCents":table+fixed,"denominator":1},"annualRule":annual});
    finish_amount(
        pkg,
        input,
        basis,
        entitlement,
        "personal-annual-payment-early-exit-amount",
    )
}
