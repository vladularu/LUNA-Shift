//! Native template row intents, separated from SQL execution and commit admission.
mod ordering;
mod saving;
#[cfg(test)]
mod tests;
use super::{InputError, calendar_rows, javascript_date, javascript_json};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc};
const MAX_ROWS: usize = 50_000;
const MAX_BYTES: u64 = 16_515_072;
fn invalid() -> InputError {
    InputError::source(
        "Die gespeicherten Vorlagen konnten nicht gelesen werden.",
        "Error",
    )
}
fn conflict() -> InputError {
    InputError::user_facing_source(
        "Der Eintrag wurde zwischenzeitlich geändert. Bitte neu laden.",
        "ConcurrencyError",
    )
}
fn number(value: f64) -> Value {
    if value.is_finite() {
        serde_json::from_str(&javascript_json::number_text(value)).expect("finite native JS number")
    } else {
        Value::Null
    }
}
fn serialized(value: &Value) -> Result<Value, InputError> {
    if value.is_null() {
        Ok(Value::Null)
    } else {
        javascript_json::stringify(value)
            .map(Value::String)
            .map_err(|_| invalid())
    }
}
fn revision(row: &Value) -> Result<u64, InputError> {
    row["revision"]
        .as_u64()
        .or_else(|| {
            row["revision"]
                .as_f64()
                .filter(|n| {
                    n.is_finite() && n.fract() == 0.0 && (1.0..=9_007_199_254_740_990.0).contains(n)
                })
                .map(|n| n as u64)
        })
        .filter(|n| (1..=9_007_199_254_740_990).contains(n))
        .ok_or_else(invalid)
}
fn raw_revision(value: &Value) -> f64 {
    value.as_f64().unwrap_or(-1.0)
}
struct Clock<'a> {
    epochs: &'a [f64],
    observed: Vec<Value>,
}
impl Clock<'_> {
    fn iso(&mut self) -> Result<String, InputError> {
        let epoch = *self
            .epochs
            .get(self.observed.len())
            .or_else(|| self.epochs.last())
            .ok_or_else(invalid)?;
        self.observed.push(number(epoch));
        javascript_date::iso_from_epoch_milliseconds(epoch)
    }
}
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TemplateWriteOperation {
    Save,
    Delete,
    Restore,
    Swap,
    Reorder,
}
pub struct NativeTemplateWritePlan {
    body: Value,
    returned: Result<Value, InputError>,
}
impl NativeTemplateWritePlan {
    fn new(mutations: Vec<Value>, returned: Result<Value, InputError>) -> Self {
        Self {
            body: json!({"schemaVersion":1,"guards":[],"mutations":mutations}),
            returned,
        }
    }
    pub fn value(&self) -> &Value {
        &self.body
    }
    /// Planned decode only. A runtime must require a genuine CommittedNativeWrite
    /// proof before publishing this result; SQL failure has precedence.
    pub fn postwrite_result(&self) -> Result<&Value, &InputError> {
        self.returned.as_ref()
    }
    pub(crate) fn into_parts(self) -> (Value, Result<Value, InputError>) {
        (self.body, self.returned)
    }
}
pub struct NativeTemplateWriteAttempt {
    result: Result<NativeTemplateWritePlan, InputError>,
    observed: Vec<Value>,
}
impl NativeTemplateWriteAttempt {
    pub fn result(&self) -> Result<&NativeTemplateWritePlan, &InputError> {
        self.result.as_ref()
    }
    pub fn into_result(self) -> Result<NativeTemplateWritePlan, InputError> {
        self.result
    }
    pub fn observed_epochs(&self) -> &[Value] {
        &self.observed
    }
}
pub struct NativeTemplateWriteSource {
    rows: Arc<[Value]>,
    index: BTreeMap<String, usize>,
}
impl NativeTemplateWriteSource {
    pub fn from_raw_rows(rows: Arc<[Value]>) -> Result<Self, InputError> {
        if rows.len() > MAX_ROWS {
            return Err(invalid());
        }
        crate::report::cache_budget::serialized_bytes(&rows.as_ref(), MAX_BYTES)
            .ok_or_else(invalid)?;
        let mut index = BTreeMap::new();
        for (i, row) in rows.iter().enumerate() {
            let object = row.as_object().ok_or_else(invalid)?;
            let id = row["id"].as_str().ok_or_else(invalid)?;
            if object.len() != calendar_rows::TEMPLATE_ROW_FIELDS.len()
                || calendar_rows::TEMPLATE_ROW_FIELDS
                    .iter()
                    .any(|key| !object.contains_key(*key))
                || id.encode_utf16().count() > 256
                || index.insert(id.to_owned(), i).is_some()
            {
                return Err(invalid());
            }
            revision(row)?;
            for key in ["name", "created_at", "updated_at"] {
                if !row[key].is_string() {
                    return Err(invalid());
                }
            }
            if !row["deleted_at"].is_null() && !row["deleted_at"].is_string() {
                return Err(invalid());
            }
        }
        Ok(Self { rows, index })
    }
    fn get(&self, id: &str) -> Option<&Value> {
        self.index.get(id).map(|i| &self.rows[*i])
    }
    fn active_row(&self, id: &str, expected: f64) -> Result<&Value, InputError> {
        self.get(id)
            .filter(|r| r["deleted_at"].is_null() && r["revision"].as_f64() == Some(expected))
            .ok_or_else(conflict)
    }
    pub fn prepare(
        &self,
        operation: TemplateWriteOperation,
        payload: &Value,
        epochs: &[f64],
        allocated_id: Option<&str>,
    ) -> NativeTemplateWriteAttempt {
        let mut clock = Clock {
            epochs,
            observed: vec![],
        };
        let result = match operation {
            TemplateWriteOperation::Save => self.save(payload, &mut clock, allocated_id),
            TemplateWriteOperation::Delete => self.delete(payload, &mut clock),
            TemplateWriteOperation::Restore => self.restore(payload, &mut clock),
            TemplateWriteOperation::Swap => self.swap(payload, &mut clock),
            TemplateWriteOperation::Reorder => self.reorder(payload, &mut clock),
        };
        NativeTemplateWriteAttempt {
            result,
            observed: clock.observed,
        }
    }
    fn ordered<'a>(&'a self, overlays: &'a [Value]) -> Result<Vec<&'a Value>, InputError> {
        let replacements = overlays
            .iter()
            .map(|r| (r["id"].as_str().expect("native row id"), r))
            .collect::<BTreeMap<_, _>>();
        let mut rows = self
            .rows
            .iter()
            .map(|r| {
                replacements
                    .get(r["id"].as_str().expect("checked row id"))
                    .copied()
                    .unwrap_or(r)
            })
            .filter(|r| r["deleted_at"].is_null())
            .collect::<Vec<_>>();
        for row in &rows {
            if row["sort_order"].as_f64().is_none() || !row["name"].is_string() {
                return Err(calendar_rows::map_template(row)
                    .err()
                    .unwrap_or_else(invalid));
            }
        }
        rows.sort_by(|a, b| {
            a["sort_order"]
                .as_f64()
                .unwrap()
                .partial_cmp(&b["sort_order"].as_f64().unwrap())
                .expect("finite JSON number")
                .then_with(|| a["name"].as_str().unwrap().cmp(b["name"].as_str().unwrap()))
        });
        Ok(rows)
    }
    pub fn active_templates(&self) -> Result<Vec<Value>, InputError> {
        self.ordered(&[])?
            .into_iter()
            .map(calendar_rows::map_template)
            .collect()
    }
}
