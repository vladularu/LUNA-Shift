use super::{
    CalendarLoadRange, ScopeEntries, ScopeEntry, ScopeError,
    reconcile::{self, EntryId},
};
use crate::calendar::recurrence::CollationRanks;
use serde::Serialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, Weak},
};

#[derive(Debug, Clone, Copy)]
pub enum ScopeLoadFailure {
    Profile,
    Templates,
    Calendar,
    TariffDecisions,
    WorkPattern,
    ProfileSalaryInvalid,
    ProfileSalaryConflict,
}
impl ScopeLoadFailure {
    pub fn code(self) -> &'static str {
        match self {
            Self::Profile => "LOAD_PROFILE_FAILED",
            Self::Templates => "LOAD_TEMPLATES_FAILED",
            Self::Calendar => "LOAD_CALENDAR_FAILED",
            Self::TariffDecisions => "LOAD_TARIFF_DECISIONS_FAILED",
            Self::WorkPattern => "LOAD_WORK_PATTERN_FAILED",
            Self::ProfileSalaryInvalid => "PROFILE_SALARY_INVALID",
            Self::ProfileSalaryConflict => "PROFILE_SALARY_CONFLICT",
        }
    }
    fn message(self) -> String {
        format!(
            "Lokale Daten konnten nicht geladen werden. Bitte versuche es erneut.\n\nFehlercode: {}",
            self.code()
        )
    }
}
#[derive(Debug, Clone)]
pub enum ScopeLoadStart {
    Unchanged,
    Reused,
    Read {
        load: u64,
        range: CalendarLoadRange,
        full_snapshot: bool,
        background: bool,
    },
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScopeLoadCompletion {
    Published,
    Discarded,
}
struct Pending {
    before: ScopeEntries,
    range: CalendarLoadRange,
    full_snapshot: bool,
    background: bool,
    current_year: i32,
    deleted: BTreeSet<EntryId>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeLoadStatus {
    pub ready: bool,
    pub calendar_range: Option<CalendarLoadRange>,
    pub error: Option<String>,
}
/// No Deserialize and no IO/owner capability. Runtime admission is required on
/// both sides of every operation. A begin retains only Arc entry handles.
#[derive(Default)]
pub struct CalendarLoadedScope {
    identity: Arc<()>,
    pub(super) active_year: Option<i32>,
    pub(super) range: Option<CalendarLoadRange>,
    pub(super) loaded_key: Option<String>,
    pub(super) calendar_range: Option<CalendarLoadRange>,
    pub(super) retained: Vec<CalendarLoadRange>,
    pub(super) initialized: bool,
    pub(super) sequence: u64,
    pub(super) entries: ScopeEntries,
    pub(super) error: Option<ScopeLoadFailure>,
    pending: BTreeMap<u64, Pending>,
    pub(super) deleted: BTreeSet<EntryId>,
    pub(super) notification_refresh: Option<(u64, String)>,
}
enum CompletionMembership {
    Sorted(ScopeEntries),
    Unsorted(Vec<Arc<ScopeEntry>>),
}
impl CompletionMembership {
    fn entries(&self) -> &[Arc<ScopeEntry>] {
        match self {
            Self::Sorted(book) => book.entries(),
            Self::Unsorted(entries) => entries,
        }
    }
    fn finish(self, ranks: &CollationRanks) -> Result<ScopeEntries, ScopeError> {
        match self {
            Self::Sorted(book) => Ok(book),
            Self::Unsorted(entries) => ScopeEntries::sorted(entries, ranks),
        }
    }
}
enum CompletionOutcome {
    Discard,
    Failure(ScopeLoadFailure),
    Ready(CompletionMembership),
}
/// One source-bound membership calculation. It retains native owners and can
/// neither be deserialized nor used after a local write or a later load.
pub struct ScopeCompletionDraft {
    identity: Weak<()>,
    generation: u64,
    load: u64,
    current: ScopeEntries,
    outcome: CompletionOutcome,
    zone: Option<String>,
    candidates: BTreeSet<String>,
}
impl ScopeCompletionDraft {
    pub fn collation_candidates(&self) -> &BTreeSet<String> {
        &self.candidates
    }
    pub fn needs_sort(&self) -> bool {
        matches!(
            self.outcome,
            CompletionOutcome::Ready(CompletionMembership::Unsorted(_))
        )
    }
}
fn present_year(epoch: i64) -> Result<i32, ScopeError> {
    if !(-8_640_000_000_000_000..=8_640_000_000_000_000).contains(&epoch) {
        return Err(ScopeError::InvalidIntent);
    }
    let stamp = jiff::Timestamp::from_millisecond(epoch).map_err(|_| ScopeError::InvalidIntent)?;
    let date = stamp.to_zoned(crate::time::zone("Europe/Berlin")?).date();
    // Preserve the original Number(currentMonth().slice(0, 4)), including
    // Temporal's signed six-digit negative year spelling.
    let year = i32::from(date.year());
    let text = if year < 0 {
        format!("-{:06}", -year)
    } else {
        format!("{year:04}")
    };
    text[..4].parse().map_err(|_| ScopeError::InvalidIntent)
}
impl CalendarLoadedScope {
    fn advance(&mut self) -> Result<(), ScopeError> {
        self.sequence = self.sequence.checked_add(1).ok_or(ScopeError::Capacity)?;
        Ok(())
    }
    pub fn active_month(&mut self, month: &str, epoch: i64) -> Result<ScopeLoadStart, ScopeError> {
        let range = CalendarLoadRange::for_month(month)?;
        let year = month[..4]
            .parse::<i32>()
            .map_err(|_| ScopeError::InvalidIntent)?;
        if self.active_year == Some(year) {
            return Ok(ScopeLoadStart::Unchanged);
        }
        let current = present_year(epoch)?;
        self.sequence
            .checked_add(if self.active_year.is_some() { 2 } else { 1 })
            .ok_or(ScopeError::Capacity)?;
        if self.active_year.is_some() {
            self.advance()?;
        }
        self.active_year = Some(year);
        self.range = Some(range);
        self.begin(false, false, current)
    }
    pub fn reload(&mut self, background: bool, epoch: i64) -> Result<ScopeLoadStart, ScopeError> {
        let year = present_year(epoch)?;
        self.begin(true, background, year)
    }
    fn begin(
        &mut self,
        full: bool,
        background: bool,
        current_year: i32,
    ) -> Result<ScopeLoadStart, ScopeError> {
        let range = self.range.clone().ok_or(ScopeError::InvalidIntent)?;
        self.advance()?;
        if !full
            && self.initialized
            && let Some(cached) = self
                .retained
                .iter()
                .find(|known| known.covers(&range))
                .cloned()
        {
            self.retained = reconcile::retain(&self.retained, &cached, current_year);
            self.calendar_range = Some(range.clone());
            self.loaded_key = Some(range.key());
            self.error = None;
            return Ok(ScopeLoadStart::Reused);
        }
        self.deleted.clear();
        if full {
            if background
                && self
                    .retained
                    .iter()
                    .any(|known| known.covers_year(self.active_year.unwrap_or_default()))
            {
                self.loaded_key = Some(range.key());
            }
            self.initialized = false;
            if !background {
                self.loaded_key = None;
                self.calendar_range = None;
            }
            self.retained.clear();
        }
        self.error = None;
        let full_snapshot = full || !self.initialized;
        self.pending.insert(
            self.sequence,
            Pending {
                before: self.entries.clone(),
                range: range.clone(),
                full_snapshot,
                background,
                current_year,
                deleted: BTreeSet::new(),
            },
        );
        Ok(ScopeLoadStart::Read {
            load: self.sequence,
            range,
            full_snapshot,
            background,
        })
    }
    pub fn prepare_completion(
        &self,
        load: u64,
        result: Result<ScopeEntries, ScopeLoadFailure>,
        snapshot_time_zone: Option<&str>,
    ) -> Result<ScopeCompletionDraft, ScopeError> {
        let pending = self.pending.get(&load).ok_or(ScopeError::UnknownLoad)?;
        let outcome = if load != self.sequence {
            CompletionOutcome::Discard
        } else {
            match result {
                Err(failure) => CompletionOutcome::Failure(failure),
                Ok(loaded) => {
                    let keep = if pending.full_snapshot && pending.background {
                        vec![pending.range.clone()]
                    } else {
                        reconcile::retain(&self.retained, &pending.range, pending.current_year)
                    };
                    let membership = if pending.full_snapshot && !pending.background {
                        CompletionMembership::Sorted(loaded)
                    } else {
                        CompletionMembership::Unsorted(reconcile::membership(
                            &loaded,
                            &pending.before,
                            &self.entries,
                            &pending.range,
                            &pending.deleted,
                            &keep,
                        )?)
                    };
                    CompletionOutcome::Ready(membership)
                }
            }
        };
        let candidates = match &outcome {
            CompletionOutcome::Ready(entries) => super::model::entry_candidates(entries.entries()),
            _ => BTreeSet::new(),
        };
        Ok(ScopeCompletionDraft {
            identity: Arc::downgrade(&self.identity),
            generation: self.sequence,
            load,
            current: self.entries.clone(),
            outcome,
            zone: snapshot_time_zone.map(str::to_owned),
            candidates,
        })
    }
    pub fn finish_completion(
        &mut self,
        draft: ScopeCompletionDraft,
        ranks: &CollationRanks,
    ) -> Result<ScopeLoadCompletion, ScopeError> {
        if !Weak::ptr_eq(&draft.identity, &Arc::downgrade(&self.identity))
            || draft.generation != self.sequence
            || !Arc::ptr_eq(&draft.current.0, &self.entries.0)
        {
            return Err(ScopeError::StaleDraft);
        }
        let pending = self
            .pending
            .get(&draft.load)
            .ok_or(ScopeError::UnknownLoad)?;
        match draft.outcome {
            CompletionOutcome::Discard => {
                self.pending.remove(&draft.load);
                return Ok(ScopeLoadCompletion::Discarded);
            }
            CompletionOutcome::Failure(failure) => {
                self.error = Some(failure);
                self.loaded_key = Some(pending.range.key());
            }
            CompletionOutcome::Ready(entries) => {
                let next = entries.finish(ranks)?;
                self.entries = next;
                if pending.full_snapshot {
                    self.initialized = true;
                    if pending.background {
                        self.notification_refresh = Some((
                            draft.load,
                            draft.zone.unwrap_or_else(|| "Europe/Berlin".to_owned()),
                        ));
                    }
                }
                self.retained =
                    reconcile::retain(&self.retained, &pending.range, pending.current_year);
                self.calendar_range = Some(pending.range.clone());
                self.loaded_key = Some(pending.range.key());
            }
        }
        self.pending.remove(&draft.load);
        Ok(ScopeLoadCompletion::Published)
    }
    /// Convenience for callers already holding a single genuine rank owner
    /// covering the complete query/retained/local-write union.
    pub fn complete(
        &mut self,
        load: u64,
        result: Result<ScopeEntries, ScopeLoadFailure>,
        snapshot_time_zone: Option<&str>,
        ranks: &CollationRanks,
    ) -> Result<ScopeLoadCompletion, ScopeError> {
        let draft = self.prepare_completion(load, result, snapshot_time_zone)?;
        self.finish_completion(draft, ranks)
    }
    pub fn publish_write(
        &mut self,
        saved: Arc<ScopeEntry>,
        ranks: &CollationRanks,
    ) -> Result<(), ScopeError> {
        self.entries = reconcile::upsert(&self.entries, saved, ranks)?;
        Ok(())
    }
    pub fn publish_delete(&mut self, deleted: &ScopeEntry) {
        let (kind, id) = deleted.key();
        let key = (kind.to_owned(), id.to_owned());
        self.deleted.insert(key.clone());
        if let Some(pending) = self.pending.get_mut(&self.sequence) {
            pending.deleted.insert(key);
        }
        self.entries = ScopeEntries(Arc::from(
            self.entries
                .entries()
                .iter()
                .filter(|entry| entry.value["id"] != deleted.value["id"])
                .cloned()
                .collect::<Vec<_>>(),
        ));
    }
    pub fn unmount(&mut self) -> Result<(), ScopeError> {
        self.advance()
    }
    pub fn entries(&self) -> &ScopeEntries {
        &self.entries
    }
    pub fn generation(&self) -> u64 {
        self.sequence
    }
    pub fn status(&self) -> ScopeLoadStatus {
        let Some(range) = self.range.as_ref() else {
            return ScopeLoadStatus {
                ready: false,
                calendar_range: None,
                error: None,
            };
        };
        let covered = self.retained.iter().any(|known| known.covers(range));
        ScopeLoadStatus {
            ready: self.loaded_key.as_ref() == Some(&range.key())
                || self
                    .retained
                    .iter()
                    .any(|known| known.covers_year(self.active_year.unwrap_or_default())),
            calendar_range: if covered {
                Some(range.clone())
            } else {
                self.calendar_range.clone()
            },
            error: self.error.map(ScopeLoadFailure::message),
        }
    }
}
