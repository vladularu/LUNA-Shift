use super::*;
use std::collections::BTreeMap;
fn window(minute: i64, w: &Value) -> bool {
    let a = w["startMinute"].as_i64().unwrap();
    let b = w["endMinute"].as_i64().unwrap();
    if a < b {
        minute >= a && minute < b
    } else {
        minute >= a || minute < b
    }
}
pub fn time(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    if pkg.engine_contract_version != 15
        || pkg.status() != Some("DRAFT")
        || !validator.validate(pkg)?
    {
        return Ok(unavailable("INVALID_PACKAGE"));
    }
    let Some(b) = input["month"].as_str().and_then(bounds) else {
        return Ok(unavailable("INVALID_MONTH"));
    };
    if b.start < pkg.valid_from || pkg.valid_to.as_ref().is_some_and(|to| b.end > *to) {
        return Ok(unavailable("OUTSIDE_VALIDITY"));
    }
    if !js_truthy(&input["avrddApplicabilityConfirmed"]) {
        return Ok(unavailable("AVRDD_APPLICABILITY_UNCONFIRMED"));
    }
    if !js_truthy(&input["workDataComplete"]) {
        return Ok(unavailable("WORK_DATA_INCOMPLETE"));
    }
    if input["premiumArrangement"] == "UNKNOWN" {
        return Ok(unavailable("LOCAL_AGREEMENT_UNKNOWN"));
    }
    if input["premiumArrangement"] != "NONE_CONFIRMED" {
        return Ok(unavailable("LOCAL_AGREEMENT_UNSUPPORTED"));
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
    let Some(policy) = pkg
        .rules()
        .get("avrddTimePremiumPolicy")
        .filter(|p| js_truthy(p))
    else {
        return Ok(unavailable("MISSING_POLICY"));
    };
    let rates: Vec<_> = rows(pkg.rules(), "avrddHourlyRates")
        .iter()
        .filter(|r| r["groupId"] == group)
        .collect();
    if rates.len() != 1 {
        return Ok(unavailable("MISSING_HOURLY_RATE"));
    }
    let rate = rates[0];
    let sources = source_ids(&[rate, policy]);
    let mut buckets = Vec::<(&str, &str, i64, i64)>::new();
    let mut prior = BTreeMap::<&str, Vec<(i64, i64)>>::new();
    let slices = input["workedSlices"]
        .as_array()
        .ok_or(BaseError::InvalidCalculation)?;
    for slice in slices {
        let date = slice["date"].as_str().unwrap_or("");
        let from = slice["fromMinute"].as_f64();
        let through = slice["throughMinute"].as_f64();
        let (Some(from), Some(through)) = (from, through) else {
            return Ok(unavailable("INVALID_WORKED_SLICE"));
        };
        if !real_date(date)
            || !safe(from)
            || !safe(through)
            || from < 0.0
            || through > 1440.0
            || from >= through
        {
            return Ok(unavailable("INVALID_WORKED_SLICE"));
        }
        if date.get(..7) != input["month"].as_str() {
            return Ok(unavailable("OUTSIDE_MONTH"));
        }
        if slice["workKind"] != "REGULAR_ACTIVE" {
            return Ok(unavailable("SPECIAL_WORK_UNSUPPORTED"));
        }
        let Some(holiday) = slice["publicHoliday"].as_bool() else {
            return Ok(unavailable("HOLIDAY_UNKNOWN"));
        };
        let (from, through) = (from as i64, through as i64);
        let existing = prior.entry(date).or_default();
        if existing.iter().any(|(a, b)| from < *b && through > *a) {
            return Ok(unavailable("WORKED_SLICES_OVERLAP"));
        }
        existing.push((from, through));
        let weekday = crate::calendar::parse_date(date)?
            .weekday()
            .to_monday_one_offset();
        for minute in from..through {
            if window(minute, &policy["nightWindow"]) {
                let Some(eligible) = slice["nightPremiumEligible"].as_bool() else {
                    return Ok(unavailable("NIGHT_ELIGIBILITY_UNKNOWN"));
                };
                if eligible {
                    count(
                        &mut buckets,
                        date,
                        "NIGHT",
                        rate["nightCents"]
                            .as_i64()
                            .ok_or(BaseError::InvalidCalculation)?,
                    );
                }
            }
            let mut winner: Option<(&str, i64)> = None;
            let mut consider = |kind, cents: &Value| -> Result<(), BaseError> {
                let cents = cents.as_i64().ok_or(BaseError::InvalidCalculation)?;
                if winner.is_none_or(|(_, best)| cents > best) {
                    winner = Some((kind, cents));
                }
                Ok(())
            };
            if weekday == 7 {
                consider("SUNDAY", &rate["sundayOrHolidayCents"])?;
            }
            if holiday {
                consider(
                    if weekday == 7 {
                        "HOLIDAY_ON_SUNDAY"
                    } else {
                        "HOLIDAY"
                    },
                    &rate[if weekday == 7 {
                        "holidayOnSundayCents"
                    } else {
                        "sundayOrHolidayCents"
                    }],
                )?;
            }
            if weekday == 6 && window(minute, &policy["saturdayWindow"]) {
                consider("SATURDAY", &rate["saturdayCents"])?;
            }
            if let Some((kind, cents)) = winner {
                count(&mut buckets, date, kind, cents);
            }
        }
    }
    let mut positions = Vec::new();
    let mut total = 0.0;
    for (date, premium, minutes, rate) in buckets {
        let amount = round_remuneration_cents(rate as f64 * minutes as f64, 60.0)?;
        total += amount as f64;
        positions.push(json!({"date":date,"premium":premium,"minutes":minutes,"printedRateCentsPerHour":rate,"amountCents":amount}));
    }
    if !safe(total) {
        return Ok(unavailable("AMOUNT_OVERFLOW"));
    }
    Ok(
        json!({"kind":"draft-time-premiums","status":"estimated","completeGross":false,"packageId":pkg.package_id,"versionId":pkg.version_id,"month":input["month"],"groupId":group,"amountCents":total as i64,"sourceIds":sources,"positions":positions,"excludedComponents":["OVERTIME","ALLOWANCES","ANNUAL_PAYMENT","OTHER_LOCAL_TERMS"]}),
    )
}
fn count<'a>(
    buckets: &mut Vec<(&'a str, &'a str, i64, i64)>,
    date: &'a str,
    premium: &'a str,
    rate: i64,
) {
    if let Some(b) = buckets.iter_mut().find(|b| b.0 == date && b.1 == premium) {
        b.2 += 1;
        b.3 = rate;
    } else {
        buckets.push((date, premium, 1, rate));
    }
}
