//! One explicit artifact request on the existing Finance queue. Ordinary
//! recorded input is not a ready profile, report, result, or admission proof.
use super::{CalculationRequest, ContractError};
use crate::calendar::recurrence::CollationRanks;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExportFormat {
    Csv,
    Pdf,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportLayout {
    Standard,
    Compact,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExportProfileRole {
    Calculation,
    Provided,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RecordedKind {
    #[serde(rename = "RECORDED_ENTRIES")]
    Recorded,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecordedInput {
    kind: RecordedKind,
    #[serde(
        serialize_with = "serialize_entries",
        deserialize_with = "deserialize_entries"
    )]
    entries: Arc<Vec<Value>>,
}
fn serialize_entries<S: serde::Serializer>(v: &Arc<Vec<Value>>, s: S) -> Result<S::Ok, S::Error> {
    v.as_slice().serialize(s)
}
fn deserialize_entries<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Arc<Vec<Value>>, D::Error> {
    Vec::<Value>::deserialize(d).map(Arc::new)
}
fn serialize_ranks<S: serde::Serializer>(v: &Arc<CollationRanks>, s: S) -> Result<S::Ok, S::Error> {
    v.as_ref().serialize(s)
}
fn deserialize_ranks<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Arc<CollationRanks>, D::Error> {
    CollationRanks::deserialize(d).map(Arc::new)
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportIntent {
    pub format: ExportFormat,
    pub layout: ExportLayout,
    pub include_salary: bool,
    pub profile_role: ExportProfileRole,
    pub observed_epoch_milliseconds: i64,
    records: RecordedInput,
    #[serde(
        serialize_with = "serialize_ranks",
        deserialize_with = "deserialize_ranks"
    )]
    ranks: Arc<CollationRanks>,
    #[serde(
        serialize_with = "serialize_entries",
        deserialize_with = "deserialize_entries"
    )]
    net_settings_rows: Arc<Vec<Value>>,
    #[serde(deserialize_with = "required_nullable")]
    salary_preference_row: Option<Value>,
}
fn required_nullable<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Value>, D::Error> {
    Option::<Value>::deserialize(d)
}
impl ExportIntent {
    pub fn entries(&self) -> &Arc<Vec<Value>> {
        &self.records.entries
    }
    pub fn ranks(&self) -> &Arc<CollationRanks> {
        &self.ranks
    }
    pub fn net_settings_rows(&self) -> &Arc<Vec<Value>> {
        &self.net_settings_rows
    }
    pub fn salary_preference_row(&self) -> Option<&Value> {
        self.salary_preference_row.as_ref()
    }
    pub(super) fn validate(&self) -> Result<(), ContractError> {
        if self.records.entries.len() > 50_000
            || self.observed_epoch_milliseconds.unsigned_abs() > 8_640_000_000_000_000
        {
            return Err(ContractError::InvalidRequest);
        }
        Ok(())
    }
}
pub(super) fn optional<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<ExportIntent>, D::Error> {
    ExportIntent::deserialize(d).map(Some)
}
/// Only small request metadata is public. The raw records and comparison map
/// remain owned by the pending native calculation and disappear after it.
pub(super) fn serialize_public_request<S: serde::Serializer>(
    request: &CalculationRequest,
    s: S,
) -> Result<S::Ok, S::Error> {
    use serde::ser::SerializeMap;
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Options {
        format: ExportFormat,
        layout: ExportLayout,
        include_salary: bool,
        profile_role: ExportProfileRole,
        observed_epoch_milliseconds: i64,
    }
    let intent = request
        .export_report
        .as_ref()
        .ok_or_else(|| serde::ser::Error::custom("Missing export intent"))?;
    let mut map = s.serialize_map(Some(6))?;
    map.serialize_entry("guard", &request.guard)?;
    map.serialize_entry("periods", &request.periods)?;
    map.serialize_entry("sections", &request.sections)?;
    map.serialize_entry("perspective", &request.perspective)?;
    map.serialize_entry("priority", &request.priority)?;
    map.serialize_entry(
        "exportReport",
        &Options {
            format: intent.format,
            layout: intent.layout,
            include_salary: intent.include_salary,
            profile_role: intent.profile_role,
            observed_epoch_milliseconds: intent.observed_epoch_milliseconds,
        },
    )?;
    map.end()
}
