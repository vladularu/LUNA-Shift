use super::*;
pub fn overtime(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    let (b, w) = match super::allowances::preflight(pkg, input, validator)? {
        Ok(v) => v,
        Err(reason) => return Ok(unavailable(reason)),
    };
    let _ = b;
    if w < 2340.0 && input["partTimePlusHoursAgreementConfirmed"] != true {
        return Ok(unavailable("PART_TIME_AGREEMENT_UNCONFIRMED"));
    }
    if !js_truthy(&input["monthlyAccountComplete"]) {
        return Ok(unavailable("MONTH_ACCOUNT_INCOMPLETE"));
    }
    let Some(plus) = input["monthlyPlusMinutes"]
        .as_f64()
        .filter(|n| safe(*n) && (0.0..=44640.0).contains(n))
    else {
        return Ok(unavailable("INVALID_PLUS_MINUTES"));
    };
    let Some(minutes) = input["confirmedOvertimeMinutes"]
        .as_f64()
        .filter(|n| safe(*n) && *n >= 1.0 && *n <= plus)
    else {
        return Ok(unavailable("INVALID_OVERTIME_MINUTES"));
    };
    if input["classification"] == "NOT_OVERTIME" {
        return Ok(unavailable("NOT_OVERTIME"));
    }
    if input["classification"] != "ORDERED_OR_APPROVED_CONFIRMED" {
        return Ok(unavailable("CLASSIFICATION_UNCONFIRMED"));
    }
    let Some(policy) = pkg
        .rules()
        .get("avrddOvertimePolicy")
        .filter(|p| js_truthy(p))
    else {
        return Ok(unavailable("MISSING_POLICY"));
    };
    let threshold = policy["fullTimePlusThresholdMinutes"]
        .as_f64()
        .ok_or(BaseError::InvalidCalculation)?
        * w;
    if minutes * 2340.0 > plus * 2340.0 - threshold {
        return Ok(unavailable("BELOW_MONTHLY_THRESHOLD"));
    }
    if !js_truthy(&input["completeUniformPersonalBasisConfirmed"])
        || !js_truthy(&input["basisExcludesOvertimeConfirmed"])
    {
        return Ok(unavailable("PERSONAL_BASIS_UNCONFIRMED"));
    }
    let (Some(entgelt), Some(fixed)) = (
        input["monthlyEntgelt14Cents"].as_f64(),
        input["monthlyFixedAllowancesCents"].as_f64(),
    ) else {
        return Ok(unavailable("INVALID_PERSONAL_BASIS"));
    };
    if !safe(entgelt) || entgelt <= 0.0 || !safe(fixed) || fixed < 0.0 {
        return Ok(unavailable("INVALID_PERSONAL_BASIS"));
    }
    let basis = entgelt + fixed;
    if !safe(basis) {
        return Ok(unavailable("AMOUNT_OVERFLOW"));
    }
    if input["premiumArrangement"] == "UNKNOWN" {
        return Ok(unavailable("LOCAL_AGREEMENT_UNKNOWN"));
    }
    if input["premiumArrangement"] != "NONE_CONFIRMED" {
        return Ok(unavailable("LOCAL_AGREEMENT_UNSUPPORTED"));
    }
    if input["workSettlement"] == "UNKNOWN" || input["premiumSettlement"] == "UNKNOWN" {
        return Ok(unavailable("SETTLEMENT_UNCONFIRMED"));
    }
    if input["workSettlement"] != "CASH_CONFIRMED" || input["premiumSettlement"] != "CASH_CONFIRMED"
    {
        return Ok(unavailable("SETTLEMENT_UNSUPPORTED"));
    }
    let group = input["groupId"]
        .as_str()
        .ok_or(BaseError::InvalidCalculation)?
        .to_lowercase();
    let selected = resolve_tariff_selection(
        pkg,
        input["variantId"].as_str().unwrap_or(""),
        input["regionId"].as_str().unwrap_or(""),
    );
    if selected.as_ref().is_none_or(|s| {
        s.family_id != "avr-dd"
            || s.engine_id != "avr-dd-v1"
            || !s.groups.iter().any(|g| g.id == group)
    }) {
        return Ok(unavailable("UNKNOWN_SELECTION"));
    }
    let rates: Vec<_> = rows(pkg.rules(), "avrddHourlyRates")
        .iter()
        .filter(|r| r["groupId"] == group)
        .collect();
    if rates.len() != 1 {
        return Ok(unavailable("MISSING_PREMIUM_RATE"));
    }
    let rate = rates[0];
    let printed = rate["overtimeSupplementCents"]
        .as_f64()
        .ok_or(BaseError::InvalidCalculation)?;
    let divisor = w * policy["monthlyFactorThousandths"]
        .as_f64()
        .ok_or(BaseError::InvalidCalculation)?;
    let numerator = basis * 60000.0;
    if !safe(numerator) || !safe(divisor) {
        return Ok(unavailable("AMOUNT_OVERFLOW"));
    }
    let hourly = round_remuneration_cents(numerator, divisor)?;
    let work = hourly as f64 * minutes;
    let premium = printed * minutes;
    if !safe(work) || !safe(premium) {
        return Ok(unavailable("AMOUNT_OVERFLOW"));
    }
    let work = round_remuneration_cents(work, 60.0)?;
    let premium = round_remuneration_cents(premium, 60.0)?;
    let cash = work as f64 + premium as f64;
    if !safe(cash) {
        return Ok(unavailable("AMOUNT_OVERFLOW"));
    }
    Ok(
        json!({"kind":"draft-confirmed-cash-overtime","status":"estimated","completeGross":false,"workMonth":input["workMonth"],"payoutMonth":null,"packageId":pkg.package_id,"versionId":pkg.version_id,"groupId":group,"monthlyPlusMinutes":plus as i64,"confirmedOvertimeMinutes":minutes as i64,"thresholdNumerator":threshold as i64,"thresholdDenominator":2340,"personalHourlyBasisCents":hourly,"cashClaimCents":cash as i64,"sourceIds":source_ids(&[rate,policy]),"positions":[{"component":"WORK_HOURS","minutes":minutes as i64,"rateCentsPerHour":hourly,"amountCents":work},{"component":"OVERTIME_PREMIUM","minutes":minutes as i64,"rateCentsPerHour":printed as i64,"amountCents":premium}]}),
    )
}
