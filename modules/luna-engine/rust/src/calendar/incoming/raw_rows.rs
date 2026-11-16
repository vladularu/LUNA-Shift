use crate::{
    contract::{self, ContractError},
    input::raw_json,
};
use serde_json::{Map, Number, Value};
use sha2::{Digest, Sha256};
use std::{borrow::Cow, sync::Arc};

const COLUMNS: &[&str] = &[
    "account_id",
    "calendar_id",
    "metadata_json",
    "entries_json",
    "fetched_at",
    "visible",
    "local_color",
];
const JSON_COLUMNS: &[&str] = &["metadata_json", "entries_json"];

/// Raw SQLite cache-list projection, not a validated visibility/clock proof.
pub struct RawIncomingCacheRows {
    calendars: Arc<Vec<Value>>,
}
impl RawIncomingCacheRows {
    pub fn parse(account_id: &str, bytes: &[u8]) -> Result<Self, ContractError> {
        let (rows, mut budget) = decode_rows(bytes)?;
        let mut calendars = Vec::with_capacity(rows.len());
        for row in rows {
            let mut mapped = mapped_rest(account_id, &row)?;
            let calendar = budget.column(&row, "metadata_json")?;
            let entries = budget.column(&row, "entries_json")?;
            budget.charge_nodes(8)?;
            mapped.insert("calendar".into(), calendar);
            mapped.insert("entries".into(), entries);
            calendars.push(Value::Object(mapped));
            // Drop each original SQL row/string after decoding it. The final
            // mapped source is the only retained entry tree.
        }
        Ok(Self {
            calendars: Arc::new(calendars),
        })
    }
    pub fn calendars(&self) -> &Arc<Vec<Value>> {
        &self.calendars
    }
}

