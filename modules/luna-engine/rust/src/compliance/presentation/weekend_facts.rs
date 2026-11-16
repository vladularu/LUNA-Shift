use super::facts::{date, integer};
use jiff::{ToSpan, civil::Date};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

const REASONS: [&str; 6] = [
    "WORK_RECORDED",
    "WORK_NOT_CONFIRMED_COMPLETE",
    "OUTSIDE_COVERAGE",
    "UNRESOLVED_DUTY",
    "INVALID_DUTY",
    "EMPLOYMENT_CONTEXT_CHANGED",
];
pub(super) fn affected(value: &Value) -> impl Iterator<Item = &Value> {
    value["windows"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|window| {
            window["assessmentComplete"] == true
                && window["unknownCount"].as_f64() == Some(0.0)
                && window["freeCount"].as_f64().is_some_and(|n| n < 2.0)
        })
}
fn unique_strings(value: &Value, predicate: impl Fn(&str) -> bool) -> bool {
    let Some(items) = value.as_array() else {
        return false;
    };
    let mut seen = BTreeSet::new();
    items.iter().all(|item| {
        item.as_str()
            .is_some_and(|text| predicate(text) && seen.insert(text))
    })
}
fn weekend(value: &Value) -> bool {
    let Some(saturday) = date(&value["saturday"]) else {
        return false;
    };
    if !value.is_object()
        || saturday.weekday().to_monday_one_offset() != 6
        || saturday.checked_add(1.days()).ok() != date(&value["sunday"])
        || !unique_strings(&value["relatedShiftIds"], |text| !text.is_empty())
        || !unique_strings(&value["reasons"], |text| REASONS.contains(&text))
    {
        return false;
    }
    let ids = value["relatedShiftIds"].as_array().unwrap();
    let reasons = value["reasons"].as_array().unwrap();
    match value["status"].as_str() {
        Some("FREE") => ids.is_empty() && reasons.is_empty(),
        Some("OCCUPIED") => {
            !ids.is_empty() && reasons.iter().any(|reason| reason == "WORK_RECORDED")
        }
        Some("UNKNOWN") => !reasons.is_empty(),
        _ => false,
    }
}
fn counts(value: &Value, weekends: &[Value]) -> bool {
    [
        ("freeCount", "FREE"),
        ("occupiedCount", "OCCUPIED"),
        ("unknownCount", "UNKNOWN"),
    ]
    .into_iter()
    .all(|(key, status)| {
        integer(&value[key])
            == Some(weekends.iter().filter(|w| w["status"] == status).count() as i64)
    })
}
fn consistent<'a>(value: &'a Value, known: &mut BTreeMap<&'a str, Vec<&'a Value>>) -> bool {
    let key = value["saturday"].as_str().unwrap();
    let identity = ["saturday", "sunday", "status", "relatedShiftIds", "reasons"]
        .into_iter()
        .map(|key| &value[key])
        .collect::<Vec<_>>();
    known
        .insert(key, identity.clone())
        .is_none_or(|old| old == identity)
}
fn verify(value: &Value) -> Option<()> {
    if !value.is_object() || value["policyVersion"] != "2026-11-09-four-weeks" {
        return None;
    }
    let month = value["month"].as_str()?;
    if month.len() != 7 {
        return None;
    }
    let first: Date = crate::calendar::parse_date(&format!("{month}-01")).ok()?;
    let mut end = first
        .checked_add(((7 - first.weekday().to_monday_one_offset()) % 7).days())
        .ok()?;
    let mut ends = Vec::new();
    while end.month() == first.month() {
        ends.push(end);
        end = end.checked_add(7.days()).ok()?;
    }
    let weekends = value["weekends"].as_array()?;
    let windows = value["windows"].as_array()?;
    if weekends.len() != ends.len()
        || windows.len() != ends.len()
        || integer(&value["totalCount"]) != Some(ends.len() as i64)
        || !weekends.iter().all(weekend)
        || !counts(value, weekends)
        || weekends
            .iter()
            .zip(&ends)
            .any(|(w, e)| w["sunday"].as_str() != Some(e.to_string().as_str()))
    {
        return None;
    }
    let mut known = BTreeMap::new();
    if !weekends.iter().all(|w| consistent(w, &mut known)) {
        return None;
    }
    for (window, end) in windows.iter().zip(ends) {
        let members = window["weekends"].as_array()?;
        if !window.is_object()
            || !window["assessmentComplete"].is_boolean()
            || window["until"].as_str() != Some(end.to_string().as_str())
            || window["from"].as_str()
                != Some(end.checked_sub(27.days()).ok()?.to_string().as_str())
            || members.len() != 4
            || !members.iter().all(weekend)
            || !counts(window, members)
            || window["assessmentComplete"] == true
                && (integer(&window["unknownCount"]) != Some(0)
                    || members.iter().any(|member| {
                        member["reasons"].as_array().unwrap().iter().any(|r| {
                            matches!(
                                r.as_str(),
                                Some(
                                    "WORK_NOT_CONFIRMED_COMPLETE"
                                        | "OUTSIDE_COVERAGE"
                                        | "EMPLOYMENT_CONTEXT_CHANGED"
                                )
                            )
                        })
                    }))
        {
            return None;
        }
        for (index, member) in members.iter().enumerate() {
            if member["sunday"].as_str()
                != Some(
                    end.checked_sub(((3 - index) as i64 * 7).days())
                        .ok()?
                        .to_string()
                        .as_str(),
                )
                || !consistent(member, &mut known)
            {
                return None;
            }
        }
    }
    Some(())
}
pub fn valid(value: &Value) -> bool {
    verify(value).is_some()
}
