use super::{
    book::{Draft, RankOwner, Retired},
    model::{MAX_DRAFTS, MAX_OWNERS, MAX_PROOFS, MAX_RETAINED_BYTES, PrepareOutcome, Witness},
    structure::{checked_next, field},
    *,
};
use crate::{
    contract::{self, financial_collation as wire, utility::UtilityKind},
    runtime::report::ReportIssue,
};
use sha2::{Digest, Sha256};
use std::sync::{
    MutexGuard,
    atomic::{AtomicU64, Ordering},
};
struct RawPermit<'a>(&'a AtomicBool);
static RESOURCE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
fn resource_id() -> Result<u64, FinancialPoolError> {
    RESOURCE_SEQUENCE
        .try_update(Ordering::Relaxed, Ordering::Relaxed, |n| {
            (n < contract::MAX_SAFE_REVISION).then(|| n + 1)
        })
        .map(|n| n + 1)
        .map_err(|_| FinancialPoolError::SequenceExhausted)
}
impl Drop for RawPermit<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
impl FinancialCollationPool {
    fn lock(&self) -> Result<MutexGuard<'_, book::Book>, FinancialPoolError> {
        self.state.lock().map_err(|_| FinancialPoolError::Poisoned)
    }
    fn raw_permit(&self) -> Result<RawPermit<'_>, FinancialPoolError> {
        self.raw
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| FinancialPoolError::Busy)?;
        Ok(RawPermit(&self.raw))
    }
    fn unavailable(
        witness: Arc<Witness>,
        scope: Arc<FinancialScope>,
        reason: ReportIssue,
    ) -> PrepareCompletion {
        PrepareCompletion {
            witness,
            scope,
            outcome: PrepareOutcome::Unavailable(reason),
        }
    }
    pub fn prepare(&self, header: &[u8]) -> Result<PrepareCompletion, FinancialPoolError> {
        let marker = self.registry.preparation_marker()?;
        let arrival = self.registry.utility_owner_marker()?;
        let request = wire::parse_prepare(header)?;
        if !marker.is_current()? {
            return Err(FinancialPoolError::Stale);
        }
        let mut lease = self.registry.lease_utility(
            &arrival,
            request.guard(),
            UtilityKind::FinancialCollation,
        )?;
        self.collect_retired()?;
        let scope = Arc::new(FinancialScope {
            guard: request.guard().clone(),
            intent: request.intent().clone(),
            locale_key: request.locale_key().to_owned(),
        });
        let identity = request.guard().snapshot().expect("validated snapshot");
        let previous = {
            let state = self.lock()?;
            state
                .owners
                .iter()
                .find(|o| o.index.identity == *identity && o.locale == request.locale_key())
                .cloned()
        };
        // Serialize creation, then recheck: a concurrent predecessor may have
        // published the index while this caller was acquiring the permit.
        let _creation = if previous.is_none() {
            Some(self.raw_permit()?)
        } else {
            None
        };
        let previous = if previous.is_none() {
            let state = self.lock()?;
            state
                .owners
                .iter()
                .find(|o| o.index.identity == *identity && o.locale == request.locale_key())
                .cloned()
        } else {
            previous
        };
        let owner = if let Some(owner) = previous {
            owner
        } else {
            let existing = {
                let state = self.lock()?;
                state
                    .owners
                    .iter()
                    .find(|o| o.index.identity == *identity)
                    .map(|o| o.index.clone())
            };
            let index = if let Some(index) = existing {
                index
            } else {
                let failed = {
                    self.lock()?
                        .failed
                        .iter()
                        .find(|(id, _)| id == identity)
                        .map(|(_, issue)| issue.clone())
                };
                if let Some(reason) = failed {
                    lease.release_source_owner();
                    let witness = Arc::new(Witness {
                        marker,
                        lease: Arc::new(lease),
                    });
                    return Ok(Self::unavailable(witness, scope, reason));
                }
                let facts = lease.facts().ok_or(FinancialPoolError::Stale)?.clone();
                self.lock()?.structure_builds += 1;
                let built = structure::build(&facts, identity);
                drop(facts);
                if !marker.is_current()? {
                    return Err(FinancialPoolError::Stale);
                }
                match built {
                    Ok(index) => Arc::new(index),
                    Err(reason) => {
                        let mut state = self.lock()?;
                        if state.failed.len() == 2 {
                            state.failed.remove(0);
                        }
                        state.failed.push((identity.clone(), reason.clone()));
                        drop(state);
                        lease.release_source_owner();
                        let witness = Arc::new(Witness {
                            marker,
                            lease: Arc::new(lease),
                        });
                        return Ok(Self::unavailable(witness, scope, reason));
                    }
                }
            };
            if let Err(error) = self.make_room(index.bytes, true) {
                if error != FinancialPoolError::ResourceLimit {
                    return Err(error);
                }
                lease.release_source_owner();
                let witness = Arc::new(Witness {
                    marker,
                    lease: Arc::new(lease),
                });
                return Ok(Self::unavailable(
                    witness,
                    scope,
                    ReportIssue::new("FINANCIAL_COLLATION_RESOURCE_LIMIT"),
                ));
            }
            let mut state = self.lock()?;
            let last = checked_next(&mut state.sequence)?;
            let charge = index.bytes;
            let owner = Arc::new(RankOwner {
                index,
                locale: request.locale_key().to_owned(),
                marker: marker.clone(),
                active: AtomicBool::new(true),
                ranks: Mutex::new(None),
                last: AtomicU64::new(last),
                bytes: AtomicU64::new(charge),
            });
            state.bytes += charge;
            state.owners.push(owner.clone());
            owner
        };
        lease.release_source_owner();
        let witness = Arc::new(Witness {
            marker,
            lease: Arc::new(lease),
        });
        witness.check()?;
        let mut state = self.lock()?;
        if state.drafts.len() >= MAX_DRAFTS {
            drop(state);
            return Ok(Self::unavailable(
                witness,
                scope,
                ReportIssue::new("FINANCIAL_COLLATION_RESOURCE_LIMIT"),
            ));
        }
        let id = resource_id()?;
        owner
            .last
            .store(checked_next(&mut state.sequence)?, Ordering::Release);
        let draft = Arc::new(Draft {
            id,
            owner,
            witness: witness.clone(),
            scope: scope.clone(),
            active: AtomicBool::new(true),
        });
        state.drafts.insert(id, draft.clone());
        drop(state);
        draft.check()?;
        Ok(PrepareCompletion {
            witness,
            scope,
            outcome: PrepareOutcome::Prepared(draft),
        })
    }
    fn draft(&self, id: u64, digest: &str) -> Result<Arc<Draft>, FinancialPoolError> {
        let draft = self
            .lock()?
            .drafts
            .get(&id)
            .cloned()
            .ok_or(FinancialPoolError::UnknownDraft)?;
        draft.check()?;
        if draft.owner.index.digest != digest {
            return Err(FinancialPoolError::ScopeMismatch);
        }
        Ok(draft)
    }
    pub fn candidates(&self, header: &[u8]) -> Result<CandidatePageCompletion, FinancialPoolError> {
        let marker = self.registry.preparation_marker()?;
        let request = wire::parse_candidates(header)?;
        if !marker.is_current()? {
            return Err(FinancialPoolError::Stale);
        }
        let draft = self.draft(request.draft_id(), request.candidate_digest())?;
        let strings = &draft.owner.index.strings;
        let start = request.after().unwrap_or(0) as usize;
        if start > strings.len() {
            return Err(contract::ContractError::InvalidRequest.into());
        }
        let mut end = start;
        let mut bytes = 8192u64;
        while end < strings.len() && end - start < request.limit() as usize {
            let next =
                crate::report::cache_budget::serialized_bytes(&strings[end], model::MAX_PAGE_BYTES)
                    .ok_or(FinancialPoolError::OutputLimit)?
                    + 1;
            if bytes + next > model::MAX_PAGE_BYTES {
                break;
            }
            bytes += next;
            end += 1;
        }
        if end == start && start < strings.len() {
            return Err(FinancialPoolError::OutputLimit);
        }
        draft.check()?;
        Ok(CandidatePageCompletion { draft, start, end })
    }
    pub fn abort(&self, header: &[u8]) -> Result<bool, FinancialPoolError> {
        let request = wire::parse_abort(header)?;
        let mut state = self.lock()?;
        if let Some(draft) = state.drafts.remove(&request.draft_id()) {
            draft.active.store(false, Ordering::Release);
            state.retired.push(Retired::Draft(draft));
            Ok(true)
        } else {
            Ok(false)
        }
    }
    pub fn finalize(
        &self,
        header: &[u8],
        raw_ranks: &[u8],
    ) -> Result<FinalizeCompletion, FinancialPoolError> {
        self.finalize_observed(header, raw_ranks, || {})
    }
    fn finalize_observed(
        &self,
        header: &[u8],
        raw_ranks: &[u8],
        before_parse: impl FnOnce(),
    ) -> Result<FinalizeCompletion, FinancialPoolError> {
        let marker = self.registry.preparation_marker()?;
        let request = wire::parse_finalize(header)?;
        if !marker.is_current()? {
            return Err(FinancialPoolError::Stale);
        }
        let draft = self.draft(request.draft_id(), request.candidate_digest())?;
        let (ranks, rank_digest) = if request.reuse_cached() {
            if !raw_ranks.is_empty() {
                return Err(FinancialPoolError::InvalidRanks);
            }
            let cached = draft
                .owner
                .ranks
                .lock()
                .map_err(|_| FinancialPoolError::Poisoned)?;
            let cached = cached.as_ref().ok_or(FinancialPoolError::InvalidRanks)?;
            (cached.ranks.clone(), cached.digest.clone())
        } else {
            let _permit = self.raw_permit()?;
            let needs = draft
                .owner
                .ranks
                .lock()
                .map_err(|_| FinancialPoolError::Poisoned)?
                .is_none();
            if needs {
                self.make_room(draft.owner.index.rank_reservation, false)?;
                self.lock()?.reserved += draft.owner.index.rank_reservation;
            }
            self.lock()?.rank_parses += 1;
            before_parse();
            let parsed = super::finalize::parse(raw_ranks, &draft);
            if needs {
                self.lock()?.reserved -= draft.owner.index.rank_reservation;
            }
            let parsed = parsed?;
            draft.check()?;
            let mut existing = draft
                .owner
                .ranks
                .lock()
                .map_err(|_| FinancialPoolError::Poisoned)?;
            if let Some(existing) = existing.as_ref() {
                if existing.digest != parsed.digest {
                    return Err(FinancialPoolError::RankConflict);
                }
                (existing.ranks.clone(), existing.digest.clone())
            } else {
                if parsed.bytes > draft.owner.index.rank_reservation {
                    return Err(FinancialPoolError::ResourceLimit);
                }
                let result = (parsed.ranks.clone(), parsed.digest.clone());
                self.lock()?.bytes += parsed.bytes;
                draft.owner.bytes.fetch_add(parsed.bytes, Ordering::AcqRel);
                *existing = Some(parsed);
                result
            }
        };
        draft.check()?;
        let mut hash = Sha256::new();
        field(&mut hash, b"luna-financial-admission-v1");
        field(&mut hash, crate::ENGINE_VERSION.as_bytes());
        field(
            &mut hash,
            &serde_json::to_vec(&*draft.scope).map_err(|_| FinancialPoolError::ScopeMismatch)?,
        );
        field(&mut hash, draft.owner.index.digest.as_bytes());
        field(&mut hash, rank_digest.as_bytes());
        let digest = format!("{:x}", hash.finalize());
        let mut state = self.lock()?;
        if state.proofs.len() >= MAX_PROOFS {
            let candidate = state
                .proofs
                .iter()
                .filter(|(_, proof)| Arc::strong_count(proof) == 1)
                .min_by_key(|(_, proof)| proof.last.load(Ordering::Acquire))
                .map(|(token, _)| *token)
                .ok_or(FinancialPoolError::ResourceLimit)?;
            let old = state.proofs.remove(&candidate).unwrap();
            old.active.store(false, Ordering::Release);
            state.retired.push(Retired::Proof(old));
        }
        if !state
            .drafts
            .get(&draft.id)
            .is_some_and(|stored| Arc::ptr_eq(stored, &draft))
        {
            return Err(FinancialPoolError::Stale);
        }
        let token = resource_id()?;
        let last = checked_next(&mut state.sequence)?;
        let proof = Arc::new(FinancialAdmissionProof {
            token,
            digest,
            candidate_digest: draft.owner.index.digest.clone(),
            scope: draft.scope.clone(),
            witness: draft.witness.clone(),
            owner: draft.owner.clone(),
            ranks,
            active: AtomicBool::new(true),
            last: AtomicU64::new(last),
        });
        draft.active.store(false, Ordering::Release);
        state.drafts.remove(&draft.id);
        state.retired.push(Retired::Draft(draft.clone()));
        state.proofs.insert(token, proof.clone());
        drop(state);
        if !proof.is_current()? {
            return Err(FinancialPoolError::Stale);
        }
        Ok(FinalizeCompletion { proof })
    }
    pub fn admission_for_request(
        &self,
        request: &contract::CalculationRequest,
    ) -> Result<Arc<FinancialAdmissionProof>, FinancialPoolError> {
        let details = request
            .financial_details()
            .ok_or(FinancialPoolError::ScopeMismatch)?;
        let locator = details.collation();
        let proof = self
            .lock()?
            .proofs
            .get(&locator.token())
            .cloned()
            .ok_or(FinancialPoolError::UnknownProof)?;
        if !proof.matches_request(request) {
            return Err(FinancialPoolError::ScopeMismatch);
        }
        self.admission(
            locator.token(),
            locator.digest(),
            request.snapshot_identity(),
            proof.scope.intent(),
            locator.locale_key(),
        )
    }
    pub fn admission(
        &self,
        token: u64,
        digest: &str,
        snapshot: &contract::SnapshotIdentity,
        intent: &wire::FinancialIntent,
        locale_key: &str,
    ) -> Result<Arc<FinancialAdmissionProof>, FinancialPoolError> {
        let proof = self
            .lock()?
            .proofs
            .get(&token)
            .cloned()
            .ok_or(FinancialPoolError::UnknownProof)?;
        if proof.digest != digest
            || proof.scope.guard.snapshot() != Some(snapshot)
            || proof.scope.intent != *intent
            || proof.scope.locale_key != locale_key
        {
            return Err(FinancialPoolError::ScopeMismatch);
        }
        if !proof.is_current()? {
            return Err(FinancialPoolError::Stale);
        }
        let mut state = self.lock()?;
        let last = checked_next(&mut state.sequence)?;
        proof.last.store(last, Ordering::Release);
        proof.owner.last.store(last, Ordering::Release);
        Ok(proof)
    }
    pub fn stats(&self) -> Result<PoolStats, FinancialPoolError> {
        let state = self.lock()?;
        Ok(PoolStats {
            open_drafts: state.drafts.len(),
            intent_proofs: state.proofs.len(),
            shared_owners: state.owners.len(),
            retained_bytes: state.bytes + state.reserved,
            retired: state.retired.len(),
            structure_builds: state.structure_builds,
            rank_parses: state.rank_parses,
            raw_operation: self.raw.load(Ordering::Acquire),
        })
    }
    pub fn collect_retired(&self) -> Result<PoolStats, FinancialPoolError> {
        let (drafts, proofs, owners) = {
            let state = self.lock()?;
            (
                state.drafts.values().cloned().collect::<Vec<_>>(),
                state.proofs.values().cloned().collect::<Vec<_>>(),
                state.owners.clone(),
            )
        };
        let stale_drafts = drafts
            .iter()
            .filter_map(|d| match d.current() {
                Ok(false) => Some(Ok(d.id)),
                Ok(true) => None,
                Err(e) => Some(Err(e)),
            })
            .collect::<Result<Vec<_>, _>>()?;
        let stale_proofs = proofs
            .iter()
            .filter_map(|p| match p.is_current() {
                Ok(false) => Some(Ok(p.token)),
                Ok(true) => None,
                Err(e) => Some(Err(e)),
            })
            .collect::<Result<Vec<_>, _>>()?;
        let stale_owners = owners
            .iter()
            .filter_map(|o| match o.marker.is_current() {
                Ok(false) => Some(Ok(o.clone())),
                Ok(true) => None,
                Err(e) => Some(Err(e.into())),
            })
            .collect::<Result<Vec<_>, FinancialPoolError>>()?;
        {
            let mut state = self.lock()?;
            for id in stale_drafts {
                if let Some(d) = state.drafts.remove(&id) {
                    d.active.store(false, Ordering::Release);
                    state.retired.push(Retired::Draft(d));
                }
            }
            for id in stale_proofs {
                if let Some(p) = state.proofs.remove(&id) {
                    p.active.store(false, Ordering::Release);
                    state.retired.push(Retired::Proof(p));
                }
            }
            for owner in &stale_owners {
                if let Some(index) = state.owners.iter().position(|o| Arc::ptr_eq(o, owner)) {
                    let owner = state.owners.remove(index);
                    owner.active.store(false, Ordering::Release);
                    state.retired.push(Retired::Owner(owner));
                }
            }
        }
        drop((drafts, proofs, owners, stale_owners));
        let retired = { std::mem::take(&mut self.lock()?.retired) };
        let mut retained = Vec::new();
        let mut retired_owners = Vec::new();
        for item in retired {
            match item {
                Retired::Draft(d) => drop(d),
                Retired::Proof(p) => drop(p),
                Retired::Owner(o) => retired_owners.push(o),
            }
        }
        for owner in retired_owners {
            if Arc::strong_count(&owner) == 1 {
                let charge = owner.bytes.load(Ordering::Acquire);
                self.lock()?.bytes -= charge;
                drop(owner);
            } else {
                retained.push(Retired::Owner(owner));
            }
        }
        self.lock()?.retired.extend(retained);
        self.stats()
    }
    fn make_room(&self, extra: u64, new_owner: bool) -> Result<(), FinancialPoolError> {
        if extra > MAX_RETAINED_BYTES - 1024 * 1024 {
            return Err(FinancialPoolError::ResourceLimit);
        }
        for _ in 0..=MAX_OWNERS {
            self.collect_retired()?;
            let mut state = self.lock()?;
            if state
                .bytes
                .saturating_add(state.reserved)
                .saturating_add(extra)
                <= MAX_RETAINED_BYTES
                && (!new_owner || state.owners.len() < MAX_OWNERS)
            {
                return Ok(());
            }
            let candidate = state
                .owners
                .iter()
                .enumerate()
                .filter(|(_, owner)| {
                    let count = state
                        .proofs
                        .values()
                        .filter(|p| Arc::ptr_eq(&p.owner, owner))
                        .count();
                    !state.drafts.values().any(|d| Arc::ptr_eq(&d.owner, owner))
                        && state
                            .proofs
                            .values()
                            .filter(|p| Arc::ptr_eq(&p.owner, owner))
                            .all(|p| Arc::strong_count(p) == 1)
                        && Arc::strong_count(owner) == 1 + count
                })
                .min_by_key(|(_, owner)| owner.last.load(Ordering::Acquire))
                .map(|(i, _)| i)
                .ok_or(FinancialPoolError::ResourceLimit)?;
            let owner = state.owners.remove(candidate);
            owner.active.store(false, Ordering::Release);
            let ids = state
                .proofs
                .iter()
                .filter(|(_, p)| Arc::ptr_eq(&p.owner, &owner))
                .map(|(id, _)| *id)
                .collect::<Vec<_>>();
            for id in ids {
                let p = state.proofs.remove(&id).unwrap();
                p.active.store(false, Ordering::Release);
                state.retired.push(Retired::Proof(p));
            }
            state.retired.push(Retired::Owner(owner));
        }
        Err(FinancialPoolError::ResourceLimit)
    }
}
#[cfg(test)]
mod race_tests {
    use super::*;
    use serde_json::{Value, json};
    use std::{sync::Barrier, thread};
    fn fixture() -> (SnapshotRegistry, FinancialCollationPool, Value) {
        let sources=contract::ALL_SOURCE_KINDS.iter().map(|kind|json!({"kind":kind,"source":if *kind==contract::SourceKind::CalendarEntries {json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":{"shiftRows":[],"appointmentRows":[],"platformCollationRanks":{}}}}})}else{json!({"state":"NOT_REQUESTED"})}})).collect::<Vec<_>>();
        let mut raw = json!({"identity":{"ownerScope":"pool-race","ownerEpoch":1,"snapshotId":"snapshot","snapshotRevision":1,"inputDigest":"a".repeat(64),"catalogDigest":"b".repeat(64)},"referenceDate":"2026-11-13","sources":sources,"catalogs":{"current":{"selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"tariff":{"state":"NOT_REQUESTED"},"legal":{"state":"NOT_REQUESTED"},"holiday":{"state":"NOT_REQUESTED"}},"history":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}});
        let hashes = contract::snapshot_digests_json(&serde_json::to_vec(&raw).unwrap()).unwrap();
        raw["identity"]["inputDigest"] = json!(hashes.input_digest);
        raw["identity"]["catalogDigest"] = json!(hashes.catalog_digest);
        let snapshot=match contract::parse_request(&serde_json::to_vec(&json!({"wireSchemaVersion":1,"expectedEngineVersion":crate::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"REGISTER_SNAPSHOT","snapshot":raw}})).unwrap()).unwrap(){contract::ValidatedRequest::RegisterSnapshot(s)=>s,_=>panic!("snapshot")};
        let registry = SnapshotRegistry::default();
        registry
            .reset_for_owner(&contract::OwnerIdentity::new("pool-race", 1).unwrap())
            .unwrap();
        let identity = snapshot.identity().clone();
        registry.register(snapshot).unwrap();
        let pool = FinancialCollationPool::new(registry.clone());
        let header = json!({"wireSchemaVersion":1,"expectedEngineVersion":crate::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"pool-race","ownerEpoch":1,"requestId":"race","draftRevision":1,"snapshot":identity},"intent":{"month":"2026-07","perspective":"EARNED","filter":null,"includeSpecialDutyPay":false},"localeKey":"de-DE"});
        let prepared = pool.prepare(&serde_json::to_vec(&header).unwrap()).unwrap();
        let value = serde_json::from_slice(&prepared.serialize_current().unwrap()).unwrap();
        (registry, pool, value)
    }
    #[test]
    fn abort_or_same_epoch_reset_during_raw_finalize_never_publishes_a_proof() {
        for reset in [false, true] {
            let (registry, pool, prepared) = fixture();
            let draft = pool
                .draft(
                    prepared["draftId"].as_u64().unwrap(),
                    prepared["candidateDigest"].as_str().unwrap(),
                )
                .unwrap();
            let raw = serde_json::to_vec(
                &draft
                    .owner
                    .index
                    .strings
                    .iter()
                    .enumerate()
                    .map(|(i, s)| (s.clone(), i))
                    .collect::<std::collections::BTreeMap<_, _>>(),
            )
            .unwrap();
            drop(draft);
            let header=serde_json::to_vec(&json!({"draftId":prepared["draftId"],"candidateDigest":prepared["candidateDigest"],"reuseCached":false})).unwrap();
            let barrier = Arc::new(Barrier::new(2));
            let entered = barrier.clone();
            let worker = pool.clone();
            let work = thread::spawn(move || {
                worker.finalize_observed(&header, &raw, || {
                    entered.wait();
                    entered.wait();
                })
            });
            barrier.wait();
            assert!(pool.stats().unwrap().raw_operation);
            if reset {
                registry
                    .reset_for_owner(&contract::OwnerIdentity::new("pool-race", 1).unwrap())
                    .unwrap();
            } else {
                assert!(
                    pool.abort(
                        &serde_json::to_vec(&json!({"draftId":prepared["draftId"]})).unwrap()
                    )
                    .unwrap()
                );
                assert!(pool.stats().unwrap().retired > 0);
            }
            barrier.wait();
            assert!(work.join().unwrap().is_err());
            assert_eq!(pool.stats().unwrap().intent_proofs, 0);
            assert!(!pool.stats().unwrap().raw_operation);
            pool.collect_retired().unwrap();
        }
    }
}