pub(super) fn decode_rows(bytes: &[u8]) -> Result<(Vec<Value>, Budget), ContractError> {
    let (rows, nodes) = contract::bounded_json_with_node_budget(bytes, contract::MAX_JSON_NODES)?;
    let Value::Array(rows) = rows else {
        return Err(ContractError::MalformedEnvelope);
    };
    if rows.len() > 10000 {
        return Err(ContractError::CollectionTooLarge);
    }
    Ok((
        rows,
        Budget {
            bytes: bytes.len(),
            nodes,
        },
    ))
}
pub(super) fn mapped_rest(
    account_id: &str,
    row: &Value,
) -> Result<Map<String, Value>, ContractError> {
    if !raw_json::exact_sql_columns(row, COLUMNS, JSON_COLUMNS)
        || row["account_id"].as_str() != Some(account_id)
        || !row["calendar_id"].is_string()
        || !row["fetched_at"].is_string()
        || !matches!(row["visible"].as_f64(), Some(0.0 | 1.0))
        || !(row["local_color"].is_null() || row["local_color"].is_string())
    {
        return Err(ContractError::MalformedEnvelope);
    }
    let mut mapped = Map::new();
    mapped.insert("accountId".into(), Value::String(account_id.into()));
    mapped.insert("fetchedAt".into(), row["fetched_at"].clone());
    mapped.insert(
        "visible".into(),
        Value::Bool(row["visible"].as_f64() == Some(1.0)),
    );
    if row["local_color"]
        .as_str()
        .is_some_and(|text| !text.is_empty())
    {
        mapped.insert("localColor".into(), row["local_color"].clone());
    }
    Ok(mapped)
}
pub(super) struct Budget {
    bytes: usize,
    nodes: u32,
}
impl Budget {
    pub(super) fn charged_wire_bytes(&self) -> usize {
        self.bytes
    }
    fn column(&mut self, row: &Value, name: &str) -> Result<Value, ContractError> {
        let text = self.text(row, name)?;
        self.decode(&text).map(|(value, _)| value)
    }
    pub(super) fn text<'a>(
        &mut self,
        row: &'a Value,
        name: &str,
    ) -> Result<ColumnText<'a>, ContractError> {
        let text = if let Some(chunks) = row.get(format!("{name}_chunks")) {
            let chunks = chunks
                .as_array()
                .filter(|values| !values.is_empty() && values.len() <= 512)
                .ok_or(ContractError::MalformedEnvelope)?;
            let mut size = 0usize;
            for chunk in chunks {
                let text = chunk
                    .as_str()
                    .filter(|text| text.len() <= 65536)
                    .ok_or(ContractError::StringTooLarge)?;
                size = size
                    .checked_add(text.len())
                    .ok_or(ContractError::InputTooLarge)?;
                if size > contract::MAX_INPUT_BYTES as usize {
                    return Err(ContractError::InputTooLarge);
                }
            }
            if self
                .bytes
                .checked_add(size)
                .is_none_or(|size| size > contract::MAX_INPUT_BYTES as usize)
            {
                return Err(ContractError::InputTooLarge);
            }
            ColumnText {
                parts: chunks.iter().map(|chunk| chunk.as_str().unwrap()).collect(),
                size,
                chunked: true,
            }
        } else {
            let text = row
                .get(name)
                .and_then(Value::as_str)
                .ok_or(ContractError::MalformedEnvelope)?;
            ColumnText {
                parts: vec![text],
                size: text.len(),
                chunked: false,
            }
        };
        self.bytes = self
            .bytes
            .checked_add(text.size)
            .filter(|size| *size <= contract::MAX_INPUT_BYTES as usize)
            .ok_or(ContractError::InputTooLarge)?;
        Ok(text)
    }
    pub(super) fn charge_nodes(&mut self, used: u32) -> Result<(), ContractError> {
        self.nodes = self
            .nodes
            .checked_add(used)
            .filter(|nodes| *nodes <= contract::MAX_JSON_NODES)
            .ok_or(ContractError::TooManyJsonNodes)?;
        Ok(())
    }
    pub(super) fn decode(
        &mut self,
        column: &ColumnText<'_>,
    ) -> Result<(Value, u32), ContractError> {
        let text = column.join();
        let (mut value, used) = contract::bounded_json_with_node_budget(
            text.as_bytes(),
            contract::MAX_JSON_NODES - self.nodes,
        )?;
        self.charge_nodes(used)?;
        source_numbers_and_depth(&mut value, 2)?;
        Ok((value, used))
    }
}
pub(super) struct ColumnText<'a> {
    parts: Vec<&'a str>,
    size: usize,
    pub(super) chunked: bool,
}
impl ColumnText<'_> {
    fn join(&self) -> Cow<'_, str> {
        if !self.chunked {
            return Cow::Borrowed(self.parts[0]);
        }
        let mut text = String::with_capacity(self.size);
        for part in &self.parts {
            text.push_str(part);
        }
        Cow::Owned(text)
    }
    pub(super) fn digest(&self, field: &str) -> [u8; 32] {
        let mut hash = Sha256::new();
        hash.update(b"luna/incoming/raw-field/v1\0");
        hash.update((field.len() as u64).to_be_bytes());
        hash.update(field.as_bytes());
        hash.update((self.size as u64).to_be_bytes());
        for part in &self.parts {
            hash.update(part.as_bytes());
        }
        hash.finalize().into()
    }
}

fn source_numbers_and_depth(value: &mut Value, depth: u32) -> Result<(), ContractError> {
    if depth > contract::MAX_JSON_DEPTH {
        return Err(ContractError::JsonTooDeep);
    }
    match value {
        Value::Number(number) => {
            // The original list mapper calls JSON.parse. Round JSON integer
            // lexemes to its binary64 value before any retained native use.
            let number = number.as_f64().ok_or(ContractError::InvalidJson)?;
            *value = Value::Number(
                if number.fract() == 0.0 && (i64::MIN as f64..-(i64::MIN as f64)).contains(&number)
                {
                    Number::from(number as i64)
                } else {
                    Number::from_f64(number).ok_or(ContractError::InvalidJson)?
                },
            );
        }
        Value::Array(values) => {
            for value in values {
                source_numbers_and_depth(value, depth + 1)?;
            }
        }
        Value::Object(values) => {
            for value in values.values_mut() {
                source_numbers_and_depth(value, depth + 1)?;
            }
        }
        _ => {}
    }
    Ok(())
}
