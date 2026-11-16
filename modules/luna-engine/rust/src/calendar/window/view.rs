use super::{
    borrowed::{CalendarEntrySource, CalendarRecordRef},
    projection::{ProjectedEntry, SortedCalendarWindow},
};
use serde::{
    Serialize, Serializer,
    ser::{SerializeMap, SerializeSeq, SerializeStruct},
};
use serde_json::Value;
use std::sync::Arc;
/// Borrowed full Source view. Runtime paging can reuse these descriptors
/// without materializing a second complete entry/value tree.
pub struct CalendarWindowView<S = Arc<Vec<Value>>> {
    pub(super) window: Arc<SortedCalendarWindow<S>>,
    pub(super) visible: Vec<u32>,
    pub(super) dates: Vec<(String, Vec<u32>)>,
    pub(super) months: Vec<(String, Vec<u32>)>,
}
pub struct CalendarEntryView<'a> {
    pub(super) entry: &'a ProjectedEntry,
    pub(super) record: CalendarRecordRef<'a>,
}
impl<'a> CalendarEntryView<'a> {
    pub fn original(&self) -> &'a Value {
        self.record.base_value()
    }
    pub fn date(&self) -> &'a str {
        self.entry
            .date
            .as_deref()
            .or_else(|| self.record.get("date").and_then(Value::as_str))
            .expect("indexed normalized date")
    }
    /// Effective source field, before an occurrence's date replacement. Use
    /// `date()` for the occurrence date and Serialize for its complete record.
    pub fn get(&self, field: &str) -> Option<&'a Value> {
        self.record.get(field)
    }
    pub fn source_record(&self) -> CalendarRecordRef<'a> {
        self.record
    }
}
impl<S: CalendarEntrySource> CalendarWindowView<S> {
    pub(crate) fn metadata_bytes(&self) -> u64 {
        let groups = |values: &Vec<(String, Vec<u32>)>| {
            values.capacity() as u64 * std::mem::size_of::<(String, Vec<u32>)>() as u64
                + values
                    .iter()
                    .map(|(key, indices)| key.capacity() as u64 + indices.capacity() as u64 * 4)
                    .sum::<u64>()
        };
        std::mem::size_of::<Self>() as u64
            + self.window.metadata_bytes()
            + self.visible.capacity() as u64 * 4
            + groups(&self.dates)
            + groups(&self.months)
    }
    pub fn window(&self) -> &Arc<SortedCalendarWindow<S>> {
        &self.window
    }
    pub fn visible_indices(&self) -> &[u32] {
        &self.visible
    }
    pub fn date_groups(&self) -> &[(String, Vec<u32>)] {
        &self.dates
    }
    pub fn month_groups(&self) -> &[(String, Vec<u32>)] {
        &self.months
    }
}
impl Serialize for CalendarEntryView<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let record = self.record;
        let base = record.base_value();
        let Some(date) = &self.entry.date else {
            return record.serialize(serializer);
        };
        let object = base.as_object().expect("indexed normalized object");
        let mut map = serializer.serialize_map(Some(object.len()))?;
        for (key, value) in object {
            if key == "date" {
                map.serialize_entry(key, date)?;
            } else {
                map.serialize_entry(key, record.get(key).unwrap_or(value))?;
            }
        }
        map.end()
    }
}
struct Rows<'a, S> {
    window: &'a SortedCalendarWindow<S>,
    indices: Option<&'a [u32]>,
}
impl<S: CalendarEntrySource> Serialize for Rows<'_, S> {
    fn serialize<T: Serializer>(&self, serializer: T) -> Result<T::Ok, T::Error> {
        let mut sequence = serializer.serialize_seq(Some(
            self.indices.map_or(self.window.entries.len(), |i| i.len()),
        ))?;
        if let Some(indices) = self.indices {
            for &index in indices {
                sequence.serialize_element(&CalendarEntryView {
                    entry: &self.window.entries[index as usize],
                    record: self.window.entries[index as usize].row(&self.window.rows),
                })?;
            }
        } else {
            for entry in &self.window.entries {
                sequence.serialize_element(&CalendarEntryView {
                    entry,
                    record: entry.row(&self.window.rows),
                })?;
            }
        }
        sequence.end()
    }
}
struct Groups<'a, S> {
    window: &'a SortedCalendarWindow<S>,
    groups: &'a [(String, Vec<u32>)],
}
impl<S: CalendarEntrySource> Serialize for Groups<'_, S> {
    fn serialize<T: Serializer>(&self, serializer: T) -> Result<T::Ok, T::Error> {
        let mut sequence = serializer.serialize_seq(Some(self.groups.len()))?;
        for (date, indices) in self.groups {
            sequence.serialize_element(&(
                date,
                Rows {
                    window: self.window,
                    indices: Some(indices),
                },
            ))?;
        }
        sequence.end()
    }
}
impl<S: CalendarEntrySource> Serialize for CalendarWindowView<S> {
    fn serialize<T: Serializer>(&self, serializer: T) -> Result<T::Ok, T::Error> {
        let mut object = serializer.serialize_struct("CalendarWindow", 5)?;
        object.serialize_field("bounds", &self.window.bounds)?;
        object.serialize_field(
            "expanded",
            &Rows {
                window: &self.window,
                indices: None,
            },
        )?;
        object.serialize_field(
            "visibleEntries",
            &Rows {
                window: &self.window,
                indices: Some(&self.visible),
            },
        )?;
        object.serialize_field(
            "entriesByDate",
            &Groups {
                window: &self.window,
                groups: &self.dates,
            },
        )?;
        object.serialize_field(
            "shiftsByMonth",
            &Groups {
                window: &self.window,
                groups: &self.months,
            },
        )?;
        object.end()
    }
}
