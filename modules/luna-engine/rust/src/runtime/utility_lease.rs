//! Independent utility/draft publication slots. Lifecycle locks hold metadata
//! only; checked source owners are acquired and dropped on utility workers.
use super::*;
use crate::contract::utility::{UtilityGuard, UtilityKind};
const MAX_UTILITY_CHANNELS: usize = 128;
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UtilityFenceError {
    OwnerMismatch,
    Stale,
    StaleDraft,
    Capacity,
    SequenceExhausted,
    Poisoned,
    MissingSnapshot,
}
#[derive(Debug, Default)]
pub(super) struct UtilityRegistryState {
    owner_generation: u64,
    sequence: u64,
    admission_floor: u64,
    channels: BTreeMap<String, Channel>,
}
#[derive(Debug)]
struct Channel {
    draft_revision: u64,
    last: u64,
    writers: BTreeMap<UtilityKind, UtilityWriter>,
}
#[derive(Debug)]
struct UtilityWriter {
    token: u64,
    arrival: u64,
    active: bool,
}
impl UtilityRegistryState {
    pub(super) fn reset_owner(&mut self) -> Result<(), RegistryError> {
        let next = self
            .owner_generation
            .checked_add(1)
            .ok_or(RegistryError::SequenceExhausted)?;
        self.channels.clear();
        self.owner_generation = next;
        Ok(())
    }
}
/// Captured before raw payload parsing; source revisions do not invalidate pure
/// draft work, but reset to the same owner/epoch still invalidates this marker.
#[derive(Clone)]
pub struct UtilityOwnerMarker {
    registry: Weak<Mutex<State>>,
    owner_generation: u64,
    owner: (String, u64),
    arrival: u64,
}
impl UtilityOwnerMarker {
    pub(in crate::runtime) fn shares_registry_owner(
        &self,
        registry: &Weak<Mutex<State>>,
        scope: &str,
        epoch: u64,
    ) -> bool {
        Weak::ptr_eq(&self.registry, registry) && self.owner.0 == scope && self.owner.1 == epoch
    }
    pub(crate) fn shares_owner(&self, other: &Self) -> bool {
        Weak::ptr_eq(&self.registry, &other.registry)
            && self.owner_generation == other.owner_generation
            && self.owner == other.owner
    }
    /// Owner strings can repeat in another core or after reset. They do not establish ownership.
    pub(crate) fn shares_lease(&self, lease: &UtilityLease) -> bool {
        Weak::ptr_eq(&self.registry, &lease.registry)
            && self.owner_generation == lease.owner_generation
            && self.owner.0 == lease.guard.owner_scope()
            && self.owner.1 == lease.guard.owner_epoch()
    }
    pub(crate) fn matches_owner(
        &self,
        owner: &crate::contract::OwnerIdentity,
    ) -> Result<bool, UtilityFenceError> {
        Ok(self.owner.0 == owner.scope() && self.owner.1 == owner.epoch() && self.is_current()?)
    }
    /// Report revisions do not invalidate an editor; any owner reset does.
    pub fn is_current(&self) -> Result<bool, UtilityFenceError> {
        let Some(registry) = self.registry.upgrade() else {
            return Ok(false);
        };
        let state = registry.lock().map_err(|_| UtilityFenceError::Poisoned)?;
        Ok(self.current_owner(&state))
    }
    pub(in crate::runtime) fn current_owner(&self, state: &State) -> bool {
        self.owner_generation == state.utility.owner_generation
            && state.expected_owner.as_ref() == Some(&self.owner)
    }
}
pub struct UtilityLease {
    registry: Weak<Mutex<State>>,
    owner_generation: u64,
    source_generation: Option<u64>,
    guard: UtilityGuard,
    kind: UtilityKind,
    token: u64,
    facts: Option<Arc<facts::SnapshotFacts>>,
}
impl UtilityLease {
    pub fn guard(&self) -> &UtilityGuard {
        &self.guard
    }
    pub fn kind(&self) -> UtilityKind {
        self.kind
    }
    pub fn facts(&self) -> Option<&Arc<facts::SnapshotFacts>> {
        self.facts.as_ref()
    }
    /// Structural resource producers keep only this publication witness once
    /// their owned index is complete. Call on a preparation worker, outside locks.
    pub(crate) fn release_source_owner(&mut self) {
        self.facts = None;
    }
    pub fn is_current(&self) -> Result<bool, UtilityFenceError> {
        let Some(registry) = self.registry.upgrade() else {
            return Ok(false);
        };
        let state = registry.lock().map_err(|_| UtilityFenceError::Poisoned)?;
        Ok(self.current(&state))
    }
    pub(super) fn current(&self, state: &State) -> bool {
        state.utility.owner_generation == self.owner_generation
            && state.expected_owner.as_ref().is_some_and(|(scope, epoch)| {
                scope == self.guard.owner_scope() && *epoch == self.guard.owner_epoch()
            })
            && self
                .source_generation
                .is_none_or(|generation| generation == state.generation)
            && self.guard.snapshot().is_none_or(|identity| {
                state.snapshot.as_ref().is_some_and(|snapshot| {
                    snapshot.identity() == identity
                        && identity.snapshot_revision() >= state.minimum_revision
                })
            })
            && state
                .utility
                .channels
                .get(self.guard.request_id())
                .is_some_and(|channel| {
                    channel.draft_revision == self.guard.draft_revision()
                        && channel
                            .writers
                            .get(&self.kind)
                            .is_some_and(|writer| writer.token == self.token && writer.active)
                })
    }
}
impl Drop for UtilityLease {
    fn drop(&mut self) {
        if let Some(registry) = self.registry.upgrade()
            && let Ok(mut state) = registry.lock()
            && state.utility.owner_generation == self.owner_generation
            && let Some(writer) = state
                .utility
                .channels
                .get_mut(self.guard.request_id())
                .and_then(|channel| channel.writers.get_mut(&self.kind))
            && writer.token == self.token
        {
            writer.active = false;
        }
        // Lease fields, including any last ArcFacts owner, drop after this lock.
    }
}
impl SnapshotRegistry {
    pub fn utility_owner_marker(&self) -> Result<UtilityOwnerMarker, UtilityFenceError> {
        let mut state = self.0.lock().map_err(|_| UtilityFenceError::Poisoned)?;
        let owner = state
            .expected_owner
            .clone()
            .ok_or(UtilityFenceError::OwnerMismatch)?;
        let arrival = state
            .utility
            .sequence
            .checked_add(1)
            .ok_or(UtilityFenceError::SequenceExhausted)?;
        state.utility.sequence = arrival;
        Ok(UtilityOwnerMarker {
            registry: Arc::downgrade(&self.0),
            owner_generation: state.utility.owner_generation,
            owner,
            arrival,
        })
    }
    pub fn lease_utility(
        &self,
        marker: &UtilityOwnerMarker,
        guard: &UtilityGuard,
        kind: UtilityKind,
    ) -> Result<UtilityLease, UtilityFenceError> {
        if !Weak::ptr_eq(&marker.registry, &Arc::downgrade(&self.0)) {
            return Err(UtilityFenceError::OwnerMismatch);
        }
        let mut state = self.0.lock().map_err(|_| UtilityFenceError::Poisoned)?;
        if marker.owner_generation != state.utility.owner_generation {
            return Err(UtilityFenceError::Stale);
        }
        if marker.arrival < state.utility.admission_floor {
            return Err(UtilityFenceError::Stale);
        }
        if marker.owner.0 != guard.owner_scope()
            || marker.owner.1 != guard.owner_epoch()
            || state.expected_owner.as_ref() != Some(&marker.owner)
        {
            return Err(UtilityFenceError::OwnerMismatch);
        }
        let (source_generation, facts) = if let Some(identity) = guard.snapshot() {
            if !state.snapshot.as_ref().is_some_and(|snapshot| {
                snapshot.identity() == identity
                    && identity.snapshot_revision() >= state.minimum_revision
            }) {
                return Err(UtilityFenceError::MissingSnapshot);
            }
            (
                Some(state.generation),
                Some(Arc::clone(
                    state
                        .facts
                        .as_ref()
                        .ok_or(UtilityFenceError::MissingSnapshot)?,
                )),
            )
        } else {
            (None, None)
        };
        if let Some(channel) = state.utility.channels.get(guard.request_id())
            && guard.draft_revision() < channel.draft_revision
        {
            return Err(UtilityFenceError::StaleDraft);
        }
        if state
            .utility
            .channels
            .get(guard.request_id())
            .and_then(|channel| channel.writers.get(&kind))
            .is_some_and(|writer| writer.arrival > marker.arrival)
        {
            return Err(UtilityFenceError::Stale);
        }
        let token = state
            .utility
            .sequence
            .checked_add(1)
            .ok_or(UtilityFenceError::SequenceExhausted)?;
        if !state.utility.channels.contains_key(guard.request_id())
            && state.utility.channels.len() >= MAX_UTILITY_CHANNELS
        {
            let evict = state
                .utility
                .channels
                .iter()
                .filter(|(_, channel)| channel.writers.values().all(|writer| !writer.active))
                .min_by_key(|(_, channel)| channel.last)
                .map(|(key, _)| key.clone())
                .ok_or(UtilityFenceError::Capacity)?;
            state.utility.channels.remove(&evict);
            // Only metadata is evicted. Any parse that arrived before this
            // forgetting boundary must not resurrect an older draft channel.
            state.utility.admission_floor = token;
        }
        state.utility.sequence = token;
        let channel = state
            .utility
            .channels
            .entry(guard.request_id().to_owned())
            .or_insert_with(|| Channel {
                draft_revision: guard.draft_revision(),
                last: token,
                writers: BTreeMap::new(),
            });
        if channel.draft_revision < guard.draft_revision() {
            channel.writers.clear();
            channel.draft_revision = guard.draft_revision();
        }
        channel.last = token;
        channel.writers.insert(
            kind,
            UtilityWriter {
                token,
                arrival: marker.arrival,
                active: true,
            },
        );
        Ok(UtilityLease {
            registry: Arc::downgrade(&self.0),
            owner_generation: state.utility.owner_generation,
            source_generation,
            guard: guard.clone(),
            kind,
            token,
            facts,
        })
    }
}
