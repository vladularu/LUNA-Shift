use super::{
    model::*,
    resource::{Phase, Resource, SourceOwner, SourceWitness, Witness},
    *,
};
use crate::{
    contract::{self, calendar_window as wire, utility::UtilityKind},
    runtime::{
        collation_ranks::{self, Namespace, ParseError},
        report::ReportIssue,
    },
};
use sha2::{Digest, Sha256};
use std::sync::{
    MutexGuard, Weak,
    atomic::{AtomicU64, Ordering},
};

static RESOURCE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
struct RawPermit<'a>(&'a AtomicBool);
impl Drop for RawPermit<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn field(hash: &mut Sha256, bytes: &[u8]) {
    hash.update((bytes.len() as u64).to_be_bytes());
    hash.update(bytes);
}
fn next(sequence: &mut u64) -> Result<u64, WindowPoolError> {
    *sequence = sequence
        .checked_add(1)
        .ok_or(WindowPoolError::SequenceExhausted)?;
    Ok(*sequence)
}
fn resource_id() -> Result<u64, WindowPoolError> {
    RESOURCE_SEQUENCE
        .try_update(Ordering::Relaxed, Ordering::Relaxed, |n| {
            (n < contract::MAX_SAFE_REVISION).then(|| n + 1)
        })
        .map(|n| n + 1)
        .map_err(|_| WindowPoolError::SequenceExhausted)
}
fn candidate_bytes(strings: &[String], capacity: usize) -> u64 {
    4096 + capacity as u64 * std::mem::size_of::<String>() as u64
        + strings.iter().map(|s| s.capacity() as u64).sum::<u64>()
}

