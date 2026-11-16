use super::{CommittedCalendarDelta, WriteContextStamp, WriteResourceError, source::Binding};
use crate::{
    input::{
        InputError, day_write::NativeDayWritePlan, profile_write::NativeProfileWritePlan,
        template_write::NativeTemplateWritePlan,
    },
    runtime::payroll_form::plan::NativePayrollWritePlan,
};
use serde_json::Value;
use std::sync::{Arc, Mutex};
const MAX_PLAN_BYTES: u64 = super::source::MAX_CONTEXT_BYTES as u64;
pub(super) enum Plan {
    Profile(Box<NativeProfileWritePlan>),
    Payroll(NativePayrollWritePlan),
    Day(NativeDayWritePlan),
    Template(NativeTemplateWritePlan),
}
impl Plan {
    fn value(&self) -> &Value {
        match self {
            Self::Profile(p) => p.value(),
            Self::Payroll(p) => p.value(),
            Self::Day(p) => p.value(),
            Self::Template(p) => p.value(),
        }
    }
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum Stage {
    Ready,
    Taken,
    Completed,
    Aborted,
}
struct State {
    stage: Stage,
    plan: Option<Plan>,
}
pub struct NativeWritePermit {
    binding: Arc<Binding>,
    state: Mutex<State>,
}
pub struct TakenNativeWrite {
    pub stamp: WriteContextStamp,
    pub body: String,
}
pub struct CommittedNativeWrite {
    binding: Arc<Binding>,
    stamp: WriteContextStamp,
    profile: Option<Arc<Value>>,
    entry: Option<Value>,
    template: Option<Result<Value, InputError>>,
    calendar: Option<CommittedCalendarDelta>,
}
impl CommittedNativeWrite {
    pub(super) fn take_calendar_delta(
        &mut self,
        binding: &Arc<Binding>,
    ) -> Result<CommittedCalendarDelta, WriteResourceError> {
        if !Arc::ptr_eq(binding, &self.binding) {
            return Err(WriteResourceError::ForeignPermit);
        }
        binding.current()?;
        self.calendar
            .take()
            .ok_or(WriteResourceError::AlreadyCompleted)
    }
    pub(super) fn into_template(self, binding: &Arc<Binding>) -> Result<Value, WriteResourceError> {
        if !Arc::ptr_eq(binding, &self.binding) {
            return Err(WriteResourceError::ForeignPermit);
        }
        binding.current()?;
        self.template
            .ok_or(WriteResourceError::InvalidContext)?
            .map_err(WriteResourceError::Input)
    }
    pub(super) fn into_entry(self, binding: &Arc<Binding>) -> Result<Value, WriteResourceError> {
        if !Arc::ptr_eq(binding, &self.binding) {
            return Err(WriteResourceError::ForeignPermit);
        }
        binding.current()?;
        self.entry.ok_or(WriteResourceError::InvalidContext)
    }
    pub(super) fn into_profile(
        self,
        binding: &Arc<Binding>,
    ) -> Result<Arc<Value>, WriteResourceError> {
        if !Arc::ptr_eq(binding, &self.binding) {
            return Err(WriteResourceError::ForeignPermit);
        }
        binding.current()?;
        self.profile.ok_or(WriteResourceError::InvalidContext)
    }
    pub fn profile(&self) -> Option<&Arc<Value>> {
        self.profile.as_ref()
    }
    pub fn stamp(&self) -> &WriteContextStamp {
        &self.stamp
    }
}
impl NativeWritePermit {
    pub(super) fn new(binding: Arc<Binding>, plan: Plan) -> Self {
        Self {
            binding,
            state: Mutex::new(State {
                stage: Stage::Ready,
                plan: Some(plan),
            }),
        }
    }
    fn guard(&self, binding: &Arc<Binding>) -> Result<(), WriteResourceError> {
        if !Arc::ptr_eq(binding, &self.binding) {
            return Err(WriteResourceError::ForeignPermit);
        }
        binding.current()
    }
    pub(super) fn take(
        &self,
        binding: &Arc<Binding>,
    ) -> Result<TakenNativeWrite, WriteResourceError> {
        self.guard(binding)?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| WriteResourceError::Poisoned)?;
        if state.stage != Stage::Ready {
            return Err(WriteResourceError::AlreadyTaken);
        }
        let plan = state.plan.as_ref().expect("private ready plan");
        crate::report::cache_budget::serialized_bytes(plan.value(), MAX_PLAN_BYTES)
            .ok_or(WriteResourceError::InputTooLarge)?;
        let body =
            serde_json::to_string(plan.value()).map_err(|_| WriteResourceError::InvalidContext)?;
        self.guard(binding)?;
        state.stage = Stage::Taken;
        Ok(TakenNativeWrite {
            stamp: binding.stamp.clone(),
            body,
        })
    }
    pub(super) fn acknowledge(
        &self,
        binding: &Arc<Binding>,
        stamp: WriteContextStamp,
    ) -> Result<CommittedNativeWrite, WriteResourceError> {
        self.guard(binding)?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| WriteResourceError::Poisoned)?;
        match state.stage {
            Stage::Ready => return Err(WriteResourceError::NotTaken),
            Stage::Completed | Stage::Aborted => return Err(WriteResourceError::AlreadyCompleted),
            Stage::Taken => {}
        }
        let plan = state.plan.as_ref().expect("private taken plan");
        let changed = plan.value()["mutations"]
            .as_array()
            .is_some_and(|v| !v.is_empty());
        stamp.follows(&binding.stamp, changed)?;
        self.guard(binding)?;
        let plan = state.plan.take().expect("private taken plan");
        state.stage = Stage::Completed;
        drop(state);
        let (profile, entry, template, calendar) = match plan {
            Plan::Profile(p) => (Some((*p).into_returned_profile()), None, None, None),
            Plan::Payroll(_) => (None, None, None, None),
            Plan::Day(p) => {
                let (body, returned) = p.into_parts();
                let delta = CommittedCalendarDelta::from_native_body(
                    Arc::clone(binding),
                    stamp.clone(),
                    body,
                    true,
                )?;
                (None, Some(returned), None, Some(delta))
            }
            Plan::Template(p) => {
                let (body, returned) = p.into_parts();
                let delta = CommittedCalendarDelta::from_native_body(
                    Arc::clone(binding),
                    stamp.clone(),
                    body,
                    returned.is_ok(),
                )?;
                (None, None, Some(returned), Some(delta))
            }
        };
        Ok(CommittedNativeWrite {
            binding: Arc::clone(binding),
            stamp,
            profile,
            entry,
            template,
            calendar,
        })
    }
    pub(super) fn abort(&self, binding: &Arc<Binding>) -> Result<(), WriteResourceError> {
        self.guard(binding)?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| WriteResourceError::Poisoned)?;
        if matches!(state.stage, Stage::Completed | Stage::Aborted) {
            return Err(WriteResourceError::AlreadyCompleted);
        }
        state.stage = Stage::Aborted;
        let plan = state.plan.take();
        drop(state);
        drop(plan);
        Ok(())
    }
}
