use super::*;
struct Permit<'a>(&'a AtomicBool);
impl Drop for Permit<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
pub(super) struct RawOperation<'a> {
    pool: &'a CalendarAssemblyPool,
    pub(super) builder: Arc<Builder>,
    pub(super) body: Option<CalendarOnlyAssembly>,
    pub(super) completed: bool,
    restored: bool,
    _permit: Permit<'a>,
}
impl<'a> RawOperation<'a> {
    pub(super) fn new(
        pool: &'a CalendarAssemblyPool,
        id: CalendarBuilderId,
    ) -> Result<Self, CalendarAssemblyError> {
        pool.raw
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .map_err(|_| CalendarAssemblyError::Busy)?;
        let permit = Permit(&pool.raw);
        pool.collect_retired()?;
        let builder = pool.current(id)?;
        if !builder.marker.is_current()? {
            return Err(RegistryError::StaleSnapshot.into());
        }
        let body = builder
            .body
            .lock()
            .map_err(|_| CalendarAssemblyError::Poisoned)?
            .take()
            .ok_or(CalendarAssemblyError::UnknownBuilder)?;
        if !builder.marker.is_current()? {
            return Err(RegistryError::StaleSnapshot.into());
        }
        Ok(Self {
            pool,
            builder,
            body: Some(body),
            completed: false,
            restored: false,
            _permit: permit,
        })
    }
    pub(super) fn restore(&mut self) -> Result<(), CalendarAssemblyError> {
        if !self.builder.marker.is_current()? {
            return Err(RegistryError::StaleSnapshot.into());
        }
        let body = self
            .body
            .take()
            .ok_or(CalendarAssemblyError::UnknownBuilder)?;
        let mut slot = self
            .builder
            .body
            .lock()
            .map_err(|_| CalendarAssemblyError::Poisoned)?;
        if slot.is_some() {
            return Err(CalendarAssemblyError::Capacity);
        }
        *slot = Some(body);
        drop(slot);
        if !self.builder.marker.is_current()? {
            return Err(RegistryError::StaleSnapshot.into());
        }
        self.restored = true;
        Ok(())
    }
}
impl Drop for RawOperation<'_> {
    fn drop(&mut self) {
        if !self.restored && !self.completed {
            let _ = self.builder.marker.cancel(&self.pool.registry);
            let removed = self.pool.remove(self.builder.id).ok().flatten();
            drop(self.body.take());
            drop(removed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::OwnerIdentity;
    use serde_json::json;
    fn header(clock: bool, revision: u64) -> Vec<u8> {
        serde_json::to_vec(&json!({"wireSchemaVersion":1,"expectedEngineVersion":crate::ENGINE_VERSION,"calculationContractVersion":crate::contract::CONTRACT_VERSION,"ownerScope":"calendar-owner","ownerEpoch":1,"sourceRevision":revision,"intent":if clock{json!({"kind":"CLOCK","observedEpochMilliseconds":1794480000000_i64})}else{json!({"kind":"ROWS"})}})).unwrap()
    }
    fn setup() -> CalendarAssemblyPool {
        let r = SnapshotRegistry::default();
        r.reset_for_owner(&OwnerIdentity::new("calendar-owner", 1).unwrap())
            .unwrap();
        CalendarAssemblyPool::new(r)
    }
    fn source() -> (Vec<u8>, Vec<u8>) {
        (serde_json::to_vec(&json!({"kind":"CALENDAR_ENTRIES","source":{"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE"}}}})).unwrap(),serde_json::to_vec(&json!({"shiftRows":[],"appointmentRows":[],"templateRows":[],"platformCollationRanks":{}})).unwrap())
    }
    #[test]
    fn one_raw_operation_allows_new_metadata_begin_and_old_drop_does_not_cancel_it() {
        let p = setup();
        let old = p.begin(&header(false, 1)).unwrap();
        let op = RawOperation::new(&p, old).unwrap();
        let next = p.begin(&header(false, 2)).unwrap();
        let (h, b) = source();
        assert_eq!(
            p.source(next, &h, &b).unwrap_err(),
            CalendarAssemblyError::Busy
        );
        assert!(p.stats().unwrap().raw_operation);
        drop(op);
        assert!(!p.stats().unwrap().raw_operation);
        p.source(next, &h, &b).unwrap();
        assert!(p.seal(next).unwrap().is_current().unwrap());
    }
    #[test]
    fn cancellation_metadata_never_keeps_a_last_large_builder_owner_on_control_queue() {
        let p = setup();
        let id = p.begin(&header(false, 1)).unwrap();
        let (h, b) = source();
        p.source(id, &h, &b).unwrap();
        let owner = p.current(id).unwrap();
        let weak = Arc::downgrade(&owner);
        drop(owner);
        let marker = p.cancellation_marker(id).unwrap().unwrap();
        assert_eq!(weak.strong_count(), 1);
        p.abort(id).unwrap();
        assert_eq!(weak.strong_count(), 1);
        p.collect_retired().unwrap();
        assert!(weak.upgrade().is_none());
        assert!(!marker.is_current().unwrap());
        assert_eq!(p.stats().unwrap().retained_input_bytes, 0);
    }
    #[test]
    fn an_older_begin_cannot_replace_a_newer_installed_builder_but_other_kind_is_independent() {
        let p = setup();
        let result = p.begin_observed(&header(false, 1), || {
            p.begin(&header(false, 2)).unwrap();
        });
        assert!(matches!(
            result,
            Err(CalendarAssemblyError::Registry(
                RegistryError::StaleSnapshot
            ))
        ));
        assert_eq!(p.stats().unwrap().active_rows, 1);
        assert_eq!(p.stats().unwrap().retired_builders, 0);
        let p = setup();
        p.begin_observed(&header(false, 1), || {
            p.begin(&header(true, 1)).unwrap();
        })
        .unwrap();
        assert_eq!(p.stats().unwrap().active_rows, 1);
        assert_eq!(p.stats().unwrap().active_clock, 1);
    }
    #[test]
    fn raw_quota_is_shared_atomic_and_all_charges_release_only_with_worker_ownership() {
        let p = setup();
        let rows = p.begin(&header(false, 1)).unwrap();
        let owner = p.current(rows).unwrap();
        owner.charge(MAX_INPUT_BYTES as usize).unwrap();
        let before = p.stats().unwrap().retained_input_bytes;
        assert_eq!(
            owner.charge(MAX_INPUT_BYTES as usize).unwrap_err(),
            CalendarAssemblyError::Capacity
        );
        assert_eq!(p.stats().unwrap().retained_input_bytes, before);
        let clock = p.begin(&header(true, 1)).unwrap();
        drop(owner);
        p.abort(rows).unwrap();
        assert!(p.stats().unwrap().retained_input_bytes > header(true, 1).len() as u64);
        p.collect_retired().unwrap();
        assert_eq!(
            p.stats().unwrap().retained_input_bytes,
            header(true, 1).len() as u64
        );
        p.abort(clock).unwrap();
        p.collect_retired().unwrap();
        assert_eq!(p.stats().unwrap().retained_input_bytes, 0);
    }
}
