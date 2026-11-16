//! Snapshot ownership and publication guards. No lock is held during calculation
//! or database work. A transport registration is not business-domain readiness.
pub mod assembly;
pub mod assessed_source;
pub mod calendar_loaded;
pub mod calendar_only;
pub mod calendar_selected;
pub mod calendar_source;
pub mod calendar_window;
pub mod catalog;
pub mod catalog_artifact;
pub mod catalog_source;
pub mod checks_source;
pub(crate) mod collation_ranks;
pub mod day_details_source;
pub mod day_editor_controller;
pub mod day_editor_review;
pub mod day_editor_source;
pub mod dispatch;
pub mod export_report;
pub mod facts;
pub mod financial_collation;
pub mod financial_facade;
pub mod financial_report;
pub mod financial_source;
pub mod form_resource;
pub mod incoming;
pub mod jobs;
pub mod payroll_form;
mod profile_clock;
pub(crate) use profile_clock::ProfileClockEnvironment;
pub mod profile_editor_draft;
pub mod profile_editor_flow;
pub mod profile_editor_presentation;
pub mod profile_editor_receipt;
pub mod profile_editor_source;
pub mod profile_form_facade;
pub(crate) mod profile_inputs;
pub mod report;
mod reuse;
pub mod sources;
pub mod target_ui;
pub mod template_editor_source;
pub mod template_save_sequence;
pub mod time_source;
pub mod time_ui;
pub mod utility;
pub mod utility_lease;
pub mod view_composition;
pub mod write_resource;
use crate::contract::{
    CalculationRequest, ImmutableSnapshot, OwnerIdentity, ReportPeriod, RevisionFence,
    SalaryPerspective, SnapshotIdentity,
};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex, Weak},
};
const MAX_ACTIVE_SLOTS: usize = 512;
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobLane {
    Finance,
    Checks,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RegistryError {
    Poisoned,
    OwnerMismatch,
    StaleSnapshot,
    IdentityConflict,
    MissingSnapshot,
    StaleRequest,
    DuplicateRequest,
    InvalidLane,
    FinancialProofRequired,
    InvalidFinancialProof,
    Capacity,
    SequenceExhausted,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Section {
    Time,
    Gross,
    Net,
    Checks,
    ChecksDetails,
    FinancialDetails,
    PayrollPage,
    PayrollPanel(crate::contract::PayrollPanel),
    Export,
}
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct Slot {
    section: Section,
    period: ReportPeriod,
    perspective: Option<SalaryPerspective>,
}
#[derive(Debug)]
struct Writer {
    token: u64,
    revision: u64,
    request_id: String,
    active: bool,
}
#[derive(Debug, Default)]
struct State {
    calendar: calendar_only::CalendarSlot,
    utility: utility_lease::UtilityRegistryState,
    financial_reuse: Arc<reuse::FinancialReuseCaches>,
    snapshot: Option<ImmutableSnapshot>,
    facts: Option<Arc<facts::SnapshotFacts>>,
    retired: Option<RetiredInputs>,
    generation: u64,
    sequence: u64,
    writers: BTreeMap<Slot, Writer>,
    expected_owner: Option<(String, u64)>,
    initialized: bool,
    latest_identity: Option<SnapshotIdentity>,
    minimum_revision: u64,
}
type RetiredInputs = (Option<ImmutableSnapshot>, Option<Arc<facts::SnapshotFacts>>);
impl State {
    fn retire_inputs(&mut self) {
        if self.snapshot.is_some() || self.facts.is_some() {
            // A successful registration drains the previous retired owner
            // before exposing a new active one. Repeated reset is O(1).
            debug_assert!(self.retired.is_none());
            self.retired = Some((self.snapshot.take(), self.facts.take()));
        }
    }
}
#[derive(Debug, Clone, Default)]
pub struct SnapshotRegistry(Arc<Mutex<State>>);
/// Captured before worker-side parsing. No source owner is retained, and even
/// a reset to the same owner/epoch invalidates this preparation generation.
#[derive(Clone)]
pub struct PreparationMarker {
    registry: Weak<Mutex<State>>,
    generation: u64,
}
impl PreparationMarker {
    pub fn is_current(&self) -> Result<bool, RegistryError> {
        let Some(registry) = self.registry.upgrade() else {
            return Ok(false);
        };
        let state = registry.lock().map_err(|_| RegistryError::Poisoned)?;
        Ok(state.generation == self.generation)
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RegistryStats {
    pub writer_slots: usize,
    pub active_writer_slots: usize,
}

/// A waiting job reserves publication order without retaining old source trees.
#[derive(Debug)]
pub struct CalculationReservation {
    registry: Weak<Mutex<State>>,
    generation: u64,
    token: u64,
    lane: JobLane,
    request: CalculationRequest,
    slots: Vec<Slot>,
    financial_details: Option<Arc<financial_collation::FinancialAdmissionProof>>,
}
impl CalculationReservation {
    pub fn request(&self) -> &CalculationRequest {
        &self.request
    }
    pub fn lane(&self) -> JobLane {
        self.lane
    }
}
/// Constructed only by this registry when a worker actually begins reading.
#[derive(Debug)]
pub struct CalculationLease {
    reservation: CalculationReservation,
    snapshot: ImmutableSnapshot,
    facts: Arc<facts::SnapshotFacts>,
}
impl CalculationLease {
    pub fn facts(&self) -> &Arc<facts::SnapshotFacts> {
        &self.facts
    }
    pub fn snapshot(&self) -> &ImmutableSnapshot {
        &self.snapshot
    }
    pub fn request(&self) -> &CalculationRequest {
        self.reservation.request()
    }
    pub fn lane(&self) -> JobLane {
        self.reservation.lane()
    }
    pub fn financial_details(&self) -> Option<&Arc<financial_collation::FinancialAdmissionProof>> {
        self.reservation.financial_details.as_ref()
    }
}
impl Drop for CalculationReservation {
    fn drop(&mut self) {
        if let Some(registry) = self.registry.upgrade()
            && let Ok(mut state) = registry.lock()
        {
            for slot in &self.slots {
                if state
                    .writers
                    .get(slot)
                    .is_some_and(|w| w.token == self.token)
                {
                    state.writers.get_mut(slot).unwrap().active = false;
                }
            }
        }
    }
}
/// Grants one publication attempt for the complete request identity. The app
/// must still recheck current DB ownership inside its final write transaction.
#[derive(Debug)]
pub struct PublicationPermit {
    request: CalculationRequest,
    lane: JobLane,
    financial_details: Option<Arc<financial_collation::FinancialAdmissionProof>>,
}
impl PublicationPermit {
    pub fn financial_details(&self) -> Option<&Arc<financial_collation::FinancialAdmissionProof>> {
        self.financial_details.as_ref()
    }
    pub fn request(&self) -> &CalculationRequest {
        &self.request
    }
    pub fn lane(&self) -> JobLane {
        self.lane
    }
}
fn slots(request: &CalculationRequest, lane: JobLane) -> Result<Vec<Slot>, RegistryError> {
    if lane == JobLane::Finance && request.checks_details().is_some() {
        return Err(RegistryError::InvalidLane);
    }
    if lane == JobLane::Checks
        && (request.financial_details().is_some()
            || request.payroll_page()
            || request.payroll_panel().is_some()
            || request.export_report().is_some())
    {
        return Err(RegistryError::InvalidLane);
    }
    let selected = request.sections();
    let mut sections = vec![];
    match lane {
        JobLane::Finance => {
            if request.export_report().is_some() {
                sections.push(Section::Export);
            }
            if request.payroll_page() {
                sections.push(Section::PayrollPage);
            }
            if let Some(panel) = request.payroll_panel() {
                sections.push(Section::PayrollPanel(panel));
            }
            if request.financial_details().is_some() {
                sections.push(Section::FinancialDetails);
            }
            if selected.time() {
                sections.push(Section::Time);
            }
            if selected.gross() {
                sections.push(Section::Gross);
            }
            if selected.net() {
                sections.push(Section::Net);
            }
        }
        JobLane::Checks => {
            if request.checks_details().is_some() {
                sections.push(Section::ChecksDetails);
            }
            if selected.checks() {
                sections.push(Section::Checks);
            }
        }
    }
    if sections.is_empty() {
        return Err(RegistryError::InvalidLane);
    }
    Ok(request
        .periods()
        .iter()
        .flat_map(|period| {
            sections.iter().map(move |section| Slot {
                section: *section,
                period: period.clone(),
                perspective: matches!(
                    section,
                    Section::Gross
                        | Section::Net
                        | Section::FinancialDetails
                        | Section::PayrollPage
                        | Section::PayrollPanel(_)
                )
                .then(|| request.perspective()),
            })
        })
        .collect())
}
impl SnapshotRegistry {
    pub fn preparation_marker(&self) -> Result<PreparationMarker, RegistryError> {
        let state = self.0.lock().map_err(|_| RegistryError::Poisoned)?;
        Ok(PreparationMarker {
            registry: Arc::downgrade(&self.0),
            generation: state.generation,
        })
    }
    /// Atomically supersede older preparations, including an equal owner/fence.
    /// No source owner, parser, or destructor runs under this lifecycle lock.
    pub fn start_preparation(
        &self,
        entry: &PreparationMarker,
        fence: &RevisionFence,
    ) -> Result<PreparationMarker, RegistryError> {
        if !Weak::ptr_eq(&entry.registry, &Arc::downgrade(&self.0)) {
            return Err(RegistryError::OwnerMismatch);
        }
        let mut state = self.0.lock().map_err(|_| RegistryError::Poisoned)?;
        if state.generation != entry.generation {
            return Err(RegistryError::StaleSnapshot);
        }
        if !state.expected_owner.as_ref().is_some_and(|(scope, epoch)| {
            scope == fence.owner().scope() && *epoch == fence.owner().epoch()
        }) {
            return Err(RegistryError::OwnerMismatch);
        }
        let minimum = state.minimum_revision.max(
            state
                .latest_identity
                .as_ref()
                .map_or(0, SnapshotIdentity::snapshot_revision),
        );
        if fence.snapshot_revision() < minimum {
            return Err(RegistryError::StaleSnapshot);
        }
        state.generation = state
            .generation
            .checked_add(1)
            .ok_or(RegistryError::SequenceExhausted)?;
        state.minimum_revision = fence.snapshot_revision();
        state.writers.clear();
        Ok(PreparationMarker {
            registry: Arc::downgrade(&self.0),
            generation: state.generation,
        })
    }
    /// Cancel only this exact preparation. An old abort cannot affect a new one.
    pub fn cancel_preparation(&self, marker: &PreparationMarker) -> Result<bool, RegistryError> {
        if !Weak::ptr_eq(&marker.registry, &Arc::downgrade(&self.0)) {
            return Err(RegistryError::OwnerMismatch);
        }
        let mut state = self.0.lock().map_err(|_| RegistryError::Poisoned)?;
        if state.generation != marker.generation {
            return Ok(false);
        }
        state.generation = state
            .generation
            .checked_add(1)
            .ok_or(RegistryError::SequenceExhausted)?;
        state.writers.clear();
        Ok(true)
    }
    /// Called immediately after a source change, before async data loading.
    /// Old results and delayed old registrations are blocked during that gap.
    /// Only bounded bookkeeping runs under this mutex; no source is parsed.
    pub fn advance_revision(&self, fence: &RevisionFence) -> Result<bool, RegistryError> {
        let mut state = self.0.lock().map_err(|_| RegistryError::Poisoned)?;
        if !state.expected_owner.as_ref().is_some_and(|(scope, epoch)| {
            scope == fence.owner().scope() && *epoch == fence.owner().epoch()
        }) {
            return Err(RegistryError::OwnerMismatch);
        }
        let latest = state
            .latest_identity
            .as_ref()
            .map_or(0, |i| i.snapshot_revision())
            .max(state.minimum_revision);
        if fence.snapshot_revision() < latest {
            return Err(RegistryError::StaleSnapshot);
        }
        if fence.snapshot_revision() == latest {
            state.minimum_revision = fence.snapshot_revision();
            return Ok(false);
        }
        let generation = state
            .generation
            .checked_add(1)
            .ok_or(RegistryError::SequenceExhausted)?;
        state.minimum_revision = fence.snapshot_revision();
        state.generation = generation;
        state.writers.clear();
        Ok(true)
    }
    pub fn snapshot(
        &self,
        identity: &SnapshotIdentity,
    ) -> Result<ImmutableSnapshot, RegistryError> {
        let state = self.0.lock().map_err(|_| RegistryError::Poisoned)?;
        state
            .snapshot
            .as_ref()
            .filter(|snapshot| {
                snapshot.identity() == identity
                    && identity.snapshot_revision() >= state.minimum_revision
            })
            .cloned()
            .ok_or(RegistryError::MissingSnapshot)
    }
    /// Idempotent registration shares the already retained snapshot. A newer
    /// revision invalidates all older writers before any new calculation starts.
    pub fn register(
        &self,
        snapshot: ImmutableSnapshot,
    ) -> Result<ImmutableSnapshot, RegistryError> {
        self.register_inner(snapshot, None, None, None)
    }
    pub fn register_prepared(
        &self,
        marker: &PreparationMarker,
        snapshot: ImmutableSnapshot,
    ) -> Result<ImmutableSnapshot, RegistryError> {
        if !Weak::ptr_eq(&marker.registry, &Arc::downgrade(&self.0)) {
            return Err(RegistryError::OwnerMismatch);
        }
        self.register_inner(snapshot, Some(marker), None, None)
    }
    pub(crate) fn register_prepared_catalog(
        &self,
        marker: &PreparationMarker,
        snapshot: ImmutableSnapshot,
        admission: &assembly::CatalogAdmission,
    ) -> Result<ImmutableSnapshot, RegistryError> {
        if !Weak::ptr_eq(&marker.registry, &Arc::downgrade(&self.0)) {
            return Err(RegistryError::OwnerMismatch);
        }
        // Check before locking; the large catalog owner remains on this worker.
        // Only the outer identity failure rejects registration. The inner
        // native catalog error is intentionally seeded as unavailable later.
        let _ = admission.checked_for(snapshot.identity())?;
        self.register_inner(snapshot, Some(marker), Some(admission), None)
    }
    pub(crate) fn register_prepared_inputs(
        &self,
        marker: &PreparationMarker,
        snapshot: ImmutableSnapshot,
        catalog: Option<&assembly::CatalogAdmission>,
        clock: Option<&profile_clock::ProfileClockAdmission>,
    ) -> Result<ImmutableSnapshot, RegistryError> {
        // Keep catalog-only preparation on its existing checked admission path.
        if let (Some(catalog), None) = (catalog, clock) {
            return self.register_prepared_catalog(marker, snapshot, catalog);
        }
        if !Weak::ptr_eq(&marker.registry, &Arc::downgrade(&self.0)) {
            return Err(RegistryError::OwnerMismatch);
        }
        if let Some(catalog) = catalog {
            let _ = catalog.checked_for(snapshot.identity())?;
        }
        if let Some(clock) = clock {
            let _ = clock.checked_for(&snapshot)?;
        }
        self.register_inner(snapshot, Some(marker), catalog, clock)
    }
    fn register_inner(
        &self,
        snapshot: ImmutableSnapshot,
        marker: Option<&PreparationMarker>,
        admission: Option<&assembly::CatalogAdmission>,
        clock_admission: Option<&profile_clock::ProfileClockAdmission>,
    ) -> Result<ImmutableSnapshot, RegistryError> {
        // Native source/clock admission may parse a large history. Perform it
        // outside lifecycle locks, fenced both before and after calculation.
        if snapshot.clock_context().is_some() {
            let state = self.0.lock().map_err(|_| RegistryError::Poisoned)?;
            if marker.is_some_and(|m| state.generation != m.generation) {
                return Err(RegistryError::StaleSnapshot);
            }
            if state.expected_owner.as_ref().is_some_and(|(scope, epoch)| {
                scope != snapshot.identity().owner_scope()
                    || *epoch != snapshot.identity().owner_epoch()
            }) {
                return Err(RegistryError::OwnerMismatch);
            }
            if snapshot.identity().snapshot_revision() < state.minimum_revision {
                return Err(RegistryError::StaleSnapshot);
            }
        }
        let prepared_clock = if clock_admission.is_none() {
            profile_clock::ProfileClockAdmission::registration(&snapshot)?
        } else {
            None
        };
        let clock_admission = clock_admission.or(prepared_clock.as_ref());
        let mut state = self.0.lock().map_err(|_| RegistryError::Poisoned)?;
        if marker.is_some_and(|marker| state.generation != marker.generation) {
            return Err(RegistryError::StaleSnapshot);
        }
        let identity = snapshot.identity();
        match &state.expected_owner {
            Some((scope, epoch))
                if scope != identity.owner_scope() || *epoch != identity.owner_epoch() =>
            {
                return Err(RegistryError::OwnerMismatch);
            }
            None if state.initialized => return Err(RegistryError::OwnerMismatch),
            _ => {}
        }
        if identity.snapshot_revision() < state.minimum_revision {
            return Err(RegistryError::StaleSnapshot);
        }
        if let Some(current) = state.snapshot.as_ref() {
            let a = current.identity();
            let b = snapshot.identity();
            if a.owner_scope() != b.owner_scope() || a.owner_epoch() != b.owner_epoch() {
                return Err(RegistryError::OwnerMismatch);
            }
            if a == b {
                if let (Some(admission), Some(facts)) = (admission, state.facts.as_ref()) {
                    facts.seed_catalog(admission)?;
                }
                if let (Some(admission), Some(facts)) = (clock_admission, state.facts.as_ref()) {
                    facts.seed_profile_clock(admission)?;
                }
                return Ok(current.clone());
            }
        }
        if let Some(previous) = state.latest_identity.as_ref() {
            let b = snapshot.identity();
            if b.snapshot_revision() < previous.snapshot_revision() {
                return Err(RegistryError::StaleSnapshot);
            }
            if b.snapshot_revision() == previous.snapshot_revision() && b != previous {
                return Err(RegistryError::IdentityConflict);
            }
        }
        let generation = state
            .generation
            .checked_add(1)
            .ok_or(RegistryError::SequenceExhausted)?;
        let shared_reuse = Arc::clone(&state.financial_reuse);
        let next_facts = Arc::new(facts::SnapshotFacts::with_shared_reuse(
            snapshot.clone(),
            shared_reuse,
        ));
        if let Some(admission) = admission {
            next_facts.seed_catalog(admission)?;
        }
        if let Some(admission) = clock_admission {
            next_facts.seed_profile_clock(admission)?;
        }
        state.generation = generation;
        state.expected_owner = Some((identity.owner_scope().to_owned(), identity.owner_epoch()));
        state.initialized = true;
        state.latest_identity = Some(identity.clone());
        state.writers.clear();
        let previous_facts = state.facts.replace(next_facts);
        let previous_snapshot = state.snapshot.replace(snapshot.clone());
        let retired = state.retired.take();
        drop(state);
        // Registration runs on a worker. Destruction of large immutable source
        // trees must never hold the lifecycle mutex used by tiny control calls.
        drop((previous_snapshot, previous_facts, retired));
        Ok(snapshot)
    }
    /// The platform calls this when ownership is reset. All in-flight leases are
    /// invalid immediately, even if the next account uses the same revision number.
    pub fn reset(&self) -> Result<(), RegistryError> {
        let mut state = self.0.lock().map_err(|_| RegistryError::Poisoned)?;
        let generation = state
            .generation
            .checked_add(1)
            .ok_or(RegistryError::SequenceExhausted)?;
        state.utility.reset_owner()?;
        state.generation = generation;
        state.writers.clear();
        state.retire_inputs();
        state.calendar.retire_owner();
        state.expected_owner = None;
        state.initialized = true;
        state.latest_identity = None;
        state.minimum_revision = 0;
        Ok(())
    }
    /// Bind the intended next owner before starting asynchronous source loads.
    /// A delayed registration from the signed-out owner cannot claim the empty registry.
    pub fn reset_for_owner(&self, identity: &OwnerIdentity) -> Result<(), RegistryError> {
        let mut state = self.0.lock().map_err(|_| RegistryError::Poisoned)?;
        let generation = state
            .generation
            .checked_add(1)
            .ok_or(RegistryError::SequenceExhausted)?;
        state.utility.reset_owner()?;
        state.generation = generation;
        state.writers.clear();
        state.retire_inputs();
        state.calendar.retire_owner();
        state.expected_owner = Some((identity.scope().to_owned(), identity.epoch()));
        state.initialized = true;
        state.latest_identity = None;
        state.minimum_revision = 0;
        Ok(())
    }
    /// Run on a worker after a synchronous owner/reset fence. Only inaccessible
    /// retired data is removed; a racing newly registered snapshot is untouched.
    /// At most one detached source owner waits in the registry for collection.
    pub fn collect_retired(&self) -> Result<bool, RegistryError> {
        let (retired, calendar) = {
            let mut state = self.0.lock().map_err(|_| RegistryError::Poisoned)?;
            (state.retired.take(), state.calendar.take_retired())
        };
        let collected = retired.is_some() || calendar.is_some();
        drop(retired);
        drop(calendar);
        Ok(collected)
    }
    pub fn release(&self, identity: &SnapshotIdentity) -> Result<bool, RegistryError> {
        let mut state = self.0.lock().map_err(|_| RegistryError::Poisoned)?;
        if state
            .snapshot
            .as_ref()
            .is_none_or(|s| s.identity() != identity)
        {
            return Ok(false);
        }
        state.generation = state
            .generation
            .checked_add(1)
            .ok_or(RegistryError::SequenceExhausted)?;
        state.writers.clear();
        let snapshot = state.snapshot.take();
        let facts = state.facts.take();
        let retired = state.retired.take();
        drop(state);
        drop((snapshot, facts, retired));
        Ok(true)
    }
    /// Reserve writer slots on request arrival, before dispatching work to a native
    /// worker. Independent time, finance and check sections never share a slot.
    pub fn reserve(
        &self,
        request: CalculationRequest,
        lane: JobLane,
    ) -> Result<CalculationReservation, RegistryError> {
        self.reserve_checked(request, lane, None)
    }
    pub fn reserve_with_financial_details(
        &self,
        request: CalculationRequest,
        lane: JobLane,
        proof: Arc<financial_collation::FinancialAdmissionProof>,
    ) -> Result<CalculationReservation, RegistryError> {
        self.reserve_checked(request, lane, Some(proof))
    }
    fn reserve_checked(
        &self,
        request: CalculationRequest,
        lane: JobLane,
        proof: Option<Arc<financial_collation::FinancialAdmissionProof>>,
    ) -> Result<CalculationReservation, RegistryError> {
        if request.financial_details().is_some() != proof.is_some() {
            return Err(RegistryError::FinancialProofRequired);
        }
        if proof.as_ref().is_some_and(|p| !p.matches_request(&request)) {
            return Err(RegistryError::InvalidFinancialProof);
        }
        let slots = slots(&request, lane)?;
        let mut state = self.0.lock().map_err(|_| RegistryError::Poisoned)?;
        state
            .snapshot
            .as_ref()
            .filter(|s| {
                s.identity() == request.snapshot_identity()
                    && s.identity().snapshot_revision() >= state.minimum_revision
            })
            .ok_or(RegistryError::MissingSnapshot)?;
        if state.facts.is_none() {
            return Err(RegistryError::MissingSnapshot);
        }
        if proof
            .as_ref()
            .is_some_and(|p| !p.current_in_registry(self, &state))
        {
            return Err(RegistryError::InvalidFinancialProof);
        }
        for slot in &slots {
            if let Some(writer) = state.writers.get(slot) {
                if writer.revision > request.request_revision() {
                    return Err(RegistryError::StaleRequest);
                }
                if writer.revision == request.request_revision() {
                    return Err(if writer.request_id == request.request_id() {
                        RegistryError::DuplicateRequest
                    } else {
                        RegistryError::IdentityConflict
                    });
                }
            }
        }
        let excess = (state.writers.len()
            + slots
                .iter()
                .filter(|key| !state.writers.contains_key(*key))
                .count())
        .saturating_sub(MAX_ACTIVE_SLOTS);
        if excess > 0 {
            let mut expired: Vec<_> = state
                .writers
                .iter()
                .filter(|(slot, writer)| !writer.active && !slots.contains(slot))
                .map(|(slot, writer)| (writer.token, slot.clone()))
                .collect();
            expired.sort_by_key(|(token, _)| *token);
            if expired.len() < excess {
                return Err(RegistryError::Capacity);
            }
            for (_, slot) in expired.into_iter().take(excess) {
                state.writers.remove(&slot);
            }
        }
        let token = state
            .sequence
            .checked_add(1)
            .ok_or(RegistryError::SequenceExhausted)?;
        state.sequence = token;
        for slot in &slots {
            state.writers.insert(
                slot.clone(),
                Writer {
                    token,
                    revision: request.request_revision(),
                    request_id: request.request_id().to_owned(),
                    active: true,
                },
            );
        }
        Ok(CalculationReservation {
            registry: Arc::downgrade(&self.0),
            generation: state.generation,
            token,
            lane,
            request,
            slots,
            financial_details: proof,
        })
    }
    /// Worker-only acquisition; an obsolete queued reservation owns no inputs.
    pub fn acquire(
        &self,
        reservation: CalculationReservation,
    ) -> Result<CalculationLease, RegistryError> {
        let state = self.0.lock().map_err(|_| RegistryError::Poisoned)?;
        if !self.current(&state, &reservation) {
            drop(state);
            return Err(RegistryError::MissingSnapshot);
        }
        let snapshot = state.snapshot.as_ref().expect("current snapshot").clone();
        let facts = state.facts.as_ref().expect("current facts").clone();
        drop(state);
        Ok(CalculationLease {
            reservation,
            snapshot,
            facts,
        })
    }
    pub fn begin(
        &self,
        request: CalculationRequest,
        lane: JobLane,
    ) -> Result<CalculationLease, RegistryError> {
        self.acquire(self.reserve(request, lane)?)
    }
    fn current(&self, state: &State, lease: &CalculationReservation) -> bool {
        Weak::ptr_eq(&Arc::downgrade(&self.0), &lease.registry)
            && state.generation == lease.generation
            && state
                .snapshot
                .as_ref()
                .is_some_and(|s| s.identity() == lease.request.snapshot_identity())
            && lease
                .financial_details
                .as_ref()
                .is_none_or(|p| p.current_in_registry(self, state))
            && lease.slots.iter().all(|slot| {
                state
                    .writers
                    .get(slot)
                    .is_some_and(|w| w.token == lease.token && w.active)
            })
    }
    pub fn is_current(&self, lease: &CalculationLease) -> Result<bool, RegistryError> {
        let state = self.0.lock().map_err(|_| RegistryError::Poisoned)?;
        Ok(self.current(&state, &lease.reservation))
    }
    pub fn complete(
        &self,
        lease: &CalculationLease,
    ) -> Result<Option<PublicationPermit>, RegistryError> {
        let mut state = self.0.lock().map_err(|_| RegistryError::Poisoned)?;
        let lease = &lease.reservation;
        let current = self.current(&state, lease);
        if Weak::ptr_eq(&Arc::downgrade(&self.0), &lease.registry) {
            for slot in &lease.slots {
                if state
                    .writers
                    .get(slot)
                    .is_some_and(|w| w.token == lease.token)
                {
                    state.writers.get_mut(slot).unwrap().active = false;
                }
            }
        }
        Ok(current.then(|| PublicationPermit {
            request: lease.request.clone(),
            lane: lease.lane,
            financial_details: lease.financial_details.clone(),
        }))
    }
    /// Bounded diagnostic counts only; no owner, dates or raw business records.
    pub fn stats(&self) -> Result<RegistryStats, RegistryError> {
        let state = self.0.lock().map_err(|_| RegistryError::Poisoned)?;
        Ok(RegistryStats {
            writer_slots: state.writers.len(),
            active_writer_slots: state
                .writers
                .values()
                .filter(|writer| writer.active)
                .count(),
        })
    }
}
