use super::{
    SharedCalendarDays, SharedDayWindow,
    source_view::Source,
    visible::{PreparedIncomingCalendars, VisibilityContext},
};
use crate::EngineError;
use serde::{Serialize, Serializer, ser::SerializeMap};
use serde_json::{Map, Value, json};
use std::{collections::HashMap, sync::Arc};

pub(super) struct CacheRecord {
    pub(super) rest: Map<String, Value>,
    pub(super) calendar: Arc<Value>,
    pub(super) entries: Arc<Value>,
}
impl CacheRecord {
    pub(super) fn get(&self, key: &str) -> Option<&Value> {
        match key {
            "calendar" => Some(&self.calendar),
            "entries" => Some(&self.entries),
            _ => self.rest.get(key),
        }
    }
    fn id(&self) -> &str {
        self.calendar["id"].as_str().unwrap()
    }
}
impl Serialize for CacheRecord {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.rest.len() + 2))?;
        for (key, value) in &self.rest {
            map.serialize_entry(key, value)?;
        }
        map.serialize_entry("calendar", self.calendar.as_ref())?;
        map.serialize_entry("entries", self.entries.as_ref())?;
        map.end()
    }
}
fn ordered_equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .zip(b)
                    .all(|((ak, av), (bk, bv))| ak == bk && ordered_equal(av, bv))
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| ordered_equal(a, b))
        }
        _ => a == b,
    }
}
fn equal_fields(a: &CacheRecord, b: &CacheRecord, fetched: bool) -> bool {
    ["accountId", "visible", "localColor"]
        .iter()
        .all(|key| a.get(key) == b.get(key))
        && (!fetched || a.get("fetchedAt") == b.get("fetchedAt"))
}
fn display_equal(a: &CacheRecord, b: &CacheRecord) -> bool {
    Arc::ptr_eq(&a.calendar, &b.calendar)
        && Arc::ptr_eq(&a.entries, &b.entries)
        && equal_fields(a, b, false)
}
fn compatibility_encode<T: Serialize>(value: T) -> Result<Value, EngineError> {
    serde_json::to_value(value).map_err(|_| EngineError::InvalidCalendarEntry)
}
#[derive(Serialize)]
struct Reused {
    wrapper: i64,
    calendar: i64,
    entries: i64,
}

