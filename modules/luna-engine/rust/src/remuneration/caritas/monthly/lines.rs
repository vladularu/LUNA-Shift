use super::*;
use std::collections::{BTreeMap, BTreeSet};
#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Hourly,
    Time,
    Overtime,
}
pub(super) fn hourly(
    pkg: &RulePackage,
    input: &Value,
    base: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    calculate(Kind::Hourly, pkg, input, base, validator)
}
pub(super) fn time(
    pkg: &RulePackage,
    input: &Value,
    base: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    calculate(Kind::Time, pkg, input, base, validator)
}
pub(super) fn overtime(
    pkg: &RulePackage,
    input: &Value,
    base: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    calculate(Kind::Overtime, pkg, input, base, validator)
}
fn calculate(
    kind: Kind,
    pkg: &RulePackage,
    input: &Value,
    base: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    let (key, component_name, invalid_lines, empty, invalid_line, invalid_id, duplicate, outside) =
        match kind {
            Kind::Hourly => (
                "confirmedHourlyShift",
                "confirmed-hourly-shift-allowance",
                "INVALID_HOURLY_SHIFT_LINES",
                "NO_CONFIRMED_HOURLY_SHIFT_LINES",
                "INVALID_HOURLY_SHIFT_LINE",
                "INVALID_HOURLY_SHIFT_LINE_ID",
                "DUPLICATE_HOURLY_SHIFT_LINE",
                "HOURLY_SHIFT_OUTSIDE_MONTH",
            ),
            Kind::Time => (
                "confirmedPremiums",
                "confirmed-time-premium",
                "INVALID_PREMIUM_LINES",
                "NO_CONFIRMED_PREMIUM_LINES",
                "INVALID_PREMIUM_LINE",
                "INVALID_PREMIUM_LINE_ID",
                "DUPLICATE_PREMIUM_LINE",
                "PREMIUM_OUTSIDE_MONTH",
            ),
            Kind::Overtime => (
                "confirmedOvertime",
                "confirmed-overtime",
                "INVALID_OVERTIME_LINES",
                "NO_CONFIRMED_OVERTIME_LINES",
                "INVALID_OVERTIME_LINE",
                "INVALID_OVERTIME_LINE_ID",
                "DUPLICATE_OVERTIME_LINE",
                "OVERTIME_OUTSIDE_MONTH",
            ),
        };
    let Some(entries) = input[key].as_array() else {
        if kind == Kind::Time {
            return Err(BaseError::InvalidCalculation);
        }
        return Ok(failure(invalid_lines, component_name, None));
    };
    if entries.is_empty() {
        return Ok(failure(empty, component_name, None));
    }
    let mut ids = BTreeSet::new();
    let mut hours: BTreeMap<String, f64> = BTreeMap::new();
    let mut positions = rows(base, "positions").to_vec();
    let (mut amount, mut premium_amount) = (0.0, 0.0);
    let month_prefix = format!("{}-", base["month"].as_str().unwrap());
    for line in entries {
        if !line.is_object() && !(kind != Kind::Hourly && line.is_array()) {
            if kind == Kind::Time && line.is_null() {
                return Err(BaseError::InvalidCalculation);
            }
            return Ok(failure(
                if kind == Kind::Time {
                    invalid_id
                } else {
                    invalid_line
                },
                component_name,
                None,
            ));
        }
        let Some(raw_id) = line["lineId"]
            .as_str()
            .filter(|s| !crate::input::trim_javascript(s).is_empty())
        else {
            return Ok(failure(invalid_id, component_name, None));
        };
        let id = if kind == Kind::Time {
            raw_id
        } else {
            crate::input::trim_javascript(raw_id)
        };
        if !ids.insert(id) {
            return Ok(failure(duplicate, component_name, Some(id)));
        }
        if kind != Kind::Time && line["monthlyAllocationConfirmed"] != true {
            return Ok(failure(
                "MONTHLY_ALLOCATION_UNCONFIRMED",
                component_name,
                Some(id),
            ));
        }
        if kind == Kind::Hourly && line["categoryAndOverlapConfirmed"] != true {
            return Ok(failure(
                "CATEGORY_OR_OVERLAP_UNCONFIRMED",
                component_name,
                Some(id),
            ));
        }
        let Some(date) = line["serviceDate"].as_str() else {
            if kind == Kind::Time {
                return Err(BaseError::InvalidCalculation);
            }
            return Ok(failure("INVALID_DATE", component_name, Some(id)));
        };
        if !date.starts_with(&month_prefix) {
            return Ok(failure(outside, component_name, Some(id)));
        }
        let mut args = arguments(input, Some(line));
        if kind == Kind::Overtime {
            args["personalStepId"] = input["stepId"].clone();
        }
        let value = match kind {
            Kind::Hourly => personal_allowances::hourly_shift(pkg, &args, validator)?,
            Kind::Time => personal_cash::time_premium(pkg, &args, validator)?,
            Kind::Overtime => personal_cash::overtime(pkg, &args, validator)?,
        };
        if bad(&value) {
            return Ok(component(value, component_name, Some(id)));
        }
        if kind != Kind::Time {
            let daily = hours
                .entry(value["serviceDate"].as_str().unwrap().to_owned())
                .or_default();
            *daily += value["payableWholeHours"].as_f64().unwrap();
            if *daily > 24.0 {
                return Ok(failure("DAILY_HOURS_EXCEEDED", component_name, Some(id)));
            }
        }
        amount += value[if kind == Kind::Overtime {
            "baseAmountCents"
        } else {
            "personalAmountCents"
        }]
        .as_f64()
        .unwrap();
        if kind == Kind::Overtime {
            premium_amount += value["premiumAmountCents"].as_f64().unwrap();
        }
        if safe(amount).is_none() || safe(premium_amount).is_none() {
            return Ok(failure("AMOUNT_OVERFLOW", component_name, Some(id)));
        }
        match kind{
   Kind::Hourly=>positions.push(json!({"component":component_name,"lineId":id,"serviceDate":value["serviceDate"],"allowanceType":value["allowanceType"],"payableWholeHours":value["payableWholeHours"],"rateCentsPerHour":value["rateCentsPerHour"],"amountCents":value["personalAmountCents"],"rateId":value["rateId"],"sourceIds":value["sourceIds"]})),
   Kind::Time=>{let reference=&value["hourlyValues"]["ratio"]["reference"];let sources=source_ids(&source_ids(&reference["tableSourceIds"],&reference["workingTimeSourceIds"]),&reference["rateSourceIds"]);positions.push(json!({"component":component_name,"lineId":id,"serviceDate":value["serviceDate"],"premiumType":value["premiumType"],"payableWholeHours":value["payableWholeHours"],"rateCentsPerHour":value["rateCentsPerHour"],"amountCents":value["personalAmountCents"],"sourceIds":sources,"tableSourceIds":reference["tableSourceIds"],"workingTimeSourceIds":reference["workingTimeSourceIds"],"rateSourceIds":reference["rateSourceIds"]}));},
   Kind::Overtime=>{for(component_name,rate_key,amount_key)in[("confirmed-overtime-base","baseCentsPerHour","baseAmountCents"),("confirmed-overtime-premium","premiumCentsPerHour","premiumAmountCents")]{positions.push(json!({"lineId":id,"serviceDate":value["serviceDate"],"payableWholeHours":value["payableWholeHours"],"sourceIds":value["hourlyValues"]["sourceIds"],"hourlyValues":value["hourlyValues"],"component":component_name,"rateCentsPerHour":value["hourlyValues"][rate_key],"amountCents":value[amount_key]}));}}
  }
    }
    let Some(line_subtotal) = safe(amount + premium_amount) else {
        return Ok(failure("AMOUNT_OVERFLOW", component_name, None));
    };
    let Some(total) = safe(base["knownSubtotalCents"].as_f64().unwrap() + line_subtotal as f64)
    else {
        return Ok(failure("AMOUNT_OVERFLOW", component_name, None));
    };
    let (kind_name, excluded, key) = match kind {
        Kind::Hourly => (
            "draft-known-monthly-components-with-hourly-shift",
            ["OTHER_SHIFT_ALLOWANCES", "TIME_PREMIUMS", "OVERTIME"],
            "knownHourlyShiftSubtotalCents",
        ),
        Kind::Time => (
            "draft-known-monthly-components-with-time-premiums",
            ["SHIFT_ALLOWANCES", "OTHER_TIME_PREMIUMS", "OVERTIME"],
            "knownTimePremiumSubtotalCents",
        ),
        Kind::Overtime => (
            "draft-known-monthly-components-with-overtime",
            ["SHIFT_ALLOWANCES", "TIME_PREMIUMS", "OTHER_OVERTIME"],
            "knownOvertimeSubtotalCents",
        ),
    };
    let mut result = result(base, kind_name, total, positions, excluded);
    result[key] = json!(line_subtotal);
    if kind == Kind::Overtime {
        result["knownOvertimeBaseSubtotalCents"] = json!(safe(amount).unwrap());
        result["knownOvertimePremiumSubtotalCents"] = json!(safe(premium_amount).unwrap());
    }
    Ok(result)
}
