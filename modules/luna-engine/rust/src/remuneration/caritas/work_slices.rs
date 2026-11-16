//! Actual recorded pauses become local-date work slices; unsupported clock transitions stay explicit.
use crate::{
    calendar::parse_date,
    input::javascript_instant_milliseconds,
    pay::pattern::is_pay_work_shift,
    time::{ShiftTime, shift_bounds},
    time_zone, training,
};
use jiff::{Timestamp, ToSpan, Zoned};
use serde_json::{Value, json};

fn unavailable(reason: &str) -> Value {
    json!({"kind":"unavailable","reason":reason})
}
fn zoned(milliseconds: i64, zone: &jiff::tz::TimeZone) -> Result<Zoned, ()> {
    Ok(Timestamp::from_millisecond(milliseconds)
        .map_err(|_| ())?
        .to_zoned(zone.clone()))
}
fn pause_milliseconds(value: &Value) -> Result<i64, ()> {
    javascript_instant_milliseconds(value.as_str().ok_or(())?)
        .and_then(|n| i64::try_from(n).ok())
        .ok_or(())
}
fn slices(shift: &Value, details: &Value, time_zone: &str) -> Result<Value, ()> {
    let input = ShiftTime {
        date: shift["date"].as_str().ok_or(())?.to_owned(),
        start_time: Some(shift["startTime"].as_str().ok_or(())?.to_owned()),
        end_time: Some(shift["endTime"].as_str().ok_or(())?.to_owned()),
        break_minutes: shift["breakMinutes"].as_i64().ok_or(())?,
        all_day: false,
        special_duty: None,
    };
    let bounds = shift_bounds(&input, time_zone).map_err(|_| ())?.ok_or(())?;
    if bounds.gross_minutes <= 0 {
        return Ok(unavailable("TIME_BOUNDS_INVALID"));
    }
    let zone = time_zone::zone(time_zone).map_err(|_| ())?;
    let start_ms = bounds.start_epoch_minutes.checked_mul(60_000).ok_or(())?;
    let end_ms = bounds.end_epoch_minutes.checked_mul(60_000).ok_or(())?;
    let first = zoned(start_ms, &zone)?;
    let last = zoned(end_ms.checked_sub(60_000).ok_or(())?, &zone)?;
    if first.offset() != last.offset() {
        return Ok(unavailable("DST_TRANSITION_UNSUPPORTED"));
    }
    let mut work = Vec::new();
    let mut from = start_ms;
    for pause in details["data"]["pauses"].as_array().ok_or(())? {
        let pause_from = pause_milliseconds(&pause["start"])?;
        let pause_through = pause_milliseconds(&pause["end"])?;
        if pause_from > from {
            work.push((from, pause_from));
        }
        from = pause_through;
    }
    if from < end_ms {
        work.push((from, end_ms));
    }
    let mut slices = Vec::new();
    let mut worked_minutes = 0i64;
    for (mut cursor, interval_through) in work {
        while cursor < interval_through {
            let start = zoned(cursor, &zone)?;
            let next_midnight = start
                .start_of_day()
                .map_err(|_| ())?
                .checked_add(1.days())
                .map_err(|_| ())?
                .timestamp()
                .as_millisecond();
            let through = interval_through.min(next_midnight);
            let end = if through == next_midnight {
                1440
            } else {
                let local = zoned(through, &zone)?;
                i64::from(local.hour()) * 60 + i64::from(local.minute())
            };
            let beginning = i64::from(start.hour()) * 60 + i64::from(start.minute());
            if end <= beginning || (end - beginning) * 60_000 != through - cursor {
                return Ok(unavailable("DST_TRANSITION_UNSUPPORTED"));
            }
            slices.push(
                json!({"date":start.date().to_string(),"fromMinute":beginning,"throughMinute":end}),
            );
            worked_minutes += end - beginning;
            cursor = through;
        }
    }
    if worked_minutes == 0 {
        return Ok(unavailable("NO_NET_WORK"));
    }
    if worked_minutes != bounds.net_minutes {
        return Ok(unavailable("PAUSE_DATA_INVALID"));
    }
    Ok(
        json!({"kind":"confirmed-net-slices","shiftId":shift["id"],"detailRevision":details["revision"],"workedMinutes":worked_minutes,"slices":slices}),
    )
}

