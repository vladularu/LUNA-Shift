//! Incoming calendar projection; foreign rows never become local entries.
pub mod cache;
pub mod raw_rows;
pub mod raw_source;
mod source_view;
mod time;
pub mod timeline_source;
pub mod visible;
use crate::EngineError;
use serde::{
    Serialize, Serializer,
    ser::{SerializeMap, SerializeSeq},
};
use serde_json::Value;
use source_view::Source;
use std::{collections::HashMap, sync::Arc};
pub struct SharedDayWindow<'a> {
    pub start_date: &'a str,
    pub end_date: &'a str,
}
struct Row {
    calendar: usize,
    entry: usize,
    when: String,
}
/// One immutable original source owner and small native row locators.
pub struct SharedCalendarDays {
    source: Source,
    groups: Vec<(String, Vec<Row>)>,
    group_index: HashMap<String, usize>,
}
struct Rows<'a> {
    source: &'a Source,
    rows: &'a [Row],
}
struct RowView<'a> {
    source: &'a Source,
    row: &'a Row,
}
impl Serialize for RowView<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let cached = self.source.get(self.row.calendar).unwrap();
        let calendar = cached.get("calendar").unwrap_or(&Value::Null);
        let mut map = serializer.serialize_map(None)?;
        for (key, value) in [
            ("calendarId", calendar.get("id")),
            ("calendarName", calendar.get("name")),
            (
                "calendarColor",
                cached
                    .get("localColor")
                    .filter(|v| !v.is_null())
                    .or_else(|| calendar.get("color")),
            ),
        ] {
            if let Some(value) = value {
                map.serialize_entry(key, value)?;
            }
        }
        map.serialize_entry(
            "entry",
            &cached.get("entries").unwrap_or(&Value::Null)[self.row.entry],
        )?;
        map.serialize_entry("when", &self.row.when)?;
        if let Some(value) = cached.get("fetchedAt") {
            map.serialize_entry("fetchedAt", value)?;
        }
        map.end()
    }
}
impl Serialize for Rows<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut sequence = serializer.serialize_seq(Some(self.rows.len()))?;
        for row in self.rows {
            sequence.serialize_element(&RowView {
                source: self.source,
                row,
            })?;
        }
        sequence.end()
    }
}
impl Serialize for SharedCalendarDays {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut sequence = serializer.serialize_seq(Some(self.groups.len()))?;
        for (date, rows) in &self.groups {
            sequence.serialize_element(&(
                date,
                Rows {
                    source: &self.source,
                    rows,
                },
            ))?;
        }
        sequence.end()
    }
}
fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(value)) => *value,
        Some(Value::Number(value)) => value.as_f64().is_some_and(|n| n != 0.0),
        Some(Value::String(value)) => !value.is_empty(),
        Some(Value::Array(_) | Value::Object(_)) => true,
    }
}
/// Same raw Date.parse contract as incoming visibility. This is a structural
/// widget scheduling primitive, never source admission or a ready clock lease.
pub(crate) fn cache_expiry_milliseconds(raw: &str) -> Option<i64> {
    time::date_milliseconds(raw).map(|epoch| (epoch + 86_400_000.0) as i64)
}
pub(crate) fn shared_editor_time_labels(
    start: &str,
    end: &str,
    zone: &str,
    all_day: bool,
) -> Option<(Option<String>, Option<String>, Option<String>)> {
    time::editor_labels(start, end, zone, all_day)
}
pub fn shared_calendar_days(
    calendars: Arc<Vec<Value>>,
    time_zone: &str,
    now: Option<f64>,
    window: Option<&SharedDayWindow<'_>>,
) -> Result<SharedCalendarDays, EngineError> {
    project(Source::Raw(calendars), time_zone, now, window, None)
}
// One policy for ordinary projection and widget timeline visibility epochs.
fn eligible_calendar(
    cached: &source_view::Cached<'_>,
    now: Option<f64>,
) -> Result<bool, EngineError> {
    if !truthy(cached.get("visible")) {
        return Ok(false);
    }
    let calendar = cached
        .get("calendar")
        .filter(|v| v.is_object())
        .ok_or(EngineError::InvalidCalendarEntry)?;
    if truthy(calendar.get("isOwner")) {
        return Ok(false);
    }
    let age = if let Some(now) = now {
        let Some(fetched) = cached
            .get("fetchedAt")
            .and_then(Value::as_str)
            .and_then(time::date_milliseconds)
        else {
            return Ok(false);
        };
        now - fetched
    } else {
        0.0
    };
    Ok(age.is_finite() && (0.0..86400000.0).contains(&age))
}
fn project(
    calendars: Source,
    time_zone: &str,
    now: Option<f64>,
    window: Option<&SharedDayWindow<'_>>,
    selected: Option<&[usize]>,
) -> Result<SharedCalendarDays, EngineError> {
    if calendars.len() > 10000 {
        return Err(EngineError::Overflow);
    }
    let bounds = window.map(|window| {
        (
            time::date_milliseconds(&format!("{}T00:00:00Z", window.start_date))
                .map(|n| n - 86400000.0),
            time::date_milliseconds(&format!("{}T00:00:00Z", window.end_date))
                .map(|n| n + 86400000.0),
        )
    });
    let mut groups: Vec<(String, Vec<Row>)> = Vec::new();
    let mut dates: HashMap<String, usize> = HashMap::new();
    let (mut source_rows, mut projected_rows) = (0usize, 0usize);
    let all = 0..if selected.is_none() {
        calendars.len()
    } else {
        0
    };
    let indices = selected
        .into_iter()
        .flat_map(|v| v.iter().copied())
        .chain(all);
    for calendar_index in indices {
        let cached = calendars.get(calendar_index).unwrap();
        if !eligible_calendar(&cached, now)? {
            continue;
        }
        let entries = cached
            .get("entries")
            .and_then(Value::as_array)
            .ok_or(EngineError::InvalidCalendarEntry)?;
        source_rows = source_rows
            .checked_add(entries.len())
            .ok_or(EngineError::Overflow)?;
        if source_rows > 100000 {
            return Err(EngineError::Overflow);
        }
        for (entry_index, entry) in entries.iter().enumerate() {
            if !entry.is_object() {
                continue;
            }
            if let Some((lower, upper)) = bounds {
                let start = entry
                    .get("startsAt")
                    .and_then(Value::as_str)
                    .and_then(time::date_milliseconds);
                let end = entry
                    .get("endsAt")
                    .and_then(Value::as_str)
                    .and_then(time::date_milliseconds);
                if end.zip(lower).is_some_and(|(end, lower)| end < lower)
                    || start
                        .zip(upper)
                        .is_some_and(|(start, upper)| start >= upper)
                {
                    continue;
                }
            }
            let Some(start) = entry.get("startsAt").and_then(Value::as_str) else {
                continue;
            };
            let Some(end) = entry.get("endsAt").and_then(Value::as_str) else {
                continue;
            };
            let all_day = truthy(entry.get("allDay"));
            let zone = if all_day {
                entry.get("timeZone").and_then(Value::as_str).unwrap_or("")
            } else {
                time_zone
            };
            let Some(projected) = time::project(start, end, zone, all_day) else {
                continue;
            };
            for date in projected.dates {
                if window.is_some_and(|window| {
                    date.as_str() < window.start_date || date.as_str() >= window.end_date
                }) {
                    continue;
                }
                projected_rows += 1;
                if projected_rows > 300000 {
                    return Err(EngineError::Overflow);
                }
                let group = if let Some(index) = dates.get(&date) {
                    *index
                } else {
                    let index = groups.len();
                    dates.insert(date.clone(), index);
                    groups.push((date, Vec::new()));
                    index
                };
                groups[group].1.push(Row {
                    calendar: calendar_index,
                    entry: entry_index,
                    when: projected.when.clone(),
                });
            }
        }
    }
    Ok(SharedCalendarDays {
        source: calendars,
        groups,
        group_index: dates,
    })
}

