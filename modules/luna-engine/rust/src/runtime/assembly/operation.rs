use super::*;

struct RawPermit<'a>(&'a AtomicBool);
impl Drop for RawPermit<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
pub(super) struct RawOperation<'a> {
    pool: &'a SnapshotAssemblyPool,
    pub(super) builder: Arc<Builder>,
    pub(super) body: Option<SnapshotAssembly>,
    restored: bool,
    // Dropped last, after any detached large ownership has been destroyed.
    _permit: RawPermit<'a>,
}
impl<'a> RawOperation<'a> {
    pub(super) fn new(
        pool: &'a SnapshotAssemblyPool,
        id: BuilderId,
    ) -> Result<Self, AssemblyError> {
        pool.raw
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .map_err(|_| AssemblyError::Busy)?;
        let permit = RawPermit(&pool.raw);
        pool.collect_retired()?;
        let builder = pool.current(id)?;
        if !builder.marker.is_current()? {
            return Err(RegistryError::StaleSnapshot.into());
        }
        let body = builder
            .body
            .lock()
            .map_err(|_| AssemblyError::Poisoned)?
            .take()
            .ok_or(AssemblyError::UnknownBuilder)?;
        if !builder.marker.is_current()? {
            return Err(RegistryError::StaleSnapshot.into());
        }
        Ok(Self {
            pool,
            builder,
            body: Some(body),
            restored: false,
            _permit: permit,
        })
    }
    pub(super) fn restore(&mut self) -> Result<(), AssemblyError> {
        if !self.builder.marker.is_current()? {
            return Err(RegistryError::StaleSnapshot.into());
        }
        let body = self.body.take().ok_or(AssemblyError::UnknownBuilder)?;
        let mut slot = self
            .builder
            .body
            .lock()
            .map_err(|_| AssemblyError::Poisoned)?;
        if slot.is_some() {
            return Err(AssemblyError::Capacity);
        }
        *slot = Some(body);
        self.restored = true;
        Ok(())
    }
}
impl Drop for RawOperation<'_> {
    fn drop(&mut self) {
        if !self.restored {
            let _ = self.pool.registry.cancel_preparation(&self.builder.marker);
            let removed = self.pool.remove(self.builder.id).ok().flatten();
            // Both locks were released above. A failed/raw-aborted operation
            // never returns a partially populated assembler to another caller.
            drop(self.body.take());
            drop(removed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::{MAX_SAFE_REVISION, OwnerIdentity};
    use serde_json::json;

    fn setup() -> (SnapshotAssemblyPool, Vec<u8>) {
        let registry = SnapshotRegistry::default();
        registry
            .reset_for_owner(&OwnerIdentity::new("pool-owner", 1).unwrap())
            .unwrap();
        let header=serde_json::to_vec(&json!({"ownerScope":"pool-owner","ownerEpoch":1,"snapshotId":"pool-snapshot","snapshotRevision":1,"referenceDate":"2026-11-13","selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}})).unwrap();
        (SnapshotAssemblyPool::new(registry), header)
    }
    #[test]
    fn one_raw_operation_allows_one_new_metadata_builder_and_never_cancels_it_on_old_drop() {
        let (pool, header) = setup();
        let old = pool.begin(&header).unwrap();
        let operation = RawOperation::new(&pool, old).unwrap();
        let next = pool.begin(&header).unwrap();
        assert!(matches!(pool.seal(next), Err(AssemblyError::Busy)));
        assert!(pool.stats().unwrap().raw_operation);
        assert!(!operation.builder.marker.is_current().unwrap());
        drop(operation);
        assert!(!pool.stats().unwrap().raw_operation);
        assert!(pool.seal(next).is_ok());
    }
    #[test]
    fn tiny_abort_does_not_wait_on_the_inflight_raw_assembly() {
        let (pool, header) = setup();
        let id = pool.begin(&header).unwrap();
        let operation = RawOperation::new(&pool, id).unwrap();
        let clone = pool.clone();
        let (send, receive) = std::sync::mpsc::channel();
        let thread = std::thread::spawn(move || {
            send.send(clone.abort(id)).unwrap();
        });
        let reply = receive.recv_timeout(std::time::Duration::from_secs(2));
        drop(operation);
        thread.join().unwrap();
        assert!(reply.unwrap().unwrap());
        assert!(pool.seal(id).is_err());
    }
    #[test]
    fn cancellation_metadata_cannot_become_the_last_large_builder_owner() {
        let (pool, header) = setup();
        let id = pool.begin(&header).unwrap();
        let builder = pool.current(id).unwrap();
        let weak = Arc::downgrade(&builder);
        drop(builder);
        let marker = pool.cancellation_marker(id).unwrap().unwrap();
        assert_eq!(weak.strong_count(), 1);
        pool.registry.cancel_preparation(&marker).unwrap();
        pool.retire(id).unwrap();
        let worker = pool.clone();
        std::thread::spawn(move || worker.collect_retired().unwrap())
            .join()
            .unwrap();
        assert!(weak.upgrade().is_none());
        assert!(!marker.is_current().unwrap());
    }
    #[test]
    fn older_begin_cannot_install_over_a_newer_already_installed_builder() {
        let (pool, header) = setup();
        let body = SnapshotAssembly::begin(&header).unwrap();
        let entry = pool.registry.preparation_marker().unwrap();
        let marker = pool
            .registry
            .start_preparation(&entry, &body.fence())
            .unwrap();
        let old = Arc::new(Builder {
            id: BuilderId::next(&BUILDER_SEQUENCE).unwrap(),
            marker,
            body: Mutex::new(Some(body)),
            wire_bytes: AtomicU32::new(header.len() as u32),
            calendar: OnceLock::new(),
            catalog: OnceLock::new(),
            profile_clock: OnceLock::new(),
        });
        let latest = pool.begin(&header).unwrap();
        assert!(matches!(
            pool.install(old),
            Err(AssemblyError::Registry(RegistryError::StaleSnapshot))
        ));
        assert!(pool.seal(latest).is_ok());
    }
    #[test]
    fn aborted_large_owner_survives_control_until_worker_collection() {
        let (pool, header) = setup();
        let id = pool.begin(&header).unwrap();
        let group=serde_json::to_vec(&json!({"kind":"CALENDAR_ENTRIES","source":{"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE"}}}})).unwrap();
        let body = serde_json::to_vec(&vec!["x".repeat(200_000); 8]).unwrap();
        pool.source(id, SourceTarget::Source, &group, &body)
            .unwrap();
        let weak = Arc::downgrade(&pool.current(id).unwrap());
        assert!(pool.abort(id).unwrap());
        assert_eq!(pool.stats().unwrap().retired_builders, 1);
        assert!(weak.upgrade().unwrap().body.lock().unwrap().is_some());
        assert_eq!(pool.collect_retired().unwrap(), 1);
        assert!(weak.upgrade().is_none());
    }
    #[test]
    fn safe_global_ids_never_wrap_or_reuse_after_exhaustion() {
        let sequence = AtomicU64::new(MAX_SAFE_REVISION - 1);
        assert_eq!(
            BuilderId::next(&sequence).unwrap().value(),
            MAX_SAFE_REVISION
        );
        assert_eq!(
            BuilderId::next(&sequence),
            Err(AssemblyError::SequenceExhausted)
        );
        assert_eq!(sequence.load(Ordering::Relaxed), MAX_SAFE_REVISION);
        let invalid = AtomicU64::new(u64::MAX);
        assert_eq!(
            BuilderId::next(&invalid),
            Err(AssemblyError::SequenceExhausted)
        );
    }
    #[test]
    fn original_c_frame_headers_share_one_global_byte_budget_with_all_sources() {
        let (pool, header) = setup();
        let id = pool.begin(&header).unwrap();
        let mut body = Vec::with_capacity(30_001_000);
        body.push(b'[');
        let text = vec![b'x'; 250_000];
        for index in 0..120 {
            if index > 0 {
                body.push(b',');
            }
            body.push(b'"');
            body.extend_from_slice(&text);
            body.push(b'"');
        }
        body.push(b']');
        let mut limited = false;
        for (index, kind) in crate::contract::ALL_SOURCE_KINDS.iter().enumerate() {
            let state = if index == 0 {
                json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE"}}})
            } else {
                json!({"state":"NOT_REQUESTED"})
            };
            let group = serde_json::to_vec(&json!({"kind":kind,"source":state})).unwrap();
            let payload = if index == 0 { body.as_slice() } else { b"" };
            match pool.source_frame(id, SourceTarget::Source, &group, payload, 128 * 1024) {
                Ok(()) => {}
                Err(AssemblyError::Contract(crate::contract::ContractError::InputTooLarge)) => {
                    limited = true;
                    break;
                }
                Err(error) => panic!("unexpected bounded source error: {error:?}"),
            }
        }
        assert!(limited);
        assert!(pool.seal(id).is_err());
        assert!(!pool.stats().unwrap().raw_operation);
    }
}
