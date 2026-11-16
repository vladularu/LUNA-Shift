//! Versioned holiday facts plus explicit confirmations; no compensation or shift status is inferred.
use crate::{
    calendar::parse_date,
    rules::{
        RuleResolver,
        holidays::{HolidayError, HolidayMonthResolution, resolve_holiday_map_for_month},
    },
};
use serde_json::{Value, json};
use std::collections::BTreeMap;
fn unavailable(reason: &str, value: Option<&Value>) -> Value {
    let mut out = json!({"kind":"unavailable","reason":reason});
    if let Some(value) = value {
        for field in ["shiftId", "date"] {
            if let Some(v) = value.get(field) {
                out[field] = v.clone();
            }
        }
    }
    out
}
fn real_date(value: &Value) -> bool {
    value.as_str().is_some_and(|s| parse_date(s).is_ok())
}
fn fact(value: Option<&Value>) -> bool {
    value.is_some_and(|v| v.is_boolean() || v.is_null())
}
fn needs_saturday(slice: &Value, window: &Value) -> bool {
    if parse_date(slice["date"].as_str().expect("validated date"))
        .expect("validated date")
        .weekday()
        .to_monday_one_offset()
        != 6
    {
        return false;
    }
    let start = window["startMinute"].as_f64().unwrap_or(f64::NAN);
    let end = window["endMinute"].as_f64().unwrap_or(f64::NAN);
    let from = slice["fromMinute"].as_f64().expect("validated minute");
    let through = slice["throughMinute"].as_f64().expect("validated minute");
    if start < end {
        from < end && through > start
    } else {
        from < end || through > start
    }
}
pub fn derive_work_facts(
    pkg: &Value,
    slices: &[Value],
    raw_decisions: &[Value],
    federal_state: &str,
    holiday_region: &str,
    resolver: &RuleResolver,
) -> Result<Value, HolidayError> {
    derive_work_facts_from_rules(
        &pkg["rules"],
        slices,
        raw_decisions,
        federal_state,
        holiday_region,
        resolver,
    )
}
/// Borrowed package rules avoid serializing/cloning the complete tariff package in native compositions.
pub fn derive_work_facts_from_rules(
    rules: &Value,
    slices: &[Value],
    raw_decisions: &[Value],
    federal_state: &str,
    holiday_region: &str,
    resolver: &RuleResolver,
) -> Result<Value, HolidayError> {
    let Some(policy) = rules
        .get("caritasTimePremiumPolicy")
        .filter(|v| !v.is_null() && **v != false)
    else {
        return Ok(unavailable("MISSING_POLICY", None));
    };
    if holiday_region == "UNKNOWN" {
        return Ok(unavailable("HOLIDAY_REGION_UNCONFIRMED", None));
    }
    let mut decisions = BTreeMap::new();
    for decision in raw_decisions {
        if decision["shiftId"].as_str().is_none_or(str::is_empty)
            || !real_date(&decision["date"])
            || !fact(decision.get("holidayTimeOff"))
            || !fact(decision.get("shiftWork"))
            || decision["origin"] != "confirmed"
        {
            return Ok(unavailable("INVALID_DECISION", Some(decision)));
        }
        let key = (
            decision["shiftId"].as_str().expect("confirmed id"),
            decision["date"].as_str().expect("confirmed date"),
        );
        if decisions.insert(key, decision).is_some() {
            return Ok(unavailable("DECISION_AMBIGUOUS", Some(decision)));
        }
    }
    let mut holidays: BTreeMap<&str, HolidayMonthResolution> = BTreeMap::new();
    let mut out = Vec::with_capacity(slices.len());
    for slice in slices {
        let from = slice["fromMinute"].as_f64();
        let through = slice["throughMinute"].as_f64();
        if !real_date(&slice["date"])
            || !from.is_some_and(|n| n.fract() == 0.0 && (0.0..=9007199254740991.0).contains(&n))
            || !through
                .is_some_and(|n| n.fract() == 0.0 && (-9007199254740991.0..=1440.0).contains(&n))
            || from >= through
        {
            return Ok(unavailable("INVALID_WORKED_SLICE", Some(slice)));
        }
        let date = slice["date"].as_str().expect("validated date");
        let month = &date[..7];
        if !holidays.contains_key(month) {
            holidays.insert(
                month,
                resolve_holiday_map_for_month(month, federal_state, holiday_region, resolver)?,
            );
        }
        let resolution = &holidays[month];
        if resolution.status != "AVAILABLE" {
            return Ok(unavailable("HOLIDAY_RULES_UNAVAILABLE", Some(slice)));
        }
        let holiday = resolution.holidays.contains_key(date);
        let decision = decisions
            .get(&(slice["shiftId"].as_str().unwrap_or("undefined"), date))
            .copied();
        if holiday && !decision.is_some_and(|d| d["holidayTimeOff"].is_boolean()) {
            return Ok(unavailable("HOLIDAY_TIME_OFF_UNCONFIRMED", Some(slice)));
        }
        if needs_saturday(slice, &policy["saturdayWindow"])
            && !decision.is_some_and(|d| d["shiftWork"].is_boolean())
        {
            return Ok(unavailable("SHIFT_WORK_UNCONFIRMED", Some(slice)));
        }
        out.push(json!({"date":date,"fromMinute":slice["fromMinute"],"throughMinute":slice["throughMinute"],"publicHoliday":holiday,"holidayTimeOff":if holiday{&decision.expect("confirmed holiday")["holidayTimeOff"]}else{&Value::Null},"shiftWork":decision.map_or(&Value::Null,|d|&d["shiftWork"])}));
    }
    Ok(
        json!({"kind":"confirmed-work-facts","slices":out,"federalState":federal_state,"holidayRegion":holiday_region}),
    )
}
