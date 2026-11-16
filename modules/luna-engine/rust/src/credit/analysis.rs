//! Credit allocation grouped by source shift appearance and shift type.
use super::{
    context::DailyCreditContextCache,
    daily,
    duty::project_duty_calendar_day_parts,
    string,
    summary::{MetricsError, decimal_minutes},
};
use crate::{
    EngineError,
    calendar::{
        recurrence::CollationRanks,
        window::{CalendarRecordRef, CalendarRecordSource},
    },
    report::records::SliceRecords,
    rules::RuleResolver,
};
use serde_json::{Value, json};
use std::{
    borrow::Cow,
    collections::{BTreeMap, BTreeSet, HashMap},
};
pub(crate) const SHIFT_TYPES: [&str; 9] = [
    "EARLY", "LATE", "NIGHT", "DAY", "TRAINING", "VACATION", "SICK", "FREE", "CUSTOM",
];

fn record_string<'a>(entry: &CalendarRecordRef<'a>, key: &str) -> Result<&'a str, MetricsError> {
    entry
        .get(key)
        .and_then(Value::as_str)
        .ok_or(EngineError::InvalidCalendarEntry.into())
}
fn appearance(entry: &CalendarRecordRef<'_>) -> Result<Value, MetricsError> {
    Ok(
        json!({"title":record_string(entry,"title")?,"color":record_string(entry,"color")?,"symbol":record_string(entry,"symbol")?}),
    )
}
fn appearance_key(entry: &CalendarRecordRef<'_>) -> Result<String, MetricsError> {
    serde_json::to_string(&[
        record_string(entry, "title")?,
        record_string(entry, "color")?,
        record_string(entry, "symbol")?,
    ])
    .map_err(|_| EngineError::InvalidCalendarEntry.into())
}
#[derive(Clone)]
struct GroupEntry {
    id: String,
    date: String,
    minutes: f64,
}
struct Group {
    key: String,
    appearance: Value,
    types: Vec<String>,
    entries: Vec<GroupEntry>,
    entry_index: BTreeMap<String, usize>,
}
impl Group {
    fn to_json(&self) -> Value {
        let mut out = self.appearance.clone();
        let object = out.as_object_mut().expect("constructed appearance");
        object.insert("key".into(), json!(self.key));
        object.insert("types".into(), json!(self.types));
        object.insert("count".into(), json!(self.entries.len()));
        object.insert(
            "minutes".into(),
            json!(
                self.entries
                    .iter()
                    .fold(0.0, |sum, entry| sum + entry.minutes)
            ),
        );
        object.insert(
            "entries".into(),
            json!(
                self.entries
                    .iter()
                    .map(|entry| json!({"id":entry.id,"date":entry.date,"minutes":entry.minutes}))
                    .collect::<Vec<_>>()
            ),
        );
        out
    }
}
pub fn monthly_shift_type_analysis(
    month: &str,
    entries: &[Value],
    profile: &Value,
    resolver: &RuleResolver,
    collation: &CollationRanks,
    timed: bool,
) -> Result<Value, MetricsError> {
    if timed {
        monthly_timed_shift_type_analysis(month, entries, profile, collation)
    } else {
        let mut cache = DailyCreditContextCache::new(profile, resolver);
        monthly_shift_type_analysis_prepared(month, entries, &mut cache, collation)
    }
}
pub fn monthly_shift_type_analysis_prepared(
    month: &str,
    entries: &[Value],
    cache: &mut DailyCreditContextCache<'_>,
    collation: &CollationRanks,
) -> Result<Value, MetricsError> {
    monthly_analysis(month, entries, cache.profile(), collation, Some(cache))
}
/// Timed core reports need no tariff/legal/target catalog and therefore do not
/// wait for an unrelated catalog acquisition or prepare an unused target cache.
pub fn monthly_timed_shift_type_analysis(
    month: &str,
    entries: &[Value],
    profile: &Value,
    collation: &CollationRanks,
) -> Result<Value, MetricsError> {
    monthly_analysis(month, entries, profile, collation, None)
}
fn monthly_analysis(
    month: &str,
    entries: &[Value],
    profile: &Value,
    collation: &CollationRanks,
    cache: Option<&mut DailyCreditContextCache<'_>>,
) -> Result<Value, MetricsError> {
    let source = SliceRecords(entries);
    monthly_analysis_records(
        month,
        &source.records().collect::<Vec<_>>(),
        profile,
        collation,
        cache,
    )
}
pub fn monthly_shift_type_analysis_records_prepared(
    month: &str,
    entries: &[CalendarRecordRef<'_>],
    cache: &mut DailyCreditContextCache<'_>,
    collation: &CollationRanks,
) -> Result<Value, MetricsError> {
    monthly_analysis_records(month, entries, cache.profile(), collation, Some(cache))
}
pub fn monthly_timed_shift_type_analysis_records(
    month: &str,
    entries: &[CalendarRecordRef<'_>],
    profile: &Value,
    collation: &CollationRanks,
) -> Result<Value, MetricsError> {
    monthly_analysis_records(month, entries, profile, collation, None)
}
fn monthly_analysis_records(
    month: &str,
    entries: &[CalendarRecordRef<'_>],
    profile: &Value,
    collation: &CollationRanks,
    mut cache: Option<&mut DailyCreditContextCache<'_>>,
) -> Result<Value, MetricsError> {
    let mut sources = BTreeMap::new();
    for entry in entries.iter().filter(|entry| entry["kind"] == "SHIFT") {
        sources.insert(string(entry.base_value(), "id")?, entry.base_value());
    }
    let mut projected = Vec::new();
    for entry in entries.iter().filter(|entry| entry["kind"] == "SHIFT") {
        match project_duty_calendar_day_parts(entry.base_value())? {
            Some(parts) if !parts.is_empty() => {
                projected.extend(parts.into_iter().map(|part| (Cow::Owned(part), *entry)))
            }
            _ => projected.push((Cow::Borrowed(entry.base_value()), *entry)),
        }
    }
    // Native pointer identity lasts only for this call. It is not a cache key
    // or wire proof. Allocations borrow these exact original/generated records.
    let appearances_by_record = projected
        .iter()
        .map(|(entry, record)| (entry.as_ref() as *const Value, *record))
        .collect::<HashMap<_, _>>();
    let mut counted = BTreeSet::new();
    let mut counts = BTreeMap::<String, usize>::new();
    let mut minutes = BTreeMap::<String, f64>::new();
    let mut appearances = BTreeMap::<String, Vec<Value>>::new();
    let mut appearance_order = Vec::new();
    let mut groups = Vec::<Group>::new();
    let mut group_index = BTreeMap::<String, usize>::new();
    let mut dates = Vec::<(String, Vec<&Value>)>::new();
    let mut date_index = BTreeMap::<String, usize>::new();
    let prefix = format!("{month}-");
    for (entry, record) in &projected {
        if !entry.get("deletedAt").is_some_and(Value::is_null)
            || !string(entry, "date")?.starts_with(&prefix)
        {
            continue;
        }
        let kind = string(entry, "type")?.to_owned();
        let style = appearance(record)?;
        let styles = appearances.entry(kind.clone()).or_default();
        if styles.is_empty() {
            appearance_order.push(kind.clone());
        }
        if !styles.contains(&style) {
            styles.push(style.clone());
        }
        let id = string(entry, "id")?.to_owned();
        if counted.insert(id.clone()) {
            *counts.entry(kind.clone()).or_default() += 1;
        }
        let key = appearance_key(record)?;
        let index = if let Some(index) = group_index.get(&key) {
            *index
        } else {
            let index = groups.len();
            group_index.insert(key.clone(), index);
            groups.push(Group {
                key,
                appearance: style,
                types: Vec::new(),
                entries: Vec::new(),
                entry_index: BTreeMap::new(),
            });
            index
        };
        let group = &mut groups[index];
        if !group.types.contains(&kind) {
            group.types.push(kind);
        }
        if !group.entry_index.contains_key(&id) {
            let date = sources
                .get(id.as_str())
                .map(|source| string(source, "date"))
                .transpose()?
                .unwrap_or(string(entry, "date")?)
                .to_owned();
            group.entry_index.insert(id.clone(), group.entries.len());
            group.entries.push(GroupEntry {
                id,
                date,
                minutes: 0.0,
            });
        }
        let date = string(entry, "date")?.to_owned();
        if let Some(index) = date_index.get(&date) {
            dates[*index].1.push(entry.as_ref());
        } else {
            date_index.insert(date.clone(), dates.len());
            dates.push((date, vec![entry.as_ref()]));
        }
    }
    for (date, entries) in dates {
        let prepared = super::prepared::PreparedCreditEntries::from_refs(entries)?;
        let (by_type, allocations) = if cache.is_none() {
            let result = daily::calculate_timed_daily_work_credit_borrowed_prepared(
                &date,
                &prepared,
                string(profile, "timeZone")?,
                collation,
            )?;
            (result.summary.minutes_by_type, result.allocations)
        } else {
            let result = cache
                .as_mut()
                .ok_or(EngineError::InvalidCalendarEntry)?
                .calculate_borrowed_prepared(&date, &prepared, collation)?;
            (result.summary.minutes_by_type, result.allocations)
        };
        for allocation in allocations {
            let record = appearances_by_record
                .get(&(allocation.entry as *const Value))
                .ok_or(EngineError::InvalidCalendarEntry)?;
            let key = appearance_key(record)?;
            if let Some(index) = group_index.get(&key) {
                let group = &mut groups[*index];
                if let Some(index) = group.entry_index.get(string(allocation.entry, "id")?) {
                    group.entries[*index].minutes += decimal_minutes(&allocation.minutes)?;
                }
            }
        }
        for kind in SHIFT_TYPES {
            if let Some(value) = by_type.get(kind) {
                let credit = decimal_minutes(value)?;
                if credit > 0.0 {
                    *minutes.entry(kind.to_owned()).or_default() += credit;
                }
            }
        }
    }
    let items=SHIFT_TYPES.into_iter().filter(|kind|counts.get(*kind).copied().unwrap_or(0)>0||minutes.get(*kind).copied().unwrap_or(0.0)>0.0).map(|kind|json!({"type":kind,"count":counts.get(kind).copied().unwrap_or(0),"minutes":minutes.get(kind).copied().unwrap_or(0.0)})).collect::<Vec<_>>();
    let total_count = items.iter().try_fold(0_u64, |sum, item| {
        sum.checked_add(
            item["count"]
                .as_u64()
                .ok_or(EngineError::InvalidCalendarEntry)?,
        )
        .ok_or(EngineError::Overflow)
    })?;
    let total_minutes = items.iter().fold(0.0, |sum, item| {
        sum + item["minutes"].as_f64().unwrap_or(0.0)
    });
    let mut result = json!({"items":items,"totalCount":total_count,"totalMinutes":total_minutes});
    let out = result
        .as_object_mut()
        .ok_or(EngineError::InvalidCalendarEntry)?;
    if !groups.is_empty() {
        out.insert(
            "groups".into(),
            json!(groups.iter().map(Group::to_json).collect::<Vec<_>>()),
        );
    }
    if !items.is_empty() {
        let mut record = serde_json::Map::new();
        for kind in appearance_order {
            let styles = appearances
                .remove(&kind)
                .ok_or(EngineError::InvalidCalendarEntry)?;
            record.insert(kind, json!(styles));
        }
        out.insert("appearances".into(), Value::Object(record));
    }
    Ok(result)
}
fn array<'a>(value: &'a Value, key: &str) -> Result<&'a [Value], MetricsError> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .ok_or_else(|| EngineError::InvalidCalendarEntry.into())
}
fn numeric(value: &Value, key: &str) -> Result<f64, MetricsError> {
    value
        .get(key)
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
        .ok_or_else(|| EngineError::InvalidDuration.into())
}
pub fn combine_shift_type_analyses(parts: &[Value]) -> Result<Value, MetricsError> {
    let mut groups = Vec::<Value>::new();
    let mut index = BTreeMap::<String, usize>::new();
    for part in parts {
        if let Some(values) = part.get("groups").and_then(Value::as_array) {
            for group in values {
                let key = string(group, "key")?;
                if let Some(index) = index.get(key) {
                    let previous = &mut groups[*index];
                    let mut types = array(previous, "types")?.to_vec();
                    for kind in array(group, "types")? {
                        if !types.contains(kind) {
                            types.push(kind.clone());
                        }
                    }
                    let mut entries = array(previous, "entries")?.to_vec();
                    entries.extend_from_slice(array(group, "entries")?);
                    let count = numeric(previous, "count")? + numeric(group, "count")?;
                    let minutes = numeric(previous, "minutes")? + numeric(group, "minutes")?;
                    let out = previous
                        .as_object_mut()
                        .ok_or(EngineError::InvalidCalendarEntry)?;
                    out.insert("types".into(), json!(types));
                    out.insert("entries".into(), json!(entries));
                    out.insert("count".into(), json!(count));
                    out.insert("minutes".into(), json!(minutes));
                } else {
                    index.insert(key.to_owned(), groups.len());
                    groups.push(group.clone());
                }
            }
        }
    }
    let mut items = Vec::new();
    let mut appearances = serde_json::Map::new();
    for kind in SHIFT_TYPES {
        let mut count = 0.0;
        let mut minutes = 0.0;
        let mut styles = Vec::<Value>::new();
        for part in parts {
            if let Some(item) = array(part, "items")?
                .iter()
                .find(|item| item["type"] == kind)
            {
                count += numeric(item, "count")?;
                minutes += numeric(item, "minutes")?;
            }
            if let Some(values) = part
                .get("appearances")
                .and_then(|value| value.get(kind))
                .and_then(Value::as_array)
            {
                for style in values {
                    if !styles.contains(style) {
                        styles.push(style.clone());
                    }
                }
            }
        }
        if count > 0.0 || minutes > 0.0 {
            items.push(json!({"type":kind,"count":count,"minutes":minutes}));
        }
        if !styles.is_empty() {
            appearances.insert(kind.to_owned(), json!(styles));
        }
    }
    let total_count = items
        .iter()
        .fold(0.0, |sum, item| sum + item["count"].as_f64().unwrap_or(0.0));
    let total_minutes = items.iter().fold(0.0, |sum, item| {
        sum + item["minutes"].as_f64().unwrap_or(0.0)
    });
    let mut result = json!({"items":items,"totalCount":total_count,"totalMinutes":total_minutes});
    let out = result
        .as_object_mut()
        .ok_or(EngineError::InvalidCalendarEntry)?;
    if !groups.is_empty() {
        out.insert("groups".into(), json!(groups));
    }
    if !appearances.is_empty() {
        out.insert("appearances".into(), Value::Object(appearances));
    }
    Ok(result)
}
