//! Private minimal raw-source owner for the day-detail route. No report pool.
mod assembly;
mod read_context;
use super::{
    facts::{FactError, SnapshotFacts},
    profile_clock::{ProfileClockAdmission, ProfileClockEnvironment},
    sources::SourceReadError,
    utility_lease::UtilityOwnerMarker,
    write_resource::{WriteContextStamp, WriteResourceError},
};
use crate::{
    calendar::window::{CalendarSourceIndex, WindowError, WindowSpec},
    contract::{
        ALL_SOURCE_KINDS, ContractError, SourceKind, SourceState, assembly::SnapshotAssembly,
    },
    credit::{context::DailyCreditContextCache, summary::MetricsError},
    input::{
        calculation_profile::{TargetProfileFacts, YouthProtectionFacts, bind_calculation_profile},
        calendar_rows::RawCalendarEntries,
    },
    report::day_details::{self, DayDetailsProjection},
    rules::RuleResolver,
    runtime::catalog_source::CatalogSourceError,
    target::{InputStatus, PreparedTargetSource},
};
pub use assembly::NativeDayDetailsAssembly;
pub use read_context::{
    NativeDayDetailsReadAssembly, NativeDayDetailsReadContext, NativeDayDetailsReadView,
};
use serde_json::Value;
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};
const MAX_CACHED_DAYS: usize = 4;
const MAX_CACHED_BYTES: u64 = 16 * 1024 * 1024;
struct NativeParts {
    calendar: Arc<RawCalendarEntries>,
    catalog: super::catalog::RuntimeCatalog,
}
#[derive(Debug)]
pub enum DayDetailsSourceError {
    OwnerChanged,
    InvalidSourceScope,
    InvalidResult,
    Poisoned,
    Contract(ContractError),
    Facts(FactError),
    Catalog(CatalogSourceError),
    Write(WriteResourceError),
    Registry(super::RegistryError),
    Window(WindowError),
    Metrics(MetricsError),
}
struct CachedDay {
    date: String,
    view: Arc<DayDetailsProjection>,
    bytes: u64,
}
struct Context {
    profile: Arc<Value>,
    targets: PreparedTargetSource,
    calendar: Arc<RawCalendarEntries>,
    index: Arc<CalendarSourceIndex>,
    resolver: Arc<RuleResolver>,
    cache: Mutex<VecDeque<CachedDay>>,
}
pub struct NativeDayDetailsSource {
    owner: UtilityOwnerMarker,
    stamp: WriteContextStamp,
    context: Option<Context>,
    observed_epoch_milliseconds: i64,
    valid_until_epoch_milliseconds: Option<i64>,
}
pub struct NativeDayDetailsCompletion {
    owner: UtilityOwnerMarker,
    view: Arc<DayDetailsProjection>,
}
impl NativeDayDetailsCompletion {
    fn check(&self) -> Result<(), DayDetailsSourceError> {
        check(&self.owner)
    }
    pub fn metadata(&self) -> Result<Value, DayDetailsSourceError> {
        self.check()?;
        let value = serde_json::to_value(self.view.as_ref())
            .map_err(|_| DayDetailsSourceError::InvalidResult)?;
        self.check()?;
        Ok(value)
    }
    pub fn entry_count(&self) -> Result<u32, DayDetailsSourceError> {
        self.check()?;
        Ok(self.view.entry_count())
    }
    pub fn rows(&self, offset: u32, limit: u32) -> Result<Vec<Value>, DayDetailsSourceError> {
        self.check()?;
        let rows = self
            .view
            .rows(offset, limit)
            .map_err(DayDetailsSourceError::Metrics)?;
        self.check()?;
        Ok(rows)
    }
    pub fn shares_projection(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.view, &other.view)
    }
}
fn check(owner: &UtilityOwnerMarker) -> Result<(), DayDetailsSourceError> {
    if owner
        .is_current()
        .map_err(|_| DayDetailsSourceError::OwnerChanged)?
    {
        Ok(())
    } else {
        Err(DayDetailsSourceError::OwnerChanged)
    }
}
impl NativeDayDetailsSource {
    pub fn prepare(
        owner: UtilityOwnerMarker,
        stamp: WriteContextStamp,
        source: SnapshotAssembly,
        epoch: i64,
    ) -> Result<Self, DayDetailsSourceError> {
        Self::prepare_inner(owner, stamp, source, epoch, None)
    }
    fn prepare_inner(
        owner: UtilityOwnerMarker,
        stamp: WriteContextStamp,
        mut source: SnapshotAssembly,
        epoch: i64,
        parts: Option<NativeParts>,
    ) -> Result<Self, DayDetailsSourceError> {
        check(&owner)?;
        stamp.validate().map_err(DayDetailsSourceError::Write)?;
        if !owner
            .matches_owner(source.fence().owner())
            .map_err(|_| DayDetailsSourceError::OwnerChanged)?
        {
            return Err(DayDetailsSourceError::OwnerChanged);
        }
        for kind in ALL_SOURCE_KINDS {
            if !matches!(
                kind,
                SourceKind::WorkProfile
                    | SourceKind::RemunerationProfiles
                    | SourceKind::WorkPatternSettings
                    | SourceKind::CalendarEntries
                    | SourceKind::WorkingTimeTarget
                    | SourceKind::YouthPreference
            ) && !matches!(source.source_state(*kind), SourceState::NotRequested)
            {
                return Err(DayDetailsSourceError::InvalidSourceScope);
            }
        }
        let target_status = match source.source_state(SourceKind::WorkingTimeTarget) {
            SourceState::NotRequested | SourceState::Loading => InputStatus::Loading,
            SourceState::Failed { .. } => InputStatus::Error,
            SourceState::Ready { .. } => InputStatus::Ready,
        };
        let env = ProfileClockEnvironment::from_states(
            source.owner_scope(),
            source.source_state(SourceKind::WorkProfile),
            source.source_state(SourceKind::RemunerationProfiles),
            epoch,
        )
        .map_err(DayDetailsSourceError::Facts)?;
        let calculation_base = env
            .calculation_profile_base(source.source_state(SourceKind::WorkPatternSettings))
            .map_err(DayDetailsSourceError::Facts)?;
        let valid_until_epoch_milliseconds =
            env.prepared.clock_metadata()["validUntilEpochMilliseconds"].as_i64();
        source
            .bind_profile_clock(epoch, env.reference_date())
            .map_err(DayDetailsSourceError::Contract)?;
        let snapshot = source.seal().map_err(DayDetailsSourceError::Contract)?;
        let proof = ProfileClockAdmission::from_environment(&snapshot, env)
            .map_err(DayDetailsSourceError::Registry)?;
        let facts = SnapshotFacts::new(snapshot);
        facts
            .seed_profile_clock(&proof)
            .map_err(DayDetailsSourceError::Registry)?;
        let context = match facts.profile().map_err(DayDetailsSourceError::Facts)? {
            None => None,
            Some(stored) => {
                let calendar = match &parts {
                    Some(parts) => Arc::clone(&parts.calendar),
                    None => Arc::clone(facts.calendar().map_err(DayDetailsSourceError::Facts)?),
                };
                let saved = if target_status == InputStatus::Ready {
                    facts.saved_target().ok().flatten()
                } else {
                    None
                };
                let target = match target_status {
                    InputStatus::Loading => TargetProfileFacts::Loading,
                    InputStatus::Error => TargetProfileFacts::Error,
                    InputStatus::Ready => match facts.saved_target() {
                        Ok(_) => TargetProfileFacts::Ready {
                            saved: saved.map(Arc::as_ref),
                            calendar: &calendar,
                        },
                        Err(_) => TargetProfileFacts::Error,
                    },
                };
                let youth = match facts.youth_preference() {
                    Ok(value) => YouthProtectionFacts {
                        value: Some(value),
                        status: InputStatus::Ready,
                    },
                    Err(FactError::Source {
                        error: SourceReadError::Loading | SourceReadError::NotRequested,
                        ..
                    }) => YouthProtectionFacts {
                        value: None,
                        status: InputStatus::Loading,
                    },
                    Err(_) => YouthProtectionFacts {
                        value: None,
                        status: InputStatus::Error,
                    },
                };
                let profile = bind_calculation_profile(
                    stored,
                    facts
                        .employment_history()
                        .map_err(DayDetailsSourceError::Facts)?,
                    calculation_base
                        .as_deref()
                        .ok_or(DayDetailsSourceError::InvalidResult)?,
                    target,
                    youth,
                )
                .map_err(|error| DayDetailsSourceError::Facts(FactError::Profile(error)))?;
                let targets = PreparedTargetSource::new(Arc::clone(&profile));
                let index = if parts.is_some() {
                    Arc::new(
                        CalendarSourceIndex::new(Arc::clone(calendar.entries()))
                            .map_err(DayDetailsSourceError::Window)?,
                    )
                } else {
                    Arc::clone(
                        facts
                            .calendar_window_index()
                            .map_err(|_| DayDetailsSourceError::InvalidResult)?,
                    )
                };
                let resolver = match &parts {
                    Some(parts) => Arc::clone(parts.catalog.resolver()),
                    None => Arc::clone(
                        facts
                            .catalog()
                            .map_err(DayDetailsSourceError::Catalog)?
                            .resolver(),
                    ),
                };
                Some(Context {
                    profile,
                    targets,
                    calendar,
                    index,
                    resolver,
                    cache: Mutex::new(VecDeque::new()),
                })
            }
        };
        check(&owner)?;
        // Facts/raw transport trees are dropped. Only the checked owners used
        // by this route survive; no financial/check context is initialized.
        Ok(Self {
            owner,
            stamp,
            context,
            observed_epoch_milliseconds: epoch,
            valid_until_epoch_milliseconds,
        })
    }
    pub fn profile(&self) -> Result<Option<&Arc<Value>>, DayDetailsSourceError> {
        check(&self.owner)?;
        Ok(self.context.as_ref().map(|context| &context.profile))
    }
    pub fn stamp(&self) -> Result<&WriteContextStamp, DayDetailsSourceError> {
        check(&self.owner)?;
        Ok(&self.stamp)
    }
    pub fn project(
        &self,
        date: &str,
    ) -> Result<Option<NativeDayDetailsCompletion>, DayDetailsSourceError> {
        check(&self.owner)?;
        crate::calendar::parse_date(date)
            .map_err(|error| DayDetailsSourceError::Metrics(MetricsError::Calculation(error)))?;
        let Some(context) = &self.context else {
            return Ok(None);
        };
        let cached = {
            let cache = context
                .cache
                .lock()
                .map_err(|_| DayDetailsSourceError::Poisoned)?;
            cache
                .iter()
                .find(|entry| entry.date == date)
                .map(|entry| Arc::clone(&entry.view))
        };
        let view = if let Some(view) = cached {
            view
        } else {
            let window = context
                .index
                .prepare(&WindowSpec::Day { date: date.into() })
                .map_err(DayDetailsSourceError::Window)?
                .finalize(context.calendar.collation())
                .map_err(DayDetailsSourceError::Window)?;
            let mut credits =
                DailyCreditContextCache::with_source(&context.targets, &context.resolver);
            let view = Arc::new(
                day_details::prepare(date, window, &mut credits, context.calendar.collation())
                    .map_err(DayDetailsSourceError::Metrics)?,
            );
            check(&self.owner)?;
            let bytes = view.source_window().metadata_bytes()
                + serde_json::to_vec(view.as_ref())
                    .map_err(|_| DayDetailsSourceError::InvalidResult)?
                    .len() as u64;
            if bytes <= MAX_CACHED_BYTES {
                let mut cache = context
                    .cache
                    .lock()
                    .map_err(|_| DayDetailsSourceError::Poisoned)?;
                while cache.len() >= MAX_CACHED_DAYS
                    || cache.iter().map(|entry| entry.bytes).sum::<u64>() + bytes > MAX_CACHED_BYTES
                {
                    cache.pop_front();
                }
                cache.push_back(CachedDay {
                    date: date.into(),
                    view: Arc::clone(&view),
                    bytes,
                });
            }
            view
        };
        check(&self.owner)?;
        Ok(Some(NativeDayDetailsCompletion {
            owner: self.owner.clone(),
            view,
        }))
    }
    pub fn is_current(&self) -> Result<bool, DayDetailsSourceError> {
        self.owner
            .is_current()
            .map_err(|_| DayDetailsSourceError::OwnerChanged)
    }
    pub fn valid_until_epoch_milliseconds(&self) -> Result<Option<i64>, DayDetailsSourceError> {
        check(&self.owner)?;
        Ok(self.valid_until_epoch_milliseconds)
    }
    /// Read-only routes must reopen at a native clock-role boundary. A cached
    /// clock display is never accepted as proof that this source is fresh.
    pub fn is_fresh_at(&self, epoch: i64) -> Result<bool, DayDetailsSourceError> {
        crate::contract::RawClockContext::from_epoch_milliseconds(epoch)
            .map_err(DayDetailsSourceError::Contract)?;
        Ok(self.is_current()?
            && epoch >= self.observed_epoch_milliseconds
            && self
                .valid_until_epoch_milliseconds
                .is_some_and(|until| epoch < until))
    }
}
