//! Widget business policy over borrowed, already typed rows. No Source READY
//! evidence, platform palette or widget publication is produced by this leaf.
use crate::{
    EngineError,
    calendar::{
        incoming::SharedCalendarDays,
        presentation::{
            DisplayOptions,
            rows::{shared_shift_detail, shift_detail},
        },
        recurrence::{CollationRanks, sort_key_for_fields},
        window::CalendarRecordSource,
    },
    credit::duty::duty_calendar_dates,
};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
#[derive(Clone, Copy)]
pub struct WidgetRowOptions {
    pub show_shifts: bool,
    pub show_appointments: bool,
    pub show_shift_times: bool,
    pub show_shift_duration: bool,
}

#[cfg(test)]
mod record_ownership_tests {
    use super::*;
    use crate::calendar::{
        loaded_scope::{CalendarLoadRange, RawScopeRows},
        widget::WidgetClock,
    };
    use std::sync::Arc;
    #[test]
    fn widget_locators_borrow_the_existing_native_scope_values_without_an_entry_tree_copy() {
        let corpus = crate::test_value_pool::decode(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../reference/widget-own-query-golden.json"
        )));
        let i = &corpus["cases"][0]["input"];
        let r = &i["raw"];
        let raw = RawScopeRows::new(
            Arc::from(r["shiftRows"].as_array().unwrap().clone()),
            Arc::from(r["appointmentRows"].as_array().unwrap().clone()),
            Arc::from(r["templateRows"].as_array().unwrap().clone()),
        )
        .unwrap();
        let weak = Arc::downgrade(&raw);
        let clock = WidgetClock::from_epoch(
            i["observedEpochMilliseconds"].as_i64().unwrap(),
            i["timeZone"].as_str().unwrap(),
        )
        .unwrap();
        let range = clock.entry_range().unwrap();
        let ranks: CollationRanks = serde_json::from_value(i["comparisonRanks"].clone()).unwrap();
        let entries = raw
            .prepare(&CalendarLoadRange {
                start_date: range.start_date,
                end_date: range.end_date,
            })
            .unwrap()
            .finish(&ranks)
            .unwrap();
        let before = Arc::strong_count(&raw);
        let rows = WidgetRows::from_records(
            &entries,
            &ranks,
            i["timeZone"].as_str().unwrap(),
            WidgetRowOptions {
                show_shifts: true,
                show_appointments: true,
                show_shift_times: true,
                show_shift_duration: true,
            },
        )
        .unwrap();
        assert_eq!(Arc::strong_count(&raw), before);
        for (index, entry) in entries.entries().iter().enumerate() {
            assert!(std::ptr::eq(rows.source.base(index), entry.base_value()));
            assert_eq!(rows.source.get(index, "title"), entry.get("title"));
        }
        drop(rows);
        drop(entries);
        drop(raw);
        assert!(weak.upgrade().is_none());
    }
}
#[derive(Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum ShiftOrigin {
    Own,
    Shared,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetBusinessShift {
    id: String,
    raw_symbol: String,
    origin: ShiftOrigin,
    title: String,
    start: String,
    end: String,
    next_day: bool,
    color: String,
    detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner_color: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetBusinessAppointment {
    id: String,
    title: String,
    start: String,
    end: String,
    next_day: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner_color: Option<String>,
}
#[derive(Serialize)]
pub struct WidgetBusinessDay {
    date: String,
    shifts: Vec<WidgetBusinessShift>,
    appointments: Vec<WidgetBusinessAppointment>,
}
pub struct WidgetRows<'a> {
    source: OwnEntries<'a>,
    shifts: BTreeMap<String, Vec<usize>>,
    appointments: BTreeMap<String, Vec<usize>>,
    collation: &'a CollationRanks,
    zone: jiff::tz::TimeZone,
    zone_name: &'a str,
    options: WidgetRowOptions,
}
enum OwnEntries<'a> {
    Slice(&'a [Value]),
    Records(&'a dyn CalendarRecordSource),
}
impl<'a> OwnEntries<'a> {
    fn len(&self) -> usize {
        match self {
            Self::Slice(v) => v.len(),
            Self::Records(v) => v.entries_len(),
        }
    }
    fn base(&self, index: usize) -> &'a Value {
        match self {
            Self::Slice(v) => &v[index],
            Self::Records(v) => (*v).base_value(index),
        }
    }
    fn get(&self, index: usize, key: &str) -> Option<&'a Value> {
        match self {
            Self::Slice(v) => v[index].get(key),
            Self::Records(v) => (*v).field(index, key),
        }
    }
    fn text(&self, index: usize, key: &str) -> Result<&'a str, EngineError> {
        self.get(index, key)
            .and_then(Value::as_str)
            .ok_or(EngineError::InvalidCalendarEntry)
    }
}
fn text<'a>(row: &'a Value, key: &str) -> Result<&'a str, EngineError> {
    row.get(key)
        .and_then(Value::as_str)
        .ok_or(EngineError::InvalidCalendarEntry)
}
fn own_times(row: &Value, appointment: bool) -> (String, String, bool) {
    let all_day = row.get("allDay").and_then(Value::as_bool) == Some(true);
    let start = row.get("startTime").and_then(Value::as_str);
    let end = row.get("endTime").and_then(Value::as_str);
    let timed = !all_day && start.is_some() && (appointment || end.is_some());
    if !timed {
        return (String::new(), String::new(), false);
    }
    let start = start.unwrap_or_default();
    (
        start.into(),
        end.unwrap_or_default().into(),
        end.is_some_and(|end| end <= start),
    )
}
fn shared_times(
    row: &Value,
    zone: &jiff::tz::TimeZone,
) -> Result<(String, String, bool), EngineError> {
    let local = |key| {
        text(row, key)?
            .parse::<jiff::Timestamp>()
            .map(|t| t.to_zoned(zone.clone()))
            .map_err(|_| EngineError::InvalidDate)
    };
    let from = local("startsAt")?;
    let to = local("endsAt")?;
    let all_day = row.get("allDay").and_then(Value::as_bool) == Some(true);
    let clock = |v: &jiff::Zoned| {
        if all_day {
            String::new()
        } else {
            format!("{:02}:{:02}", v.hour(), v.minute())
        }
    };
    Ok((clock(&from), clock(&to), from.date() != to.date()))
}
impl<'a> WidgetRows<'a> {
    pub fn new(
        entries: &'a [Value],
        collation: &'a CollationRanks,
        zone_name: &'a str,
        options: WidgetRowOptions,
    ) -> Result<Self, EngineError> {
        Self::from_source(OwnEntries::Slice(entries), collation, zone_name, options)
    }
    pub fn from_records<S: CalendarRecordSource>(
        entries: &'a S,
        collation: &'a CollationRanks,
        zone_name: &'a str,
        options: WidgetRowOptions,
    ) -> Result<Self, EngineError> {
        Self::from_source(OwnEntries::Records(entries), collation, zone_name, options)
    }
    fn from_source(
        source: OwnEntries<'a>,
        collation: &'a CollationRanks,
        zone_name: &'a str,
        options: WidgetRowOptions,
    ) -> Result<Self, EngineError> {
        if source.len() > 100000 {
            return Err(EngineError::Overflow);
        }
        let mut ordered = (0..source.len())
            .map(|index| {
                Ok((
                    sort_key_for_fields(
                        |key| source.get(index, key),
                        source.text(index, "date")?,
                        collation,
                    )?,
                    index,
                ))
            })
            .collect::<Result<Vec<_>, EngineError>>()?;
        ordered.sort_by_key(|(key, _)| *key);
        let mut result = Self {
            source,
            shifts: BTreeMap::new(),
            appointments: BTreeMap::new(),
            collation,
            zone: crate::time_zone::zone(zone_name)?,
            zone_name,
            options,
        };
        let mut projected = 0usize;
        for (_, index) in ordered {
            if result.source.get(index, "deletedAt") != Some(&Value::Null) {
                continue;
            }
            if result.source.get(index, "kind").and_then(Value::as_str) == Some("APPOINTMENT") {
                if options.show_appointments {
                    result
                        .appointments
                        .entry(result.source.text(index, "date")?.into())
                        .or_default()
                        .push(index);
                }
            } else {
                for date in duty_calendar_dates(result.source.base(index))? {
                    projected += 1;
                    if projected > 300000 {
                        return Err(EngineError::Overflow);
                    }
                    result.shifts.entry(date).or_default().push(index);
                }
            }
        }
        Ok(result)
    }
    pub fn day(
        &self,
        date: &str,
        shared: &SharedCalendarDays,
    ) -> Result<WidgetBusinessDay, EngineError> {
        let own = self.shifts.get(date).map(Vec::as_slice).unwrap_or_default();
        let mut incoming = shared
            .rows_for_date(date)
            .map(|row| {
                let row = row?;
                Ok((
                    row.starts_epoch_milliseconds()
                        .ok_or(EngineError::InvalidDate)?,
                    self.collation.rank(row.calendar_id)?,
                    self.collation.rank(text(row.entry, "id")?)?,
                    row,
                ))
            })
            .collect::<Result<Vec<_>, EngineError>>()?;
        incoming.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
        let details = DisplayOptions {
            show_shift_times: self.options.show_shift_times,
            show_shift_duration: self.options.show_shift_duration,
        };
        let mut shifts = Vec::new();
        if self.options.show_shifts {
            for &index in own {
                let row = self.source.base(index);
                let (start, end, next_day) = own_times(row, false);
                shifts.push(WidgetBusinessShift {
                    id: self.source.text(index, "id")?.into(),
                    raw_symbol: self.source.text(index, "symbol")?.into(),
                    origin: ShiftOrigin::Own,
                    title: self.source.text(index, "title")?.into(),
                    start,
                    end,
                    next_day,
                    color: self.source.text(index, "color")?.into(),
                    detail: shift_detail(row, details, self.zone_name)?,
                    owner_name: None,
                    owner_color: None,
                });
            }
        }
        if own.is_empty()
            && let Some((_, _, _, row)) = incoming.iter().find(|(_, _, _, row)| {
                row.entry.get("kind").and_then(Value::as_str) != Some("APPOINTMENT")
            })
        {
            let (start, end, next_day) = shared_times(row.entry, &self.zone)?;
            let detail = shared_shift_detail(row.entry, &start, details)?;
            shifts.push(WidgetBusinessShift {
                id: format!("shared:{}:{}", row.calendar_id, text(row.entry, "id")?),
                raw_symbol: text(row.entry, "symbol")?.into(),
                origin: ShiftOrigin::Shared,
                title: text(row.entry, "title")?.into(),
                start,
                end,
                next_day,
                color: text(row.entry, "color")?.into(),
                detail,
                owner_name: row.calendar_name.map(str::to_owned),
                owner_color: row.calendar_color.map(str::to_owned),
            });
        }
        let mut appointments = Vec::new();
        if self.options.show_appointments {
            for &index in self.appointments.get(date).into_iter().flatten() {
                let row = self.source.base(index);
                let (start, end, next_day) = own_times(row, true);
                appointments.push(WidgetBusinessAppointment {
                    id: self.source.text(index, "id")?.into(),
                    title: self.source.text(index, "title")?.into(),
                    start,
                    end,
                    next_day,
                    owner_name: None,
                    owner_color: None,
                });
            }
            for (_, _, _, row) in incoming.iter().filter(|(_, _, _, row)| {
                row.entry.get("kind").and_then(Value::as_str) == Some("APPOINTMENT")
            }) {
                let (start, end, next_day) = shared_times(row.entry, &self.zone)?;
                appointments.push(WidgetBusinessAppointment {
                    id: format!("shared:{}:{}", row.calendar_id, text(row.entry, "id")?),
                    title: text(row.entry, "title")?.into(),
                    start,
                    end,
                    next_day,
                    owner_name: row.calendar_name.map(str::to_owned),
                    owner_color: row.calendar_color.map(str::to_owned),
                });
            }
        }
        let day = WidgetBusinessDay {
            date: date.into(),
            shifts,
            appointments,
        };
        crate::report::cache_budget::serialized_bytes(&day, 16_515_072)
            .ok_or(EngineError::Overflow)?;
        Ok(day)
    }
}
