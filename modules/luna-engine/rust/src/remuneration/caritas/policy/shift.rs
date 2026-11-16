use super::{money, package, sum, working_rules};
use crate::{
    calendar::parse_date,
    remuneration::{
        base::BaseError,
        caritas::{
            lookup::{rows, unavailable},
            overtime::source_ids,
            personal_base::text,
            reference::{integer, product},
        },
        context::{model::NativePackageValidator, selection::resolve_tariff_selection},
    },
    rules::RulePackage,
};
use jiff::ToSpan;
use serde_json::{Value, json};
use std::collections::BTreeMap;
struct Bucket<'a> {
    status: &'a str,
    rate: &'a Value,
    full: i64,
    sources: Value,
    days: i64,
    worked: i64,
    estimated: bool,
}
pub fn calculate(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    if !package(pkg, false, validator)? {
        return Ok(unavailable("INVALID_PACKAGE"));
    }
    let from = text(input, "from");
    let through = text(input, "through");
    let (Ok(first), Ok(last)) = (parse_date(from), parse_date(through)) else {
        return Ok(unavailable("INVALID_PERIOD"));
    };
    if from > through || from[..7] != through[..7] {
        return Ok(unavailable("INVALID_PERIOD"));
    }
    if from < pkg.valid_from.as_str() || pkg.valid_to.as_deref().is_some_and(|to| through > to) {
        return Ok(unavailable("OUTSIDE_VALIDITY"));
    }
    let variant = text(input, "variantId");
    let region = text(input, "regionId");
    let selection = resolve_tariff_selection(pkg, variant, region);
    if selection.as_ref().is_none_or(|s| {
        s.family_id != "avr-caritas-p"
            || s.engine_id != "avr-caritas-p-v1"
            || s.capabilities
                .as_object()
                .is_none_or(|c| c.values().any(|v| v != "UNSUPPORTED"))
    }) {
        return Ok(unavailable("UNKNOWN_SELECTION"));
    }
    let Some(weekly) = integer(&input["weeklyMinutes"]).filter(|n| *n >= 60) else {
        return Ok(unavailable("INVALID_WEEKLY_TIME"));
    };
    if input["workDaysComplete"] != true {
        return Ok(unavailable("WORK_DATA_INCOMPLETE"));
    }
    let mut work = BTreeMap::new();
    for day in rows(input, "workedDays") {
        let date = text(day, "date");
        if parse_date(date).is_err()
            || date < from
            || date > through
            || work.contains_key(date)
            || !integer(&day["workedMinutes"]).is_some_and(|m| (0..=1440).contains(&m))
            || !day["estimatedPause"].is_boolean()
        {
            return Ok(unavailable("INVALID_WORKED_MINUTES"));
        }
        work.insert(date, day);
    }
    let entitlements = rows(input, "entitlements");
    for item in entitlements {
        let a = text(item, "from");
        let b = text(item, "through");
        if parse_date(a).is_err()
            || parse_date(b).is_err()
            || a > b
            || !matches!(
                item["status"].as_str(),
                Some(
                    "NONE"
                        | "ALTERNATING_MONTHLY"
                        | "ALTERNATING_HOURLY"
                        | "SHIFT_MONTHLY"
                        | "SHIFT_HOURLY"
                )
            )
        {
            return Ok(unavailable("DECISION_AMBIGUOUS"));
        }
    }
    let mut buckets: Vec<Bucket<'_>> = Vec::new();
    let mut index = BTreeMap::new();
    let mut date = first;
    loop {
        let day = date.to_string();
        let times = working_rules(pkg, &day, variant, region, true);
        if times.len() != 1 {
            return Ok(unavailable("MISSING_WORKING_TIME"));
        }
        let full =
            integer(&times[0]["fullTimeWeeklyMinutes"]).ok_or(BaseError::InvalidCalculation)?;
        if weekly > full {
            return Ok(unavailable("INVALID_WEEKLY_TIME"));
        }
        let rates: Vec<_> = rows(pkg.rules(), "caritasShiftAllowanceRates")
            .iter()
            .filter(|r| {
                r["variantId"] == variant
                    && r["regionId"] == region
                    && r["validFrom"]
                        .as_str()
                        .is_some_and(|from| from <= day.as_str())
                    && r["validTo"].as_str().is_some_and(|to| day.as_str() <= to)
            })
            .collect();
        if rates.len() != 1 {
            return Ok(unavailable("MISSING_SHIFT_RATE"));
        }
        let decisions: Vec<_> = entitlements
            .iter()
            .filter(|e| text(e, "from") <= day.as_str() && day.as_str() <= text(e, "through"))
            .collect();
        if decisions.len() > 1 {
            return Ok(unavailable("DECISION_AMBIGUOUS"));
        }
        if decisions.len() != 1 || decisions[0]["origin"] != "confirmed" {
            return Ok(unavailable("DECISION_MISSING"));
        }
        let status = decisions[0]["status"].as_str().expect("validated status");
        if status != "NONE" {
            let rate = rates[0];
            let key = (status, text(rate, "id"), full);
            let position = if let Some(&i) = index.get(&key) {
                i
            } else {
                let i = buckets.len();
                index.insert(key, i);
                buckets.push(Bucket {
                    status,
                    rate,
                    full,
                    sources: source_ids(&rate["sourceIds"], &times[0]["sourceIds"]),
                    days: 0,
                    worked: 0,
                    estimated: false,
                });
                i
            };
            let bucket = &mut buckets[position];
            bucket.days += 1;
            if !status.ends_with("_MONTHLY")
                && let Some(work) = work.get(day.as_str())
            {
                bucket.worked += integer(&work["workedMinutes"]).expect("validated minutes");
                bucket.estimated |= work["estimatedPause"] == true;
            }
        }
        if date == last {
            break;
        }
        date = date
            .checked_add(1.days())
            .map_err(|_| BaseError::InvalidCalculation)?;
    }
    let month_days = i64::from(first.last_of_month().day());
    let mut positions = Vec::with_capacity(buckets.len());
    let mut estimated = false;
    let mut amounts = Vec::with_capacity(buckets.len());
    for bucket in buckets {
        let monthly = bucket.status.ends_with("_MONTHLY");
        let alternating = bucket.status.starts_with("ALTERNATING");
        let key = match (alternating, monthly) {
            (true, true) => "alternatingMonthlyCents",
            (true, false) => "alternatingHourlyCents",
            (false, true) => "shiftMonthlyCents",
            (false, false) => "shiftHourlyCents",
        };
        let rate = integer(&bucket.rate[key]).ok_or(BaseError::InvalidCalculation)?;
        let personal = if monthly {
            Some(money(product(rate, weekly), Some(bucket.full))?)
        } else {
            None
        };
        let amount = if let Some(personal) = personal {
            money(product(personal, bucket.days), Some(month_days))?
        } else {
            money(product(rate, bucket.worked), Some(60))?
        };
        estimated |= bucket.estimated || monthly && bucket.days < month_days;
        amounts.push(amount);
        positions.push(json!({"allowanceStatus":bucket.status,"rateId":bucket.rate["id"],"rateCents":rate,"personalMonthlyCents":personal,"calendarDays":bucket.days,"workedMinutes":bucket.worked,"amountCents":amount,"sourceIds":bucket.sources}));
    }
    Ok(
        json!({"kind":"personal-shift-allowance","amountCents":sum(amounts.into_iter()),"status":if estimated{"estimated"}else{"calculated"},"packageId":pkg.package_id,"versionId":pkg.version_id,"positions":positions}),
    )
}
