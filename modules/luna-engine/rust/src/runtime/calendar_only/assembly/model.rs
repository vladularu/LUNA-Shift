use crate::{
    contract::{ContractError, MAX_SAFE_REVISION},
    runtime::RegistryError,
};
use std::sync::atomic::{AtomicU64, Ordering};
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CalendarBuilderId(u64);
impl CalendarBuilderId {
    pub(super) fn next(sequence: &AtomicU64) -> Result<Self, CalendarAssemblyError> {
        sequence
            .try_update(Ordering::Relaxed, Ordering::Relaxed, |v| {
                (v < MAX_SAFE_REVISION).then(|| v + 1)
            })
            .map(|v| Self(v + 1))
            .map_err(|_| CalendarAssemblyError::SequenceExhausted)
    }
    pub fn value(self) -> u64 {
        self.0
    }
    pub fn from_wire(value: u64) -> Option<Self> {
        (value > 0 && value <= MAX_SAFE_REVISION).then_some(Self(value))
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CalendarAssemblyError {
    Contract(ContractError),
    Registry(RegistryError),
    Busy,
    UnknownBuilder,
    Capacity,
    SequenceExhausted,
    Poisoned,
    OutputLimit,
}
impl From<ContractError> for CalendarAssemblyError {
    fn from(e: ContractError) -> Self {
        Self::Contract(e)
    }
}
impl From<RegistryError> for CalendarAssemblyError {
    fn from(e: RegistryError) -> Self {
        Self::Registry(e)
    }
}
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarAssemblyStats {
    pub active_rows: u32,
    pub active_clock: u32,
    pub retired_builders: u32,
    pub raw_operation: bool,
    pub retained_input_bytes: u64,
}