impl CalendarWindowPool {
    fn lock(&self) -> Result<MutexGuard<'_, resource::Book>, WindowPoolError> {
        self.book.lock().map_err(|_| WindowPoolError::Poisoned)
    }
    fn raw_permit(&self) -> Result<RawPermit<'_>, WindowPoolError> {
        self.raw
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| WindowPoolError::Busy)?;
        Ok(RawPermit(&self.raw))
    }
    fn source_bytes(&self) -> Result<u64, WindowPoolError> {
        let sources = self
            .lock()?
            .sources
            .iter()
            .map(|source| source.index.clone())
            .collect::<Vec<_>>();
        // Last source owners, if any, drop here on this worker outside locks.
        Ok(sources
            .iter()
            .filter_map(Weak::upgrade)
            .map(|source| source.metadata_bytes())
            .sum())
    }
    fn unavailable(
        witness: Arc<Witness>,
        scope: Arc<WindowScope>,
        reason: ReportIssue,
    ) -> Completion {
        Completion {
            reply: Reply::Unavailable {
                witness,
                scope,
                reason,
            },
        }
    }
    pub fn prepare(&self, header: &[u8]) -> Result<Completion, WindowPoolError> {
        let marker = self.registry.preparation_marker()?;
        let calendar_marker = self.registry.calendar_rows_marker()?;
        let clock_marker = self.registry.calendar_clock_marker()?;
        let arrival = self.registry.utility_owner_marker()?;
        let request = wire::parse_prepare(header)?;
        let clock = if let Some(p) = request.presentation() {
            let lease = self
                .registry
                .lease_calendar_clock(&clock_marker, &p.clock_identity)?;
            let metadata = lease.clock().metadata();
            let valid = if metadata.cacheable {
                lease.is_fresh_at(p.observed_epoch_milliseconds)?
            } else {
                lease.is_current()?
                    && p.observed_epoch_milliseconds == metadata.observed_epoch_milliseconds
            };
            if !valid {
                return Err(WindowPoolError::Stale);
            }
            Some(Arc::new(lease))
        } else {
            None
        };
        let _raw = self.raw_permit()?;
        let bound = request.source_guard()?;
        let mut lease =
            self.registry
                .lease_utility(&arrival, &bound, UtilityKind::CalendarWindow)?;
        let source_witness = match request.source() {
            wire::WindowSource::ReportSnapshot { .. } => SourceWitness::Report(marker),
            wire::WindowSource::CalendarOnly { identity } => SourceWitness::Calendar(Box::new(
                self.registry
                    .lease_calendar_rows(&calendar_marker, identity)?,
            )),
        };
        self.collect_retired()?;
        let scope = Arc::new(WindowScope {
            guard: request.guard().clone(),
            source: request.source().clone(),
            spec: request.spec().clone(),
            options: request.options(),
            locale_key: request.locale_key().to_owned(),
            presentation: request.presentation().cloned(),
        });
        let identity = request.source();
        let source_limit = {
            let mut state = self.lock()?;
            state
                .sources
                .retain(|source| source.index.strong_count() > 0);
            state.sources.len() >= 2
                && !state
                    .sources
                    .iter()
                    .any(|source| &source.identity == identity||matches!(&source_witness,SourceWitness::Calendar(lease) if lease.rows().is_ok_and(|rows|Weak::ptr_eq(&source.index,&Arc::downgrade(rows.index())))))
        };
        // Enforce the source-owner cap before constructing a third native index.
        if source_limit {
            lease.release_source_owner();
            let witness = Arc::new(Witness {
                source: source_witness,
                lease: Arc::new(lease),
                clock,
            });
            witness.check()?;
            return Ok(Self::unavailable(
                witness,
                scope,
                ReportIssue::new("CALENDAR_WINDOW_RESOURCE_LIMIT"),
            ));
        }
        let built = match &source_witness {
            SourceWitness::Report(_) => lease
                .facts()
                .ok_or(WindowPoolError::Stale)?
                .calendar_window_index()
                .cloned(),
            SourceWitness::Calendar(calendar) => calendar
                .rows()
                .map(|rows| rows.index().clone())
                .map_err(Clone::clone),
        };
        lease.release_source_owner();
        let witness = Arc::new(Witness {
            source: source_witness,
            lease: Arc::new(lease),
            clock,
        });
        witness.check()?;
        let index = match built {
            Ok(index) => index,
            Err(reason) => return Ok(Self::unavailable(witness, scope, reason)),
        };
        {
            let mut state = self.lock()?;
            state.sources.retain(|s| s.index.strong_count() > 0);
            if !state
                .sources
                .iter()
                .any(|s| Weak::ptr_eq(&s.index, &Arc::downgrade(&index)))
            {
                if state.sources.len() >= 2 {
                    return Ok(Self::unavailable(
                        witness,
                        scope,
                        ReportIssue::new("CALENDAR_WINDOW_RESOURCE_LIMIT"),
                    ));
                }
                state.sources.push(SourceOwner {
                    identity: identity.clone(),
                    index: Arc::downgrade(&index),
                });
            }
            state.preparations += 1;
        }
        let mut prepared = match index.prepare_current(request.spec(), || witness.check().is_ok()) {
            Ok(value) => value,
            Err(error) => {
                witness.check()?;
                return Ok(Self::unavailable(
                    witness,
                    scope,
                    ReportIssue::new(error.code()),
                ));
            }
        };
        witness.check()?;
        let candidates = prepared.take_candidates().into_iter().collect::<Vec<_>>();
        let navigation = match (request.presentation(), witness.clock.as_ref()) {
            (Some(p), Some(clock)) => {
                let input = crate::calendar::presentation::navigation::NavigationInput {
                    anchor_month: p.anchor_month.clone(),
                    reference_date: clock.clock().metadata().reference_date.clone(),
                    selected_date: p.selected_date.clone(),
                    before: p.before,
                    after: p.after,
                };
                Some(super::resource::NavigationFrame {
                    clock: clock.clock().metadata().clone(),
                    navigation: crate::calendar::presentation::navigation::calculate(&input)
                        .map_err(|_| {
                            WindowPoolError::Contract(contract::ContractError::InvalidRequest)
                        })?,
                })
            }
            (None, None) => None,
            _ => return Err(WindowPoolError::Stale),
        };
        let navigation_charge = if let Some(nav) = &navigation {
            crate::report::cache_budget::serialized_bytes(nav, MAX_PAGE_BYTES - 16384)
                .ok_or(WindowPoolError::OutputLimit)?
                .saturating_mul(2)
                .saturating_add(1024)
        } else {
            0
        };
        let charge = candidate_bytes(&candidates, candidates.capacity())
            .saturating_add(prepared.metadata_bytes())
            .saturating_add(8192)
            .saturating_add(navigation_charge);
        if let Err(error) = self.make_room(charge, Some(false)) {
            if error == WindowPoolError::ResourceLimit {
                return Ok(Self::unavailable(
                    witness,
                    scope,
                    ReportIssue::new("CALENDAR_WINDOW_RESOURCE_LIMIT"),
                ));
            }
            return Err(error);
        }
        let mut digest = Sha256::new();
        field(&mut digest, b"luna-calendar-window-candidates-v1");
        field(&mut digest, crate::ENGINE_VERSION.as_bytes());
        for text in &candidates {
            field(&mut digest, text.as_bytes());
        }
        let mut state = self.lock()?;
        let id = resource_id()?;
        let last = next(&mut state.sequence)?;
        let resource = Arc::new(Resource {
            id,
            scope,
            witness,
            bounds: prepared.bounds().clone(),
            projected: prepared.projected_len(),
            candidates,
            digest: format!("{:x}", digest.finalize()),
            phase: Mutex::new(Phase::Prepared(prepared)),
            active: AtomicBool::new(true),
            ready: AtomicBool::new(false),
            charge: AtomicU64::new(charge),
            last: AtomicU64::new(last),
            navigation,
            navigation_charge,
        });
        state.bytes += charge;
        state.entries.insert(id, resource.clone());
        drop(state);
        resource.check()?;
        Ok(Completion {
            reply: Reply::Prepared(resource),
        })
    }
    fn get(&self, id: u64) -> Result<Arc<Resource>, WindowPoolError> {
        let resource = self
            .lock()?
            .entries
            .get(&id)
            .cloned()
            .ok_or(WindowPoolError::UnknownResource)?;
        resource.check()?;
        let last = next(&mut self.lock()?.sequence)?;
        resource.last.store(last, Ordering::Release);
        Ok(resource)
    }
    pub fn candidates(&self, header: &[u8]) -> Result<Completion, WindowPoolError> {
        let request = wire::parse_candidates(header)?;
        let resource = self.get(request.resource_id())?;
        if request.candidate_digest() != resource.digest {
            return Err(WindowPoolError::InvalidRanks);
        }
        let start = request.after().unwrap_or(0) as usize;
        let end = pages::candidate_end(&resource, start, request.limit())?;
        resource.check()?;
        Ok(Completion {
            reply: Reply::Candidates {
                resource,
                start,
                end,
            },
        })
    }
    pub fn finalize(&self, header: &[u8], raw_ranks: &[u8]) -> Result<Completion, WindowPoolError> {
        self.finalize_observed(header, raw_ranks, || {})
    }
    fn finalize_observed(
        &self,
        header: &[u8],
        raw_ranks: &[u8],
        before_parse: impl FnOnce(),
    ) -> Result<Completion, WindowPoolError> {
        let request = wire::parse_finalize(header)?;
        let _raw = self.raw_permit()?;
        let resource = self.get(request.resource_id())?;
        if request.candidate_digest() != resource.digest {
            return Err(WindowPoolError::InvalidRanks);
        }
        if resource.ready.load(Ordering::Acquire) {
            return Err(WindowPoolError::AlreadyReady);
        }
        let reserve = 4096
            + resource
                .candidates
                .iter()
                .map(|s| s.len() as u64 + 144)
                .sum::<u64>();
        self.make_room(reserve, None)?;
        {
            let mut state = self.lock()?;
            state.reserved += reserve;
            state.rank_parses += 1;
        }
        before_parse();
        let parsed = collation_ranks::parse(
            raw_ranks,
            &resource.candidates,
            Namespace::CalendarWindow,
            || resource.check(),
        );
        self.lock()?.reserved -= reserve;
        let parsed = parsed.map_err(|error| match error {
            ParseError::InputTooLarge => {
                WindowPoolError::Contract(contract::ContractError::InputTooLarge)
            }
            ParseError::InvalidRanks => WindowPoolError::InvalidRanks,
            ParseError::Fence(error) => error,
        })?;
        resource.check()?;
        let prepared = {
            let mut phase = resource
                .phase
                .lock()
                .map_err(|_| WindowPoolError::Poisoned)?;
            match std::mem::replace(&mut *phase, Phase::Building) {
                Phase::Prepared(value) => value,
                other => {
                    *phase = other;
                    return Err(WindowPoolError::AlreadyReady);
                }
            }
        };
        let built = prepared
            .finalize(&parsed.ranks)
            .and_then(|sorted| sorted.index(resource.scope.options));
        let view = match built {
            Ok(view) => Arc::new(view),
            Err(error) => {
                resource.active.store(false, Ordering::Release);
                return Err(match error {
                    crate::calendar::window::WindowError::ResourceLimit => {
                        WindowPoolError::ResourceLimit
                    }
                    _ => WindowPoolError::Contract(contract::ContractError::InvalidRequest),
                });
            }
        };
        // Transient parse/sort owners release on this worker, before publication.
        drop(parsed);
        resource.check()?;
        let charge = candidate_bytes(&resource.candidates, resource.candidates.capacity())
            .saturating_add(view.metadata_bytes())
            .saturating_add(8192)
            .saturating_add(resource.navigation_charge);
        let previous = resource.charge.load(Ordering::Acquire);
        if let Err(error) = self.make_room(charge.saturating_sub(previous), Some(true)) {
            resource.active.store(false, Ordering::Release);
            return Err(error);
        }
        {
            let mut state = self.lock()?;
            state.bytes = state.bytes - previous + charge;
            resource.charge.store(charge, Ordering::Release);
        }
        *resource
            .phase
            .lock()
            .map_err(|_| WindowPoolError::Poisoned)? = Phase::Ready(view.clone());
        resource.ready.store(true, Ordering::Release);
        resource.check()?;
        Ok(Completion {
            reply: Reply::Ready { resource, view },
        })
    }
    pub fn read(&self, header: &[u8]) -> Result<Completion, WindowPoolError> {
        let request = wire::parse_read(header)?;
        let resource = self.get(request.resource_id())?;
        let view = resource.ready()?;
        let start = request.after().unwrap_or(0) as usize;
        if matches!(request.view(), wire::PageView::Navigation) && resource.navigation.is_none() {
            return Err(WindowPoolError::NotReady);
        }
        let display = resource
            .scope
            .presentation
            .as_ref()
            .and_then(|p| p.entries.as_ref());
        if matches!(
            request.view(),
            wire::PageView::EntryPresentations | wire::PageView::DatePreviews
        ) && (display.is_none() || resource.navigation.is_none())
        {
            return Err(WindowPoolError::NotReady);
        }
        let total = pages::total(&view, request.view(), resource.navigation.as_ref());
        let end = pages::read_end(
            &view,
            request.view(),
            start,
            request.limit(),
            resource.navigation.as_ref(),
            display,
        )?;
        resource.check()?;
        Ok(Completion {
            reply: Reply::Read {
                resource,
                view,
                selector: request.view(),
                start,
                end,
                total,
            },
        })
    }
    /// Control operation: only a flag and Arc ownership move under the lock.
    pub fn abort(&self, header: &[u8]) -> Result<bool, WindowPoolError> {
        let request = wire::parse_abort(header)?;
        let mut state = self.lock()?;
        if let Some(resource) = state.entries.remove(&request.resource_id()) {
            resource.active.store(false, Ordering::Release);
            state.retired.push(resource);
            Ok(true)
        } else {
            Ok(false)
        }
    }
    pub fn stats(&self) -> Result<PoolStats, WindowPoolError> {
        let source_bytes = self.source_bytes()?;
        let state = self.lock()?;
        let ready = state
            .entries
            .values()
            .filter(|r| r.ready.load(Ordering::Acquire))
            .count();
        Ok(PoolStats {
            drafts: (state.entries.len() - ready) as u32,
            ready: ready as u32,
            retired: state.retired.len() as u32,
            retained_bytes: state.bytes + state.reserved + source_bytes,
            source_indices: state
                .sources
                .iter()
                .filter(|s| s.index.strong_count() > 0)
                .count() as u32,
            preparations: state.preparations,
            rank_parses: state.rank_parses,
        })
    }
    /// Preparation worker only. No last large owner drops on the control queue.
    pub fn collect_retired(&self) -> Result<PoolStats, WindowPoolError> {
        let entries = self.lock()?.entries.values().cloned().collect::<Vec<_>>();
        let stale = entries
            .iter()
            .filter_map(|r| match r.check() {
                Ok(()) => None,
                Err(WindowPoolError::Stale) => Some(Ok(r.id)),
                Err(error) => Some(Err(error)),
            })
            .collect::<Result<Vec<_>, _>>()?;
        drop(entries);
        let retired = {
            let mut state = self.lock()?;
            for id in stale {
                if let Some(resource) = state.entries.remove(&id) {
                    resource.active.store(false, Ordering::Release);
                    state.retired.push(resource);
                }
            }
            let mut collected = Vec::new();
            let mut index = 0;
            while index < state.retired.len() {
                if Arc::strong_count(&state.retired[index]) == 1 {
                    let resource = state.retired.swap_remove(index);
                    state.bytes -= resource.charge.load(Ordering::Acquire);
                    collected.push(resource);
                } else {
                    index += 1;
                }
            }
            state.sources.retain(|s| s.index.strong_count() > 0);
            collected
        };
        drop(retired);
        self.stats()
    }
    // Some(false): new draft; Some(true): draft becomes ready; None: byte reserve.
    fn make_room(&self, extra: u64, kind: Option<bool>) -> Result<(), WindowPoolError> {
        for _ in 0..=MAX_TOTAL {
            self.collect_retired()?;
            let source_bytes = self.source_bytes()?;
            let mut state = self.lock()?;
            let ready = state
                .entries
                .values()
                .filter(|r| r.ready.load(Ordering::Acquire))
                .count();
            let draft_blocked = kind == Some(false) && state.entries.len() - ready >= MAX_DRAFTS;
            let ready_blocked = kind == Some(true) && ready >= MAX_READY;
            let total_blocked =
                kind == Some(false) && state.entries.len() + state.retired.len() >= MAX_TOTAL;
            let bytes_blocked = state
                .bytes
                .saturating_add(state.reserved)
                .saturating_add(source_bytes)
                .saturating_add(extra)
                > MAX_BYTES;
            if !draft_blocked && !ready_blocked && !total_blocked && !bytes_blocked {
                return Ok(());
            }
            let evict = state
                .entries
                .iter()
                .filter(|(_, r)| {
                    Arc::strong_count(r) == 1
                        && (!draft_blocked || !r.ready.load(Ordering::Acquire))
                        && (!ready_blocked || r.ready.load(Ordering::Acquire))
                })
                .min_by_key(|(_, r)| r.last.load(Ordering::Acquire))
                .map(|(id, _)| *id)
                .ok_or(WindowPoolError::ResourceLimit)?;
            let resource = state.entries.remove(&evict).expect("retained candidate");
            resource.active.store(false, Ordering::Release);
            state.retired.push(resource);
        }
        Err(WindowPoolError::ResourceLimit)
    }
}

