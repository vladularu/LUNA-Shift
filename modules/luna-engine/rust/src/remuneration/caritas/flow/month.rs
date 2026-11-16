use super::*;
use std::collections::BTreeMap;
pub fn calculate_month(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, FlowError> {
    let month = input["month"].as_str().unwrap_or("");
    let Some((first, last)) = bounds(month) else {
        return Ok(unavailable("INVALID_MONTH"));
    };
    if !js_truthy(&input["fullMonthEmploymentConfirmed"]) {
        return Ok(unavailable("PARTIAL_EMPLOYMENT"));
    }
    if !js_truthy(&input["fullMonthlyBaseEntitlementConfirmed"]) {
        return Ok(unavailable("BASE_ENTITLEMENT_UNKNOWN"));
    }
    if input["fixedAllowanceClaim"] == "UNKNOWN" || input["careAllowanceClaim"] == "UNKNOWN" {
        return Ok(unavailable("ALLOWANCE_CLAIM_UNKNOWN"));
    }
    if first < pkg.valid_from || pkg.valid_to.as_ref().is_some_and(|to| last > *to) {
        return Ok(unavailable("OUTSIDE_VALIDITY"));
    }
    if pkg.status() != Some("DRAFT") {
        return Ok(unavailable("INVALID_PACKAGE"));
    }
    let changes = |r: &Value| {
        r["variantId"] == input["variantId"]
            && r["regionId"] == input["regionId"]
            && (r["validFrom"]
                .as_str()
                .is_some_and(|s| s > first.as_str() && s <= last.as_str())
                || r["validTo"]
                    .as_str()
                    .is_some_and(|s| s >= first.as_str() && s < last.as_str()))
    };
    if rows(pkg.rules(), "employmentWorkingTimeRules")
        .iter()
        .any(changes)
        || [
            ("fixedAllowanceClaim", "SECTION_12_3"),
            ("careAllowanceClaim", "SECTION_12_4"),
        ]
        .iter()
        .any(|(key, provision)| {
            input[*key] == "ENTITLED"
                && rows(pkg.rules(), "caritasCareAllowanceRates")
                    .iter()
                    .any(|r| r["provisionId"] == *provision && changes(r))
        })
    {
        return Ok(unavailable("MID_MONTH_BASE_CHANGE"));
    }
    let mut args = parameters(input);
    args["date"] = json!(first);
    let base = personal_base::calculate_original(pkg, &args, validator)?;
    if bad(&base) {
        return Ok(component(base, "base"));
    }
    let mut positions = vec![
        json!({"component":"base","amountCents":base["personalMonthlyCents"],"status":"calculated","sourceIds":base["sourceIds"]}),
    ];
    for (key, name, dynamic) in [
        ("fixedAllowanceClaim", "fixed-allowance", false),
        ("careAllowanceClaim", "care-allowance", true),
    ] {
        if input[key] == "NOT_ENTITLED" {
            continue;
        }
        let allowance = if dynamic {
            personal_allowances::legacy_dynamic(pkg, &args, validator)?
        } else {
            personal_allowances::legacy_fixed(pkg, &args, validator)?
        };
        if bad(&allowance) {
            return Ok(component(allowance, name));
        }
        positions.push(json!({"component":name,"amountCents":allowance["personalMonthlyCents"],"status":"calculated","sourceIds":source_ids(&allowance["rateSourceIds"],&allowance["basisSourceIds"])}));
    }
    let Some(raw) = input["workedSlices"].as_array() else {
        return Err(BaseError::InvalidCalculation.into());
    };
    let mut slices: Vec<_> = raw.iter().collect();
    slices.sort_by(|a, b| {
        a["date"].as_str().cmp(&b["date"].as_str()).then_with(|| {
            a["fromMinute"]
                .as_f64()
                .unwrap_or(f64::NAN)
                .partial_cmp(&b["fromMinute"].as_f64().unwrap_or(f64::NAN))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
    });
    let mut work: BTreeMap<&str, f64> = BTreeMap::new();
    for (i, slice) in slices.iter().enumerate() {
        let date = slice["date"]
            .as_str()
            .ok_or(BaseError::InvalidCalculation)?;
        if date < first.as_str() || date > last.as_str() {
            return Ok(component(unavailable("OUTSIDE_VALIDITY"), "time-premiums"));
        }
        if i > 0
            && slices[i - 1]["date"] == slice["date"]
            && slices[i - 1]["throughMinute"].as_f64() > slice["fromMinute"].as_f64()
        {
            return Ok(component(
                unavailable("WORKED_SLICES_OVERLAP"),
                "time-premiums",
            ));
        }
        *work.entry(date).or_default() += slice["throughMinute"].as_f64().unwrap_or(f64::NAN)
            - slice["fromMinute"].as_f64().unwrap_or(f64::NAN);
    }
    let mut shift_args = parameters(input);
    shift_args["from"] = json!(first);
    shift_args["through"] = json!(last);
    shift_args["entitlements"] = input["shiftEntitlements"].clone();
    shift_args["workDaysComplete"] = input["workDataComplete"].clone();
    shift_args["workedDays"]=Value::Array(work.iter().map(|(date,minutes)|json!({"date":date,"workedMinutes":source_number(*minutes),"estimatedPause":false})).collect());
    let shift = policy::shift::calculate(pkg, &shift_args, validator)?;
    if bad(&shift) {
        return Ok(component(shift, "shift-allowance"));
    }
    let mut shift_sources = Vec::new();
    for p in rows(&shift, "positions") {
        for source in rows(p, "sourceIds") {
            if !shift_sources.contains(source) {
                shift_sources.push(source.clone());
            }
        }
    }
    positions.push(json!({"component":"shift-allowance","amountCents":shift["amountCents"],"status":shift["status"],"sourceIds":shift_sources}));
    let mut time_args = parameters(input);
    time_args["workedSlices"] = Value::Array(slices.into_iter().cloned().collect());
    time_args["workDataComplete"] = input["workDataComplete"].clone();
    let time = policy::time::calculate(pkg, &time_args, validator)?;
    if bad(&time) {
        return Ok(component(time, "time-premiums"));
    }
    positions.push(json!({"component":"time-premiums","amountCents":time["amountCents"],"status":time["status"],"sourceIds":time["sourceIds"]}));
    let total = positions
        .iter()
        .fold(0.0, |sum, p| sum + p["amountCents"].as_f64().unwrap());
    Ok(
        json!({"kind":"draft-known-subtotal","status":"estimated","knownSubtotalCents":source_number(total),"packageId":pkg.package_id,"versionId":pkg.version_id,"month":month,"localAgreementUnconfirmed":time["localAgreementUnconfirmed"],"excludedComponents":["OVERTIME","ANNUAL_PAYMENT","OTHER_LOCAL_TERMS"],"positions":positions}),
    )
}
fn source_number(n: f64) -> Value {
    if n.fract() == 0.0 && n.abs() <= crate::money::MAX_SAFE_INTEGER as f64 {
        json!(n as i64)
    } else {
        json!(n)
    }
}
