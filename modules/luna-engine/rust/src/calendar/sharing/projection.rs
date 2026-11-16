use super::{
    Options, SharedEntry, SharingError, required_string,
    selection::{self, SelectedEntry},
    text,
};
use crate::{
    calendar::parse_date,
    time::{ShiftTime, SpecialDutyTime, clock, shift_bounds},
};
use jiff::{Timestamp, ToSpan, tz::Disambiguation};
use serde_json::Value;

pub(super) fn entry(
    raw: &Value,
    selected: &SelectedEntry,
    id: &str,
    options: &Options,
) -> Result<SharedEntry, SharingError> {
    let get = |key| selection::value(raw, selected, key);
    let kind = required_string(raw, "kind")?;
    let string = |key| {
        get(key)
            .and_then(Value::as_str)
            .ok_or_else(SharingError::invalid)
    };
    let optional_time = |key| match get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        _ => Err(SharingError::invalid()),
    };
    let start_time = optional_time("startTime")?;
    let end_time = optional_time("endTime")?;
    let all_day = get("allDay") == Some(&Value::Bool(true))
        || (get("startTime") == Some(&Value::Null) && get("endTime") == Some(&Value::Null));
    let day = parse_date(string("date")?).map_err(|_| SharingError::time())?;
    let start = clock(if all_day {
        "00:00"
    } else {
        start_time.as_deref().unwrap_or("00:00")
    })
    .map_err(|_| SharingError::time())?;
    let end = clock(if all_day {
        "00:00"
    } else {
        end_time.as_deref().unwrap_or("00:00")
    })
    .map_err(|_| SharingError::time())?;
    let end_day = if all_day || end <= start {
        day.checked_add(1.days())
            .map_err(|_| SharingError::time())?
    } else {
        day
    };
    let bounds = if kind == "SHIFT" {
        let special_duty: Option<SpecialDutyTime> = get("specialDuty")
            .filter(|d| !d.is_null())
            .map(|d| serde_json::from_value(d.clone()).map_err(|_| SharingError::invalid()))
            .transpose()?;
        shift_bounds(
            &ShiftTime {
                date: day.to_string(),
                start_time,
                end_time,
                all_day,
                break_minutes: 0,
                special_duty,
            },
            &options.time_zone,
        )
        .map_err(|_| SharingError::time())?
    } else {
        None
    };
    let (starts_at, ends_at) = if let Some(bounds) = &bounds {
        let instant = |minutes: i64| {
            minutes
                .checked_mul(60_000)
                .and_then(|ms| Timestamp::from_millisecond(ms).ok())
                .map(|t| t.to_string())
                .ok_or_else(SharingError::time)
        };
        (
            instant(bounds.start_epoch_minutes)?,
            instant(bounds.end_epoch_minutes)?,
        )
    } else {
        let zone = crate::time_zone::zone(&options.time_zone).map_err(|_| SharingError::time())?;
        let instant = |date: jiff::civil::Date, time: jiff::civil::Time| {
            zone.to_ambiguous_zoned(date.to_datetime(time))
                .disambiguate(Disambiguation::Compatible)
                .map(|z| z.timestamp().to_string())
                .map_err(|_| SharingError::time())
        };
        (instant(day, start)?, instant(end_day, end)?)
    };
    let appearance = if kind == "APPOINTMENT" {
        ("Termin", "calendar")
    } else {
        match string("type")? {
            "EARLY" => ("Früh", "sunrise"),
            "LATE" => ("Spät", "sun"),
            "NIGHT" => ("Nacht", "moon"),
            "DAY" => ("Tag", "home"),
            "TRAINING" => ("Schule", "book"),
            "VACATION" => ("Urlaub", "star"),
            "SICK" => ("Krank", "unavailable"),
            "FREE" => ("Frei", "star"),
            "CUSTOM" => ("Dienst", "clock"),
            _ => return Err(SharingError::invalid()),
        }
    };
    let title_utf16 = if options.neutral {
        "Nicht verfügbar".encode_utf16().collect()
    } else if kind == "APPOINTMENT" && options.content.is_none() {
        "Termin".encode_utf16().collect()
    } else {
        text::title(
            selected
                .title_override
                .unwrap_or(required_string(raw, "title")?),
            appearance.0,
        )
    };
    let symbol = if options.neutral {
        "unavailable"
    } else if kind == "SHIFT"
        && raw.get("symbol").and_then(Value::as_str).is_some_and(|v| {
            matches!(
                v,
                "calendar"
                    | "sunrise"
                    | "sun"
                    | "moon"
                    | "home"
                    | "book"
                    | "clock"
                    | "star"
                    | "unavailable"
            )
        })
    {
        required_string(raw, "symbol")?
    } else {
        appearance.1
    }
    .to_owned();
    let color = if options.neutral {
        "#737373".into()
    } else {
        let color = required_string(raw, "color")?;
        if color.len() == 7
            && color.starts_with('#')
            && color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
        {
            color.to_ascii_uppercase()
        } else {
            "#737373".into()
        }
    };
    let note_utf16 = options.content.as_ref().map(|content| {
        if !options.neutral && content.notes {
            raw.get("note").and_then(Value::as_str).and_then(text::note)
        } else {
            None
        }
    });
    let break_minutes = if !options.neutral && bounds.is_some() && kind == "SHIFT" {
        let n = get("breakMinutes")
            .and_then(Value::as_f64)
            .filter(|n| n.is_finite())
            .ok_or_else(SharingError::invalid)?;
        Some(n)
    } else {
        None
    };
    Ok(SharedEntry {
        kind: options.content.as_ref().map(|_| kind.to_owned()),
        note_utf16,
        id: id.to_owned(),
        break_minutes,
        starts_at,
        ends_at,
        time_zone: options.time_zone.clone(),
        all_day,
        title_utf16,
        symbol,
        color,
    })
}
