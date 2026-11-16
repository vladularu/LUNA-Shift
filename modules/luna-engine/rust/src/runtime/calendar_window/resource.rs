use super::model::{WindowPoolError, WindowScope};
use crate::{
    calendar::window::{
        CalendarSourceIndex, CalendarWindowView, PreparedCalendarWindow, WindowBounds,
    },
    runtime::{
        PreparationMarker,
        calendar_only::{CalendarClockLease, CalendarClockMetadata, CalendarRowsLease},
        utility_lease::UtilityLease,
    },
};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    sync::{
        Arc, Mutex, Weak,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};

pub(super) struct Witness {
    pub source: SourceWitness,
    pub lease: Arc<UtilityLease>,
    pub clock: Option<Arc<CalendarClockLease>>,
}
pub(super) enum SourceWitness {
    Report(PreparationMarker),
    Calendar(Box<CalendarRowsLease>),
}
impl Witness {
    pub fn check(&self) -> Result<(), WindowPoolError> {
        let source_current = match &self.source {
            SourceWitness::Report(marker) => marker.is_current()?,
            SourceWitness::Calendar(lease) => lease.is_current()?,
        };
        if source_current
            && self.lease.is_current()?
            && self
                .clock
                .as_ref()
                .map_or(Ok(true), |clock| clock.is_current())?
        {
            Ok(())
        } else {
            Err(WindowPoolError::Stale)
        }
    }
}
pub(super) enum Phase {
    Prepared(PreparedCalendarWindow),
    Building,
    Ready(Arc<CalendarWindowView>),
}
pub(super) struct Resource {
    pub id: u64,
    pub scope: Arc<WindowScope>,
    pub witness: Arc<Witness>,
    pub bounds: WindowBounds,
    pub projected: u32,
    pub candidates: Vec<String>,
    pub digest: String,
    pub phase: Mutex<Phase>,
    pub active: AtomicBool,
    pub ready: AtomicBool,
    pub charge: AtomicU64,
    pub last: AtomicU64,
    pub navigation: Option<NavigationFrame>,
    pub navigation_charge: u64,
}
#[derive(Serialize)]
pub(super) struct NavigationFrame {
    pub clock: CalendarClockMetadata,
    pub navigation: crate::calendar::presentation::navigation::CalendarNavigation,
}
impl Resource {
    pub fn check(&self) -> Result<(), WindowPoolError> {
        if !self.active.load(Ordering::Acquire) {
            return Err(WindowPoolError::Stale);
        }
        self.witness.check()
    }
    pub fn ready(&self) -> Result<Arc<CalendarWindowView>, WindowPoolError> {
        self.check()?;
        let phase = self.phase.lock().map_err(|_| WindowPoolError::Poisoned)?;
        match &*phase {
            Phase::Ready(view) => Ok(view.clone()),
            _ => Err(WindowPoolError::NotReady),
        }
    }
}
#[derive(Default)]
pub(super) struct Book {
    pub entries: BTreeMap<u64, Arc<Resource>>,
    pub retired: Vec<Arc<Resource>>,
    pub sources: Vec<SourceOwner>,
    pub bytes: u64,
    pub reserved: u64,
    pub sequence: u64,
    pub preparations: u64,
    pub rank_parses: u64,
}
pub(super) struct SourceOwner {
    pub identity: crate::contract::calendar_window::WindowSource,
    pub index: Weak<CalendarSourceIndex>,
}
