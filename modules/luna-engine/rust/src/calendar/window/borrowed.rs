use super::source::CalendarSourceIndex;
use serde::{Serialize, Serializer, ser::SerializeMap};
use serde_json::Value;
use std::{ops::Index, sync::Arc};

/// Native immutable records. Runtime admission remains with the owning lease.
/// `field` permits native replacement of existing display fields without
/// copying the base tree. It must preserve kind, date and recurrence fields:
/// recurrence and duty math deliberately read the immutable physical base.
pub trait CalendarRecordSource: Send + Sync {
    fn entries_len(&self) -> usize;
    fn base_value(&self, index: usize) -> &Value;
    fn field(&self, index: usize, key: &str) -> Option<&Value> {
        self.base_value(index).get(key)
    }
    /// O(1) borrowed lookup into this immutable native owner.
    fn record(&self, index: usize) -> Option<CalendarRecordRef<'_>>
    where
        Self: Sized,
    {
        (index < self.entries_len()).then(|| CalendarRecordRef::new(self, index))
    }
    fn records(&self) -> impl ExactSizeIterator<Item = CalendarRecordRef<'_>>
    where
        Self: Sized,
    {
        (0..self.entries_len()).map(|index| CalendarRecordRef::new(self, index))
    }
}
/// Cloning an admitted source must only share its immutable native owner.
pub trait CalendarEntrySource: CalendarRecordSource + Clone {}
impl<T: CalendarRecordSource + Clone> CalendarEntrySource for T {}
impl CalendarRecordSource for Arc<Vec<Value>> {
    fn entries_len(&self) -> usize {
        self.as_ref().len()
    }
    fn base_value(&self, index: usize) -> &Value {
        &self.as_ref()[index]
    }
}
impl CalendarRecordSource for Arc<Vec<Arc<Value>>> {
    fn entries_len(&self) -> usize {
        self.as_ref().len()
    }
    fn base_value(&self, index: usize) -> &Value {
        self.as_ref()[index].as_ref()
    }
}
impl CalendarRecordSource for crate::calendar::loaded_scope::ScopeEntries {
    fn entries_len(&self) -> usize {
        self.entries().len()
    }
    fn base_value(&self, index: usize) -> &Value {
        self.entries()[index].base_value()
    }
    fn field(&self, index: usize, key: &str) -> Option<&Value> {
        self.entries()[index].get(key)
    }
}
#[derive(Clone, Copy)]
pub struct CalendarRecordRef<'a> {
    source: &'a dyn CalendarRecordSource,
    index: usize,
}
impl<'a> CalendarRecordRef<'a> {
    pub(super) fn new(source: &'a dyn CalendarRecordSource, index: usize) -> Self {
        Self { source, index }
    }
    pub fn base_value(&self) -> &'a Value {
        self.source.base_value(self.index)
    }
    pub fn get(&self, key: &str) -> Option<&'a Value> {
        self.source.field(self.index, key)
    }
    pub fn is_object(&self) -> bool {
        self.base_value().is_object()
    }
}
impl Index<&str> for CalendarRecordRef<'_> {
    type Output = Value;
    fn index(&self, key: &str) -> &Value {
        self.get(key).unwrap_or(&Value::Null)
    }
}
impl Serialize for CalendarRecordRef<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let base = self.base_value();
        let Some(object) = base.as_object() else {
            return base.serialize(serializer);
        };
        let mut map = serializer.serialize_map(Some(object.len()))?;
        for (key, value) in object {
            map.serialize_entry(key, self.get(key).unwrap_or(value))?;
        }
        map.end()
    }
}
pub type SharedCalendarSourceIndex = CalendarSourceIndex<Arc<Vec<Arc<Value>>>>;
