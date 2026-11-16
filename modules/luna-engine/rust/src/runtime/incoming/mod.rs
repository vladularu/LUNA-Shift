//! Private incoming-cache source ownership; independent of report and local-row writers.
mod binding;
mod model;
mod quota;
use super::{SnapshotRegistry, utility_lease::UtilityOwnerMarker};
use crate::{
    EngineError,
    calendar::incoming::{raw_source::IncomingSourceError, visible::VisibilityContext},
};
pub use binding::{IncomingClockError, IncomingProjection, IncomingViewerRole};
use model::SourceOwner;
pub use model::{IncomingSourceConsumption, IncomingSourceLease};
use quota::Quota;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};

#[derive(Debug)]
pub enum IncomingPoolError {
    InvalidInput,
    OwnerChanged,
    Poisoned,
    Busy,
    Capacity,
    Stale,
    Source(IncomingSourceError),
    Projection(EngineError),
}
#[derive(Default)]
struct Book {
    current: Option<Arc<SourceOwner>>,
    pending: Option<Arc<AtomicBool>>,
    retired: Vec<Arc<SourceOwner>>,
}
struct Operation<'a>(&'a AtomicBool);
impl Drop for Operation<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
#[derive(Clone)]
pub struct IncomingSourcePool {
    registry: SnapshotRegistry,
    book: Arc<Mutex<Book>>,
    raw: Arc<AtomicBool>,
    quota: Arc<Quota>,
}
impl IncomingSourcePool {
    pub fn new(registry: SnapshotRegistry) -> Self {
        Self {
            registry,
            book: Arc::new(Mutex::new(Book::default())),
            raw: Arc::new(AtomicBool::new(false)),
            quota: Arc::new(Quota::default()),
        }
    }
    pub fn supply(
        &self,
        source_token: &str,
        account_id: &str,
        raw: &[u8],
        context: &VisibilityContext<'_>,
    ) -> Result<IncomingSourceLease, IncomingPoolError> {
        self.supply_observed(source_token, account_id, raw, context, || {})
    }
    fn supply_observed(
        &self,
        source_token: &str,
        account_id: &str,
        raw: &[u8],
        context: &VisibilityContext<'_>,
        before_install: impl FnOnce(),
    ) -> Result<IncomingSourceLease, IncomingPoolError> {
        let owner = self
            .registry
            .utility_owner_marker()
            .map_err(|_| IncomingPoolError::OwnerChanged)?;
        if source_token.is_empty()
            || source_token.len() > 512
            || account_id.len() > 512
            || raw.len() > crate::contract::MAX_INPUT_BYTES as usize
        {
            return Err(IncomingPoolError::InvalidInput);
        }
        self.raw
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| IncomingPoolError::Busy)?;
        let _operation = Operation(&self.raw);
        self.collect_retired()?;
        let mut charge = self.quota.reserve()?;
        let active = Arc::new(AtomicBool::new(true));
        let previous = {
            let mut book = self.book.lock().map_err(|_| IncomingPoolError::Poisoned)?;
            if !owner
                .is_current()
                .map_err(|_| IncomingPoolError::OwnerChanged)?
            {
                return Err(IncomingPoolError::OwnerChanged);
            }
            if let Some(old) = book.pending.replace(active.clone()) {
                old.store(false, Ordering::Release);
            }
            let previous = book.current.take();
            if let Some(previous) = &previous {
                previous.active.store(false, Ordering::Release);
            }
            previous
        };
        // Fork only Arc owners and bounded per-row provenance, outside the pool
        // mutex. A failed source never mutates the last checked retention state.
        let mut cache = previous
            .as_ref()
            .filter(|source| source.owner.shares_owner(&owner))
            .map(|source| source.cache.clone())
            .unwrap_or_default();
        let prepared = cache.observe_sql(account_id, raw, context);
        before_install();
        match prepared {
            Ok((observation, stats)) => {
                charge.checked_cost(stats.charged_wire_bytes() as u64)?;
                let source = Arc::new(SourceOwner {
                    owner: owner.clone(),
                    active: active.clone(),
                    token: source_token.into(),
                    cache,
                    observation,
                    stats,
                    _charge: charge,
                });
                let installed = {
                    let mut book = self.book.lock().map_err(|_| IncomingPoolError::Poisoned)?;
                    let current = self.current_pending(&book, &active, &owner)?;
                    if current {
                        book.pending = None;
                        book.current = Some(source.clone());
                    }
                    current
                };
                if !installed {
                    active.store(false, Ordering::Release);
                    return Err(IncomingPoolError::Stale);
                }
                drop(previous);
                Ok(IncomingSourceLease(source))
            }
            Err(error) => {
                let mut previous = previous;
                {
                    let mut book = self.book.lock().map_err(|_| IncomingPoolError::Poisoned)?;
                    if self.current_pending(&book, &active, &owner)? {
                        book.pending = None;
                        book.current = previous.take();
                    }
                }
                active.store(false, Ordering::Release);
                Err(IncomingPoolError::Source(error))
            }
        }
    }
    fn current_pending(
        &self,
        book: &Book,
        active: &Arc<AtomicBool>,
        owner: &UtilityOwnerMarker,
    ) -> Result<bool, IncomingPoolError> {
        Ok(active.load(Ordering::Acquire)
            && book
                .pending
                .as_ref()
                .is_some_and(|pending| Arc::ptr_eq(pending, active))
            && owner
                .is_current()
                .map_err(|_| IncomingPoolError::OwnerChanged)?)
    }
    pub fn lease_current(&self) -> Result<IncomingSourceLease, IncomingPoolError> {
        let source = self
            .book
            .lock()
            .map_err(|_| IncomingPoolError::Poisoned)?
            .current
            .clone()
            .ok_or(IncomingPoolError::Stale)?;
        let source = IncomingSourceLease(source);
        if !source.is_current()? {
            return Err(IncomingPoolError::Stale);
        }
        Ok(source)
    }
    /// Same-owner raw source notice: fence readers immediately, while retaining
    /// only the private checked cache for the next worker-side refresh.
    pub fn source_changed(&self) -> Result<bool, IncomingPoolError> {
        let mut book = self.book.lock().map_err(|_| IncomingPoolError::Poisoned)?;
        let pending = book.pending.take();
        if let Some(pending) = &pending {
            pending.store(false, Ordering::Release);
        }
        let source = book.current.as_ref();
        if let Some(source) = source {
            source.active.store(false, Ordering::Release);
        }
        Ok(pending.is_some() || source.is_some())
    }
    /// Control path: flags and bounded owner moves only. Never drop the last
    /// heavy source owner while holding this lock or on the control queue.
    pub fn invalidate(&self) -> Result<bool, IncomingPoolError> {
        let mut book = self.book.lock().map_err(|_| IncomingPoolError::Poisoned)?;
        let pending = book.pending.take();
        if let Some(pending) = &pending {
            pending.store(false, Ordering::Release);
        }
        let source = book.current.take();
        let changed = pending.is_some() || source.is_some();
        if let Some(source) = source {
            source.active.store(false, Ordering::Release);
            book.retired.push(source);
        }
        Ok(changed)
    }
    /// Worker only. Large source destruction happens after releasing the mutex.
    pub fn collect_retired(&self) -> Result<bool, IncomingPoolError> {
        let retired = std::mem::take(
            &mut self
                .book
                .lock()
                .map_err(|_| IncomingPoolError::Poisoned)?
                .retired,
        );
        let changed = !retired.is_empty();
        drop(retired);
        Ok(changed)
    }
    pub fn retained_generations(&self) -> usize {
        self.quota.generations.load(Ordering::Acquire)
    }
    pub fn retained_wire_bytes(&self) -> u64 {
        self.quota.bytes.load(Ordering::Acquire)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::OwnerIdentity;
    fn context() -> VisibilityContext<'static> {
        VisibilityContext {
            user_id: Some("viewer"),
            status: "signedIn",
            presentation_account_id: None,
            observed_epoch_milliseconds: 1_792_929_600_000,
        }
    }
    fn rows() -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!([{"account_id":"viewer","calendar_id":"calendar","metadata_json":"{\"id\":\"calendar\",\"isOwner\":false}","entries_json":"[]","fetched_at":"2026-10-25T12:00:00Z","visible":1,"local_color":null}])).unwrap()
    }
    #[test]
    fn reset_or_newer_source_notice_during_preparation_cannot_install_a_stale_source() {
        for reset in [true, false] {
            let registry = SnapshotRegistry::default();
            let owner = OwnerIdentity::new("incoming-owner", 1).unwrap();
            registry.reset_for_owner(&owner).unwrap();
            let pool = IncomingSourcePool::new(registry.clone());
            let first = pool
                .supply("sharing-1", "viewer", &rows(), &context())
                .unwrap();
            let result = pool.supply_observed("sharing-2", "viewer", &rows(), &context(), || {
                // A second heavy raw operation cannot enter while parsing or
                // installing this source; control cancellation remains usable.
                assert!(matches!(
                    pool.supply("parallel", "viewer", &rows(), &context()),
                    Err(IncomingPoolError::Busy)
                ));
                if reset {
                    registry.reset_for_owner(&owner).unwrap();
                } else {
                    pool.source_changed().unwrap();
                }
            });
            assert!(matches!(result, Err(IncomingPoolError::Stale)));
            assert!(matches!(
                pool.lease_current(),
                Err(IncomingPoolError::Stale)
            ));
            assert!(!first.is_current().unwrap());
            drop(first);
            assert_eq!(pool.retained_generations(), 0);
            assert_eq!(pool.retained_wire_bytes(), 0);
        }
    }
    #[test]
    fn fifty_thousand_row_projection_holds_the_native_source_witness_and_quota_until_drop() {
        let registry = SnapshotRegistry::default();
        registry
            .reset_for_owner(&OwnerIdentity::new("incoming-owner", 1).unwrap())
            .unwrap();
        let pool = IncomingSourcePool::new(registry);
        let mut raw: serde_json::Value = serde_json::from_slice(&rows()).unwrap();
        let text = serde_json::to_string(&vec![false; 50000]).unwrap();
        raw[0].as_object_mut().unwrap().remove("entries_json");
        raw[0]["entries_json_chunks"] = serde_json::json!(
            text.as_bytes()
                .chunks(65536)
                .map(|chunk| std::str::from_utf8(chunk).unwrap())
                .collect::<Vec<_>>()
        );
        let lease = pool
            .supply(
                "large-sharing",
                "viewer",
                &serde_json::to_vec(&raw).unwrap(),
                &context(),
            )
            .unwrap();
        let weak = Arc::downgrade(&lease.0);
        let projection = lease
            .with_observation(|observation| {
                observation.project(
                    "Europe/Berlin",
                    context().observed_epoch_milliseconds,
                    Some(&crate::calendar::incoming::SharedDayWindow {
                        start_date: "2027-01-01",
                        end_date: "2027-02-01",
                    }),
                )
            })
            .unwrap();
        assert_eq!(
            serde_json::to_value(projection.value().unwrap()).unwrap(),
            serde_json::json!([])
        );
        pool.invalidate().unwrap();
        pool.collect_retired().unwrap();
        assert!(!projection.is_current().unwrap());
        assert!(matches!(projection.value(), Err(IncomingPoolError::Stale)));
        drop(lease);
        assert!(weak.upgrade().is_some());
        assert_eq!(pool.retained_generations(), 1);
        drop(projection);
        assert!(weak.upgrade().is_none());
        assert_eq!(pool.retained_generations(), 0);
        assert_eq!(pool.retained_wire_bytes(), 0);
    }
    #[test]
    fn projected_data_finishes_dropping_before_the_native_quota_is_released() {
        struct DataDrop {
            quota: Arc<Quota>,
            called: Arc<AtomicBool>,
        }
        impl Drop for DataDrop {
            fn drop(&mut self) {
                assert_eq!(self.quota.generations.load(Ordering::Acquire), 1);
                assert!(self.quota.bytes.load(Ordering::Acquire) > 0);
                self.called.store(true, Ordering::Release);
            }
        }
        let registry = SnapshotRegistry::default();
        registry
            .reset_for_owner(&OwnerIdentity::new("incoming-owner", 1).unwrap())
            .unwrap();
        let pool = IncomingSourcePool::new(registry);
        let lease = pool
            .supply("sharing-1", "viewer", &rows(), &context())
            .unwrap();
        let called = Arc::new(AtomicBool::new(false));
        let data = lease
            .with_observation(|_| {
                Ok(DataDrop {
                    quota: pool.quota.clone(),
                    called: called.clone(),
                })
            })
            .unwrap();
        pool.invalidate().unwrap();
        pool.collect_retired().unwrap();
        drop(lease);
        drop(data);
        assert!(called.load(Ordering::Acquire));
        assert_eq!(pool.retained_generations(), 0);
        assert_eq!(pool.retained_wire_bytes(), 0);
    }
}