/// Borrowed native projection row. Its source remains owned by SharedCalendarDays.
pub(crate) struct SharedDayRow<'a> {
    pub calendar_id: &'a str,
    pub calendar_name: Option<&'a str>,
    pub calendar_color: Option<&'a str>,
    pub entry: &'a Value,
    pub when: &'a str,
}
impl SharedDayRow<'_> {
    pub(crate) fn starts_epoch_milliseconds(&self) -> Option<f64> {
        self.entry
            .get("startsAt")
            .and_then(Value::as_str)
            .and_then(time::date_milliseconds)
    }
}
impl SharedCalendarDays {
    pub(crate) fn rows_for_date<'a>(
        &'a self,
        date: &str,
    ) -> impl Iterator<Item = Result<SharedDayRow<'a>, EngineError>> + 'a {
        self.group_index
            .get(date)
            .and_then(|index| self.groups.get(*index))
            .into_iter()
            .flat_map(|(_, rows)| rows.iter())
            .map(|row| {
                let cached = self
                    .source
                    .get(row.calendar)
                    .ok_or(EngineError::InvalidCalendarEntry)?;
                let calendar = cached
                    .get("calendar")
                    .ok_or(EngineError::InvalidCalendarEntry)?;
                let entry = cached
                    .get("entries")
                    .and_then(Value::as_array)
                    .and_then(|v| v.get(row.entry))
                    .ok_or(EngineError::InvalidCalendarEntry)?;
                Ok(SharedDayRow {
                    when: &row.when,
                    calendar_id: calendar
                        .get("id")
                        .and_then(Value::as_str)
                        .ok_or(EngineError::InvalidCalendarEntry)?,
                    calendar_name: calendar.get("name").and_then(Value::as_str),
                    calendar_color: cached
                        .get("localColor")
                        .filter(|v| !v.is_null())
                        .or_else(|| calendar.get("color"))
                        .and_then(Value::as_str),
                    entry,
                })
            })
    }
}

#[cfg(test)]
mod widget_borrow_tests {
    use super::*;
    #[test]
    fn fifty_thousand_widget_rows_borrow_the_same_source_and_release_it_after_projection() {
        let entry = serde_json::json!({"id":"entry","startsAt":"2026-10-24T19:00:00Z","endsAt":"2026-10-25T06:00:00Z","allDay":false,"timeZone":"Europe/Berlin"});
        let source = Arc::new(vec![
            serde_json::json!({"visible":true,"calendar":{"id":"foreign","name":"Name","color":"#123456","isOwner":false},"entries":vec![entry;50000]}),
        ]);
        let weak = Arc::downgrade(&source);
        let view = shared_calendar_days(source.clone(), "Europe/Berlin", None, None).unwrap();
        assert_eq!(Arc::strong_count(&source), 2);
        let mut count = 0;
        for (index, row) in view.rows_for_date("2026-10-24").enumerate() {
            let row = row.unwrap();
            assert!(std::ptr::eq(row.entry, &source[0]["entries"][index]));
            assert_eq!(row.calendar_id, "foreign");
            assert_eq!(row.calendar_name, Some("Name"));
            count += 1;
        }
        assert_eq!(count, 50000);
        assert_eq!(view.rows_for_date("2026-10-25").count(), 0);
        drop(source);
        assert!(weak.upgrade().is_some());
        drop(view);
        assert!(weak.upgrade().is_none());
    }
}
