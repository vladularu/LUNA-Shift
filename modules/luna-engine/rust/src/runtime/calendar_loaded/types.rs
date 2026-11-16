use super::{
    lease::{LoadedReadSource, ReadWitness},
    quota::{RawPermit, Slot, SourceCharge},
    rank::Candidates,
};
use crate::{
    calendar::loaded_scope::{
        CalendarLoadRange, PreparedScopeEntries, ScopeCompletionDraft, ScopeError, ScopeLoadStatus,
    },
    runtime::utility_lease::UtilityOwnerMarker,
};
use std::sync::{Arc, Weak, atomic::AtomicU8};
#[derive(Debug)]
pub enum LoadedPoolError {
    OwnerChanged,
    Stale,
    ScopeMismatch,
    Capacity,
    Busy,
    Replay,
    InvalidRanks,
    InvalidSourceToken,
    LocaleUnavailable,
    Poisoned,
    Input(crate::contract::ContractError),
    Policy(ScopeError),
}
impl From<ScopeError> for LoadedPoolError {
    fn from(error: ScopeError) -> Self {
        match error {
            ScopeError::Capacity => Self::Capacity,
            error => Self::Policy(error),
        }
    }
}
impl LoadedPoolError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::OwnerChanged => "CALENDAR_LOADED_OWNER_CHANGED",
            Self::Stale => "CALENDAR_LOADED_STALE",
            Self::ScopeMismatch => "CALENDAR_LOADED_SCOPE_MISMATCH",
            Self::Capacity => "CALENDAR_LOADED_RESOURCE_LIMIT",
            Self::Busy => "CALENDAR_LOADED_BUSY",
            Self::Replay => "CALENDAR_LOADED_REPLAY",
            Self::InvalidRanks => "CALENDAR_LOADED_INVALID_RANKS",
            Self::InvalidSourceToken => "CALENDAR_LOADED_INVALID_SOURCE_TOKEN",
            Self::LocaleUnavailable => "CALENDAR_LOADED_LOCALE_UNAVAILABLE",
            Self::Poisoned => "CALENDAR_LOADED_POISONED",
            Self::Input(crate::contract::ContractError::InputTooLarge) => {
                "CALENDAR_LOADED_INPUT_TOO_LARGE"
            }
            Self::Input(_) => "CALENDAR_LOADED_INVALID_INPUT",
            Self::Policy(_) => "CALENDAR_LOADED_INVALID_SOURCE",
        }
    }
}
pub enum LoadedStart {
    Unchanged,
    Reused,
    Read(CalendarLoadTicket),
}
#[derive(Clone)]
pub struct CalendarLoadTicket {
    pub(super) owner: UtilityOwnerMarker,
    pub(super) pool: Weak<()>,
    pub(super) source_token: String,
    pub(super) locale_key: String,
    pub(super) load: u64,
    pub(super) full_snapshot: bool,
    pub(super) background: bool,
    pub(super) range: CalendarLoadRange,
    pub(super) stage: Arc<AtomicU8>,
}
impl CalendarLoadTicket {
    /// IO intent from the native loader policy; not a source-readiness flag.
    pub fn full_snapshot(&self) -> bool {
        self.full_snapshot
    }
    pub fn background(&self) -> bool {
        self.background
    }
    pub fn range(&self) -> &CalendarLoadRange {
        &self.range
    }
    pub fn locale_key(&self) -> &str {
        &self.locale_key
    }
}
/// The raw decoder must obtain this reservation before allocating its source.
pub struct LoadedRawIntake {
    pub(super) ticket: CalendarLoadTicket,
    pub(super) slot: Slot,
    pub(super) draft_slot: Slot,
    pub(super) _raw: RawPermit,
}
pub struct LoadedQueryDraft {
    pub(super) ticket: CalendarLoadTicket,
    pub(super) prepared: PreparedScopeEntries,
    pub(super) candidates: Candidates,
    pub(super) slot: Slot,
    pub(super) charges: Vec<Arc<SourceCharge>>,
}
pub struct LoadedCompletionDraft {
    pub(super) ticket: CalendarLoadTicket,
    pub(super) prepared: ScopeCompletionDraft,
    pub(super) candidates: Candidates,
    pub(super) _slot: Slot,
    pub(super) charges: Vec<Arc<SourceCharge>>,
    pub(super) success: bool,
    pub(super) verified_ranks: Option<Arc<crate::calendar::recurrence::CollationRanks>>,
}
impl LoadedQueryDraft {
    pub fn candidates(&self) -> &[String] {
        &self.candidates.values
    }
    pub fn candidate_digest(&self) -> &str {
        &self.candidates.digest
    }
    pub fn locale_key(&self) -> &str {
        &self.ticket.locale_key
    }
}
impl LoadedCompletionDraft {
    pub fn has_verified_ranks(&self) -> bool {
        self.verified_ranks.is_some()
    }
    pub fn candidates(&self) -> &[String] {
        &self.candidates.values
    }
    pub fn candidate_digest(&self) -> &str {
        &self.candidates.digest
    }
    pub fn locale_key(&self) -> &str {
        &self.ticket.locale_key
    }
}
pub struct LoadedSnapshot {
    pub status: ScopeLoadStatus,
    pub source: Option<LoadedReadSource>,
    pub(super) witness: ReadWitness,
}
impl LoadedSnapshot {
    pub fn is_current(&self) -> Result<bool, LoadedPoolError> {
        self.witness.is_current()
    }
}