pub fn derive_work_slices(shift: &Value, details: Option<&Value>, time_zone: &str) -> Value {
    if shift.get("deletedAt") != Some(&Value::Null)
        || !is_pay_work_shift(shift)
        || shift["allDay"] == true
        || shift["startTime"].as_str().is_none_or(str::is_empty)
        || shift["endTime"].as_str().is_none_or(str::is_empty)
    {
        return unavailable("NOT_TIMED_WORK");
    }
    let Some(raw) = details else {
        return unavailable("PAUSES_MISSING_OR_STALE");
    };
    let Ok(details) = training::validate_saved_shift_training(raw) else {
        return unavailable("PAUSE_DATA_INVALID");
    };
    if !training::is_current_shift_training(&details, shift, time_zone) {
        return unavailable("PAUSES_MISSING_OR_STALE");
    }
    if training::require_shift_training_parent(&details, shift).is_err() {
        return unavailable("PAUSE_DATA_INVALID");
    }
    if details["data"]["pauses"].is_null() {
        return unavailable("PAUSES_MISSING_OR_STALE");
    }
    slices(shift, &details, time_zone).unwrap_or_else(|()| unavailable("TIME_BOUNDS_INVALID"))
}

pub fn derive_month_work_slices(
    month: &str,
    shifts: &[Value],
    details: &[Value],
    time_zone: &str,
    entries_complete: bool,
) -> Value {
    let Some(first) = (month.len() == 7)
        .then(|| parse_date(&format!("{month}-01")).ok())
        .flatten()
    else {
        return unavailable("INVALID_MONTH");
    };
    if !entries_complete {
        return unavailable("ENTRIES_INCOMPLETE");
    }
    let from = first.to_string();
    let through = first.last_of_month().to_string();
    let Ok(previous) = first.checked_sub(1.days()) else {
        return unavailable("INVALID_MONTH");
    };
    let previous = previous.to_string();
    let mut slices = Vec::new();
    for shift in shifts {
        if shift.get("deletedAt") != Some(&Value::Null) {
            continue;
        }
        let date = shift["date"].as_str().unwrap_or("");
        let in_month = date >= from.as_str() && date <= through.as_str();
        let carried = date == previous
            && shift["startTime"].is_string()
            && shift["endTime"].is_string()
            && shift["endTime"].as_str() <= shift["startTime"].as_str()
            && shift["endTime"] != "00:00";
        if !in_month && !carried {
            continue;
        }
        if !matches!(
            shift["type"].as_str(),
            Some("EARLY" | "LATE" | "NIGHT" | "DAY" | "CUSTOM")
        ) {
            continue;
        }
        if !is_pay_work_shift(shift) {
            let mut value = unavailable("WORK_TIME_MISSING");
            value["shiftId"] = shift["id"].clone();
            return value;
        }
        let mut matching = details.iter().filter(|d| d["shiftId"] == shift["id"]);
        let detail = matching.next();
        if matching.next().is_some() {
            let mut value = unavailable("DETAILS_AMBIGUOUS");
            value["shiftId"] = shift["id"].clone();
            return value;
        }
        let mut result = derive_work_slices(shift, detail, time_zone);
        if result["kind"] == "unavailable" {
            result["shiftId"] = shift["id"].clone();
            return result;
        }
        for slice in result["slices"].as_array().expect("confirmed slices") {
            let date = slice["date"].as_str().expect("confirmed date");
            if date >= from.as_str() && date <= through.as_str() {
                let mut slice = slice.clone();
                slice["shiftId"] = shift["id"].clone();
                slices.push(slice);
            }
        }
    }
    // Canonical four-digit dates have identical relative order under localeCompare.
    // sort_by is stable, preserving first-seen source order for equal starts.
    slices.sort_by(|a, b| {
        a["date"]
            .as_str()
            .cmp(&b["date"].as_str())
            .then_with(|| a["fromMinute"].as_i64().cmp(&b["fromMinute"].as_i64()))
    });
    for pair in slices.windows(2) {
        if pair[0]["date"] == pair[1]["date"]
            && pair[0]["throughMinute"].as_i64() > pair[1]["fromMinute"].as_i64()
        {
            return unavailable("WORKED_SLICES_OVERLAP");
        }
    }
    let worked_minutes: i64 = slices
        .iter()
        .map(|v| {
            v["throughMinute"].as_i64().expect("confirmed end")
                - v["fromMinute"].as_i64().expect("confirmed start")
        })
        .sum();
    json!({"kind":"confirmed-month-net-slices","month":month,"workedMinutes":worked_minutes,"slices":slices})
}
