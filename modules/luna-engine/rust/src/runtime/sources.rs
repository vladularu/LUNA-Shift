//! Borrowed I/O-state views over a transport-checked snapshot. These are raw
//! inputs; only the owning domain factory may turn them into calculation facts.
use crate::contract::{
    Coverage, DataPresence, DateRange, ImmutableSnapshot, SourceFailure, SourceKind, SourceState,
};
use serde_json::Value;
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceReadError {
    NotRequested,
    Loading,
    Failed(SourceFailure),
    MissingRecord,
    NullRecord,
    InsufficientCoverage,
    InvalidCoverage,
}
#[derive(Clone, Copy)]
pub enum RequiredCoverage<'a> {
    Any,
    AllHistory,
    Range(&'a DateRange),
}
pub struct RawReadySource<'a> {
    pub revision: u64,
    pub coverage: &'a Coverage,
    pub data: &'a DataPresence<Value>,
}
impl<'a> RawReadySource<'a> {
    pub fn value(&self) -> Result<&'a Value, SourceReadError> {
        match self.data {
            DataPresence::Value { value } => Ok(value),
            DataPresence::Missing => Err(SourceReadError::MissingRecord),
            DataPresence::Null => Err(SourceReadError::NullRecord),
        }
    }
    pub fn nullable(&self) -> Result<Option<&'a Value>, SourceReadError> {
        match self.data {
            DataPresence::Value { value } => Ok(Some(value)),
            DataPresence::Missing => Err(SourceReadError::MissingRecord),
            DataPresence::Null => Ok(None),
        }
    }
}
pub struct SnapshotSources<'a>(&'a ImmutableSnapshot);
/// The same read/coverage policy is shared by sealed Facts and the native
/// pre-seal clock query; no synthetic snapshot or source clone is required.
pub(crate) fn ready_state<'a>(
    state: &'a SourceState,
    required: RequiredCoverage<'_>,
) -> Result<RawReadySource<'a>, SourceReadError> {
    match state {
        SourceState::NotRequested => Err(SourceReadError::NotRequested),
        SourceState::Loading => Err(SourceReadError::Loading),
        SourceState::Failed { code } => Err(SourceReadError::Failed(*code)),
        SourceState::Ready {
            revision,
            coverage,
            payload,
        } => {
            let covered = match required {
                RequiredCoverage::Any => true,
                RequiredCoverage::AllHistory => matches!(coverage, Coverage::AllHistory),
                RequiredCoverage::Range(range) => coverage
                    .covers(range)
                    .map_err(|_| SourceReadError::InvalidCoverage)?,
            };
            if !covered {
                return Err(SourceReadError::InsufficientCoverage);
            }
            Ok(RawReadySource {
                revision: *revision,
                coverage,
                data: payload.data(),
            })
        }
    }
}
impl<'a> SnapshotSources<'a> {
    pub fn new(snapshot: &'a ImmutableSnapshot) -> Self {
        Self(snapshot)
    }
    pub fn ready(
        &self,
        kind: SourceKind,
        required: RequiredCoverage<'_>,
    ) -> Result<RawReadySource<'a>, SourceReadError> {
        let group = self
            .0
            .sources()
            .iter()
            .find(|group| group.kind() == kind)
            .ok_or(SourceReadError::NotRequested)?;
        ready_state(group.state(), required)
    }
}
