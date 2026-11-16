use super::{
    borrowed::{CalendarEntrySource, CalendarRecordRef, CalendarRecordSource},
    model::*,
    source::CalendarSourceIndex,
};
use crate::{
    EngineError,
    calendar::recurrence::{self, AppointmentStep, CollationRanks},
};
use serde_json::Value;
use std::{collections::BTreeSet, sync::Arc};
pub(super) struct ProjectedEntry {
    pub source: u32,
    pub date: Option<String>,
}
impl ProjectedEntry {
    pub fn row<'a>(&self, rows: &'a dyn CalendarRecordSource) -> CalendarRecordRef<'a> {
        CalendarRecordRef::new(rows, self.source as usize)
    }
    pub fn date<'a>(&'a self, rows: &'a dyn CalendarRecordSource) -> Result<&'a str, WindowError> {
        self.date
            .as_deref()
            .or_else(|| self.row(rows).get("date").and_then(Value::as_str))
            .ok_or_else(|| EngineError::InvalidCalendarEntry.into())
    }
}
pub struct PreparedCalendarWindow<S = Arc<Vec<Value>>> {
    rows: S,
    bounds: WindowBounds,
    entries: Vec<ProjectedEntry>,
    candidates: BTreeSet<String>,
    needs_base_order: bool,
}
pub struct SortedCalendarWindow<S = Arc<Vec<Value>>> {
    pub(super) rows: S,
    pub(super) bounds: WindowBounds,
    pub(super) entries: Vec<ProjectedEntry>,
}
impl<S: CalendarEntrySource> PreparedCalendarWindow<S> {
    pub(super) fn from_source(
        source: &CalendarSourceIndex<S>,
        bounds: WindowBounds,
        current: impl Fn() -> bool,
    ) -> Result<Self, WindowError> {
        if !current() {
            return Err(WindowError::Cancelled);
        }
        let mut selected = source
            .ordinary
            .range(bounds.start_date.clone()..=bounds.end_date.clone())
            .flat_map(|(_, indices)| indices.iter().copied())
            .collect::<Vec<_>>();
        selected.extend(source.recurring.iter().copied().filter(|index| {
            source
                .entries
                .field(*index as usize, "date")
                .unwrap_or(&Value::Null)
                .as_str()
                .is_some_and(|date| date <= bounds.end_date.as_str())
        }));
        // Preserve the original entry loop before the stable projection sort.
        selected.sort_unstable();
        let mut entries = Vec::new();
        let mut steps = 0u64;
        for (position, index) in selected.into_iter().enumerate() {
            if position.is_multiple_of(256) && !current() {
                return Err(WindowError::Cancelled);
            }
            let row = CalendarRecordRef::new(&source.entries, index as usize);
            if row["kind"] == "APPOINTMENT"
                && row.get("recurrence").is_some_and(|rule| !rule.is_null())
            {
                for step in recurrence::appointment_dates(
                    row.base_value(),
                    &bounds.start_date,
                    &bounds.end_date,
                )? {
                    steps += 1;
                    if steps.is_multiple_of(256) && !current() {
                        return Err(WindowError::Cancelled);
                    }
                    if steps > MAX_STEPS {
                        return Err(WindowError::ResourceLimit);
                    }
                    let AppointmentStep::Occurrence(date) = step? else {
                        continue;
                    };
                    if entries.len() == MAX_PROJECTED_ROWS {
                        return Err(WindowError::ResourceLimit);
                    }
                    entries.push(ProjectedEntry {
                        source: index,
                        date: date.map(|d| d.to_string()),
                    });
                }
            } else {
                if entries.len() == MAX_PROJECTED_ROWS {
                    return Err(WindowError::ResourceLimit);
                }
                entries.push(ProjectedEntry {
                    source: index,
                    date: None,
                });
            }
        }
        let mut candidates = BTreeSet::new();
        let mut bytes = 0usize;
        for entry in &entries {
            let row = entry.row(&source.entries);
            let start = match row.get("startTime") {
                None | Some(Value::Null) => "",
                Some(Value::String(text)) => text,
                Some(_) => return Err(EngineError::InvalidCalendarEntry.into()),
            };
            let fields = [
                entry.date(&source.entries)?,
                row["createdAt"]
                    .as_str()
                    .ok_or(EngineError::InvalidCalendarEntry)?,
                row["title"]
                    .as_str()
                    .ok_or(EngineError::InvalidCalendarEntry)?,
                row["id"]
                    .as_str()
                    .ok_or(EngineError::InvalidCalendarEntry)?,
                start,
            ];
            for text in fields {
                if !candidates.contains(text) {
                    bytes = bytes
                        .checked_add(text.len())
                        .ok_or(WindowError::ResourceLimit)?;
                    if candidates.len() == MAX_CANDIDATES || bytes > MAX_CANDIDATE_BYTES {
                        return Err(WindowError::ResourceLimit);
                    }
                    candidates.insert(text.to_owned());
                }
            }
            if source.needs_base_order {
                let seed_date = row["date"]
                    .as_str()
                    .ok_or(EngineError::InvalidCalendarEntry)?;
                if !candidates.contains(seed_date) {
                    bytes = bytes
                        .checked_add(seed_date.len())
                        .ok_or(WindowError::ResourceLimit)?;
                    if candidates.len() == MAX_CANDIDATES || bytes > MAX_CANDIDATE_BYTES {
                        return Err(WindowError::ResourceLimit);
                    }
                    candidates.insert(seed_date.to_owned());
                }
            }
        }
        if !current() {
            return Err(WindowError::Cancelled);
        }
        Ok(Self {
            rows: source.entries.clone(),
            bounds,
            entries,
            candidates,
            needs_base_order: source.needs_base_order,
        })
    }
    pub fn candidates(&self) -> &BTreeSet<String> {
        &self.candidates
    }
    pub(crate) fn take_candidates(&mut self) -> BTreeSet<String> {
        std::mem::take(&mut self.candidates)
    }
    pub(crate) fn metadata_bytes(&self) -> u64 {
        std::mem::size_of::<Self>() as u64
            + self.entries.capacity() as u64 * std::mem::size_of::<ProjectedEntry>() as u64
            + self
                .entries
                .iter()
                .filter_map(|entry| entry.date.as_ref())
                .map(|date| date.capacity() as u64)
                .sum::<u64>()
            + self.bounds.start_date.capacity() as u64
            + self.bounds.end_date.capacity() as u64
            + self
                .candidates
                .iter()
                .map(|text| text.capacity() as u64 + 192)
                .sum::<u64>()
    }
    pub fn bounds(&self) -> &WindowBounds {
        &self.bounds
    }
    pub fn projected_len(&self) -> u32 {
        self.entries.len() as u32
    }
    pub fn finalize(
        self,
        ranks: &CollationRanks,
    ) -> Result<Arc<SortedCalendarWindow<S>>, WindowError> {
        let entries = if self.needs_base_order {
            // Sorting only selected descriptors by original source keys restores
            // listCalendarEntries' base order. The second stable sort then has
            // exactly the same tie order as expansion of that original list.
            let mut base = self
                .entries
                .into_iter()
                .map(|entry| {
                    let row = entry.row(&self.rows);
                    let date = row["date"]
                        .as_str()
                        .ok_or(EngineError::InvalidCalendarEntry)?;
                    let key = recurrence::sort_key_for_fields(|field| row.get(field), date, ranks)?;
                    Ok((key, entry))
                })
                .collect::<Result<Vec<_>, WindowError>>()?;
            base.sort_by_key(|(key, _)| *key);
            base.into_iter().map(|(_, entry)| entry).collect::<Vec<_>>()
        } else {
            self.entries
        };
        let rows = self.rows;
        let mut ranked = entries
            .into_iter()
            .map(|entry| {
                let key = recurrence::sort_key_for_fields(
                    |field| entry.row(&rows).get(field),
                    entry.date(&rows)?,
                    ranks,
                )?;
                Ok((key, entry))
            })
            .collect::<Result<Vec<_>, WindowError>>()?;
        ranked.sort_by_key(|(key, _)| *key);
        Ok(Arc::new(SortedCalendarWindow {
            rows,
            bounds: self.bounds,
            entries: ranked.into_iter().map(|(_, entry)| entry).collect(),
        }))
    }
}
impl SortedCalendarWindow {
    pub fn source_entries(&self) -> &Arc<Vec<Value>> {
        &self.rows
    }
}
impl SortedCalendarWindow<Arc<Vec<Arc<Value>>>> {
    pub fn source_entries(&self) -> &Arc<Vec<Arc<Value>>> {
        &self.rows
    }
}
impl<S: CalendarEntrySource> SortedCalendarWindow<S> {
    pub(crate) fn metadata_bytes(&self) -> u64 {
        std::mem::size_of::<Self>() as u64
            + self.entries.capacity() as u64 * std::mem::size_of::<ProjectedEntry>() as u64
            + self
                .entries
                .iter()
                .filter_map(|entry| entry.date.as_ref())
                .map(|date| date.capacity() as u64)
                .sum::<u64>()
            + self.bounds.start_date.capacity() as u64
            + self.bounds.end_date.capacity() as u64
    }
    pub fn entry_source(&self) -> &S {
        &self.rows
    }
    pub fn bounds(&self) -> &WindowBounds {
        &self.bounds
    }
    pub fn projected_len(&self) -> u32 {
        self.entries.len() as u32
    }
    pub fn entry(&self, index: u32) -> Option<super::view::CalendarEntryView<'_>> {
        self.entries
            .get(index as usize)
            .map(|entry| super::view::CalendarEntryView {
                entry,
                record: entry.row(&self.rows),
            })
    }
}
