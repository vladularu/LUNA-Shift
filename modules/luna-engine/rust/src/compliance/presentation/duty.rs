//! Read-only native duty-calendar data; layout dimensions remain in the UI.
use super::{PresentationError, dates, text};
use crate::calendar::recurrence::CollationRanks;
use jiff::{ToSpan, civil::Date};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
const WEEKDAYS: [&str; 7] = [
    "Montag",
    "Dienstag",
    "Mittwoch",
    "Donnerstag",
    "Freitag",
    "Samstag",
    "Sonntag",
];
pub(super) fn ordered<'a>(
    shifts: impl Iterator<Item = &'a Value>,
    ranks: &CollationRanks,
) -> Result<Vec<&'a Value>, PresentationError> {
    let mut ordered = shifts
        .map(|shift| {
            let rank = |key: &str| {
                ranks
                    .rank(shift[key].as_str().unwrap_or(""))
                    .map_err(|_| PresentationError)
            };
            Ok((shift, (rank("date")?, rank("startTime")?, rank("id")?)))
        })
        .collect::<Result<Vec<_>, PresentationError>>()?;
    ordered.sort_by_key(|entry| entry.1);
    Ok(ordered.into_iter().map(|entry| entry.0).collect())
}
fn format(date: Date, years: bool) -> String {
    format!(
        "{:02}.{:02}.{}",
        date.day(),
        date.month(),
        if years {
            date.year().to_string()
        } else {
            String::new()
        }
    )
}
fn row(shift: &Value) -> Option<Value> {
    let date = dates::parse(shift["date"].as_str()?)?;
    let start = text(shift, "startTime");
    let end = text(shift, "endTime");
    let offset = shift["specialDuty"]
        .get("endDay")
        .filter(|v| !v.is_null())
        .and_then(Value::as_f64)
        .filter(|v| v.fract() == 0.0 && (0.0..=14.0).contains(v));
    let valid_offset = if shift["specialDuty"]
        .get("endDay")
        .is_some_and(|v| !v.is_null())
    {
        offset.unwrap_or(0.0) as i64
    } else {
        i64::from(!start.is_empty() && !end.is_empty() && end <= start)
    };
    let split = shift["specialDuty"]["kind"] == "SPLIT";
    let until = date.checked_add(valid_offset.days()).ok()?;
    let all_day = crate::credit::summary::truthy(shift.get("allDay"));
    let time = if all_day {
        "Ganztägig".into()
    } else if start.is_empty() || end.is_empty() {
        "Zeit fehlt".into()
    } else {
        format!(
            "{start}–{end}{}{}",
            if valid_offset != 0 {
                format!(" +{valid_offset}")
            } else {
                String::new()
            },
            if split { " · Teilzeiten" } else { "" }
        )
    };
    let spoken_time = if all_day || start.is_empty() || end.is_empty() {
        time.clone()
    } else {
        format!(
            "{start} bis {}{end}",
            if valid_offset != 0 {
                format!("{}, ", dates::full(until))
            } else {
                String::new()
            }
        )
    };
    let mut output = serde_json::Map::new();
    for key in ["id", "title", "color", "symbol"] {
        if let Some(value) = shift.get(key) {
            output.insert(key.into(), value.clone());
        }
    }
    output.insert("time".into(), json!(time));
    output.insert(
        "spoken".into(),
        json!(format!(
            "{}, {}, {}{spoken_time}{}",
            text(shift, "title"),
            dates::full(date),
            if split {
                "eingetragenes Zeitfenster "
            } else {
                ""
            },
            if split { ", mit Teilzeiten" } else { "" }
        )),
    );
    Some(Value::Object(output))
}
/// Null is the original unavailable/empty display. Missing collation is an
/// error and cannot silently become a successful empty grid.
pub fn prepare(
    shifts: &[Value],
    explicit_dates: Option<&[Value]>,
    ranks: &CollationRanks,
) -> Result<Value, PresentationError> {
    prepare_refs(shifts.iter(), explicit_dates, ranks)
}
fn prepare_refs<'a>(
    shifts: impl Iterator<Item = &'a Value>,
    explicit_dates: Option<&[Value]>,
    ranks: &CollationRanks,
) -> Result<Value, PresentationError> {
    let ordered = ordered(
        shifts.filter(|shift| shift.get("deletedAt") == Some(&Value::Null)),
        ranks,
    )?;
    let mut keys = if let Some(dates) = explicit_dates {
        dates
            .iter()
            .map(|date| date.as_str().ok_or(PresentationError))
            .collect::<Result<BTreeSet<_>, _>>()?
            .into_iter()
            .map(str::to_owned)
            .collect::<Vec<_>>()
    } else {
        ordered
            .iter()
            .map(|shift| text(shift, "date").to_owned())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect()
    };
    // JS Array.sort without a comparator is UTF-16 order, independent of ranks.
    keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    let Some(first) = keys.first().and_then(|key| dates::parse(key)) else {
        return Ok(Value::Null);
    };
    let Some(last) = keys.last().and_then(|key| dates::parse(key)) else {
        return Ok(Value::Null);
    };
    let count = last.since(first).map_err(|_| PresentationError)?.get_days() + 1;
    if explicit_dates.is_none() && count <= 14 {
        keys = (0..count)
            .map(|offset| {
                first
                    .checked_add(offset.days())
                    .map(|date| date.to_string())
                    .map_err(|_| PresentationError)
            })
            .collect::<Result<Vec<_>, _>>()?;
    }
    let years = first.year() != last.year();
    let period = if explicit_dates.is_none() && keys.len() > 3 {
        json!(format!(
            "{}–{}{}",
            format(first, years),
            format(last, years),
            if years {
                String::new()
            } else {
                first.year().to_string()
            }
        ))
    } else {
        Value::Null
    };
    let mut by_date: BTreeMap<&str, Vec<&Value>> = BTreeMap::new();
    for shift in ordered {
        by_date.entry(text(shift, "date")).or_default().push(shift);
    }
    let mut cells = Vec::with_capacity(keys.len());
    for key in keys {
        let Some(date) = dates::parse(&key) else {
            return Ok(Value::Null);
        };
        let duties = by_date
            .get(key.as_str())
            .into_iter()
            .flatten()
            .map(|shift| row(shift))
            .collect::<Option<Vec<_>>>();
        let Some(duties) = duties else {
            return Ok(Value::Null);
        };
        let weekday = WEEKDAYS[date.weekday().to_monday_zero_offset() as usize];
        cells.push(json!({"key":key,"weekday":weekday,"label":format(date,years),"spoken":format!("{weekday}, {}",dates::full(date)),"duties":duties}));
    }
    Ok(json!({"cells":cells,"period":period}))
}
pub fn affected(
    shifts: &[Value],
    weekend_period: Option<&Value>,
    ranks: &CollationRanks,
) -> Result<Value, PresentationError> {
    let Some(period) = weekend_period.filter(|value| crate::credit::summary::truthy(Some(value)))
    else {
        return Ok(json!({"weekendLabel":null,"overview":prepare(shifts,None,ranks)?}));
    };
    let label = dates::period(text(period, "from"), text(period, "until"))["compact"].clone();
    if label.is_null() {
        return Ok(Value::Null);
    }
    let selected = shifts
        .iter()
        .filter(|shift| {
            shift.get("deletedAt") == Some(&Value::Null)
                && text(shift, "date") >= text(period, "from")
                && text(shift, "date") <= text(period, "until")
                && dates::parse(text(shift, "date"))
                    .is_some_and(|date| date.weekday().to_monday_zero_offset() >= 5)
        })
        .collect::<Vec<_>>();
    let dates = selected
        .iter()
        .map(|shift| shift["date"].clone())
        .collect::<Vec<_>>();
    Ok(
        json!({"weekendLabel":label,"overview":prepare_refs(selected.into_iter(),Some(&dates),ranks)?}),
    )
}
