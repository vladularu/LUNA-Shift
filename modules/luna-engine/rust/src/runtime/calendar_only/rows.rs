use super::super::{
    facts::FactError,
    report::ReportIssue,
    sources::{RequiredCoverage, ready_state},
};
use crate::{
    calendar::window::CalendarSourceIndex,
    contract::{CanonicalHashWriter, CanonicalValueRef, SourceKind, SourceState},
    input::calendar_rows::PreparedCalendarRows,
};
use sha2::{Digest, Sha256};
use std::sync::Arc;
pub struct CalendarRows {
    index: Arc<CalendarSourceIndex>,
    key: String,
}
impl CalendarRows {
    pub(crate) fn recorded(
        raw: &serde_json::Value,
    ) -> Result<Arc<CalendarSourceIndex>, ReportIssue> {
        let invalid = || ReportIssue::new("CALENDAR_INVALID");
        let object = raw
            .as_object()
            .filter(|v| v.len() == 2 && v.contains_key("entries"))
            .ok_or_else(invalid)?;
        let entries = object["entries"]
            .as_array()
            .filter(|v| v.len() <= 50_000)
            .ok_or_else(invalid)?;
        for entry in entries {
            if !entry.is_object() {
                return Err(invalid());
            }
            if entry.get("deletedAt") != Some(&serde_json::Value::Null) {
                continue;
            }
            if !["id", "title"].iter().all(|key| entry[*key].is_string()) {
                return Err(invalid());
            }
        }
        // Provider order and joined-load/unjoined-receipt values are inputs.
        // Recurrence, filtering and final ordering remain in the window kernel.
        CalendarSourceIndex::new(Arc::new(entries.clone()))
            .map(Arc::new)
            .map_err(|_| invalid())
    }
    pub fn prepare(state: &SourceState) -> Result<Self, ReportIssue> {
        let raw = ready_state(state, RequiredCoverage::AllHistory)
            .and_then(|v| v.value())
            .map_err(|error| {
                ReportIssue::from(FactError::Source {
                    kind: SourceKind::CalendarEntries,
                    error,
                })
            })?;
        let invalid = || ReportIssue::new("CALENDAR_INVALID");
        let recorded =
            raw.get("kind").and_then(serde_json::Value::as_str) == Some("RECORDED_ENTRIES");
        if recorded {
            let index = Self::recorded(raw)?;
            let mut hash = Sha256::new();
            hash.update(b"luna-calendar-record-input-v1\0");
            hash.update(crate::ENGINE_VERSION.as_bytes());
            hash.update(b"\0");
            serde_json::to_writer(CanonicalHashWriter(&mut hash), &CanonicalValueRef(raw))
                .map_err(|_| invalid())?;
            return Ok(Self {
                index,
                key: format!("{:x}", hash.finalize()),
            });
        }
        let object = raw
            .as_object()
            .filter(|v| {
                (v.len() == 3 || (v.len() == 4 && v.contains_key("templateRows")))
                    && ["shiftRows", "appointmentRows", "platformCollationRanks"]
                        .iter()
                        .all(|k| v.contains_key(*k))
            })
            .ok_or_else(invalid)?;
        // This original path accepts SQL rows. Platform comparison maps are
        // created for the selected window later, never supplied as ready row facts.
        if !object["platformCollationRanks"]
            .as_object()
            .is_some_and(|v| v.is_empty())
        {
            return Err(invalid());
        }
        let shifts = object["shiftRows"].as_array().ok_or_else(invalid)?;
        let appointments = object["appointmentRows"].as_array().ok_or_else(invalid)?;
        let templates = object
            .get("templateRows")
            .map(|v| v.as_array().map(Vec::as_slice).ok_or_else(invalid))
            .transpose()?;
        let entries = PreparedCalendarRows::normalize_rows(shifts, appointments, templates)
            .map_err(|_| invalid())?;
        let index = Arc::new(
            CalendarSourceIndex::from_unranked_normalized(Arc::new(entries))
                .map_err(|_| invalid())?,
        );
        let mut hash = Sha256::new();
        hash.update(b"luna-calendar-only-row-source-v1\0");
        hash.update(crate::ENGINE_VERSION.as_bytes());
        hash.update(b"\0");
        serde_json::to_writer(CanonicalHashWriter(&mut hash), &CanonicalValueRef(raw))
            .map_err(|_| invalid())?;
        Ok(Self {
            index,
            key: format!("{:x}", hash.finalize()),
        })
    }
    pub fn index(&self) -> &Arc<CalendarSourceIndex> {
        &self.index
    }
    pub fn key(&self) -> &str {
        &self.key
    }
}
