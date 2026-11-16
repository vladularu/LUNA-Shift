use super::{borrowed::CalendarEntrySource, model::*, projection::PreparedCalendarWindow};
use crate::{EngineError, calendar::parse_date};
use serde_json::Value;
use std::{collections::BTreeMap, sync::Arc};
/// Rust-only normalized source owner. Production supplies the existing
/// RawCalendarEntries::entries Arc; this constructor is no wire-ready claim.
pub struct CalendarSourceIndex<S = Arc<Vec<Value>>> {
    pub(super) entries: S,
    pub(super) ordinary: BTreeMap<String, Vec<u32>>,
    pub(super) recurring: Vec<u32>,
    pub(super) needs_base_order: bool,
    bytes: u64,
}

impl CalendarSourceIndex {
    /// Native normalized input before repository base ordering. This is not a
    /// deserializable admission proof or a host Ready flag.
    pub fn from_unranked_normalized(entries: Arc<Vec<Value>>) -> Result<Self, WindowError> {
        Self::from_unranked_entry_source(entries)
    }
    pub fn new(entries: Arc<Vec<Value>>) -> Result<Self, WindowError> {
        Self::from_entry_source(entries)
    }
    pub fn source_entries(&self) -> &Arc<Vec<Value>> {
        &self.entries
    }
}
impl CalendarSourceIndex<Arc<Vec<Arc<Value>>>> {
    pub fn from_shared_entries(entries: Arc<Vec<Arc<Value>>>) -> Result<Self, WindowError> {
        Self::from_entry_source(entries)
    }
    pub fn source_entries(&self) -> &Arc<Vec<Arc<Value>>> {
        &self.entries
    }
}
impl<S: CalendarEntrySource> CalendarSourceIndex<S> {
    /// Native source before repository ordering; only the selected window's
    /// base keys and occurrence keys are ranked during preparation.
    pub fn from_unranked_entry_source(entries: S) -> Result<Self, WindowError> {
        let mut source = Self::from_entry_source(entries)?;
        source.needs_base_order = true;
        Ok(source)
    }
    pub fn from_entry_source(entries: S) -> Result<Self, WindowError> {
        if entries.entries_len() > MAX_SOURCE_ROWS {
            return Err(WindowError::ResourceLimit);
        }
        let mut ordinary: BTreeMap<String, Vec<u32>> = BTreeMap::new();
        let mut recurring = Vec::new();
        for (index, entry) in entries.records().enumerate() {
            if !entry.is_object() {
                return Err(EngineError::InvalidCalendarEntry.into());
            }
            if entry.get("deletedAt") != Some(&Value::Null) {
                continue;
            }
            let kind = entry["kind"]
                .as_str()
                .ok_or(EngineError::InvalidCalendarEntry)?;
            if kind != "SHIFT" && kind != "APPOINTMENT" {
                return Err(EngineError::InvalidCalendarEntry.into());
            }
            let date = entry["date"]
                .as_str()
                .ok_or(EngineError::InvalidCalendarEntry)?;
            parse_date(date)?;
            let index = u32::try_from(index).map_err(|_| WindowError::ResourceLimit)?;
            if kind == "APPOINTMENT" && entry.get("recurrence").is_some_and(|r| !r.is_null()) {
                recurring.push(index);
            } else {
                ordinary.entry(date.to_owned()).or_default().push(index);
            }
        }
        let bytes = 4096
            + std::mem::size_of::<Self>() as u64
            + recurring.capacity() as u64 * 4
            + ordinary
                .iter()
                .map(|(date, rows)| date.capacity() as u64 + rows.capacity() as u64 * 4 + 192)
                .sum::<u64>();
        Ok(Self {
            entries,
            ordinary,
            recurring,
            needs_base_order: false,
            bytes,
        })
    }
    pub fn entry_source(&self) -> &S {
        &self.entries
    }
    /// Index allocations only; immutable normalized rows are shared, not copied.
    pub(crate) fn metadata_bytes(&self) -> u64 {
        self.bytes
    }
    pub fn prepare(&self, spec: &WindowSpec) -> Result<PreparedCalendarWindow<S>, WindowError> {
        self.prepare_current(spec, || true)
    }
    pub(crate) fn prepare_current(
        &self,
        spec: &WindowSpec,
        current: impl Fn() -> bool,
    ) -> Result<PreparedCalendarWindow<S>, WindowError> {
        PreparedCalendarWindow::from_source(self, WindowBounds::from_spec(spec)?, current)
    }
}

#[cfg(test)]
mod cancellation_tests {
    use super::*;
    use serde_json::json;
    use std::cell::Cell;
    #[test]
    fn cancelled_window_stops_legacy_recurrence_work_without_publishing_partial_rows() {
        let source=CalendarSourceIndex::new(Arc::new(vec![json!({"kind":"APPOINTMENT","id":"old-series","date":"2000-01-01","title":"Original","startTime":null,"createdAt":"2000-01-01T00:00:00Z","deletedAt":null,"recurrence":{"frequency":"DAY","interval":1}})])).unwrap();
        let checks = Cell::new(0);
        let result = source.prepare_current(
            &WindowSpec::Day {
                date: "2026-03-01".to_owned(),
            },
            || {
                checks.set(checks.get() + 1);
                checks.get() < 3
            },
        );
        assert!(matches!(result, Err(WindowError::Cancelled)));
        assert_eq!(
            checks.get(),
            3,
            "cancellation is checked during skipped recurrence attempts"
        );
    }
}
