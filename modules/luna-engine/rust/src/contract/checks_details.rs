//! Explicit details work on the existing Checks lane. All profile/target values
//! are ordinary raw IO inputs; no wire constructor accepts a calculated profile.
use super::{CalculationRequest, ContractError, SourceGroup, SourceKind};
use crate::calendar::recurrence::CollationRanks;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeSet, sync::Arc};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProfileBasis {
    pub(crate) source_clock_key: String,
    pub(crate) source_epoch_milliseconds: i64,
    pub(crate) sources: Vec<SourceGroup>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ChildReadState {
    Loading,
    Ready,
    Failed,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetRead {
    #[serde(deserialize_with = "required_nullable")]
    pub(crate) saved_row: Option<Value>,
    #[serde(deserialize_with = "required_nullable")]
    pub(crate) time_zone: Option<String>,
    pub(crate) plan_rows: Vec<Value>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoadedTarget {
    pub(crate) revision: u64,
    pub(crate) state: ChildReadState,
    #[serde(deserialize_with = "required_nullable")]
    pub(crate) read: Option<TargetRead>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChildInputs {
    pub(crate) target_revision: u64,
    #[serde(deserialize_with = "required_nullable")]
    pub(crate) loaded_target: Option<LoadedTarget>,
    pub(crate) history_state: ChildReadState,
    pub(crate) history_rows: Vec<Value>,
    #[serde(deserialize_with = "required_nullable")]
    pub(crate) youth_protection: Option<bool>,
    pub(crate) youth_state: ChildReadState,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChecksDetailsIntent {
    pub(crate) basis: ProfileBasis,
    pub(crate) children: ChildInputs,
    pub(crate) observed_epoch_milliseconds: i64,
    pub(crate) youth_protection: bool,
    #[serde(
        serialize_with = "serialize_records",
        deserialize_with = "deserialize_records"
    )]
    pub(crate) entries: Arc<Vec<Value>>,
    #[serde(
        serialize_with = "serialize_ranks",
        deserialize_with = "deserialize_ranks"
    )]
    pub(crate) ranks: Arc<CollationRanks>,
}
fn required_nullable<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(d)
}
fn serialize_records<S: serde::Serializer>(v: &Arc<Vec<Value>>, s: S) -> Result<S::Ok, S::Error> {
    v.as_slice().serialize(s)
}
fn deserialize_records<'de, D: serde::Deserializer<'de>>(
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
impl ChecksDetailsIntent {
    pub(super) fn validate(&self) -> Result<(), ContractError> {
        super::digest(&self.basis.source_clock_key)?;
        for epoch in [
            self.basis.source_epoch_milliseconds,
            self.observed_epoch_milliseconds,
        ] {
            if epoch.unsigned_abs() > 8_640_000_000_000_000 {
                return Err(ContractError::InvalidDate);
            }
            jiff::Timestamp::from_millisecond(epoch).map_err(|_| ContractError::InvalidDate)?;
        }
        super::revision(self.children.target_revision)?;
        if self.entries.len() > 50_000
            || self.children.history_rows.len() > 50_000
            || self.basis.sources.len() != 3
        {
            return Err(ContractError::InvalidRequest);
        }
        let mut seen = BTreeSet::new();
        for source in &self.basis.sources {
            if !matches!(
                source.kind(),
                SourceKind::WorkProfile
                    | SourceKind::RemunerationProfiles
                    | SourceKind::WorkPatternSettings
            ) || !seen.insert(source.kind())
            {
                return Err(ContractError::InvalidRequest);
            }
            source.source.validate()?;
        }
        if let Some(loaded) = &self.children.loaded_target {
            super::revision(loaded.revision)?;
            if !matches!(
                (loaded.state, &loaded.read),
                (ChildReadState::Ready, Some(_)) | (ChildReadState::Failed, None)
            ) {
                return Err(ContractError::InvalidRequest);
            }
            if let Some(read) = &loaded.read
                && read.plan_rows.len() > 50_000
            {
                return Err(ContractError::InvalidRequest);
            }
        }
        Ok(())
    }
}
pub(super) fn optional<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<Arc<ChecksDetailsIntent>>, D::Error> {
    ChecksDetailsIntent::deserialize(d).map(|value| Some(Arc::new(value)))
}
pub(super) fn serialize<S: serde::Serializer>(
    value: &Option<Arc<ChecksDetailsIntent>>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    value.as_deref().serialize(serializer)
}
/// Raw source bodies, history, plan and comparison data never appear in replies.
pub(super) fn serialize_public_request<S: serde::Serializer>(
    request: &CalculationRequest,
    s: S,
) -> Result<S::Ok, S::Error> {
    use serde::ser::SerializeMap;
    let mut map = s.serialize_map(Some(6))?;
    map.serialize_entry("guard", &request.guard)?;
    map.serialize_entry("periods", &request.periods)?;
    map.serialize_entry("sections", &request.sections)?;
    map.serialize_entry("perspective", &request.perspective)?;
    map.serialize_entry("priority", &request.priority)?;
    map.serialize_entry("checksDetails", &true)?;
    map.end()
}
