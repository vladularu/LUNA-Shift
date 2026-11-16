use super::LoadedPoolError;
use crate::calendar::loaded_scope::RawScopeRows;
use std::sync::{
    Arc, Weak,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};
pub(super) const MAX_RAW_SOURCES: usize = 4;
pub(super) const MAX_DRAFTS: usize = 2;
pub(super) const RAW_SOURCE_CEILING: u64 = 16_515_072;
#[derive(Default)]
pub(super) struct Quota {
    sources: Arc<AtomicUsize>,
    drafts: Arc<AtomicUsize>,
}
pub(super) struct Slot(Arc<AtomicUsize>);
impl Drop for Slot {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}
impl Quota {
    fn reserve(counter: &Arc<AtomicUsize>, limit: usize) -> Result<Slot, LoadedPoolError> {
        counter
            .try_update(Ordering::AcqRel, Ordering::Acquire, |value| {
                (value < limit).then_some(value + 1)
            })
            .map_err(|_| LoadedPoolError::Capacity)?;
        Ok(Slot(counter.clone()))
    }
    pub fn source(&self) -> Result<Slot, LoadedPoolError> {
        Self::reserve(&self.sources, MAX_RAW_SOURCES)
    }
    pub fn draft(&self) -> Result<Slot, LoadedPoolError> {
        Self::reserve(&self.drafts, MAX_DRAFTS)
    }
    pub fn sources(&self) -> usize {
        self.sources.load(Ordering::Acquire)
    }
}
pub(super) struct RawPermit(Arc<AtomicBool>);
impl RawPermit {
    pub fn acquire(flag: &Arc<AtomicBool>) -> Result<Self, LoadedPoolError> {
        flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| LoadedPoolError::Busy)?;
        Ok(Self(flag.clone()))
    }
}
impl Drop for RawPermit {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
pub(super) struct SourceCharge {
    pub raw: Weak<RawScopeRows>,
    pub _slot: Slot,
}
