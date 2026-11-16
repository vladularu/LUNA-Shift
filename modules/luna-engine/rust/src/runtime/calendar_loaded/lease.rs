use super::{LoadedPoolError, quota::SourceCharge};
use crate::{
    calendar::{loaded_scope::ScopeEntries, window::CalendarRecordSource},
    runtime::utility_lease::UtilityOwnerMarker,
};
use serde_json::Value;
use std::sync::{
    Arc, Weak,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
#[derive(Clone)]
pub(super) struct ReadWitness {
    pub owner: UtilityOwnerMarker,
    pub pool: Weak<()>,
    pub revision: Arc<AtomicU64>,
    pub observed: u64,
}
impl ReadWitness {
    pub fn owner_current(&self) -> Result<bool, LoadedPoolError> {
        Ok(self.pool.upgrade().is_some()
            && self
                .owner
                .is_current()
                .map_err(|_| LoadedPoolError::Poisoned)?)
    }
    pub fn is_current(&self) -> Result<bool, LoadedPoolError> {
        Ok(self.owner_current()? && self.revision.load(Ordering::Acquire) == self.observed)
    }
}
pub(super) struct RetainedEntries {
    pub entries: ScopeEntries,
    pub _charges: Vec<Arc<SourceCharge>>,
}
#[derive(Clone)]
pub struct LoadedReadSource {
    pub(super) data: Arc<RetainedEntries>,
    pub(super) witness: ReadWitness,
}
impl LoadedReadSource {
    pub fn shares_owner(&self, marker: &UtilityOwnerMarker) -> bool {
        self.witness.owner.shares_owner(marker)
    }
    pub fn is_current(&self) -> Result<bool, LoadedPoolError> {
        self.witness.is_current()
    }
    pub fn entries(&self) -> Result<&ScopeEntries, LoadedPoolError> {
        if !self.is_current()? {
            return Err(LoadedPoolError::Stale);
        }
        Ok(&self.data.entries)
    }
    pub fn pin_submission(
        &self,
        write_id: u64,
    ) -> Result<LoadedSubmissionCapture, LoadedPoolError> {
        if write_id == 0 || write_id > crate::contract::MAX_SAFE_REVISION {
            return Err(LoadedPoolError::ScopeMismatch);
        }
        self.entries()?;
        Ok(LoadedSubmissionCapture {
            data: self.data.clone(),
            witness: self.witness.clone(),
            write_id,
            active: AtomicBool::new(true),
        })
    }
}
impl CalendarRecordSource for LoadedReadSource {
    fn entries_len(&self) -> usize {
        self.data.entries.entries().len()
    }
    fn base_value(&self, index: usize) -> &Value {
        self.data.entries.entries()[index].base_value()
    }
    fn field(&self, index: usize, key: &str) -> Option<&Value> {
        self.data.entries.entries()[index].get(key)
    }
}
/// A write keeps immutable entries instead of a later live-scope generation.
/// The form controller supplies its private write ID and retires this capture.
pub struct LoadedSubmissionCapture {
    data: Arc<RetainedEntries>,
    witness: ReadWitness,
    write_id: u64,
    active: AtomicBool,
}
impl LoadedSubmissionCapture {
    pub fn is_current_for_write(&self, write_id: u64) -> Result<bool, LoadedPoolError> {
        Ok(write_id == self.write_id
            && self.active.load(Ordering::Acquire)
            && self.witness.owner_current()?)
    }
    pub fn entries_for_write(&self, write_id: u64) -> Result<&ScopeEntries, LoadedPoolError> {
        if !self.is_current_for_write(write_id)? {
            return Err(LoadedPoolError::Stale);
        }
        Ok(&self.data.entries)
    }
    pub fn retire(&self) {
        self.active.store(false, Ordering::Release);
    }
}
