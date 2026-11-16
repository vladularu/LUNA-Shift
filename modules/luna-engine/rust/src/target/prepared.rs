//! Immutable source ownership, shared typed input and one validated day index.
//! None of these holders can be deserialized from the application wire.
use super::{
    InputStatus, MonthlyTarget, TargetContext, TargetDayFact, TargetError, TargetInput,
    TargetProfile,
};
use crate::rules::RuleResolver;
use serde::Deserialize;
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicUsize, Ordering},
    },
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TargetPreparationStats {
    pub input_parses: usize,
    pub context_preparations: usize,
}
#[derive(Default)]
struct Counters {
    parses: AtomicUsize,
    contexts: AtomicUsize,
}
impl Counters {
    fn stats(&self) -> TargetPreparationStats {
        TargetPreparationStats {
            input_parses: self.parses.load(Ordering::Relaxed),
            context_preparations: self.contexts.load(Ordering::Relaxed),
        }
    }
}

pub(crate) struct ContextIndex {
    identity: usize,
    positions: Vec<usize>,
}
impl ContextIndex {
    fn new(context: &TargetContext) -> Result<Self, TargetError> {
        super::validation::validate_context(context)?;
        let mut positions = (0..context.days.len()).collect::<Vec<_>>();
        positions.sort_by(|a, b| context.days[*a].date.cmp(&context.days[*b].date));
        Ok(Self {
            identity: context as *const TargetContext as usize,
            positions,
        })
    }
    pub fn matches(&self, context: &TargetContext) -> bool {
        self.identity == context as *const TargetContext as usize
    }
    pub fn fact<'a>(&self, context: &'a TargetContext, date: &str) -> Option<&'a TargetDayFact> {
        let index = self
            .positions
            .binary_search_by(|index| context.days[*index].date.as_str().cmp(date))
            .ok()?;
        context.days.get(self.positions[index])
    }
}
struct PreparedInput {
    input: Arc<TargetInput>,
    index: OnceLock<Result<ContextIndex, TargetError>>,
    counters: Arc<Counters>,
}
impl PreparedInput {
    fn context(&self) -> Result<Option<(&TargetContext, &ContextIndex)>, TargetError> {
        let Some(context) = self.input.context.as_ref() else {
            return Ok(None);
        };
        let index = self
            .index
            .get_or_init(|| {
                self.counters.contexts.fetch_add(1, Ordering::Relaxed);
                ContextIndex::new(context)
            })
            .as_ref()
            .map_err(Clone::clone)?;
        Ok(Some((context, index)))
    }
}
type InputSlot = Arc<OnceLock<Result<Arc<PreparedInput>, TargetError>>>;
enum Owner<'a> {
    Owned(Arc<Value>),
    Borrowed(&'a Value),
}
/// The owned alias is suitable for SnapshotFacts. The borrowed form is private
/// to compatibility/request wrappers, and retains the original borrow lifetime.
pub struct TargetSource<'a> {
    owner: Owner<'a>,
    allowed: BTreeSet<usize>,
    slots: Mutex<BTreeMap<usize, InputSlot>>,
    counters: Arc<Counters>,
    identity: Arc<()>,
}
pub type PreparedTargetSource = TargetSource<'static>;
impl TargetSource<'static> {
    pub fn new(profile: Arc<Value>) -> Self {
        Self::from_owner(Owner::Owned(profile))
    }
}
impl<'a> TargetSource<'a> {
    fn from_owner(owner: Owner<'a>) -> Self {
        let profile = match &owner {
            Owner::Owned(v) => v.as_ref(),
            Owner::Borrowed(v) => v,
        };
        let mut allowed = BTreeSet::new();
        let mut register = |value: Option<&Value>| {
            if let Some(value) = value.filter(|v| !v.is_null()) {
                allowed.insert(value as *const Value as usize);
            }
        };
        register(profile.get("workingTimeTarget"));
        if let Some(history) = profile.get("employmentTimeline").and_then(Value::as_array) {
            for row in history {
                register(
                    row.get("employment")
                        .and_then(|e| e.get("workingTimeTarget")),
                );
            }
        }
        Self {
            owner,
            allowed,
            slots: Mutex::new(BTreeMap::new()),
            counters: Arc::default(),
            identity: Arc::new(()),
        }
    }
    pub(crate) fn borrowed(profile: &'a Value) -> Self {
        Self::from_owner(Owner::Borrowed(profile))
    }
    pub fn profile(&self) -> &Value {
        match &self.owner {
            Owner::Owned(v) => v.as_ref(),
            Owner::Borrowed(v) => v,
        }
    }
    pub fn stats(&self) -> TargetPreparationStats {
        self.counters.stats()
    }
    pub(crate) fn owns_profile(&self, profile: &PreparedTargetProfile) -> bool {
        Arc::ptr_eq(&self.identity, &profile.source)
    }
    fn input(&self, raw: Option<&Value>) -> Result<Option<Arc<PreparedInput>>, TargetError> {
        let Some(raw) = raw.filter(|v| !v.is_null()) else {
            return Ok(None);
        };
        let identity = raw as *const Value as usize;
        if !self.allowed.contains(&identity) {
            return Err(TargetError::InvalidInput);
        }
        let slot = {
            let mut slots = self.slots.lock().map_err(|_| TargetError::InvalidInput)?;
            Arc::clone(
                slots
                    .entry(identity)
                    .or_insert_with(|| Arc::new(OnceLock::new())),
            )
        };
        slot.get_or_init(|| {
            self.counters.parses.fetch_add(1, Ordering::Relaxed);
            let input = TargetInput::deserialize(raw).map_err(|_| TargetError::InvalidInput)?;
            Ok(Arc::new(PreparedInput {
                input: Arc::new(input),
                index: OnceLock::new(),
                counters: Arc::clone(&self.counters),
            }))
        })
        .clone()
        .map(Some)
    }
    pub fn base_profile(&self) -> Result<PreparedTargetProfile, TargetError> {
        let profile = self.profile();
        let state = profile
            .get("federalState")
            .and_then(Value::as_str)
            .ok_or(TargetError::InvalidInput)?;
        let weekly = profile
            .get("weeklyMinutes")
            .and_then(Value::as_i64)
            .ok_or(TargetError::InvalidInput)?;
        let region = match profile.get("holidayRegion") {
            None | Some(Value::Null) => None,
            Some(v) => Some(v.as_str().ok_or(TargetError::InvalidInput)?),
        };
        self.profile_fields(state, weekly, region, profile.get("workingTimeTarget"))
    }
    pub(crate) fn profile_fields(
        &self,
        state: &str,
        weekly_minutes: i64,
        region: Option<&str>,
        input: Option<&Value>,
    ) -> Result<PreparedTargetProfile, TargetError> {
        let input = self.input(input)?;
        let profile = TargetProfile {
            federal_state: state.into(),
            weekly_minutes,
            holiday_region: region.map(str::to_owned),
            working_time_target: input.as_ref().map(|v| Arc::clone(&v.input)),
        };
        Ok(PreparedTargetProfile {
            profile,
            input,
            source: Arc::clone(&self.identity),
        })
    }
}

