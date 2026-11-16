use super::{
    lease::{LoadedReadSource, ReadWitness, RetainedEntries},
    quota::{Quota, RAW_SOURCE_CEILING, SourceCharge},
    types::*,
};
use crate::{
    calendar::loaded_scope::{CalendarLoadRange, CalendarLoadedScope, ScopeLoadStart},
    runtime::{SnapshotRegistry, utility_lease::UtilityOwnerMarker},
};
use std::collections::BTreeSet;
use std::sync::{
    Arc, Mutex, Weak,
    atomic::{AtomicBool, AtomicU8, AtomicU64, Ordering},
};
pub struct CalendarLoadedPool {
    pub(super) registry: SnapshotRegistry,
    pub(super) identity: Arc<()>,
    state: Mutex<Option<OwnerState>>,
    operation: AtomicBool,
    pub(super) raw: Arc<AtomicBool>,
    pub(super) quota: Quota,
}
pub(super) struct OwnerState {
    pub owner: UtilityOwnerMarker,
    pub scope: CalendarLoadedScope,
    pub token: String,
    pub published_token: Option<String>,
    pub locale_key: Option<String>,
    pub revision: Arc<AtomicU64>,
    pub charges: Vec<Arc<SourceCharge>>,
    pub pending: BTreeSet<u64>,
}
struct Operation<'a>(&'a AtomicBool);
impl Drop for Operation<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
impl OwnerState {
    pub fn bump(&self) -> Result<(), LoadedPoolError> {
        self.revision
            .try_update(Ordering::AcqRel, Ordering::Acquire, |revision| {
                (revision < crate::contract::MAX_SAFE_REVISION).then_some(revision + 1)
            })
            .map_err(|_| LoadedPoolError::Capacity)?;
        Ok(())
    }
    fn token(&mut self, token: &str) -> Result<(), LoadedPoolError> {
        if self.token != token {
            self.bump()?;
            self.scope.unmount()?;
            self.discard_stale()?;
            self.token = token.to_owned();
        }
        Ok(())
    }
    fn discard_stale(&mut self) -> Result<(), LoadedPoolError> {
        let obsolete = self
            .pending
            .iter()
            .copied()
            .filter(|load| *load != self.scope.generation())
            .collect::<Vec<_>>();
        for load in obsolete {
            self.scope.complete(
                load,
                Err(crate::calendar::loaded_scope::ScopeLoadFailure::Calendar),
                None,
                &crate::calendar::recurrence::CollationRanks::default(),
            )?;
            self.pending.remove(&load);
        }
        Ok(())
    }
}
fn source_token(token: &str) -> Result<(), LoadedPoolError> {
    if token.is_empty() || token.len() > 1024 {
        Err(LoadedPoolError::InvalidSourceToken)
    } else {
        Ok(())
    }
}
impl CalendarLoadedPool {
    pub fn new(registry: SnapshotRegistry) -> Self {
        Self {
            registry,
            identity: Arc::new(()),
            state: Mutex::new(None),
            operation: AtomicBool::new(false),
            raw: Arc::new(AtomicBool::new(false)),
            quota: Quota::default(),
        }
    }
    /// Policy work and large drops happen on the preparation worker. The mutex
    /// only moves the state owner; it never sorts or destroys its record trees.
    pub(super) fn run<R>(
        &self,
        f: impl FnOnce(&mut OwnerState) -> Result<R, LoadedPoolError>,
    ) -> Result<R, LoadedPoolError> {
        self.operation
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| LoadedPoolError::Busy)?;
        let _operation = Operation(&self.operation);
        let marker = self
            .registry
            .utility_owner_marker()
            .map_err(|_| LoadedPoolError::OwnerChanged)?;
        if !marker.is_current().map_err(|_| LoadedPoolError::Poisoned)? {
            return Err(LoadedPoolError::OwnerChanged);
        }
        let old = self
            .state
            .lock()
            .map_err(|_| LoadedPoolError::Poisoned)?
            .take();
        let mut state = match old {
            Some(state) if state.owner.shares_owner(&marker) => state,
            other => {
                drop(other);
                OwnerState {
                    owner: marker,
                    scope: CalendarLoadedScope::default(),
                    token: String::new(),
                    published_token: None,
                    locale_key: None,
                    revision: Arc::new(AtomicU64::new(0)),
                    charges: Vec::new(),
                    pending: BTreeSet::new(),
                }
            }
        };
        state.charges.retain(|source| source.raw.strong_count() > 0);
        let result = f(&mut state);
        if !state
            .owner
            .is_current()
            .map_err(|_| LoadedPoolError::Poisoned)?
        {
            drop(state);
            return Err(LoadedPoolError::OwnerChanged);
        }
        let replaced = self
            .state
            .lock()
            .map_err(|_| LoadedPoolError::Poisoned)?
            .replace(state);
        drop(replaced);
        result
    }
    pub(super) fn check_ticket(
        &self,
        state: &OwnerState,
        ticket: &CalendarLoadTicket,
    ) -> Result<(), LoadedPoolError> {
        if !Weak::ptr_eq(&ticket.pool, &Arc::downgrade(&self.identity))
            || !ticket.owner.shares_owner(&state.owner)
        {
            return Err(LoadedPoolError::ScopeMismatch);
        }
        if !ticket
            .owner
            .is_current()
            .map_err(|_| LoadedPoolError::Poisoned)?
        {
            return Err(LoadedPoolError::OwnerChanged);
        }
        if state.scope.generation() != ticket.load || state.token != ticket.source_token {
            return Err(LoadedPoolError::Stale);
        }
        if state.locale_key.as_deref() != Some(ticket.locale_key.as_str()) {
            return Err(LoadedPoolError::Stale);
        }
        Ok(())
    }
    fn start(
        &self,
        state: &mut OwnerState,
        start: ScopeLoadStart,
    ) -> Result<LoadedStart, LoadedPoolError> {
        match start {
            ScopeLoadStart::Unchanged => Ok(LoadedStart::Unchanged),
            ScopeLoadStart::Reused => {
                state.discard_stale()?;
                state.bump()?;
                Ok(LoadedStart::Reused)
            }
            ScopeLoadStart::Read {
                load,
                range,
                full_snapshot,
                background,
            } => {
                state.discard_stale()?;
                state.pending.insert(load);
                state.bump()?;
                Ok(LoadedStart::Read(CalendarLoadTicket {
                    owner: state.owner.clone(),
                    pool: Arc::downgrade(&self.identity),
                    source_token: state.token.clone(),
                    locale_key: state
                        .locale_key
                        .clone()
                        .ok_or(LoadedPoolError::LocaleUnavailable)?,
                    load,
                    full_snapshot,
                    background,
                    range,
                    stage: Arc::new(AtomicU8::new(0)),
                }))
            }
        }
    }
    pub fn active_month(
        &self,
        month: &str,
        epoch: i64,
        token: &str,
    ) -> Result<LoadedStart, LoadedPoolError> {
        source_token(token)?;
        CalendarLoadRange::for_month(month)?;
        self.run(|state| {
            if state.locale_key.is_none() {
                return Err(LoadedPoolError::LocaleUnavailable);
            }
            state.token(token)?;
            let start = state.scope.active_month(month, epoch)?;
            self.start(state, start)
        })
    }
    pub fn reload(
        &self,
        background: bool,
        epoch: i64,
        token: &str,
    ) -> Result<LoadedStart, LoadedPoolError> {
        source_token(token)?;
        self.run(|state| {
            if state.locale_key.is_none() {
                return Err(LoadedPoolError::LocaleUnavailable);
            }
            state.token(token)?;
            let start = state.scope.reload(background, epoch)?;
            self.start(state, start)
        })
    }
    pub fn source_changed(&self, token: &str) -> Result<(), LoadedPoolError> {
        source_token(token)?;
        self.run(|state| state.token(token))
    }
    /// Bind the platform probe identity before creating IO/candidate tickets.
    /// A different configuration fences every live read/rank draft and requires
    /// a fresh load; captured writes keep their original immutable ordering.
    pub fn bind_locale(&self, locale_key: &str) -> Result<(), LoadedPoolError> {
        if locale_key.is_empty() || locale_key.len() > 4096 {
            return Err(LoadedPoolError::LocaleUnavailable);
        }
        self.run(|state| {
            if state.locale_key.as_deref() != Some(locale_key) {
                state.scope.unmount()?;
                state.discard_stale()?;
                state.bump()?;
                state.published_token = None;
                state.locale_key = Some(locale_key.to_owned());
            }
            Ok(())
        })
    }
    pub(super) fn snapshot_for(&self, state: &OwnerState) -> LoadedSnapshot {
        let witness = ReadWitness {
            owner: state.owner.clone(),
            pool: Arc::downgrade(&self.identity),
            revision: state.revision.clone(),
            observed: state.revision.load(Ordering::Acquire),
        };
        let source = (state.published_token.as_deref() == Some(state.token.as_str())).then(|| {
            LoadedReadSource {
                data: Arc::new(RetainedEntries {
                    entries: state.scope.entries().clone(),
                    _charges: state.charges.clone(),
                }),
                witness: witness.clone(),
            }
        });
        LoadedSnapshot {
            status: state.scope.status(),
            source,
            witness,
        }
    }
    pub fn snapshot(&self) -> Result<LoadedSnapshot, LoadedPoolError> {
        self.run(|state| Ok(self.snapshot_for(state)))
    }
    pub fn unmount(&self) -> Result<(), LoadedPoolError> {
        self.run(|state| {
            state.scope.unmount()?;
            state.discard_stale()?;
            state.bump()
        })
    }
    pub fn abort_load(&self, ticket: &CalendarLoadTicket) -> Result<bool, LoadedPoolError> {
        self.run(|state| {
            if !Weak::ptr_eq(&ticket.pool, &Arc::downgrade(&self.identity))
                || !ticket.owner.shares_owner(&state.owner)
            {
                return Err(LoadedPoolError::ScopeMismatch);
            }
            if state.scope.generation() != ticket.load {
                return Ok(false);
            }
            state.scope.unmount()?;
            state.discard_stale()?;
            state.bump()?;
            Ok(true)
        })
    }
    pub fn collect_retired(&self) -> Result<(), LoadedPoolError> {
        self.operation
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| LoadedPoolError::Busy)?;
        let _operation = Operation(&self.operation);
        let state = self
            .state
            .lock()
            .map_err(|_| LoadedPoolError::Poisoned)?
            .take();
        if let Some(mut state) = state {
            if state
                .owner
                .is_current()
                .map_err(|_| LoadedPoolError::Poisoned)?
            {
                state.charges.retain(|source| source.raw.strong_count() > 0);
                let previous = self
                    .state
                    .lock()
                    .map_err(|_| LoadedPoolError::Poisoned)?
                    .replace(state);
                drop(previous);
            } else {
                drop(state);
            }
        }
        Ok(())
    }
    pub fn retained_raw_sources(&self) -> usize {
        self.quota.sources()
    }
    /// Conservative source-wire reservations, not a process RSS estimate.
    pub fn reserved_source_wire_bytes(&self) -> u64 {
        self.retained_raw_sources() as u64 * RAW_SOURCE_CEILING
    }
}
