//! Bounded, independent row/clock original-source preparations.
mod completion;
mod model;
mod operation;
use super::{CalendarClockMarker, CalendarRowsMarker};
use crate::{
    contract::{
        MAX_INPUT_BYTES,
        assembly::calendar_only::{CalendarInput, CalendarIntent, CalendarOnlyAssembly},
    },
    runtime::{RegistryError, SnapshotRegistry},
};
pub use completion::CalendarSourceCompletion;
pub use model::{CalendarAssemblyError, CalendarAssemblyStats, CalendarBuilderId};
use operation::RawOperation;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
static SEQUENCE: AtomicU64 = AtomicU64::new(0);
// One shared raw-input quota and four strictly bounded control headers.
const MAX_RETAINED_BYTES: u64 = MAX_INPUT_BYTES as u64 + 4 * 8192;
#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Rows,
    Clock,
}
impl Kind {
    fn of(intent: &CalendarIntent) -> Self {
        match intent {
            CalendarIntent::Rows {} => Self::Rows,
            CalendarIntent::Clock { .. } => Self::Clock,
        }
    }
}
#[derive(Clone)]
enum Marker {
    Rows(CalendarRowsMarker),
    Clock(CalendarClockMarker),
}
impl Marker {
    fn is_current(&self) -> Result<bool, RegistryError> {
        match self {
            Self::Rows(m) => m.is_current(),
            Self::Clock(m) => m.is_current(),
        }
    }
    fn cancel(&self, registry: &SnapshotRegistry) -> Result<bool, RegistryError> {
        match self {
            Self::Rows(m) => registry.cancel_calendar_rows(m),
            Self::Clock(m) => registry.cancel_calendar_clock(m),
        }
    }
}
#[derive(Default)]
struct Budget {
    bytes: AtomicU64,
}
impl Budget {
    fn reserve(&self, amount: u64) -> Result<(), CalendarAssemblyError> {
        self.bytes
            .try_update(Ordering::AcqRel, Ordering::Acquire, |n| {
                n.checked_add(amount).filter(|n| *n <= MAX_RETAINED_BYTES)
            })
            .map(|_| ())
            .map_err(|_| CalendarAssemblyError::Capacity)
    }
}
struct Builder {
    id: CalendarBuilderId,
    kind: Kind,
    marker: Marker,
    body: Mutex<Option<CalendarOnlyAssembly>>,
    charged: AtomicU64,
    budget: Arc<Budget>,
}
impl Builder {
    fn charge(&self, amount: usize) -> Result<(), CalendarAssemblyError> {
        let amount = u64::try_from(amount).map_err(|_| CalendarAssemblyError::Capacity)?;
        self.budget.reserve(amount)?;
        self.charged.fetch_add(amount, Ordering::AcqRel);
        Ok(())
    }
}
impl Drop for Builder {
    fn drop(&mut self) {
        let charged = self.charged.load(Ordering::Acquire);
        let before = self.budget.bytes.fetch_sub(charged, Ordering::AcqRel);
        debug_assert!(before >= charged);
    }
}
#[derive(Default)]
struct Lane {
    active: Option<Arc<Builder>>,
    retired: Option<Arc<Builder>>,
}
#[derive(Default)]
struct Book {
    rows: Lane,
    clock: Lane,
}
impl Book {
    fn lane(&mut self, kind: Kind) -> &mut Lane {
        match kind {
            Kind::Rows => &mut self.rows,
            Kind::Clock => &mut self.clock,
        }
    }
}
#[derive(Clone)]
pub struct CalendarAssemblyPool {
    registry: SnapshotRegistry,
    book: Arc<Mutex<Book>>,
    raw: Arc<AtomicBool>,
    budget: Arc<Budget>,
}
impl CalendarAssemblyPool {
    pub fn new(registry: SnapshotRegistry) -> Self {
        Self {
            registry,
            book: Arc::new(Mutex::new(Book::default())),
            raw: Arc::new(AtomicBool::new(false)),
            budget: Arc::new(Budget::default()),
        }
    }
    pub fn begin(&self, header: &[u8]) -> Result<CalendarBuilderId, CalendarAssemblyError> {
        self.begin_observed(header, || {})
    }
    fn begin_observed(
        &self,
        header: &[u8],
        before_install: impl FnOnce(),
    ) -> Result<CalendarBuilderId, CalendarAssemblyError> {
        let rows = self.registry.calendar_rows_marker()?;
        let clock = self.registry.calendar_clock_marker()?;
        let body = CalendarOnlyAssembly::begin(header)?;
        self.collect_retired()?;
        let kind = Kind::of(body.intent());
        let owner = match kind {
            Kind::Rows => rows.owner(),
            Kind::Clock => clock.owner(),
        };
        if owner != body.owner() {
            return Err(RegistryError::OwnerMismatch.into());
        }
        let marker = match kind {
            Kind::Rows => Marker::Rows(
                self.registry
                    .start_calendar_rows(&rows, body.source_revision())?,
            ),
            Kind::Clock => Marker::Clock(
                self.registry
                    .start_calendar_clock(&clock, body.source_revision())?,
            ),
        };
        let id = CalendarBuilderId::next(&SEQUENCE)?;
        if let Err(error) = self.budget.reserve(header.len() as u64) {
            marker.cancel(&self.registry)?;
            return Err(error);
        }
        let builder = Arc::new(Builder {
            id,
            kind,
            marker,
            body: Mutex::new(Some(body)),
            charged: AtomicU64::new(header.len() as u64),
            budget: self.budget.clone(),
        });
        before_install();
        self.install(builder.clone())?;
        if !builder.marker.is_current()? {
            self.retire(id)?;
            return Err(RegistryError::StaleSnapshot.into());
        }
        Ok(id)
    }
    fn install(&self, builder: Arc<Builder>) -> Result<(), CalendarAssemblyError> {
        let mut book = self
            .book
            .lock()
            .map_err(|_| CalendarAssemblyError::Poisoned)?;
        if !builder.marker.is_current()? {
            return Err(RegistryError::StaleSnapshot.into());
        }
        let lane = book.lane(builder.kind);
        if lane.active.is_some() && lane.retired.is_some() {
            return Err(CalendarAssemblyError::Capacity);
        }
        let previous = lane.active.replace(builder);
        if previous.is_some() {
            lane.retired = previous;
        }
        Ok(())
    }
    pub fn source(
        &self,
        id: CalendarBuilderId,
        header: &[u8],
        raw: &[u8],
    ) -> Result<(), CalendarAssemblyError> {
        self.source_frame(id, header, raw, header.len())
    }
    pub fn source_frame(
        &self,
        id: CalendarBuilderId,
        header: &[u8],
        raw: &[u8],
        frame_header_bytes: usize,
    ) -> Result<(), CalendarAssemblyError> {
        let mut operation = RawOperation::new(self, id)?;
        if frame_header_bytes > 8192 || frame_header_bytes < header.len() {
            return Err(crate::contract::ContractError::InputTooLarge.into());
        }
        let addition = frame_header_bytes
            .checked_add(raw.len())
            .filter(|n| *n <= MAX_INPUT_BYTES as usize)
            .ok_or(crate::contract::ContractError::InputTooLarge)?;
        operation.builder.charge(addition)?;
        operation
            .body
            .as_mut()
            .ok_or(CalendarAssemblyError::UnknownBuilder)?
            .source_frame(header, raw, frame_header_bytes)?;
        operation.restore()
    }
    pub fn seal(
        &self,
        id: CalendarBuilderId,
    ) -> Result<CalendarSourceCompletion, CalendarAssemblyError> {
        let mut operation = RawOperation::new(self, id)?;
        let input = operation
            .body
            .take()
            .ok_or(CalendarAssemblyError::UnknownBuilder)?
            .seal()?;
        let receipt = match (input, &operation.builder.marker) {
            (
                CalendarInput::Rows {
                    source_revision,
                    calendar,
                    ..
                },
                Marker::Rows(marker),
            ) => {
                let identity =
                    self.registry
                        .register_calendar_rows(marker, source_revision, &calendar)?;
                CalendarSourceCompletion::rows(
                    self.registry.lease_calendar_rows(marker, &identity)?,
                )
            }
            (
                CalendarInput::Clock {
                    source_revision,
                    observed_epoch_milliseconds,
                    profile,
                    history,
                    ..
                },
                Marker::Clock(marker),
            ) => {
                let identity = self.registry.register_calendar_clock(
                    marker,
                    source_revision,
                    &profile,
                    &history,
                    observed_epoch_milliseconds,
                )?;
                CalendarSourceCompletion::clock(
                    self.registry.lease_calendar_clock(marker, &identity)?,
                )
            }
            _ => return Err(crate::contract::ContractError::InvalidRequest.into()),
        };
        if !receipt.is_current()? {
            return Err(RegistryError::StaleSnapshot.into());
        }
        operation.completed = true;
        let removed = self.remove(id)?;
        drop(removed);
        Ok(receipt)
    }
    pub fn abort(&self, id: CalendarBuilderId) -> Result<bool, CalendarAssemblyError> {
        let marker = self.cancellation_marker(id)?;
        let Some(marker) = marker else {
            return Ok(false);
        };
        let cancelled = marker.cancel(&self.registry)?;
        self.retire(id)?;
        Ok(cancelled)
    }
    fn cancellation_marker(
        &self,
        id: CalendarBuilderId,
    ) -> Result<Option<Marker>, CalendarAssemblyError> {
        Ok({
            let book = self
                .book
                .lock()
                .map_err(|_| CalendarAssemblyError::Poisoned)?;
            [&book.rows, &book.clock].into_iter().find_map(|lane| {
                lane.active
                    .as_ref()
                    .filter(|b| b.id == id)
                    .map(|b| b.marker.clone())
            })
        })
    }
    /// Bounded ACK publication fence; retains no strong builder/source owner.
    pub fn builder_is_current(&self, id: CalendarBuilderId) -> Result<bool, CalendarAssemblyError> {
        let book = self
            .book
            .lock()
            .map_err(|_| CalendarAssemblyError::Poisoned)?;
        match [&book.rows, &book.clock]
            .into_iter()
            .find_map(|lane| lane.active.as_ref().filter(|b| b.id == id))
        {
            Some(builder) => builder.marker.is_current().map_err(Into::into),
            None => Ok(false),
        }
    }
    pub fn collect_retired(&self) -> Result<u32, CalendarAssemblyError> {
        self.registry.collect_retired()?;
        let (retired, candidates) = {
            let mut book = self
                .book
                .lock()
                .map_err(|_| CalendarAssemblyError::Poisoned)?;
            (
                [book.rows.retired.take(), book.clock.retired.take()],
                [book.rows.active.clone(), book.clock.active.clone()],
            )
        };
        let mut count = retired.iter().filter(|v| v.is_some()).count() as u32;
        drop(retired);
        for builder in candidates.into_iter().flatten() {
            if !builder.marker.is_current()? {
                let removed = self.remove(builder.id)?;
                count += u32::from(removed.is_some());
                drop(removed);
            }
        }
        Ok(count)
    }
    pub fn stats(&self) -> Result<CalendarAssemblyStats, CalendarAssemblyError> {
        let book = self
            .book
            .lock()
            .map_err(|_| CalendarAssemblyError::Poisoned)?;
        Ok(CalendarAssemblyStats {
            active_rows: u32::from(book.rows.active.is_some()),
            active_clock: u32::from(book.clock.active.is_some()),
            retired_builders: u32::from(book.rows.retired.is_some())
                + u32::from(book.clock.retired.is_some()),
            raw_operation: self.raw.load(Ordering::Acquire),
            retained_input_bytes: self.budget.bytes.load(Ordering::Acquire),
        })
    }
    fn current(&self, id: CalendarBuilderId) -> Result<Arc<Builder>, CalendarAssemblyError> {
        let book = self
            .book
            .lock()
            .map_err(|_| CalendarAssemblyError::Poisoned)?;
        [&book.rows, &book.clock]
            .into_iter()
            .find_map(|lane| lane.active.as_ref().filter(|b| b.id == id).cloned())
            .ok_or(CalendarAssemblyError::UnknownBuilder)
    }
    fn retire(&self, id: CalendarBuilderId) -> Result<(), CalendarAssemblyError> {
        let mut book = self
            .book
            .lock()
            .map_err(|_| CalendarAssemblyError::Poisoned)?;
        for kind in [Kind::Rows, Kind::Clock] {
            let lane = book.lane(kind);
            if lane.retired.is_none() && lane.active.as_ref().is_some_and(|b| b.id == id) {
                lane.retired = lane.active.take();
            }
        }
        Ok(())
    }
    fn remove(&self, id: CalendarBuilderId) -> Result<Option<Arc<Builder>>, CalendarAssemblyError> {
        let mut book = self
            .book
            .lock()
            .map_err(|_| CalendarAssemblyError::Poisoned)?;
        for kind in [Kind::Rows, Kind::Clock] {
            let lane = book.lane(kind);
            if lane.active.as_ref().is_some_and(|b| b.id == id) {
                return Ok(lane.active.take());
            }
        }
        Ok(None)
    }
}
