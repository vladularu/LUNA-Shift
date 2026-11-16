use crate::input::{javascript_instant_milliseconds, precise_instant_nanoseconds};
use jiff::{Timestamp, ToSpan, civil::Date};
const CYCLE: i128 = 146097 * 86400 * 1_000_000_000;
pub(super) fn date_milliseconds(raw: &str) -> Option<f64> {
    if let Some(value) = javascript_instant_milliseconds(raw) {
        return Some(value as f64);
    }
    if [10, 13].contains(&raw.len()) && !raw.contains(['T', 't', ' ']) {
        return javascript_instant_milliseconds(&format!("{raw}T00:00:00Z")).map(|n| n as f64);
    }
    jiff::fmt::rfc2822::DateTimeParser::new()
        .parse_timestamp(raw)
        .ok()
        .map(|t| t.as_millisecond() as f64)
}
struct Civil {
    date: Date,
    cycles: i64,
    hour: i8,
    minute: i8,
}
fn civil(ns: i128, zone: &jiff::tz::TimeZone) -> Option<Civil> {
    let (surrogate, cycles) = if ns
        >= "9000-01-01T00:00:00Z"
            .parse::<Timestamp>()
            .ok()?
            .as_nanosecond()
    {
        let base = "9200-01-01T00:00:00Z"
            .parse::<Timestamp>()
            .ok()?
            .as_nanosecond();
        let cycles = (ns - base).div_euclid(CYCLE);
        (ns - cycles * CYCLE, cycles)
    } else if ns
        <= "-009000-01-01T00:00:00Z"
            .parse::<Timestamp>()
            .ok()?
            .as_nanosecond()
    {
        let base = "-009600-01-01T00:00:00Z"
            .parse::<Timestamp>()
            .ok()?
            .as_nanosecond();
        let cycles = (ns - base).div_euclid(CYCLE);
        (ns - cycles * CYCLE, cycles)
    } else {
        (ns, 0)
    };
    let local = Timestamp::from_nanosecond(surrogate)
        .ok()?
        .to_zoned(zone.clone());
    Some(Civil {
        date: local.date(),
        cycles: i64::try_from(cycles).ok()?,
        hour: local.hour(),
        minute: local.minute(),
    })
}
fn components(date: Date, cycles: i64) -> (i64, i8, i8) {
    (
        i64::from(date.year()) + cycles * 400,
        date.month(),
        date.day(),
    )
}
fn iso(date: Date, cycles: i64) -> String {
    let (year, month, day) = components(date, cycles);
    let year = if year < 0 {
        format!("-{:06}", year.unsigned_abs())
    } else if year > 9999 {
        format!("+{year:06}")
    } else {
        format!("{year:04}")
    };
    format!("{year}-{month:02}-{day:02}")
}
pub(super) struct Projection {
    pub dates: Vec<String>,
    pub when: String,
}
pub(super) fn editor_labels(
    start: &str,
    end: &str,
    zone: &str,
    all_day: bool,
) -> Option<(Option<String>, Option<String>, Option<String>)> {
    let zone = crate::time_zone::zone(zone).ok()?;
    let start = civil(precise_instant_nanoseconds(start)?, &zone)?;
    let end = civil(precise_instant_nanoseconds(end)?, &zone)?;
    if all_day {
        return Some((Some("Ganztägig".into()), None, None));
    }
    let same = components(start.date, start.cycles) == components(end.date, end.cycles);
    Some((
        None,
        Some(format!("{:02}:{:02}", start.hour, start.minute)),
        Some(format!(
            "{:02}:{:02}{}",
            end.hour,
            end.minute,
            if same {
                String::new()
            } else {
                format!(" · {:02}.{:02}.", end.date.day(), end.date.month())
            }
        )),
    ))
}
pub(super) fn project(start: &str, end: &str, zone: &str, all_day: bool) -> Option<Projection> {
    let start = precise_instant_nanoseconds(start)?;
    let end = precise_instant_nanoseconds(end)?;
    if end <= start || end.div_euclid(1_000_000) - start.div_euclid(1_000_000) > 172800000 {
        return None;
    }
    let zone = crate::time_zone::zone(zone).ok()?;
    let start = civil(start, &zone)?;
    let end = civil(end, &zone)?;
    let same = components(start.date, start.cycles) == components(end.date, end.cycles);
    let when = if all_day {
        "Ganztägig".to_owned()
    } else {
        format!(
            "{:02}:{:02}–{:02}:{:02}{}",
            start.hour,
            start.minute,
            end.hour,
            end.minute,
            if same {
                String::new()
            } else {
                format!(" · endet am {:02}.{:02}.", end.date.day(), end.date.month())
            }
        )
    };
    let mut dates = Vec::new();
    let mut day = start.date;
    loop {
        dates.push(iso(day, start.cycles));
        day = day.checked_add(1.days()).ok()?;
        // Original advances even timed rows before testing the loop guard.
        // Reuse the shared Temporal PlainDate range instead of accepting a
        // Jiff surrogate day beyond the original maximum.
        crate::input::calendar::require_local_date(&serde_json::Value::String(iso(
            day,
            start.cycles,
        )))
        .ok()?;
        if !all_day
            || components(day, start.cycles) >= components(end.date, end.cycles)
            || dates.len() >= 366
        {
            break;
        }
    }
    Some(Projection { dates, when })
}