#[cfg(test)]
mod race_tests {
    use super::*;
    use crate::contract::{OwnerIdentity, ValidatedRequest};
    use serde_json::{Value, json};
    fn bytes(value: &Value) -> Vec<u8> {
        serde_json::to_vec(value).unwrap()
    }
    fn fixture() -> (SnapshotRegistry, CalendarWindowPool, Value) {
        let sources=contract::ALL_SOURCE_KINDS.iter().map(|kind|json!({"kind":kind,"source":if *kind==contract::SourceKind::CalendarEntries{json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":{"shiftRows":[],"appointmentRows":[],"platformCollationRanks":{}}}}})}else{json!({"state":"NOT_REQUESTED"})}})).collect::<Vec<_>>();
        let mut raw = json!({"identity":{"ownerScope":"calendar-race","ownerEpoch":1,"snapshotId":"race-snapshot","snapshotRevision":1,"inputDigest":"a".repeat(64),"catalogDigest":"b".repeat(64)},"referenceDate":"2026-03-01","sources":sources,"catalogs":{"current":{"selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"tariff":{"state":"NOT_REQUESTED"},"legal":{"state":"NOT_REQUESTED"},"holiday":{"state":"NOT_REQUESTED"}},"history":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}});
        let digest = contract::snapshot_digests_json(&bytes(&raw)).unwrap();
        raw["identity"]["inputDigest"] = json!(digest.input_digest);
        raw["identity"]["catalogDigest"] = json!(digest.catalog_digest);
        let parsed=contract::parse_request(&bytes(&json!({"wireSchemaVersion":1,"expectedEngineVersion":crate::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"REGISTER_SNAPSHOT","snapshot":raw}}))).unwrap();
        let snapshot = match parsed {
            ValidatedRequest::RegisterSnapshot(s) => s,
            _ => panic!("snapshot"),
        };
        let identity = snapshot.identity().clone();
        let registry = SnapshotRegistry::default();
        registry
            .reset_for_owner(&OwnerIdentity::new("calendar-race", 1).unwrap())
            .unwrap();
        registry.register(snapshot).unwrap();
        let pool = CalendarWindowPool::new(registry.clone());
        let completion=pool.prepare(&bytes(&json!({"wireSchemaVersion":1,"expectedEngineVersion":crate::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"calendar-race","ownerEpoch":1,"requestId":"window-race","draftRevision":1},"source":{"kind":"REPORT_SNAPSHOT","identity":identity},"spec":{"kind":"DAY","date":"2026-03-01"},"options":{"showAppointments":true,"showShifts":true},"localeKey":"synthetic-empty-locale"}))).unwrap();
        let prepared = serde_json::from_slice(&completion.serialize_current().unwrap()).unwrap();
        (registry, pool, prepared)
    }
    #[test]
    fn abort_and_same_epoch_reset_during_raw_finalize_never_publish_ready() {
        for reset in [false, true] {
            let (registry, pool, prepared) = fixture();
            let result=pool.finalize_observed(&bytes(&json!({"resourceId":prepared["resourceId"],"candidateDigest":prepared["candidateDigest"]})),b"{}",||{
                if reset{registry.reset_for_owner(&OwnerIdentity::new("calendar-race",1).unwrap()).unwrap();}else{assert!(pool.abort(&bytes(&json!({"resourceId":prepared["resourceId"]}))).unwrap());}
            });
            assert!(matches!(result, Err(WindowPoolError::Stale)));
            assert_eq!(pool.stats().unwrap().ready, 0);
            assert_eq!(pool.stats().unwrap().rank_parses, 1);
        }
    }
}
