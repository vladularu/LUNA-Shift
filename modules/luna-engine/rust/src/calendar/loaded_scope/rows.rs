use super::{CalendarLoadRange, ScopeEntries, ScopeEntry, ScopeError};
use crate::calendar::recurrence::CollationRanks;
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

/// Raw physical SQL facts, never a host-computed entry list. Owner/CAS admission
/// is supplied by the runtime controller rather than this pure policy constructor.
#[derive(Debug)]
pub struct RawScopeRows {
    shifts: Arc<[Value]>,
    appointments: Arc<[Value]>,
    templates: Arc<[Value]>,
}
impl RawScopeRows {
    pub fn new(
        shifts: Arc<[Value]>,
        appointments: Arc<[Value]>,
        templates: Arc<[Value]>,
    ) -> Result<Arc<Self>, ScopeError> {
        if shifts.len().saturating_add(appointments.len()) > 50_000
            || templates.len() > 50_000
            || crate::report::cache_budget::serialized_bytes(
                &(shifts.as_ref(), appointments.as_ref(), templates.as_ref()),
                16_515_072,
            )
            .is_none()
        {
            return Err(ScopeError::Capacity);
        }
        let mut ids = BTreeSet::new();
        for row in templates.iter() {
            let id = row["id"]
                .as_str()
                .filter(|id| !id.is_empty() && id.encode_utf16().count() <= 256)
                .ok_or(ScopeError::InvalidIntent)?;
            if !ids.insert(id) {
                return Err(ScopeError::InvalidIntent);
            }
        }
        Ok(Arc::new(Self {
            shifts,
            appointments,
            templates,
        }))
    }
    pub fn prepare(
        self: &Arc<Self>,
        range: &CalendarLoadRange,
    ) -> Result<PreparedScopeEntries, ScopeError> {
        let lookup = self
            .templates
            .iter()
            .map(|row| (row["id"].as_str().unwrap_or_default(), row))
            .collect::<BTreeMap<_, _>>();
        let mut entries = Vec::new();
        let mut ids = BTreeSet::new();
        let mut candidates = BTreeSet::new();
        for row in self.shifts.iter() {
            if !row["deleted_at"].is_null()
                || !row["date"]
                    .as_str()
                    .is_some_and(|date| range.contains(date))
            {
                continue;
            }
            let template = row["template_id"]
                .as_str()
                .and_then(|id| lookup.get(id).copied());
            let value = crate::input::calendar_rows::map_shift_display(row, template)?;
            let id = checked_id(&value)?;
            if !ids.insert(("SHIFT", id.to_owned())) {
                return Err(ScopeError::InvalidIntent);
            }
            for field in ["date", "startTime", "createdAt", "title", "id"] {
                candidates.insert(value[field].as_str().unwrap_or_default().to_owned());
            }
            entries.push(Arc::new(ScopeEntry {
                value: Arc::new(value),
                display: None,
                _raw: Some(self.clone()),
            }));
        }
        for row in self.appointments.iter() {
            if !row["deleted_at"].is_null()
                || !row["date"].as_str().is_some_and(|date| {
                    date <= range.end_date.as_str()
                        && (!row["recurrence_frequency"].is_null()
                            || date >= range.start_date.as_str())
                })
            {
                continue;
            }
            let value = crate::input::calendar_rows::map_appointment(row)?;
            let id = checked_id(&value)?;
            if !ids.insert(("APPOINTMENT", id.to_owned())) {
                return Err(ScopeError::InvalidIntent);
            }
            for field in ["date", "startTime", "createdAt", "title", "id"] {
                candidates.insert(value[field].as_str().unwrap_or_default().to_owned());
            }
            entries.push(Arc::new(ScopeEntry {
                value: Arc::new(value),
                display: None,
                _raw: Some(self.clone()),
            }));
        }
        Ok(PreparedScopeEntries {
            candidates,
            entries,
        })
    }
}
pub struct PreparedScopeEntries {
    candidates: BTreeSet<String>,
    entries: Vec<Arc<ScopeEntry>>,
}
impl PreparedScopeEntries {
    pub fn collation_candidates(&self) -> &BTreeSet<String> {
        &self.candidates
    }
    pub fn finish(self, ranks: &CollationRanks) -> Result<ScopeEntries, ScopeError> {
        ScopeEntries::sorted(self.entries, ranks)
    }
}
impl ScopeEntry {
    /// Pure postimage mapper. A runtime must separately require a genuine
    /// same-Core committed-write proof before publishing this opaque value.
    pub fn from_write_row(kind: &str, row: Arc<Value>) -> Result<Arc<Self>, ScopeError> {
        let value = match kind {
            "SHIFT" => crate::input::calendar_rows::map_shift(&row)?,
            "APPOINTMENT" => crate::input::calendar_rows::map_appointment(&row)?,
            _ => return Err(ScopeError::InvalidIntent),
        };
        checked_id(&value)?;
        Ok(Arc::new(Self {
            value: Arc::new(value),
            display: None,
            _raw: None,
        }))
    }
}
fn checked_id(value: &Value) -> Result<&str, ScopeError> {
    value["id"]
        .as_str()
        .filter(|id| !id.is_empty() && id.encode_utf16().count() <= 256)
        .ok_or(ScopeError::InvalidIntent)
}