#[derive(Clone, Default)]
pub struct RetainedIncomingCache {
    pub(super) current: Arc<Vec<Arc<CacheRecord>>>,
    display: Option<Arc<Vec<Arc<CacheRecord>>>>,
    pub(super) raw_proofs: Option<super::raw_source::RawProofs>,
}
impl RetainedIncomingCache {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn observe(
        &mut self,
        calendars: Vec<Value>,
        context: &VisibilityContext<'_>,
    ) -> Result<IncomingObservation, EngineError> {
        if calendars.len() > 10000 {
            return Err(EngineError::Overflow);
        }
        let records = calendars
            .into_iter()
            .map(|value| {
                let Value::Object(mut rest) = value else {
                    return Err(EngineError::InvalidCalendarEntry);
                };
                let calendar = Arc::new(
                    rest.remove("calendar")
                        .ok_or(EngineError::InvalidCalendarEntry)?,
                );
                let entries = Arc::new(
                    rest.remove("entries")
                        .ok_or(EngineError::InvalidCalendarEntry)?,
                );
                Ok(CacheRecord {
                    rest,
                    calendar,
                    entries,
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let observation = self.observe_records(records, context)?;
        self.raw_proofs = None;
        Ok(observation)
    }
    pub(super) fn observe_records(
        &mut self,
        calendars: Vec<CacheRecord>,
        context: &VisibilityContext<'_>,
    ) -> Result<IncomingObservation, EngineError> {
        if calendars.len() > 10000 {
            return Err(EngineError::Overflow);
        }
        let previous = Arc::clone(&self.current);
        let by_id: HashMap<_, _> = previous
            .iter()
            .enumerate()
            .map(|(index, value)| (value.id(), index))
            .collect();
        // Local Arc identities are only comparison keys. Their owners remain
        // alive in `previous`; no address is retained or serialized.
        let mut wrapper_indices = HashMap::new();
        let mut calendar_indices = HashMap::new();
        let mut entry_indices = HashMap::new();
        for (index, value) in previous.iter().enumerate() {
            wrapper_indices
                .entry(Arc::as_ptr(value))
                .or_insert(index as i64);
            calendar_indices
                .entry(Arc::as_ptr(&value.calendar))
                .or_insert(index as i64);
            entry_indices
                .entry(Arc::as_ptr(&value.entries))
                .or_insert(index as i64);
        }
        let mut current = Vec::with_capacity(calendars.len());
        let mut reused = Vec::with_capacity(calendars.len());
        for CacheRecord {
            rest,
            calendar,
            entries,
        } in calendars
        {
            let id = calendar
                .get("id")
                .and_then(Value::as_str)
                .ok_or(EngineError::InvalidCalendarEntry)?;
            let old = by_id
                .get(id)
                .map(|index| &previous[*index])
                .filter(|old| old.get("accountId") == rest.get("accountId"));
            let calendar = if let Some(old) = old.filter(|old| {
                Arc::ptr_eq(&old.calendar, &calendar) || ordered_equal(&old.calendar, &calendar)
            }) {
                Arc::clone(&old.calendar)
            } else {
                calendar
            };
            let entries = if let Some(old) = old.filter(|old| {
                Arc::ptr_eq(&old.entries, &entries) || ordered_equal(&old.entries, &entries)
            }) {
                Arc::clone(&old.entries)
            } else {
                entries
            };
            let value = CacheRecord {
                rest,
                calendar,
                entries,
            };
            let value = if let Some(old) =
                old.filter(|old| display_equal(old, &value) && equal_fields(old, &value, true))
            {
                Arc::clone(old)
            } else {
                Arc::new(value)
            };
            reused.push(Reused {
                wrapper: wrapper_indices
                    .get(&Arc::as_ptr(&value))
                    .copied()
                    .unwrap_or(-1),
                calendar: calendar_indices
                    .get(&Arc::as_ptr(&value.calendar))
                    .copied()
                    .unwrap_or(-1),
                entries: entry_indices
                    .get(&Arc::as_ptr(&value.entries))
                    .copied()
                    .unwrap_or(-1),
            });
            current.push(value);
        }
        let current = if previous.len() == current.len()
            && previous
                .iter()
                .zip(&current)
                .all(|(a, b)| Arc::ptr_eq(a, b))
        {
            previous
        } else {
            Arc::new(current)
        };
        let prepared = PreparedIncomingCalendars::prepare_source(
            Source::Records(Arc::clone(&current)),
            context,
        )?;
        let selected = prepared.selected_indices().to_vec();
        let visible: Vec<_> = selected
            .iter()
            .map(|index| Arc::clone(&current[*index]))
            .collect();
        let display_same = self.display.as_ref().is_some_and(|previous| {
            previous.len() == visible.len()
                && previous
                    .iter()
                    .zip(&visible)
                    .all(|(a, b)| display_equal(a, b))
        });
        let display = if display_same {
            Arc::clone(self.display.as_ref().unwrap())
        } else {
            Arc::new(visible)
        };
        let projection = PreparedIncomingCalendars {
            source: Source::Records(Arc::clone(&display)),
            selected: (0..display.len()).collect(),
            observed: context.observed_epoch_milliseconds,
            valid_until: prepared.valid_until_epoch_milliseconds(),
        };
        self.current = Arc::clone(&current);
        self.display = Some(Arc::clone(&display));
        Ok(IncomingObservation {
            current,
            display,
            selected,
            display_same,
            reused,
            projection,
        })
    }
}
pub struct IncomingObservation {
    current: Arc<Vec<Arc<CacheRecord>>>,
    display: Arc<Vec<Arc<CacheRecord>>>,
    selected: Vec<usize>,
    display_same: bool,
    reused: Vec<Reused>,
    projection: PreparedIncomingCalendars,
}
impl IncomingObservation {
    pub fn capture_timeline_at(
        &self,
        epoch: i64,
    ) -> Result<super::timeline_source::IncomingTimelineSource, EngineError> {
        self.projection.capture_timeline_at(epoch)
    }
    pub fn valid_until_epoch_milliseconds(&self) -> Option<i64> {
        self.projection.valid_until_epoch_milliseconds()
    }
    pub fn project(
        &self,
        time_zone: &str,
        epoch: i64,
        window: Option<&SharedDayWindow<'_>>,
    ) -> Result<SharedCalendarDays, EngineError> {
        self.projection.project(time_zone, epoch, window)
    }
    /// Explicit compatibility materialization; never a source-ready UI input.
    pub fn compatibility_value(
        &self,
        time_zone: &str,
        epoch: i64,
        window: Option<&SharedDayWindow<'_>>,
    ) -> Result<Value, EngineError> {
        Ok(json!({
            "caches": compatibility_encode(Source::Records(Arc::clone(&self.current)))?,
            "selected":self.selected.iter().map(|index| self.current.iter().position(|value| Arc::ptr_eq(value, &self.current[*index])).unwrap()).collect::<Vec<_>>(),
            "display":compatibility_encode(Source::Records(Arc::clone(&self.display)))?,
            "displaySame":self.display_same,
            "reused":self.reused,
            "days":compatibility_encode(self.project(time_zone,epoch,window)?)?
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn context(epoch: i64) -> VisibilityContext<'static> {
        VisibilityContext {
            user_id: Some("viewer"),
            status: "signedIn",
            presentation_account_id: None,
            observed_epoch_milliseconds: epoch,
        }
    }
    fn source(fetched: &str) -> Vec<Value> {
        let mut calendar = json!({"accountId":"viewer","calendar":{"id":"calendar","isOwner":false},"visible":true,"fetchedAt":fetched,"entries":null});
        calendar["entries"] = Value::Array(vec![
            json!({"id":"entry","startsAt":"2026-10-24T19:00:00Z","endsAt":"2026-10-25T06:00:00Z","allDay":false,"timeZone":"Europe/Berlin"});
            50000
        ]);
        vec![calendar]
    }
    #[test]
    fn fifty_thousand_rows_share_field_owners_across_refresh_and_borrowed_projection() {
        let epoch = 1_792_929_600_000;
        let mut state = RetainedIncomingCache::new();
        let initial = state
            .observe(source("2026-10-25T11:00:00Z"), &context(epoch))
            .unwrap();
        let entries = Arc::downgrade(&state.current[0].entries);
        let refreshed = state
            .observe(source("2026-10-25T11:00:01Z"), &context(epoch))
            .unwrap();
        assert!(refreshed.display_same);
        assert!(Arc::ptr_eq(
            &initial.current[0].entries,
            &refreshed.current[0].entries
        ));
        assert!(Arc::ptr_eq(
            &initial.current[0].calendar,
            &refreshed.current[0].calendar
        ));
        assert!(!Arc::ptr_eq(&initial.current[0], &refreshed.current[0]));
        assert!(Arc::ptr_eq(&initial.display, &refreshed.display));
        assert_eq!(
            refreshed.current[0].get("fetchedAt"),
            Some(&json!("2026-10-25T11:00:01Z"))
        );
        assert_eq!(
            refreshed.display[0].get("fetchedAt"),
            Some(&json!("2026-10-25T11:00:00Z"))
        );
        let window = SharedDayWindow {
            start_date: "2027-01-01",
            end_date: "2027-02-01",
        };
        let projection = refreshed
            .project("Europe/Berlin", epoch, Some(&window))
            .unwrap();
        assert_eq!(serde_json::to_value(&projection).unwrap(), json!([]));
        drop(initial);
        drop(refreshed);
        drop(state);
        assert!(entries.upgrade().is_some());
        drop(projection);
        assert!(entries.upgrade().is_none());
    }
}
