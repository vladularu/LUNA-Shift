//! Source-compatible validation retains the original metadata on success.
use super::weekend_facts;
use crate::{calendar::parse_date, compliance::policy};
use jiff::civil::Date;
use serde_json::Value;

pub(super) fn integer(value: &Value) -> Option<i64> {
    value
        .as_f64()
        .filter(|n| {
            n.is_finite() && n.fract() == 0.0 && (0.0..=9_007_199_254_740_991.0).contains(n)
        })
        .map(|n| n as i64)
}
pub(super) fn date(value: &Value) -> Option<Date> {
    let text = value.as_str()?;
    parse_date(text)
        .ok()
        .filter(|date| date.to_string() == text)
}
fn positive(value: &Value) -> bool {
    integer(value).is_some_and(|n| n > 0)
}
fn difference(first: &Value, last: &Value) -> Option<i32> {
    date(last)?
        .since(date(first)?)
        .ok()
        .map(|span| span.get_days())
}
fn night(value: &Value, count: i64) -> bool {
    if !value.is_object()
        || value["policyVersion"] != policy::NIGHT_POLICY_VERSION
        || difference(&value["firstNight"], &value["lastNight"]).map(i64::from) != Some(count - 1)
        || !value["countIsMinimum"].is_boolean()
        || !value["lastShiftId"].is_string()
        || !value
            .get("nextShiftId")
            .is_some_and(|v| v.is_null() || v.is_string())
    {
        return false;
    }
    let Some(rest) = value.get("restMinutes") else {
        return false;
    };
    if !rest.is_null() && value["nextShiftId"].is_null() {
        return false;
    }
    match value["recoveryStatus"].as_str() {
        Some("open" | "unknown") => rest.is_null(),
        Some("under24") => integer(rest).is_some_and(|n| n < policy::MINIMUM_RECOVERY_MINUTES),
        Some("under48") => integer(rest).is_some_and(|n| {
            (policy::MINIMUM_RECOVERY_MINUTES..policy::PREFERRED_RECOVERY_MINUTES).contains(&n)
        }),
        Some("atLeast48") => integer(rest).is_some_and(|n| n >= policy::PREFERRED_RECOVERY_MINUTES),
        _ => false,
    }
}
fn weekend_sequence(value: &Value, count: i64) -> bool {
    let Some(first) = date(&value["firstSaturday"]) else {
        return false;
    };
    let Some(last) = date(&value["lastSunday"]) else {
        return false;
    };
    value.is_object()
        && value["policyVersion"] == "2026-11-08"
        && first.weekday().to_monday_one_offset() == 6
        && last.weekday().to_monday_one_offset() == 7
        && difference(&value["firstSaturday"], &value["lastSunday"]).map(i64::from)
            == (count - 1).checked_mul(7).and_then(|n| n.checked_add(1))
}
pub fn valid<'a>(value: &'a Value, rule: &str) -> Option<&'a Value> {
    if !value.is_object() || value["rule"].as_str() != Some(rule) {
        return None;
    }
    let valid = match rule {
        "ARBZG_5_REST_10H" | "JARBSCHG_13_REST" => {
            integer(&value["restMinutes"]).is_some() && positive(&value["minimumRestMinutes"])
        }
        "ARBZG_5_REST_11H" => {
            integer(&value["restMinutes"]).is_some()
                && positive(&value["compensationMinutes"])
                && date(&value["compensationDeadline"]).is_some()
        }
        "ARBZG_4_BREAK" => {
            integer(&value["recordedBreakMinutes"]).is_some()
                && integer(&value["requiredBreakMinutes"]).is_some()
        }
        "ARBZG_4_INTERRUPTION" => integer(&value["interruptionMinutes"]).is_some(),
        "ARBZG_3_MAX_10H" => {
            integer(&value["netMinutes"]).is_some() && positive(&value["maximumMinutes"])
        }
        "ARBZG_3_OVER_8H" => integer(&value["netMinutes"]).is_some(),
        "ARBZG_4_CONTINUOUS" => positive(&value["maximumContinuousMinutes"]),
        "TIME_PLAUSIBILITY" => {
            integer(&value["breakMinutes"]).is_some() && integer(&value["grossMinutes"]).is_some()
        }
        "TIME_GROSS_OVER_16H" => integer(&value["grossMinutes"]).is_some(),
        "PLANNING_7_DAYS" => positive(&value["count"]),
        "PLANNING_NIGHT_SERIES" | "PLANNING_NIGHT_RECOVERY" => integer(&value["count"])
            .is_some_and(|count| {
                if count <= 0 {
                    return false;
                }
                match value.get("nightSequence") {
                    None => rule == "PLANNING_NIGHT_SERIES",
                    Some(sequence) => {
                        night(sequence, count)
                            && if rule == "PLANNING_NIGHT_SERIES" {
                                count >= policy::FIRST_NIGHT_HINT as i64
                            } else {
                                count >= policy::MINIMUM_SERIES_FOR_RECOVERY as i64
                                    && matches!(
                                        sequence["recoveryStatus"].as_str(),
                                        Some("under24" | "under48")
                                    )
                            }
                    }
                }
            }),
        "PLANNING_LATE_EARLY" => true,
        "PLANNING_WEEKEND_RECOVERY" => {
            weekend_facts::valid(&value["assessment"])
                && weekend_facts::affected(&value["assessment"])
                    .next()
                    .is_some()
        }
        "PLANNING_WEEKENDS" => {
            if value.get("count").is_none() && value.get("weekendSeries").is_none() {
                true
            } else {
                integer(&value["count"]).is_some_and(|count| {
                    count >= 3 && weekend_sequence(&value["weekendSeries"], count)
                })
            }
        }
        _ => false,
    };
    valid.then_some(value)
}
