//! An independent tagged source slot under the existing owner-reset witness.
//! No financial snapshot, generation or writer is changed by calendar work.
use super::{CalendarClock, CalendarClockIdentity, CalendarRowIdentity, CalendarRows};
use crate::contract::{CanonicalHashWriter, CanonicalValueRef, DataPresence};
use crate::{
    contract::{MAX_SAFE_REVISION, OwnerIdentity, SourceState},
    runtime::{
        RegistryError, SnapshotRegistry, State, report::ReportIssue,
        utility_lease::UtilityOwnerMarker,
    },
};
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex, Weak};
#[derive(Default)]
pub(in crate::runtime) struct CalendarSlot {
    row_generation: u64,
    clock_generation: u64,
    row_minimum: u64,
    clock_minimum: u64,
    rows: Option<Arc<RowOwner>>,
    clock: Option<Arc<ClockOwner>>,
    last_row: Option<CalendarRowIdentity>,
    last_clock: Option<CalendarClockIdentity>,
    last_clock_input: Option<String>,
    retired: Option<RetiredCalendar>,
}
pub(in crate::runtime) type RetiredCalendar = (Option<Arc<RowOwner>>, Option<Arc<ClockOwner>>);
impl std::fmt::Debug for CalendarSlot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CalendarSlot")
            .field("row_generation", &self.row_generation)
            .field("clock_generation", &self.clock_generation)
            .field("has_rows", &self.rows.is_some())
            .field("has_clock", &self.clock.is_some())
            .finish()
    }
}
impl CalendarSlot {
    pub(in crate::runtime) fn retire_owner(&mut self) {
        if self.rows.is_some() || self.clock.is_some() {
            debug_assert!(self.retired.is_none());
            self.retired = Some((self.rows.take(), self.clock.take()));
        }
        self.last_row = None;
        self.last_clock = None;
        self.last_clock_input = None;
        self.row_minimum = 0;
        self.clock_minimum = 0;
    }
    pub(in crate::runtime) fn take_retired(&mut self) -> Option<RetiredCalendar> {
        self.retired.take()
    }
}
pub(in crate::runtime) struct RowOwner {
    identity: CalendarRowIdentity,
    generation: u64,
    rows: Result<Arc<CalendarRows>, ReportIssue>,
}
pub(in crate::runtime) struct ClockOwner {
    identity: CalendarClockIdentity,
    generation: u64,
    clock: Arc<CalendarClock>,
}
#[derive(Clone)]
struct Marker {
    registry: Weak<Mutex<State>>,
    owner: UtilityOwnerMarker,
    identity: OwnerIdentity,
    generation: u64,
    started: bool,
}
#[derive(Clone)]
pub struct CalendarRowsMarker(Marker);
#[derive(Clone)]
pub struct CalendarClockMarker(Marker);
impl CalendarRowsMarker {
    pub fn owner(&self) -> &OwnerIdentity {
        &self.0.identity
    }
    pub fn is_current(&self) -> Result<bool, RegistryError> {
        let Some(state) = self.0.registry.upgrade() else {
            return Ok(false);
        };
        let registry = SnapshotRegistry(state.clone());
        let state = state.lock().map_err(|_| RegistryError::Poisoned)?;
        Ok(self
            .0
            .current(&registry, &state, state.calendar.row_generation))
    }
}
impl CalendarClockMarker {
    pub fn owner(&self) -> &OwnerIdentity {
        &self.0.identity
    }
    pub fn is_current(&self) -> Result<bool, RegistryError> {
        let Some(state) = self.0.registry.upgrade() else {
            return Ok(false);
        };
        let registry = SnapshotRegistry(state.clone());
        let state = state.lock().map_err(|_| RegistryError::Poisoned)?;
        Ok(self
            .0
            .current(&registry, &state, state.calendar.clock_generation))
    }
}
impl Marker {
    fn current(&self, registry: &SnapshotRegistry, state: &State, generation: u64) -> bool {
        Weak::ptr_eq(&self.registry, &Arc::downgrade(&registry.0))
            && self.owner.current_owner(state)
            && self.generation == generation
    }
}
pub struct CalendarRowsLease {
    marker: Marker,
    owner: Arc<RowOwner>,
}
pub struct CalendarClockLease {
    marker: Marker,
    owner: Arc<ClockOwner>,
}
impl CalendarRowsLease {
    pub fn identity(&self) -> &CalendarRowIdentity {
        &self.owner.identity
    }
    pub fn rows(&self) -> Result<&Arc<CalendarRows>, &ReportIssue> {
        self.owner.rows.as_ref()
    }
    pub fn is_current(&self) -> Result<bool, RegistryError> {
        let Some(state) = self.marker.registry.upgrade() else {
            return Ok(false);
        };
        let registry = SnapshotRegistry(state.clone());
        let state = state.lock().map_err(|_| RegistryError::Poisoned)?;
        Ok(self
            .marker
            .current(&registry, &state, state.calendar.row_generation)
            && state.calendar.rows.as_ref().is_some_and(|o| {
                Arc::ptr_eq(o, &self.owner) && o.generation == state.calendar.row_generation
            }))
    }
}
impl CalendarClockLease {
    pub(in crate::runtime) fn shares_owner(
        &self,
        marker: &crate::runtime::utility_lease::UtilityOwnerMarker,
    ) -> bool {
        marker.shares_registry_owner(
            &self.marker.registry,
            self.identity().owner_scope(),
            self.identity().owner_epoch(),
        )
    }
    pub fn identity(&self) -> &CalendarClockIdentity {
        &self.owner.identity
    }
    pub fn clock(&self) -> &Arc<CalendarClock> {
        &self.owner.clock
    }
    pub fn is_current(&self) -> Result<bool, RegistryError> {
        let Some(state) = self.marker.registry.upgrade() else {
            return Ok(false);
        };
        let registry = SnapshotRegistry(state.clone());
        let state = state.lock().map_err(|_| RegistryError::Poisoned)?;
        Ok(self
            .marker
            .current(&registry, &state, state.calendar.clock_generation)
            && state.calendar.clock.as_ref().is_some_and(|o| {
                Arc::ptr_eq(o, &self.owner) && o.generation == state.calendar.clock_generation
            }))
    }
    pub fn is_fresh_at(&self, epoch: i64) -> Result<bool, RegistryError> {
        Ok(self.is_current()? && self.owner.clock.is_valid_at(epoch))
    }
}
impl SnapshotRegistry {
    fn calendar_entry(&self, clock: bool) -> Result<Marker, RegistryError> {
        let owner = self
            .utility_owner_marker()
            .map_err(|_| RegistryError::OwnerMismatch)?;
        let state = self.0.lock().map_err(|_| RegistryError::Poisoned)?;
        if !owner.current_owner(&state) {
            return Err(RegistryError::OwnerMismatch);
        }
        let (scope, epoch) = state
            .expected_owner
            .as_ref()
            .ok_or(RegistryError::OwnerMismatch)?;
        Ok(Marker {
            registry: Arc::downgrade(&self.0),
            owner,
            identity: OwnerIdentity::new(scope, *epoch)
                .map_err(|_| RegistryError::OwnerMismatch)?,
            generation: if clock {
                state.calendar.clock_generation
            } else {
                state.calendar.row_generation
            },
            started: false,
        })
    }
    pub fn calendar_rows_marker(&self) -> Result<CalendarRowsMarker, RegistryError> {
        self.calendar_entry(false).map(CalendarRowsMarker)
    }
    pub fn calendar_clock_marker(&self) -> Result<CalendarClockMarker, RegistryError> {
        self.calendar_entry(true).map(CalendarClockMarker)
    }
    pub fn start_calendar_rows(
        &self,
        entry: &CalendarRowsMarker,
        revision: u64,
    ) -> Result<CalendarRowsMarker, RegistryError> {
        if revision > MAX_SAFE_REVISION {
            return Err(RegistryError::IdentityConflict);
        }
        let mut state = self.0.lock().map_err(|_| RegistryError::Poisoned)?;
        if !entry.0.current(self, &state, state.calendar.row_generation) {
            return Err(RegistryError::StaleSnapshot);
        }
        if revision < state.calendar.row_minimum {
            return Err(RegistryError::StaleSnapshot);
        }
        let next = state
            .calendar
            .row_generation
            .checked_add(1)
            .ok_or(RegistryError::SequenceExhausted)?;
        state.calendar.row_generation = next;
        state.calendar.row_minimum = revision;
        let mut marker = entry.0.clone();
        marker.generation = next;
        marker.started = true;
        Ok(CalendarRowsMarker(marker))
    }
    pub fn start_calendar_clock(
        &self,
        entry: &CalendarClockMarker,
        revision: u64,
    ) -> Result<CalendarClockMarker, RegistryError> {
        if revision > MAX_SAFE_REVISION {
            return Err(RegistryError::IdentityConflict);
        }
        let mut state = self.0.lock().map_err(|_| RegistryError::Poisoned)?;
        if !entry
            .0
            .current(self, &state, state.calendar.clock_generation)
        {
            return Err(RegistryError::StaleSnapshot);
        }
        if revision < state.calendar.clock_minimum {
            return Err(RegistryError::StaleSnapshot);
        }
        let next = state
            .calendar
            .clock_generation
            .checked_add(1)
            .ok_or(RegistryError::SequenceExhausted)?;
        state.calendar.clock_generation = next;
        state.calendar.clock_minimum = revision;
        let mut marker = entry.0.clone();
        marker.generation = next;
        marker.started = true;
        Ok(CalendarClockMarker(marker))
    }
    /// Tiny control operation. Inaccessible source owners remain retained for
    /// worker collection/replacement; no large source is destroyed here.
    pub fn cancel_calendar_rows(&self, marker: &CalendarRowsMarker) -> Result<bool, RegistryError> {
        let mut state = self.0.lock().map_err(|_| RegistryError::Poisoned)?;
        if !marker.0.started
            || !marker
                .0
                .current(self, &state, state.calendar.row_generation)
        {
            return Ok(false);
        }
        state.calendar.row_generation = state
            .calendar
            .row_generation
            .checked_add(1)
            .ok_or(RegistryError::SequenceExhausted)?;
        Ok(true)
    }
    pub fn cancel_calendar_clock(
        &self,
        marker: &CalendarClockMarker,
    ) -> Result<bool, RegistryError> {
        let mut state = self.0.lock().map_err(|_| RegistryError::Poisoned)?;
        if !marker.0.started
            || !marker
                .0
                .current(self, &state, state.calendar.clock_generation)
        {
            return Ok(false);
        }
        state.calendar.clock_generation = state
            .calendar
            .clock_generation
            .checked_add(1)
            .ok_or(RegistryError::SequenceExhausted)?;
        Ok(true)
    }
    pub fn register_calendar_rows(
        &self,
        marker: &CalendarRowsMarker,
        revision: u64,
        source: &SourceState,
    ) -> Result<CalendarRowIdentity, RegistryError> {
        self.register_calendar_rows_observed(marker, revision, source, || {})
    }
    fn check_calendar_rows(
        &self,
        marker: &CalendarRowsMarker,
        revision: u64,
    ) -> Result<(), RegistryError> {
        let state = self.0.lock().map_err(|_| RegistryError::Poisoned)?;
        if !marker.0.started
            || !marker
                .0
                .current(self, &state, state.calendar.row_generation)
            || revision != state.calendar.row_minimum
        {
            return Err(RegistryError::StaleSnapshot);
        }
        Ok(())
    }
    fn register_calendar_rows_observed(
        &self,
        marker: &CalendarRowsMarker,
        revision: u64,
        source: &SourceState,
        before_commit: impl FnOnce(),
    ) -> Result<CalendarRowIdentity, RegistryError> {
        self.check_calendar_rows(marker, revision)?;
        self.collect_retired()?;
        // Native mapper/index and hashing run outside the lifecycle mutex.
        let mut rows = CalendarRows::prepare(source).map(Arc::new);
        let digest = match &rows {
            Ok(rows) => rows.key().to_owned(),
            Err(_) => failed_source_digest(source)?,
        };
        let identity = CalendarRowIdentity::new(&marker.0.identity, revision, &digest)
            .map_err(|_| RegistryError::IdentityConflict)?;
        before_commit();
        let mut state = self.0.lock().map_err(|_| RegistryError::Poisoned)?;
        if !marker.0.started
            || !marker
                .0
                .current(self, &state, state.calendar.row_generation)
            || revision != state.calendar.row_minimum
        {
            return Err(RegistryError::StaleSnapshot);
        }
        if rows.is_ok()
            && state.calendar.last_row.as_ref().is_some_and(|old| {
                old.source_revision() > revision
                    || (old.source_revision() == revision && old != &identity)
            })
        {
            return Err(RegistryError::IdentityConflict);
        }
        let mut discarded_rows = None;
        if let Some(previous) = &state.calendar.rows
            && previous.identity.digest() == identity.digest()
            && let Ok(checked) = &previous.rows
        {
            discarded_rows = Some(std::mem::replace(&mut rows, Ok(checked.clone())));
        }
        let next = Arc::new(RowOwner {
            identity: identity.clone(),
            generation: marker.0.generation,
            rows,
        });
        if next.rows.is_ok() {
            state.calendar.last_row = Some(identity.clone());
        }
        let old = state.calendar.rows.replace(next);
        drop(state);
        drop(old);
        drop(discarded_rows);
        Ok(identity)
    }
    pub fn register_calendar_clock(
        &self,
        marker: &CalendarClockMarker,
        revision: u64,
        profile: &SourceState,
        history: &SourceState,
        epoch: i64,
    ) -> Result<CalendarClockIdentity, RegistryError> {
        self.register_calendar_clock_observed(marker, revision, profile, history, epoch, || {})
    }
    fn register_calendar_clock_observed(
        &self,
        marker: &CalendarClockMarker,
        revision: u64,
        profile: &SourceState,
        history: &SourceState,
        epoch: i64,
        before_commit: impl FnOnce(),
    ) -> Result<CalendarClockIdentity, RegistryError> {
        {
            let state = self.0.lock().map_err(|_| RegistryError::Poisoned)?;
            if !marker.0.started
                || !marker
                    .0
                    .current(self, &state, state.calendar.clock_generation)
                || revision != state.calendar.clock_minimum
            {
                return Err(RegistryError::StaleSnapshot);
            }
        }
        self.collect_retired()?;
        let clock = Arc::new(
            CalendarClock::prepare(marker.0.identity.scope(), profile, history, epoch)
                .map_err(|_| RegistryError::IdentityConflict)?,
        );
        let identity = CalendarClockIdentity::new(&marker.0.identity, revision, clock.key())
            .map_err(|_| RegistryError::IdentityConflict)?;
        let history_unused = matches!(profile,SourceState::Ready{coverage:crate::contract::Coverage::AllHistory,payload,..} if matches!(payload.data(),DataPresence::Null));
        let input_digest = format!(
            "{}:{}",
            failed_source_digest(profile)?,
            if history_unused {
                "HISTORY_UNUSED".into()
            } else {
                failed_source_digest(history)?
            }
        );
        before_commit();
        let mut state = self.0.lock().map_err(|_| RegistryError::Poisoned)?;
        if !marker.0.started
            || !marker
                .0
                .current(self, &state, state.calendar.clock_generation)
            || revision != state.calendar.clock_minimum
        {
            return Err(RegistryError::StaleSnapshot);
        }
        if clock.metadata().cacheable
            && state.calendar.last_clock.as_ref().is_some_and(|old| {
                old.source_revision() > revision
                    || (old.source_revision() == revision
                        && state.calendar.last_clock_input.as_ref() != Some(&input_digest))
            })
        {
            return Err(RegistryError::IdentityConflict);
        }
        let next = Arc::new(ClockOwner {
            identity: identity.clone(),
            generation: marker.0.generation,
            clock,
        });
        if next.clock.metadata().cacheable {
            state.calendar.last_clock = Some(identity.clone());
            state.calendar.last_clock_input = Some(input_digest);
        }
        let old = state.calendar.clock.replace(next);
        drop(state);
        drop(old);
        Ok(identity)
    }
    pub fn lease_calendar_rows(
        &self,
        marker: &CalendarRowsMarker,
        identity: &CalendarRowIdentity,
    ) -> Result<CalendarRowsLease, RegistryError> {
        identity
            .validate()
            .map_err(|_| RegistryError::IdentityConflict)?;
        let state = self.0.lock().map_err(|_| RegistryError::Poisoned)?;
        if !marker
            .0
            .current(self, &state, state.calendar.row_generation)
        {
            return Err(RegistryError::StaleSnapshot);
        }
        let owner = state
            .calendar
            .rows
            .as_ref()
            .filter(|o| &o.identity == identity && o.generation == state.calendar.row_generation)
            .ok_or(RegistryError::MissingSnapshot)?
            .clone();
        Ok(CalendarRowsLease {
            marker: marker.0.clone(),
            owner,
        })
    }
    pub fn lease_calendar_clock(
        &self,
        marker: &CalendarClockMarker,
        identity: &CalendarClockIdentity,
    ) -> Result<CalendarClockLease, RegistryError> {
        identity
            .validate()
            .map_err(|_| RegistryError::IdentityConflict)?;
        let state = self.0.lock().map_err(|_| RegistryError::Poisoned)?;
        if !marker
            .0
            .current(self, &state, state.calendar.clock_generation)
        {
            return Err(RegistryError::StaleSnapshot);
        }
        let owner = state
            .calendar
            .clock
            .as_ref()
            .filter(|o| &o.identity == identity && o.generation == state.calendar.clock_generation)
            .ok_or(RegistryError::MissingSnapshot)?
            .clone();
        Ok(CalendarClockLease {
            marker: marker.0.clone(),
            owner,
        })
    }
}

