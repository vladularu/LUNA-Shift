//! Bounded worker-side source assembly. No ready domain values enter the pool.
mod calendar;
mod catalog;
pub(crate) use catalog::CatalogAdmission;
mod model;
mod operation;
mod profile_clock;
use super::{PreparationMarker, RegistryError, SnapshotRegistry};
use crate::contract::{ImmutableSnapshot, assembly::SnapshotAssembly};
pub use model::{AssemblyError, AssemblyPoolStats, BuilderId, SourceTarget};
use operation::RawOperation;
use std::sync::{
    Arc, Mutex, OnceLock,
    atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
};

static BUILDER_SEQUENCE: AtomicU64 = AtomicU64::new(0);
struct Builder {
    id: BuilderId,
    marker: PreparationMarker,
    body: Mutex<Option<SnapshotAssembly>>,
    wire_bytes: AtomicU32,
    calendar: OnceLock<calendar::CalendarPreflight>,
    catalog: OnceLock<catalog::CatalogPreflight>,
    profile_clock: OnceLock<Arc<super::profile_clock::ProfileClockEnvironment>>,
}
#[derive(Default)]
struct PoolState {
    active: Option<Arc<Builder>>,
    retired: Option<Arc<Builder>>,
}

#[derive(Clone)]
pub struct SnapshotAssemblyPool {
    registry: SnapshotRegistry,
    state: Arc<Mutex<PoolState>>,
    raw: Arc<AtomicBool>,
}
impl SnapshotAssemblyPool {
    pub fn new(registry: SnapshotRegistry) -> Self {
        Self {
            registry,
            state: Arc::new(Mutex::new(PoolState::default())),
            raw: Arc::new(AtomicBool::new(false)),
        }
    }
    /// Worker-only bounded header parse. New Begins atomically supersede old
    /// preparations, even when owner, epoch and revision are unchanged.
    pub fn begin(&self, header: &[u8]) -> Result<BuilderId, AssemblyError> {
        let entry = self.registry.preparation_marker()?;
        let body = SnapshotAssembly::begin(header)?;
        self.collect_retired()?;
        let id = BuilderId::next(&BUILDER_SEQUENCE)?;
        let marker = self.registry.start_preparation(&entry, &body.fence())?;
        let builder = Arc::new(Builder {
            id,
            marker,
            body: Mutex::new(Some(body)),
            wire_bytes: AtomicU32::new(
                u32::try_from(header.len())
                    .map_err(|_| crate::contract::ContractError::InputTooLarge)?,
            ),
            calendar: OnceLock::new(),
            catalog: OnceLock::new(),
            profile_clock: OnceLock::new(),
        });
        self.install(builder.clone())?;
        if !builder.marker.is_current()? {
            self.retire(id)?;
            return Err(RegistryError::StaleSnapshot.into());
        }
        Ok(id)
    }
    fn install(&self, builder: Arc<Builder>) -> Result<(), AssemblyError> {
        let mut state = self.state.lock().map_err(|_| AssemblyError::Poisoned)?;
        // A newer Begin may already be installed while this older preparation
        // was paused after advancing its marker. Never replace that new owner.
        if !builder.marker.is_current()? {
            return Err(RegistryError::StaleSnapshot.into());
        }
        if state.active.is_some() && state.retired.is_some() {
            return Err(AssemblyError::Capacity);
        }
        let previous = state.active.replace(builder);
        if previous.is_some() {
            state.retired = previous;
        }
        Ok(())
    }
    pub fn source(
        &self,
        id: BuilderId,
        target: SourceTarget,
        header: &[u8],
        body: &[u8],
    ) -> Result<(), AssemblyError> {
        self.source_frame(id, target, header, body, header.len())
    }
    /// The C frame contains ID/target outside the compact group. Charge its
    /// original byte length as well as the unchanged original source body.
    pub(crate) fn source_frame(
        &self,
        id: BuilderId,
        target: SourceTarget,
        header: &[u8],
        body: &[u8],
        frame_header_bytes: usize,
    ) -> Result<(), AssemblyError> {
        let mut operation = RawOperation::new(self, id)?;
        if frame_header_bytes > 128 * 1024 {
            return Err(crate::contract::ContractError::InputTooLarge.into());
        }
        let addition = frame_header_bytes
            .checked_add(body.len())
            .and_then(|n| u32::try_from(n).ok())
            .ok_or(crate::contract::ContractError::InputTooLarge)?;
        let next = operation
            .builder
            .wire_bytes
            .load(Ordering::Relaxed)
            .checked_add(addition)
            .filter(|n| *n <= crate::contract::MAX_INPUT_BYTES)
            .ok_or(crate::contract::ContractError::InputTooLarge)?;
        let assembly = operation
            .body
            .as_mut()
            .ok_or(AssemblyError::UnknownBuilder)?;
        match target {
            SourceTarget::Source => assembly.source(header, body)?,
            SourceTarget::Catalog => assembly.catalog(header, body)?,
        }
        operation.builder.wire_bytes.store(next, Ordering::Relaxed);
        operation.restore()
    }
    pub fn seal(&self, id: BuilderId) -> Result<ImmutableSnapshot, AssemblyError> {
        let mut operation = RawOperation::new(self, id)?;
        if operation
            .builder
            .calendar
            .get()
            .is_some_and(|calendar| !calendar.bound())
        {
            return Err(crate::contract::ContractError::InvalidPresence.into());
        }
        if operation
            .builder
            .catalog
            .get()
            .is_some_and(|catalog| !catalog.finalized())
        {
            return Err(crate::contract::ContractError::InvalidPresence.into());
        }
        let assembly = operation.body.take().ok_or(AssemblyError::UnknownBuilder)?;
        // Validation and digest computation are outside all ownership mutexes.
        let snapshot = assembly.seal()?;
        let catalog_admission = operation
            .builder
            .catalog
            .get()
            .and_then(|catalog| catalog.admission(snapshot.identity()));
        let clock_admission = operation
            .builder
            .profile_clock
            .get()
            .map(|clock| {
                super::profile_clock::ProfileClockAdmission::from_environment(
                    &snapshot,
                    Arc::clone(clock),
                )
            })
            .transpose()?;
        self.registry
            .register_prepared_inputs(
                &operation.builder.marker,
                snapshot,
                catalog_admission.as_ref(),
                clock_admission.as_ref(),
            )
            .map_err(Into::into)
    }
    /// Tiny control operation. Only marker/Arc metadata is touched. The last
    /// strong owner of a source tree remains in active/retired until a worker.
    pub fn abort(&self, id: BuilderId) -> Result<bool, AssemblyError> {
        let Some(marker) = self.cancellation_marker(id)? else {
            return Ok(false);
        };
        self.registry.cancel_preparation(&marker)?;
        self.retire(id)?;
        Ok(true)
    }
    /// Tiny controls must not retain a strong Builder owner. Otherwise a racing
    /// worker collection could leave its last large source drop on this queue.
    fn cancellation_marker(
        &self,
        id: BuilderId,
    ) -> Result<Option<PreparationMarker>, AssemblyError> {
        let state = self.state.lock().map_err(|_| AssemblyError::Poisoned)?;
        Ok(state
            .active
            .as_ref()
            .filter(|builder| builder.id == id)
            .map(|builder| builder.marker.clone()))
    }
    /// Worker-only destruction. Neither lifecycle nor pool locks cover drops.
    pub fn collect_retired(&self) -> Result<u32, AssemblyError> {
        let (retired, candidate) = {
            let mut state = self.state.lock().map_err(|_| AssemblyError::Poisoned)?;
            (state.retired.take(), state.active.clone())
        };
        let mut count = u32::from(retired.is_some());
        drop(retired);
        if let Some(builder) = candidate
            && !builder.marker.is_current()?
        {
            let removed = self.remove(builder.id)?;
            count += u32::from(removed.is_some());
            drop(removed);
        }
        Ok(count)
    }
    pub fn stats(&self) -> Result<AssemblyPoolStats, AssemblyError> {
        let state = self.state.lock().map_err(|_| AssemblyError::Poisoned)?;
        Ok(AssemblyPoolStats {
            active_builders: u32::from(state.active.is_some()),
            retired_builders: u32::from(state.retired.is_some()),
            raw_operation: self.raw.load(Ordering::Acquire),
        })
    }
    fn current(&self, id: BuilderId) -> Result<Arc<Builder>, AssemblyError> {
        self.state
            .lock()
            .map_err(|_| AssemblyError::Poisoned)?
            .active
            .as_ref()
            .filter(|builder| builder.id == id)
            .cloned()
            .ok_or(AssemblyError::UnknownBuilder)
    }
    fn retire(&self, id: BuilderId) -> Result<(), AssemblyError> {
        let mut state = self.state.lock().map_err(|_| AssemblyError::Poisoned)?;
        if state.retired.is_none()
            && state
                .active
                .as_ref()
                .is_some_and(|builder| builder.id == id)
        {
            state.retired = state.active.take();
        }
        Ok(())
    }
    fn remove(&self, id: BuilderId) -> Result<Option<Arc<Builder>>, AssemblyError> {
        let mut state = self.state.lock().map_err(|_| AssemblyError::Poisoned)?;
        Ok(
            if state
                .active
                .as_ref()
                .is_some_and(|builder| builder.id == id)
            {
                state.active.take()
            } else {
                None
            },
        )
    }
}
