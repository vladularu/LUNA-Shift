//! Immutable, metadata-preserving duty projection shared across daily queries.
use super::duty;
use crate::EngineError;
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::Arc;
enum Inputs<'a> {
    Borrowed(&'a [Value]),
    Shared(Arc<Vec<Value>>),
    Refs(Vec<&'a Value>),
}
impl Inputs<'_> {
    fn len(&self) -> usize {
        match self {
            Self::Borrowed(values) => values.len(),
            Self::Shared(values) => values.len(),
            Self::Refs(values) => values.len(),
        }
    }
    fn get(&self, index: usize) -> &Value {
        match self {
            Self::Borrowed(values) => &values[index],
            Self::Shared(values) => &values[index],
            Self::Refs(values) => values[index],
        }
    }
}
enum Projected {
    Original(usize),
    Duty(Value),
}
fn value<'a>(inputs: &'a Inputs<'_>, entry: &'a Projected) -> &'a Value {
    match entry {
        Projected::Original(index) => inputs.get(*index),
        Projected::Duty(value) => value,
    }
}
/// No Deserialize: indices always belong to this immutable retained input owner.
pub struct PreparedCreditEntries<'a> {
    inputs: Inputs<'a>,
    projected: Vec<Projected>,
    dates: BTreeMap<String, Vec<usize>>,
}
impl<'a> PreparedCreditEntries<'a> {
    pub fn new(entries: &'a [Value]) -> Result<Self, EngineError> {
        Self::build(Inputs::Borrowed(entries))
    }
    pub fn from_refs(entries: Vec<&'a Value>) -> Result<Self, EngineError> {
        Self::build(Inputs::Refs(entries))
    }
    fn build(inputs: Inputs<'a>) -> Result<Self, EngineError> {
        let mut projected = Vec::new();
        for index in 0..inputs.len() {
            if let Some(parts) = duty::project_duty_calendar_day_parts(inputs.get(index))? {
                projected.extend(parts.into_iter().map(Projected::Duty));
            } else {
                projected.push(Projected::Original(index));
            }
        }
        let mut dates: BTreeMap<String, Vec<usize>> = BTreeMap::new();
        for (index, entry) in projected.iter().enumerate() {
            let entry = value(&inputs, entry);
            if entry.get("deletedAt") == Some(&Value::Null)
                && let Some(date) = entry.get("date").and_then(Value::as_str)
            {
                if let Some(indices) = dates.get_mut(date) {
                    indices.push(index);
                } else {
                    dates.insert(date.to_owned(), vec![index]);
                }
            }
        }
        Ok(Self {
            inputs,
            projected,
            dates,
        })
    }
    pub fn entries(&self) -> impl ExactSizeIterator<Item = &Value> {
        self.projected
            .iter()
            .map(|entry| value(&self.inputs, entry))
    }
    pub(crate) fn active(&self, date: &str) -> Vec<&Value> {
        self.dates
            .get(date)
            .into_iter()
            .flat_map(|indices| indices.iter())
            .map(|index| value(&self.inputs, &self.projected[*index]))
            .collect()
    }
    pub fn borrowed_entry_count(&self) -> usize {
        self.projected
            .iter()
            .filter(|entry| matches!(entry, Projected::Original(_)))
            .count()
    }
    pub fn owned_duty_part_count(&self) -> usize {
        self.projected
            .iter()
            .filter(|entry| matches!(entry, Projected::Duty(_)))
            .count()
    }
    pub fn shared_owner(&self) -> Option<&Arc<Vec<Value>>> {
        if let Inputs::Shared(owner) = &self.inputs {
            Some(owner)
        } else {
            None
        }
    }
}
impl PreparedCreditEntries<'static> {
    pub fn from_shared(entries: Arc<Vec<Value>>) -> Result<Self, EngineError> {
        Self::build(Inputs::Shared(entries))
    }
}
