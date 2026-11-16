use crate::{EngineError, input::InputError};
use serde::{Serialize, Serializer, ser::SerializeMap};
use serde_json::Value;
use std::sync::Arc;

#[derive(Debug)]
pub enum ScopeError {
    Input(InputError),
    Engine(EngineError),
    InvalidIntent,
    Capacity,
    UnknownLoad,
    StaleDraft,
}
impl From<InputError> for ScopeError {
    fn from(error: InputError) -> Self {
        Self::Input(error)
    }
}
impl From<EngineError> for ScopeError {
    fn from(error: EngineError) -> Self {
        Self::Engine(error)
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarLoadRange {
    pub start_date: String,
    pub end_date: String,
}
impl CalendarLoadRange {
    pub fn for_month(month: &str) -> Result<Self, ScopeError> {
        let date = super::super::parse_date(&format!("{month}-01"))?;
        if month.len() != 7 {
            return Err(ScopeError::InvalidIntent);
        }
        let year = i32::from(date.year());
        Ok(Self {
            start_date: format!("{}-01-01", year - 1),
            end_date: format!("{}-12-31", year + 1),
        })
    }
    pub(super) fn contains(&self, date: &str) -> bool {
        date >= self.start_date.as_str() && date <= self.end_date.as_str()
    }
    pub(super) fn covers(&self, other: &Self) -> bool {
        self.start_date <= other.start_date && self.end_date >= other.end_date
    }
    pub(super) fn covers_year(&self, year: i32) -> bool {
        self.start_date <= format!("{year}-01-01") && self.end_date >= format!("{year}-12-31")
    }
    pub(super) fn key(&self) -> String {
        format!("{}:{}", self.start_date, self.end_date)
    }
}

/// Native normalized entry. No Deserialize. The raw source owner is shared,
/// while snapshots/changes retain entry identity with Arc rather than cloning JSON.
#[derive(Debug)]
pub struct ScopeEntry {
    pub(super) value: Arc<Value>,
    pub(super) display: Option<Arc<super::TemplateDisplay>>,
    pub(super) _raw: Option<Arc<super::rows::RawScopeRows>>,
}
impl ScopeEntry {
    pub fn value(&self) -> &Value {
        self.base_value()
    }
    pub fn base_value(&self) -> &Value {
        &self.value
    }
    pub fn get(&self, field: &str) -> Option<&Value> {
        if let Some(display) = &self.display {
            match field {
                "title" => return Some(&display.title),
                "color" => return Some(&display.color),
                "symbol" => return Some(&display.symbol),
                _ => {}
            }
        }
        self.value.get(field)
    }
    pub fn collation_candidates(&self) -> std::collections::BTreeSet<String> {
        ["date", "startTime", "createdAt", "title", "id"]
            .map(|field| {
                self.get(field)
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned()
            })
            .into_iter()
            .collect()
    }
    pub(super) fn key(&self) -> (&str, &str) {
        (
            self.value["kind"].as_str().unwrap_or_default(),
            self.value["id"].as_str().unwrap_or_default(),
        )
    }
}
#[derive(Debug, Clone, Default)]
pub struct ScopeEntries(pub(super) Arc<[Arc<ScopeEntry>]>);
impl ScopeEntries {
    pub fn entries(&self) -> &[Arc<ScopeEntry>] {
        &self.0
    }
    pub fn collation_candidates(&self) -> std::collections::BTreeSet<String> {
        entry_candidates(self.entries())
    }
    pub(super) fn sorted(
        entries: Vec<Arc<ScopeEntry>>,
        ranks: &crate::calendar::recurrence::CollationRanks,
    ) -> Result<Self, ScopeError> {
        let mut keyed = entries
            .into_iter()
            .map(|entry| {
                let date = entry.value["date"]
                    .as_str()
                    .ok_or(ScopeError::InvalidIntent)?;
                Ok((
                    crate::calendar::recurrence::sort_key_for_fields(
                        |field| entry.get(field),
                        date,
                        ranks,
                    )?,
                    entry,
                ))
            })
            .collect::<Result<Vec<_>, ScopeError>>()?;
        keyed.sort_by_key(|(key, _)| *key);
        Ok(Self(Arc::from(
            keyed
                .into_iter()
                .map(|(_, entry)| entry)
                .collect::<Vec<_>>(),
        )))
    }
}
pub(super) fn entry_candidates(entries: &[Arc<ScopeEntry>]) -> std::collections::BTreeSet<String> {
    entries
        .iter()
        .flat_map(|entry| {
            ["date", "startTime", "createdAt", "title", "id"].map(|field| {
                entry
                    .get(field)
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned()
            })
        })
        .collect()
}
impl Serialize for ScopeEntry {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let Some(base) = self.value.as_object() else {
            return self.value.serialize(serializer);
        };
        let mut map = serializer.serialize_map(Some(base.len()))?;
        for (key, value) in base {
            map.serialize_entry(key, self.get(key).unwrap_or(value))?;
        }
        map.end()
    }
}