/// Native typed basis; Clone shares the complete input rather than its 50k days.
#[derive(Clone)]
pub struct PreparedTargetProfile {
    profile: TargetProfile,
    input: Option<Arc<PreparedInput>>,
    source: Arc<()>,
}
impl PreparedTargetProfile {
    pub fn profile(&self) -> &TargetProfile {
        &self.profile
    }
    pub fn shares_input_with(&self, other: &Self) -> bool {
        match (
            &self.profile.working_time_target,
            &other.profile.working_time_target,
        ) {
            (Some(a), Some(b)) => Arc::ptr_eq(a, b),
            (None, None) => Arc::ptr_eq(&self.source, &other.source),
            _ => false,
        }
    }
    pub(crate) fn input_identity(&self) -> Option<usize> {
        self.profile
            .working_time_target
            .as_ref()
            .map(|v| Arc::as_ptr(v) as usize)
    }
    pub(crate) fn without_input(&self) -> Self {
        let mut profile = self.profile.clone();
        profile.working_time_target = None;
        Self {
            profile,
            input: None,
            source: Arc::clone(&self.source),
        }
    }
    pub(crate) fn validate_request(&self, month: &str) -> Result<(), TargetError> {
        validate_request(month, &self.profile)
    }
    pub fn calculate(
        &self,
        month: &str,
        resolver: &RuleResolver,
        context: Option<&PreparedTargetContext>,
    ) -> Result<MonthlyTarget, TargetError> {
        // Readiness and current month/profile validation precede index/cache access.
        self.validate_request(month)?;
        let view = if let Some(context) = context {
            Some(context.view()?)
        } else if let Some(input) = &self.input {
            input.context()?
        } else {
            None
        };
        let (context, index) = view
            .map(|(context, index)| (Some(context), Some(index)))
            .unwrap_or((None, None));
        super::calculation::calculate(month, &self.profile, resolver, context, index)
    }
    pub(crate) fn calculate_borrowed_context(
        &self,
        month: &str,
        resolver: &RuleResolver,
        context: Option<&TargetContext>,
    ) -> Result<MonthlyTarget, TargetError> {
        if context.is_some() {
            super::calculate_monthly_working_time_target(month, &self.profile, resolver, context)
        } else {
            self.calculate(month, resolver, None)
        }
    }
}
pub(crate) fn validate_request(month: &str, profile: &TargetProfile) -> Result<(), TargetError> {
    if let Some(input) = &profile.working_time_target {
        match input.status {
            InputStatus::Loading => return Err(TargetError::Loading),
            InputStatus::Error => return Err(TargetError::ReadError),
            InputStatus::Ready => {}
        }
    }
    super::validation::validate_profile(month, profile)
}

struct ContextOwner {
    context: Arc<TargetContext>,
    index: OnceLock<Result<ContextIndex, TargetError>>,
    counters: Arc<Counters>,
}
/// Explicit overrides retain their own immutable data; a transient pointer is
/// never sufficient to reuse another call's validated context.
#[derive(Clone)]
pub struct PreparedTargetContext {
    inner: Arc<ContextOwner>,
}
impl PreparedTargetContext {
    pub fn new(context: Arc<TargetContext>) -> Self {
        Self {
            inner: Arc::new(ContextOwner {
                context,
                index: OnceLock::new(),
                counters: Arc::default(),
            }),
        }
    }
    pub fn context(&self) -> &TargetContext {
        &self.inner.context
    }
    pub fn stats(&self) -> TargetPreparationStats {
        self.inner.counters.stats()
    }
    pub(crate) fn same_source(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.inner, &other.inner)
    }
    fn view(&self) -> Result<(&TargetContext, &ContextIndex), TargetError> {
        let context = self.context();
        let index = self
            .inner
            .index
            .get_or_init(|| {
                self.inner.counters.contexts.fetch_add(1, Ordering::Relaxed);
                ContextIndex::new(context)
            })
            .as_ref()
            .map_err(Clone::clone)?;
        Ok((context, index))
    }
}