fn failed_source_digest(state: &SourceState) -> Result<String, RegistryError> {
    let mut hash = Sha256::new();
    hash.update(b"luna-calendar-only-unavailable-source-v1\0");
    hash.update(crate::ENGINE_VERSION.as_bytes());
    hash.update(b"\0");
    let invalid = || RegistryError::IdentityConflict;
    match state {
        SourceState::Ready {
            coverage, payload, ..
        } => {
            hash.update(b"READY\0");
            serde_json::to_writer(CanonicalHashWriter(&mut hash), coverage)
                .map_err(|_| invalid())?;
            match payload.data() {
                DataPresence::Missing => hash.update(b"MISSING\0"),
                DataPresence::Null => hash.update(b"NULL\0"),
                DataPresence::Value { value } => {
                    hash.update(b"VALUE\0");
                    serde_json::to_writer(
                        CanonicalHashWriter(&mut hash),
                        &CanonicalValueRef(value),
                    )
                    .map_err(|_| invalid())?;
                }
            }
        }
        _ => serde_json::to_writer(CanonicalHashWriter(&mut hash), state).map_err(|_| invalid())?,
    }
    Ok(format!("{:x}", hash.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn setup() -> SnapshotRegistry {
        let r = SnapshotRegistry::default();
        r.reset_for_owner(&OwnerIdentity::new("calendar-owner", 1).unwrap())
            .unwrap();
        r
    }
    #[test]
    fn reset_or_newer_begin_during_native_rows_work_cannot_register_stale_sources() {
        for same_epoch_reset in [false, true] {
            let r = setup();
            let marker = r
                .start_calendar_rows(&r.calendar_rows_marker().unwrap(), 1)
                .unwrap();
            let result =
                r.register_calendar_rows_observed(&marker, 1, &SourceState::Loading, || {
                    if same_epoch_reset {
                        r.reset_for_owner(&OwnerIdentity::new("calendar-owner", 1).unwrap())
                            .unwrap();
                    } else {
                        r.start_calendar_rows(&r.calendar_rows_marker().unwrap(), 2)
                            .unwrap();
                    }
                });
            assert!(matches!(result, Err(RegistryError::StaleSnapshot)));
        }
    }
    #[test]
    fn reset_or_newer_clock_begin_during_clock_selection_cannot_publish_old_metadata() {
        let null:SourceState=serde_json::from_value(serde_json::json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"NULL"}}})).unwrap();
        for same_epoch_reset in [false, true] {
            let r = setup();
            let marker = r
                .start_calendar_clock(&r.calendar_clock_marker().unwrap(), 1)
                .unwrap();
            let result = r.register_calendar_clock_observed(
                &marker,
                1,
                &null,
                &SourceState::NotRequested,
                1794480000000,
                || {
                    if same_epoch_reset {
                        r.reset_for_owner(&OwnerIdentity::new("calendar-owner", 1).unwrap())
                            .unwrap();
                    } else {
                        r.start_calendar_clock(&r.calendar_clock_marker().unwrap(), 2)
                            .unwrap();
                    }
                },
            );
            assert!(matches!(result, Err(RegistryError::StaleSnapshot)));
        }
    }
}
