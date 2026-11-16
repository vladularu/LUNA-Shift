use super::IncomingPoolError;
use std::sync::{
    Arc,
    atomic::{AtomicU64, AtomicUsize, Ordering},
};
pub(super) const MAX_SOURCE_BYTES: u64 = crate::contract::MAX_INPUT_BYTES as u64;
const MAX_RETAINED_BYTES: u64 = MAX_SOURCE_BYTES * 2;
const MAX_GENERATIONS: usize = 2;
#[derive(Default)]
pub(super) struct Quota {
    pub bytes: AtomicU64,
    pub generations: AtomicUsize,
}
impl Quota {
    pub fn reserve(self: &Arc<Self>) -> Result<Charge, IncomingPoolError> {
        self.generations
            .try_update(Ordering::AcqRel, Ordering::Acquire, |n| {
                n.checked_add(1).filter(|n| *n <= MAX_GENERATIONS)
            })
            .map_err(|_| IncomingPoolError::Capacity)?;
        if self
            .bytes
            .try_update(Ordering::AcqRel, Ordering::Acquire, |n| {
                n.checked_add(MAX_SOURCE_BYTES)
                    .filter(|n| *n <= MAX_RETAINED_BYTES)
            })
            .is_err()
        {
            self.generations.fetch_sub(1, Ordering::AcqRel);
            return Err(IncomingPoolError::Capacity);
        }
        Ok(Charge {
            quota: self.clone(),
            bytes: MAX_SOURCE_BYTES,
        })
    }
}
pub(super) struct Charge {
    quota: Arc<Quota>,
    bytes: u64,
}
impl Charge {
    pub fn checked_cost(&mut self, bytes: u64) -> Result<(), IncomingPoolError> {
        if bytes > self.bytes {
            return Err(IncomingPoolError::Capacity);
        }
        self.quota
            .bytes
            .fetch_sub(self.bytes - bytes, Ordering::AcqRel);
        self.bytes = bytes;
        Ok(())
    }
}
impl Drop for Charge {
    fn drop(&mut self) {
        self.quota.bytes.fetch_sub(self.bytes, Ordering::AcqRel);
        self.quota.generations.fetch_sub(1, Ordering::AcqRel);
    }
}
