use super::{ExportTimeError, MAX_READABLE_ENTRIES, months};
use crate::{
    calendar::{
        recurrence::CollationRanks,
        window::{CalendarRecordRef, CalendarRecordSource},
    },
    input::calendar_rows::RawCalendarEntries,
    report::export_rows::{ReportComparisonCandidates, report_comparison_candidates_from_records},
    runtime::{
        calendar_loaded::LoadedReadSource, facts::SnapshotFacts, utility_lease::UtilityOwnerMarker,
    },
};
use serde_json::Value;
use std::{collections::BTreeMap, sync::Arc};
pub const MAX_CANDIDATE_BYTES: usize = 32 * 1024 * 1024;
enum CalendarOwner {
    Raw(Arc<RawCalendarEntries>),
    Loaded(LoadedReadSource),
}
impl CalendarRecordSource for CalendarOwner {
    fn entries_len(&self) -> usize {
        match self {
            Self::Raw(v) => v.entries().len(),
            Self::Loaded(v) => v.entries_len(),
        }
    }
    fn base_value(&self, index: usize) -> &Value {
        match self {
            Self::Raw(v) => &v.entries()[index],
            Self::Loaded(v) => v.base_value(index),
        }
    }
    fn field(&self, index: usize, key: &str) -> Option<&Value> {
        match self {
            Self::Raw(v) => v.entries()[index].get(key),
            Self::Loaded(v) => v.field(index, key),
        }
    }
}
/// Immutable native owner. A loaded source retains its same-core live witness.
pub struct ExportStructureIndex {
    calendar: CalendarOwner,
    by_month: BTreeMap<String, Vec<usize>>,
    scanned_entries: usize,
}
impl ExportStructureIndex {
    pub fn from_facts(facts: &SnapshotFacts) -> Result<Self, ExportTimeError> {
        Self::from_calendar(Arc::clone(
            facts.calendar().map_err(ExportTimeError::Facts)?,
        ))
    }
    pub fn from_calendar(calendar: Arc<RawCalendarEntries>) -> Result<Self, ExportTimeError> {
        Self::build(CalendarOwner::Raw(calendar))
    }
    pub fn from_loaded(source: LoadedReadSource) -> Result<Self, ExportTimeError> {
        if !source.is_current().map_err(ExportTimeError::Loaded)? {
            return Err(ExportTimeError::StaleSource);
        }
        Self::build(CalendarOwner::Loaded(source))
    }
    fn build(calendar: CalendarOwner) -> Result<Self, ExportTimeError> {
        let mut by_month: BTreeMap<String, Vec<usize>> = BTreeMap::new();
        for (index, entry) in calendar.records().enumerate() {
            if entry.get("deletedAt").is_some_and(Value::is_null) {
                let month = entry
                    .get("date")
                    .and_then(Value::as_str)
                    .and_then(|v| v.get(..7))
                    .ok_or(ExportTimeError::InvalidPeriod)?;
                by_month.entry(month.to_owned()).or_default().push(index);
            }
        }
        let scanned_entries = calendar.entries_len();
        let result = Self {
            calendar,
            by_month,
            scanned_entries,
        };
        result.check_live()?;
        Ok(result)
    }
    pub fn is_current(&self) -> Result<bool, ExportTimeError> {
        match &self.calendar {
            CalendarOwner::Raw(_) => Ok(true),
            CalendarOwner::Loaded(v) => v.is_current().map_err(ExportTimeError::Loaded),
        }
    }
    pub(crate) fn check_live(&self) -> Result<(), ExportTimeError> {
        if self.is_current()? {
            Ok(())
        } else {
            Err(ExportTimeError::StaleSource)
        }
    }
    pub(crate) fn shares_owner(&self, owner: &UtilityOwnerMarker) -> bool {
        match &self.calendar {
            CalendarOwner::Raw(_) => true,
            CalendarOwner::Loaded(v) => v.shares_owner(owner),
        }
    }
    pub fn candidates(&self, period: &str) -> Result<ReportComparisonCandidates, ExportTimeError> {
        self.check_live()?;
        let periods = months(period)?;
        let records = periods
            .iter()
            .flat_map(|v| self.month_records(v))
            .collect::<Vec<_>>();
        let result = report_comparison_candidates_from_records(
            &records,
            MAX_READABLE_ENTRIES,
            MAX_CANDIDATE_BYTES,
        )
        .map_err(ExportTimeError::Entries)?;
        self.check_live()?;
        Ok(result)
    }
    pub fn scanned_entry_count(&self) -> usize {
        self.scanned_entries
    }
    pub fn shares_calendar(&self, calendar: &Arc<RawCalendarEntries>) -> bool {
        matches!(&self.calendar,CalendarOwner::Raw(value)if Arc::ptr_eq(value,calendar))
    }
    fn month_records(&self, month: &str) -> impl Iterator<Item = CalendarRecordRef<'_>> {
        self.by_month.get(month).into_iter().flatten().map(|&i| {
            self.calendar
                .record(i)
                .expect("immutable native source index")
        })
    }
    pub(super) fn ordered_month_records<'a>(
        &'a self,
        month: &str,
        collation: &CollationRanks,
    ) -> Result<Vec<CalendarRecordRef<'a>>, ExportTimeError> {
        self.check_live()?;
        let mut selected = Vec::new();
        for entry in self.month_records(month) {
            let date = entry
                .get("date")
                .and_then(Value::as_str)
                .ok_or(ExportTimeError::InvalidPeriod)?;
            let start = entry.get("startTime").and_then(Value::as_str).unwrap_or("");
            let id = entry
                .get("id")
                .and_then(Value::as_str)
                .ok_or(ExportTimeError::InvalidPeriod)?;
            selected.push((
                (
                    collation.rank(date).map_err(ExportTimeError::Order)?,
                    collation.rank(start).map_err(ExportTimeError::Order)?,
                    collation.rank(id).map_err(ExportTimeError::Order)?,
                ),
                entry,
            ));
        }
        selected.sort_by_key(|(key, _)| *key);
        let result = selected.into_iter().map(|(_, v)| v).collect();
        self.check_live()?;
        Ok(result)
    }
}
