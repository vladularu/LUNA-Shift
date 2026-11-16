use super::super::RegistryError;
use crate::contract::{ContractError, MAX_SAFE_REVISION};
use std::sync::atomic::{AtomicU64, Ordering};
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BuilderId(u64);
impl BuilderId {
    pub fn value(self) -> u64 {
        self.0
    }
    pub fn from_wire(value: u64) -> Option<Self> {
        (value > 0 && value <= MAX_SAFE_REVISION).then_some(Self(value))
    }
    pub(super) fn next(sequence: &AtomicU64) -> Result<Self, AssemblyError> {
        sequence
            .try_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
                (value < MAX_SAFE_REVISION).then(|| value + 1)
            })
            .map(|previous| Self(previous + 1))
            .map_err(|_| AssemblyError::SequenceExhausted)
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AssemblyPoolStats {
    pub active_builders: u32,
    pub retired_builders: u32,
    pub raw_operation: bool,
}
#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SourceTarget {
    Source,
    Catalog,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AssemblyError {
    Contract(ContractError),
    Registry(RegistryError),
    Busy,
    UnknownBuilder,
    Capacity,
    SequenceExhausted,
    Poisoned,
}
impl From<ContractError> for AssemblyError {
    fn from(error: ContractError) -> Self {
        Self::Contract(error)
    }
}
impl From<RegistryError> for AssemblyError {
    fn from(error: RegistryError) -> Self {
        Self::Registry(error)
    }
}
