use super::{money, package, sum, working_rules};
use crate::{
    calendar::parse_date,
    net::js_truthy,
    remuneration::{
        base::BaseError,
        caritas::{
            lookup::{rows, unavailable},
            personal_base::text,
            reference::{integer, product},
        },
        context::{model::NativePackageValidator, selection::resolve_tariff_selection},
    },
    rules::RulePackage,
};
use serde_json::{Value, json};
use std::collections::BTreeMap;
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Premium {
    Night,
    Sunday,
    HolidayWith,
    HolidayWithout,
    PreHoliday,
    Saturday,
}
impl Premium {
    fn label(self) -> &'static str {
        match self {
            Self::Night => "NIGHT",
            Self::Sunday => "SUNDAY",
            Self::HolidayWith => "HOLIDAY_WITH_TIME_OFF",
            Self::HolidayWithout => "HOLIDAY_WITHOUT_TIME_OFF",
            Self::PreHoliday => "PRE_HOLIDAY",
            Self::Saturday => "SATURDAY",
        }
    }
}
struct Bucket<'a> {
    date: &'a str,
    premium: Premium,
    minutes: i64,
    hourly: i64,
    rate: i64,
}
fn count<'a>(
    buckets: &mut Vec<Bucket<'a>>,
    index: &mut BTreeMap<(&'a str, Premium, i64), usize>,
    date: &'a str,
    premium: Premium,
    hourly: i64,
    rate: i64,
) {
    let key = (date, premium, hourly);
    let i = if let Some(&i) = index.get(&key) {
        i
    } else {
        let i = buckets.len();
        index.insert(key, i);
        buckets.push(Bucket {
            date,
            premium,
            minutes: 0,
            hourly,
            rate,
        });
        i
    };
    buckets[i].minutes += 1;
    buckets[i].rate = rate;
}
fn window(minute: i64, value: &Value) -> bool {
    let start = integer(&value["startMinute"]).expect("validated window");
    let end = integer(&value["endMinute"]).expect("validated window");
    if start < end {
        minute >= start && minute < end
    } else {
        minute >= start || minute < end
    }
}
pub fn calculate(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    if !package(pkg, true, validator)? {
        return Ok(unavailable("INVALID_PACKAGE"));
    }
    let variant = text(input, "variantId");
    let region = text(input, "regionId");
    let selected = resolve_tariff_selection(pkg, variant, region);
    let Some(selected) =
        selected.filter(|s| s.family_id == "avr-caritas-p" && s.engine_id == "avr-caritas-p-v1")
    else {
        return Ok(unavailable("UNKNOWN_SELECTION"));
    };
    let Some(policy) = pkg
        .rules()
        .get("caritasTimePremiumPolicy")
        .filter(|p| !p.is_null())
    else {
        return Ok(unavailable("MISSING_POLICY"));
    };
    if !js_truthy(&input["workDataComplete"]) {
        return Ok(unavailable("WORK_DATA_INCOMPLETE"));
    }
    if !matches!(
        input["localAgreement"].as_str(),
        Some("NONE_CONFIRMED" | "UNKNOWN")
    ) {
        return Ok(unavailable("LOCAL_AGREEMENT_UNSUPPORTED"));
    }
    let table_id = selected
        .region
        .get("payTableId")
        .filter(|v| !v.is_null())
        .unwrap_or(&pkg.rules()["selector"]["payTableId"]);
    let table = rows(pkg.rules(), "payTables")
        .iter()
        .find(|t| &t["id"] == table_id);
    let reference = table.and_then(|t| {
        rows(t, "entries")
            .iter()
            .find(|e| e["groupId"] == input["groupId"] && e["stepId"] == policy["referenceStepId"])
    });
    let Some(reference) = reference else {
        return Ok(unavailable("MISSING_REFERENCE_PAY"));
    };
    let mut buckets = Vec::new();
    let mut index = BTreeMap::new();
    for slice in rows(input, "workedSlices") {
        let date = text(slice, "date");
        let parsed = parse_date(date);
        let from = integer(&slice["fromMinute"]);
        let through = integer(&slice["throughMinute"]);
        if parsed.is_err()
            || !from.is_some_and(|n| n >= 0)
            || !through.is_some_and(|n| n <= 1440)
            || from >= through
        {
            return Ok(unavailable("INVALID_WORKED_SLICE"));
        }
        let parsed = parsed.expect("validated date");
        if date < pkg.valid_from.as_str()
            || pkg.valid_to.as_deref().is_some_and(|to| date > to)
            || date < text(policy, "validFrom")
            || date > text(policy, "validTo")
        {
            return Ok(unavailable("OUTSIDE_VALIDITY"));
        }
        if !slice["publicHoliday"].is_boolean() {
            return Ok(unavailable("HOLIDAY_UNKNOWN"));
        }
        let holiday = slice["publicHoliday"] == true;
        if holiday && !slice["holidayTimeOff"].is_boolean() {
            return Ok(unavailable("HOLIDAY_TIME_OFF_UNKNOWN"));
        }
        let times = working_rules(pkg, date, variant, region, false);
        if times.len() != 1 {
            return Ok(unavailable("MISSING_WORKING_TIME"));
        }
        let hourly = money(
            integer(&reference["monthlyCents"]).and_then(|n| product(n, 60_000)),
            integer(&times[0]["fullTimeWeeklyMinutes"])
                .zip(integer(&policy["monthlyFactorThousandths"]))
                .and_then(|(a, b)| product(a, b)),
        )?;
        let weekday = parsed.weekday().to_monday_one_offset();
        for minute in from.expect("validated minute")..through.expect("validated minute") {
            if window(minute, &policy["nightWindow"]) {
                count(
                    &mut buckets,
                    &mut index,
                    date,
                    Premium::Night,
                    hourly,
                    integer(&policy["nightBasisPoints"]).expect("validated rate"),
                );
            }
            let mut winner: Option<(Premium, i64)> = None;
            let mut consider = |premium, rate| {
                let rate = integer(rate).expect("validated rate");
                if winner.is_none_or(|(_, best)| rate > best) {
                    winner = Some((premium, rate));
                }
            };
            if weekday == 7 {
                consider(Premium::Sunday, &policy["sundayBasisPoints"]);
            }
            if holiday {
                if slice["holidayTimeOff"] == true {
                    consider(
                        Premium::HolidayWith,
                        &policy["holidayWithTimeOffBasisPoints"],
                    );
                } else {
                    consider(
                        Premium::HolidayWithout,
                        &policy["holidayWithoutTimeOffBasisPoints"],
                    );
                }
            }
            if rows(policy, "preHolidayMonthDays")
                .iter()
                .any(|d| d.as_str() == Some(&date[5..]))
                && window(minute, &policy["preHolidayWindow"])
            {
                consider(Premium::PreHoliday, &policy["preHolidayBasisPoints"]);
            }
            if weekday == 6 && window(minute, &policy["saturdayWindow"]) {
                if !slice["shiftWork"].is_boolean() {
                    return Ok(unavailable("SHIFT_WORK_UNKNOWN"));
                }
                if slice["shiftWork"] == false {
                    consider(Premium::Saturday, &policy["saturdayBasisPoints"]);
                }
            }
            if let Some((premium, rate)) = winner {
                count(&mut buckets, &mut index, date, premium, hourly, rate);
            }
        }
    }
    let mut positions = Vec::with_capacity(buckets.len());
    let mut amounts = Vec::with_capacity(buckets.len());
    for bucket in buckets {
        let amount = money(
            product(bucket.hourly, bucket.rate).and_then(|n| product(n, bucket.minutes)),
            Some(600_000),
        )?;
        amounts.push(amount);
        positions.push(json!({"date":bucket.date,"premium":bucket.premium.label(),"minutes":bucket.minutes,"referenceHourlyCents":bucket.hourly,"percentageBasisPoints":bucket.rate,"amountCents":amount}));
    }
    Ok(
        json!({"kind":"federal-baseline-time-premiums","status":"estimated","amountCents":sum(amounts.into_iter()),"packageId":pkg.package_id,"versionId":pkg.version_id,"sourceIds":policy["sourceIds"],"localAgreementUnconfirmed":input["localAgreement"]=="UNKNOWN","positions":positions}),
    )
}
