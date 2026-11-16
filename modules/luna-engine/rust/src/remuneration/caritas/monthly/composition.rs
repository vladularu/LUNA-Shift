use super::*;
pub fn composition(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    let name = "monthly-composition";
    if input["monthlyCompositionConfirmed"] != true {
        return Ok(failure("MONTHLY_COMPOSITION_UNCONFIRMED", name, None));
    }
    if [
        "confirmedPremiums",
        "confirmedOvertime",
        "confirmedHourlyShift",
    ]
    .iter()
    .any(|key| !input[*key].is_array())
    {
        return Ok(failure("INVALID_COMPONENT_LINES", name, None));
    }
    let monthly = input.get("monthlyShift");
    if monthly != Some(&Value::Null) && monthly.is_none_or(|m| !m.is_object()) {
        return Ok(failure("INVALID_MONTHLY_SHIFT", name, None));
    }
    let has_monthly = monthly != Some(&Value::Null);
    let has_hourly = !rows(input, "confirmedHourlyShift").is_empty();
    if has_monthly && has_hourly {
        return Ok(failure("MIXED_SHIFT_FORMS_UNSUPPORTED", name, None));
    }
    let base = components(pkg, input, validator)?;
    if bad(&base) {
        return Ok(base);
    }
    let mut normalized = Vec::new();
    for line in rows(input, "confirmedPremiums") {
        if !line.is_object() && !line.is_array() {
            return Ok(failure(
                "INVALID_PREMIUM_LINE",
                "confirmed-time-premium",
                None,
            ));
        }
        let Some(id) = line["lineId"]
            .as_str()
            .map(crate::input::trim_javascript)
            .filter(|s| !s.is_empty())
        else {
            return Ok(failure(
                "INVALID_PREMIUM_LINE_ID",
                "confirmed-time-premium",
                None,
            ));
        };
        if !line["serviceDate"].is_string() {
            return Ok(failure("INVALID_DATE", "confirmed-time-premium", Some(id)));
        }
        let mut row = line.clone();
        row["lineId"] = json!(id);
        normalized.push(row);
    }
    let shift = if has_monthly {
        let mut args = arguments(input, None);
        args["shiftAllowanceType"] = input["monthlyShift"]["shiftAllowanceType"].clone();
        args["shiftEntitlement"] = input["monthlyShift"]["shiftEntitlement"].clone();
        args["fullMonthWeeklyTimeConfirmed"] =
            input["monthlyShift"]["fullMonthWeeklyTimeConfirmed"].clone();
        Some(base::shift(pkg, &args, &base, validator)?)
    } else {
        None
    };
    if let Some(value) = shift.as_ref().filter(|v| bad(v)) {
        return Ok(value.clone());
    }
    let hourly = if has_hourly {
        Some(lines::hourly(pkg, input, &base, validator)?)
    } else {
        None
    };
    if let Some(value) = hourly.as_ref().filter(|v| bad(v)) {
        return Ok(value.clone());
    }
    let time = if normalized.is_empty() {
        None
    } else {
        let mut args = arguments(input, None);
        args["confirmedPremiums"] = Value::Array(normalized);
        Some(lines::time(pkg, &args, &base, validator)?)
    };
    if let Some(value) = time.as_ref().filter(|v| bad(v)) {
        return Ok(value.clone());
    }
    let overtime = if rows(input, "confirmedOvertime").is_empty() {
        None
    } else {
        Some(lines::overtime(pkg, input, &base, validator)?)
    };
    if let Some(value) = overtime.as_ref().filter(|v| bad(v)) {
        return Ok(value.clone());
    }
    let mut positions = rows(&base, "positions").to_vec();
    let mut shift_total = 0.0;
    for (value, names) in [
        (&shift, &["monthly-shift-allowance"][..]),
        (&hourly, &["confirmed-hourly-shift-allowance"][..]),
        (&time, &["confirmed-time-premium"][..]),
        (
            &overtime,
            &["confirmed-overtime-base", "confirmed-overtime-premium"][..],
        ),
    ] {
        if let Some(value) = value {
            for position in rows(value, "positions")
                .iter()
                .filter(|p| p["component"].as_str().is_some_and(|c| names.contains(&c)))
            {
                if position["component"] == "monthly-shift-allowance" {
                    shift_total += position["amountCents"].as_f64().unwrap();
                }
                positions.push(position.clone());
            }
        }
    }
    let (Some(total), Some(shift_total)) = (position_sum(&positions), safe(shift_total)) else {
        return Ok(unavailable("AMOUNT_OVERFLOW"));
    };
    let mut result = result(
        &base,
        "draft-known-monthly-composition",
        total,
        positions,
        [
            if shift.is_none() && hourly.is_none() {
                "SHIFT_ALLOWANCES"
            } else {
                "OTHER_SHIFT_ALLOWANCES"
            },
            if time.is_none() {
                "TIME_PREMIUMS"
            } else {
                "OTHER_TIME_PREMIUMS"
            },
            if overtime.is_none() {
                "OVERTIME"
            } else {
                "OTHER_OVERTIME"
            },
        ],
    );
    result["knownBaseAndCareSubtotalCents"] = base["knownSubtotalCents"].clone();
    result["knownMonthlyShiftSubtotalCents"] = json!(shift_total);
    for (value, keys) in [
        (&hourly, &["knownHourlyShiftSubtotalCents"][..]),
        (&time, &["knownTimePremiumSubtotalCents"][..]),
        (
            &overtime,
            &[
                "knownOvertimeBaseSubtotalCents",
                "knownOvertimePremiumSubtotalCents",
                "knownOvertimeSubtotalCents",
            ][..],
        ),
    ] {
        for key in keys {
            result[*key] = value.as_ref().map_or_else(|| json!(0), |v| v[*key].clone());
        }
    }
    Ok(result)
}
