use super::*;
pub fn assess_entitlement(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    if input["singleEmploymentHistoryConfirmed"] != true {
        return Ok(unavailable("EMPLOYMENT_HISTORY_UNCONFIRMED"));
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
    if rules.iter().any(|r| {
        r["eligibilityPolicy"] != rule["eligibilityPolicy"]
            || r["reductionPolicy"] != rule["reductionPolicy"]
    }) {
        return Ok(unavailable("INVALID_PACKAGE"));
    }
    let start = utc_day(&input["employmentStartDate"]);
    let end = if input.get("employmentEndDate") == Some(&Value::Null) {
        Some(i64::MAX)
    } else {
        utc_day(&input["employmentEndDate"])
    };
    let (Some(start), Some(end)) = (start, end) else {
        return Ok(unavailable("INVALID_EMPLOYMENT_PERIOD"));
    };
    if end < start {
        return Ok(unavailable("INVALID_EMPLOYMENT_PERIOD"));
    }
    let Some(raw) = input["months"].as_array().filter(|m| m.len() == 12) else {
        return Ok(unavailable("INVALID_MONTHS"));
    };
    let mut ordered = Vec::new();
    for month in 1..=12 {
        let expected = format!("{year}-{month:02}");
        let Some(item) = raw.iter().find(|m| m["month"] == expected) else {
            return Ok(unavailable("INVALID_MONTHS"));
        };
        ordered.push(item);
    }
    let december = month_bounds(year, 12).0;
    let mut months = Vec::new();
    let mut retained = 0;
    for (index, item) in ordered.into_iter().enumerate() {
        if item["monthFactsConfirmed"] != true {
            return Ok(unavailable("MONTH_FACTS_UNCONFIRMED"));
        }
        let (first, last, days) = month_bounds(year, index as i8 + 1);
        let Some(paid) = integer(&item["entgeltOrContinuationDays"], 0, days) else {
            return Ok(unavailable("INVALID_ENTGELT_DAYS"));
        };
        let employed = (last.min(end) - first.max(start) + 1).max(0);
        if paid > employed {
            return Ok(unavailable("ENTGELT_OUTSIDE_EMPLOYMENT"));
        }
        let exception = &item["reductionException"];
        let kind = exception["kind"].as_str().unwrap_or("");
        if ![
            "NONE",
            "MILITARY_OR_CIVILIAN_SERVICE",
            "MATERNITY_EMPLOYMENT_BAN",
            "PARENTAL_LEAVE_BIRTH_YEAR",
            "SICK_PAY_SUPPLEMENT",
            "SICK_PAY_SUPPLEMENT_AMOUNT_BLOCKED",
        ]
        .contains(&kind)
        {
            return Ok(unavailable("UNKNOWN_REDUCTION_EXCEPTION"));
        }
        if paid > 0 && kind != "NONE" {
            return Ok(unavailable("EXCEPTION_WITH_ENTGELT_DAYS"));
        }
        if kind != "NONE" && employed == 0 {
            return Ok(unavailable("EXCEPTION_OUTSIDE_EMPLOYMENT"));
        }
        let confirmed = match confirmed_exception(exception, year, first, start, end, december) {
            Ok(v) => v,
            Err(reason) => return Ok(unavailable(reason)),
        };
        let decision = if paid > 0 {
            "RETAINED_ENTGELT"
        } else if kind == "NONE" {
            "REDUCED"
        } else {
            "RETAINED_EXCEPTION"
        };
        if decision != "REDUCED" {
            retained += 1;
        }
        months.push(json!({"month":item["month"],"entgeltOrContinuationDays":paid,"monthFactsConfirmed":true,"reductionException":confirmed,"decision":decision}));
    }
    let year_first = month_bounds(year, 1).0;
    let year_last = month_bounds(year, 12).1;
    let eligible = start <= december && end >= december;
    let employed = start <= year_last && end >= year_first;
    let early =
        employed && end < december && rule["eligibilityPolicy"] == "ANLAGE_31_SECTION_16_1_AND_6";
    let mut source_ids = Vec::new();
    for rule in &rules {
        for source in rows(rule, "sourceIds") {
            if !source_ids.contains(source) {
                source_ids.push(source.clone());
            }
        }
    }
    Ok(
        json!({"kind":"personal-annual-payment-entitlement","draft":true,"completeGross":false,"entitlementYear":year,"employmentStartDate":input["employmentStartDate"],"employmentEndDate":input["employmentEndDate"],"singleEmploymentHistoryConfirmed":true,"eligibility":{"eligible":eligible||early,"reason":if eligible{"EMPLOYED_ON_DECEMBER_1"}else if early{"ANLAGE_31_EARLY_EXIT"}else if !employed{"NOT_EMPLOYED_IN_YEAR"}else{"DECEMBER_1_REQUIREMENT_NOT_MET"}},"retainedMonthCount":retained,"reducedMonthCount":12-retained,"reductionFactor":{"numerator":retained,"denominator":12},"months":months,"sourcePolicy":{"packageId":pkg.package_id,"versionId":pkg.version_id,"entitlementYear":year,"variantId":input["variantId"],"regionId":input["regionId"],"eligibilityPolicy":rule["eligibilityPolicy"],"reductionPolicy":rule["reductionPolicy"],"ruleIds":rules.iter().map(|r|&r["id"]).collect::<Vec<_>>(),"sourceIds":source_ids}}),
    )
}
fn confirmed_exception(
    exception: &Value,
    year: i32,
    first: i64,
    start: i64,
    end: i64,
    december: i64,
) -> Result<Value, &'static str> {
    let kind = exception["kind"].as_str().unwrap();
    let keys: &[&str] = match kind {
        "NONE" => &[],
        "MILITARY_OR_CIVILIAN_SERVICE" => {
            if exception["noTablePayDueToServiceConfirmed"] != true
                || exception["immediateWorkResumptionConfirmed"] != true
            {
                return Err("EXCEPTION_UNCONFIRMED");
            }
            let service = utc_day(&exception["serviceEndDate"]);
            if service.is_none_or(|s| s >= december || s < first.max(start) || s > end) {
                return Err("EXCEPTION_NOT_APPLICABLE");
            }
            &[
                "noTablePayDueToServiceConfirmed",
                "serviceEndDate",
                "immediateWorkResumptionConfirmed",
            ]
        }
        "MATERNITY_EMPLOYMENT_BAN" => {
            if exception["statutoryMaternityBanConfirmed"] != true
                || exception["noTablePayDueToBanConfirmed"] != true
            {
                return Err("EXCEPTION_UNCONFIRMED");
            }
            &[
                "statutoryMaternityBanConfirmed",
                "noTablePayDueToBanConfirmed",
            ]
        }
        "PARENTAL_LEAVE_BIRTH_YEAR" => {
            if exception["noTablePayDueToBeegLeaveConfirmed"] != true
                || exception["payClaimBeforeLeaveConfirmed"] != true
            {
                return Err("EXCEPTION_UNCONFIRMED");
            }
            let birth = utc_day(&exception["birthDate"]);
            if birth.is_none_or(|b| b > first.min(end))
                || !exception["birthDate"]
                    .as_str()
                    .is_some_and(|s| s.starts_with(&format!("{year}-")))
            {
                return Err("EXCEPTION_NOT_APPLICABLE");
            }
            &[
                "noTablePayDueToBeegLeaveConfirmed",
                "birthDate",
                "payClaimBeforeLeaveConfirmed",
            ]
        }
        "SICK_PAY_SUPPLEMENT" => {
            if exception["paidSupplementConfirmed"] != true {
                return Err("EXCEPTION_UNCONFIRMED");
            }
            &["paidSupplementConfirmed"]
        }
        "SICK_PAY_SUPPLEMENT_AMOUNT_BLOCKED" => {
            if exception["onlySicknessBenefitAmountBlockedConfirmed"] != true {
                return Err("EXCEPTION_UNCONFIRMED");
            }
            &["onlySicknessBenefitAmountBlockedConfirmed"]
        }
        _ => return Err("UNKNOWN_REDUCTION_EXCEPTION"),
    };
    let mut result = json!({"kind":kind});
    for key in keys {
        result[*key] = exception[*key].clone();
    }
    Ok(result)
}
