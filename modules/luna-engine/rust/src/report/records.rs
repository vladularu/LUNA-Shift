//! Borrowed immutable calendar records for native report composition.
//!
//! This is a math owner, not a deserializable Source-admission proof. The runtime
//! consumer retains and checks its genuine Source lease around computation and
//! final publication. Selection preserves the supplied Source order.
use crate::calendar::window::{CalendarRecordRef, CalendarRecordSource};
use serde::{Serialize, Serializer};
use serde_json::Value;
use std::sync::Arc;

#[derive(Clone)]
pub struct ReportRecords {
    source: Arc<dyn CalendarRecordSource>,
    indices: Option<Arc<[usize]>>,
}
impl std::fmt::Debug for ReportRecords {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ReportRecords")
            .field("len", &self.entries_len())
            .finish_non_exhaustive()
    }
}
impl ReportRecords {
    pub fn new<S: CalendarRecordSource + 'static>(source: S) -> Self {
        Self {
            source: Arc::new(source),
            indices: None,
        }
    }
    pub fn select(&self, indices: impl IntoIterator<Item = usize>) -> Option<Self> {
        let indices = indices
            .into_iter()
            .map(|index| (index < self.entries_len()).then(|| self.original_index(index)))
            .collect::<Option<Vec<_>>>()?;
        Some(Self {
            source: Arc::clone(&self.source),
            indices: Some(indices.into()),
        })
    }
    fn original_index(&self, index: usize) -> usize {
        self.indices
            .as_ref()
            .map_or(index, |indices| indices[index])
    }
    pub fn physical(&self) -> impl ExactSizeIterator<Item = &Value> {
        (0..self.entries_len()).map(|index| self.base_value(index))
    }
}
impl CalendarRecordSource for ReportRecords {
    fn entries_len(&self) -> usize {
        self.indices
            .as_ref()
            .map_or_else(|| self.source.entries_len(), |indices| indices.len())
    }
    fn base_value(&self, index: usize) -> &Value {
        self.source.base_value(self.original_index(index))
    }
    fn field(&self, index: usize, key: &str) -> Option<&Value> {
        self.source.field(self.original_index(index), key)
    }
}
impl Serialize for ReportRecords {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_seq(self.records())
    }
}
pub(crate) struct SliceRecords<'a>(pub &'a [Value]);
impl CalendarRecordSource for SliceRecords<'_> {
    fn entries_len(&self) -> usize {
        self.0.len()
    }
    fn base_value(&self, index: usize) -> &Value {
        &self.0[index]
    }
}
pub(crate) fn physical_refs<'a>(records: &'a [CalendarRecordRef<'_>]) -> Vec<&'a Value> {
    records.iter().map(CalendarRecordRef::base_value).collect()
}
