//! Strict versioned special-duty and standby facts, independent of payroll.
use super::{InputError, local_date};
use crate::net::js_truthy;
use jiff::{ToSpan, civil::Time, fmt::temporal::DateTimeParser, tz::Disambiguation};
use serde_json::{Value, json};
fn invalid() -> InputError {
    InputError::source(
        "Bitte prüfe die Zeiten und Angaben zum Sonderdienst.",
        "Error",
    )
}
fn agreement_error() -> InputError {
    InputError::source(
        "Bitte prüfe die Abrechnungsgrundlage der Bereitschaft.",
        "Error",
    )
}
fn exact(value: &Value, keys: &[&str]) -> bool {
    value
        .as_object()
        .is_some_and(|v| v.len() == keys.len() && keys.iter().all(|k| v.contains_key(*k)))
}
fn integer(value: &Value, min: f64, max: f64) -> Option<i64> {
    value
        .as_f64()
        .filter(|n| n.fract() == 0.0 && (*n >= min && *n <= max))
        .map(|n| n as i64)
}
fn minute(value: &Value, max: f64) -> Result<i64, InputError> {
    integer(value, 0.0, max).ok_or_else(invalid)
}
fn one_of(value: &Value, items: &[&str]) -> bool {
    value.as_str().is_some_and(|v| items.contains(&v))
}
pub fn validate_standby_agreement(value: &Value) -> Result<Value, InputError> {
    if !exact(
        value,
        &[
            "tariff",
            "rule",
            "sequence",
            "payGroup",
            "rateMode",
            "hourlyCents",
            "timeOffMode",
        ],
    ) || !one_of(
        &value["tariff"],
        &["TVOED_K", "TVOED_B", "TVL_43", "TVH_43", "TVUK"],
    ) || !one_of(&value["rule"], &["UNKNOWN", "STANDARD", "CARE"])
        || (!value["sequence"].is_null() && integer(&value["sequence"], 1.0, 100.0).is_none())
        || (!value["payGroup"].is_null()
            && !value["payGroup"].as_str().is_some_and(|v| {
                !v.is_empty()
                    && v.chars().count() <= 40
                    && v.chars()
                        .all(|c| c.is_ascii_alphanumeric() || "_Ü/-".contains(c))
            }))
        || (!value["hourlyCents"].is_null()
            && integer(&value["hourlyCents"], 1.0, 100000.0).is_none())
        || !one_of(
            &value["timeOffMode"],
            &["UNKNOWN", "WEIGHTED", "FACTORIZED"],
        )
        || !one_of(&value["rateMode"], &["TABLE", "AGREED"])
        || (value["rateMode"] == "TABLE" && !value["hourlyCents"].is_null())
    {
        return Err(agreement_error());
    }
    Ok(value.clone())
}
fn part(value: &Value, callout: bool) -> Result<Value, InputError> {
    let keys: &[&str] = if callout {
        &[
            "start",
            "end",
            "breakMinutes",
            "kind",
            "departure",
            "returned",
        ]
    } else {
        &["start", "end", "breakMinutes"]
    };
    if !exact(value, keys) {
        return Err(invalid());
    }
    let start = minute(&value["start"], 20160.0)?;
    let end = minute(&value["end"], 20160.0)?;
    let pause = minute(&value["breakMinutes"], 1440.0)?;
    if end <= start || end - start > 1440 || pause >= end - start {
        return Err(invalid());
    }
    let mut result = json!({"start":start,"end":end,"breakMinutes":pause});
    if callout {
        if !one_of(&value["kind"], &["REMOTE", "ON_SITE"]) {
            return Err(invalid());
        }
        let departure = minute(&value["departure"], 20160.0)?;
        let returned = minute(&value["returned"], 20160.0)?;
        if departure > start
            || returned < end
            || returned - departure > 1440
            || (value["kind"] == "REMOTE" && (departure != start || returned != end))
        {
            return Err(invalid());
        }
        result["kind"] = value["kind"].clone();
        result["departure"] = json!(departure);
        result["returned"] = json!(returned);
    }
    Ok(result)
}
pub fn validate_special_duty(value: Option<&Value>) -> Result<Option<Value>, InputError> {
    let Some(value) = value.filter(|v| !v.is_null()) else {
        return Ok(None);
    };
    let version = integer(&value["version"], 1.0, 3.0).ok_or_else(invalid)?;
    let mut keys = vec![
        "version",
        "kind",
        "timeZone",
        "endDay",
        "parts",
        "callouts",
        "calloutsComplete",
        "standbyLevel",
        "settlement",
    ];
    if version >= 2 {
        keys.push("standbyAgreement");
    }
    if version == 3 {
        keys.push("breakStart");
    }
    if !exact(value, &keys) || !one_of(&value["kind"], &["SPLIT", "ON_CALL", "STANDBY"]) {
        return Err(invalid());
    }
    let zone = value["timeZone"].as_str().ok_or_else(invalid)?;
    crate::time_zone::zone(zone).map_err(|_| {
        InputError::source(
            "Die Zeitzone des Sonderdienstes ist ungültig.",
            "RangeError",
        )
    })?;
    let end_day = minute(&value["endDay"], 14.0)?;
    let parts = value["parts"]
        .as_array()
        .filter(|v| v.len() <= 8)
        .ok_or_else(invalid)?;
    let callouts = value["callouts"]
        .as_array()
        .filter(|v| v.len() <= 64)
        .ok_or_else(invalid)?;
    let parts = parts
        .iter()
        .map(|v| part(v, false))
        .collect::<Result<Vec<_>, _>>()?;
    let callouts = callouts
        .iter()
        .map(|v| part(v, true))
        .collect::<Result<Vec<_>, _>>()?;
    if !value["calloutsComplete"].is_boolean()
        || !one_of(
            &value["standbyLevel"],
            &["UNKNOWN", "I", "II", "III", "A", "B", "C", "D"],
        )
        || !one_of(&value["settlement"], &["UNKNOWN", "PAY", "TIME_OFF"])
        || (value["kind"] != "SPLIT" && !parts.is_empty())
        || (value["kind"] != "ON_CALL"
            && (!callouts.is_empty() || js_truthy(&value["calloutsComplete"])))
        || (version >= 2 && value["kind"] != "STANDBY")
    {
        return Err(invalid());
    }
    for (items, start, end) in [
        (&parts, "start", "end"),
        (&callouts, "departure", "returned"),
    ] {
        let mut intervals: Vec<_> = items
            .iter()
            .map(|v| {
                (
                    v[start].as_i64().expect("normalized start"),
                    v[end].as_i64().expect("normalized end"),
                )
            })
            .collect();
        intervals.sort_unstable();
        if intervals.windows(2).any(|v| v[0].1 > v[1].0) {
            return Err(invalid());
        }
    }
    let mut result = json!({"version":version,"kind":value["kind"],"timeZone":zone,"endDay":end_day,"parts":parts,"callouts":callouts,"calloutsComplete":value["calloutsComplete"],"standbyLevel":value["standbyLevel"],"settlement":value["settlement"]});
    if version >= 2 {
        result["standbyAgreement"] = if version == 3 && value["standbyAgreement"].is_null() {
            Value::Null
        } else {
            validate_standby_agreement(&value["standbyAgreement"])?
        };
    }
    if version == 3 {
        result["breakStart"] = if value["breakStart"].is_null() {
            Value::Null
        } else {
            json!(minute(&value["breakStart"], 20160.0)?)
        };
    }
    Ok(Some(result))
}
pub(crate) fn clock(value: &Value) -> Result<i64, InputError> {
    let time = DateTimeParser::new()
        .parse_time(value.as_str().ok_or_else(invalid)?)
        .map_err(|_| invalid())?;
    Ok(i64::from(time.hour()) * 60 + i64::from(time.minute()))
}
pub fn duty_instant_milliseconds(date: &str, minute: i64, zone: &str) -> Result<i64, InputError> {
    if !(0..21600).contains(&minute) {
        return Err(invalid());
    }
    let (date, cycles) = local_date::surrogate(date).ok_or_else(invalid)?;
    let date = date
        .checked_add(minute.div_euclid(1440).days())
        .map_err(|_| invalid())?;
    let time = Time::new(
        (minute.rem_euclid(1440) / 60) as i8,
        (minute.rem_euclid(60)) as i8,
        0,
        0,
    )
    .map_err(|_| invalid())?;
    let id = crate::time_zone::identifier(zone).map_err(|_| invalid())?;
    if !matches!(id.as_bytes().first(), Some(b'+' | b'-')) {
        // The frozen Temporal named-zone lookup uses a JS Date at the local
        // wall timestamp before applying offsets. At the extreme range this
        // must reject even if a later offset would move it back inside.
        let wall = date
            .to_datetime(time)
            .to_zoned(jiff::tz::TimeZone::UTC)
            .map_err(|_| invalid())?
            .timestamp()
            .as_millisecond();
        let wall = cycles
            .checked_mul(146097 * 86400000)
            .and_then(|n| wall.checked_add(n))
            .ok_or_else(invalid)?;
        if !(-8640000000000000..=8640000000000000).contains(&wall) {
            return Err(invalid());
        }
    }
    let zone = crate::time_zone::zone(zone).map_err(|_| invalid())?;
    let timestamp = zone
        .to_ambiguous_zoned(date.to_datetime(time))
        .disambiguate(Disambiguation::Reject)
        .map_err(|_| invalid())?
        .timestamp()
        .as_millisecond();
    let value = cycles
        .checked_mul(146097 * 86400000)
        .and_then(|n| timestamp.checked_add(n))
        .ok_or_else(invalid)?;
    if !(-8640000000000000..=8640000000000000).contains(&value) {
        return Err(invalid());
    }
    Ok(value)
}
pub fn validate_duty_parent(duty: Option<&Value>, parent: &Value) -> Result<(), InputError> {
    let Some(duty) = duty.filter(|v| !v.is_null()) else {
        return Ok(());
    };
    if js_truthy(&parent["allDay"])
        || !js_truthy(&parent["startTime"])
        || !js_truthy(&parent["endTime"])
        || one_of(&parent["type"], &["TRAINING", "VACATION", "SICK", "FREE"])
    {
        return Err(invalid());
    }
    let start = clock(&parent["startTime"])?;
    let end = minute(&duty["endDay"], 14.0)? * 1440 + clock(&parent["endTime"])?;
    let pause = if parent["breakMinutes"].is_null() {
        0.0
    } else {
        parent["breakMinutes"].as_f64().ok_or_else(invalid)?
    };
    if end <= start
        || end - start > 20160
        || (duty["kind"] != "ON_CALL" && end - start > 1440)
        || pause >= (end - start) as f64
        || (duty["kind"] == "ON_CALL" && pause != 0.0)
    {
        return Err(invalid());
    }
    let parts = duty["parts"].as_array().ok_or_else(invalid)?;
    let callouts = duty["callouts"].as_array().ok_or_else(invalid)?;
    if parts.iter().any(|v| {
        v["start"].as_f64().is_none_or(|n| n < end as f64)
            || v["end"].as_f64().is_none_or(|n| n - start as f64 > 1440.0)
    }) || callouts.iter().any(|v| {
        v["departure"].as_f64().is_none_or(|n| n < start as f64)
            || v["returned"].as_f64().is_none_or(|n| n > end as f64)
    }) {
        return Err(invalid());
    }
    let date = parent["date"]
        .as_str()
        .filter(|_| js_truthy(&parent["date"]));
    let zone = duty["timeZone"].as_str().ok_or_else(invalid)?;
    if !duty["breakStart"].is_null() && pause > 0.0 {
        let pause_start = minute(&duty["breakStart"], 20160.0)?;
        if pause_start < start || pause_start >= end {
            return Err(invalid());
        }
        if let Some(date) = date {
            if pause.fract() != 0.0
                || duty_instant_milliseconds(date, pause_start, zone)?
                    .checked_add((pause * 60000.0) as i64)
                    .is_none_or(|end_pause| {
                        duty_instant_milliseconds(date, end, zone)
                            .map_or(true, |end| end_pause > end)
                    })
            {
                return Err(invalid());
            }
        } else if pause_start as f64 + pause > end as f64 {
            return Err(invalid());
        }
    }
    if let Some(date) = date {
        for (a, b) in std::iter::once((start, end))
            .chain(parts.iter().map(|v| {
                (
                    v["start"].as_i64().unwrap_or(-1),
                    v["end"].as_i64().unwrap_or(-1),
                )
            }))
            .chain(callouts.iter().map(|v| {
                (
                    v["start"].as_i64().unwrap_or(-1),
                    v["end"].as_i64().unwrap_or(-1),
                )
            }))
            .chain(callouts.iter().map(|v| {
                (
                    v["departure"].as_i64().unwrap_or(-1),
                    v["returned"].as_i64().unwrap_or(-1),
                )
            }))
        {
            duty_instant_milliseconds(date, a, zone)?;
            duty_instant_milliseconds(date, b, zone)?;
        }
    }
    Ok(())
}
pub fn planned_special_duty(value: &Value) -> Result<Value, InputError> {
    if !js_truthy(value) {
        return Ok(Value::Null);
    }
    validate_special_duty(Some(value))?;
    let mut result = value.clone();
    result["callouts"] = json!([]);
    result["calloutsComplete"] = json!(false);
    if js_truthy(&value["standbyAgreement"]) {
        result["standbyAgreement"]["sequence"] = Value::Null;
    }
    Ok(result)
}
