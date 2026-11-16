use super::{NativeWritePermit, WriteResourceError, permit::Plan};
use crate::{
    input::{
        InputError,
        day_write::NativeDayWriteSource,
        finance_rows::RawNetPayTimeline,
        net_form::InitialNetSettings,
        profile_editor::ProfileFields,
        profile_write::{ProfileWriteRoute, ProfileWriteSource},
        template_write::{NativeTemplateWriteSource, TemplateWriteOperation},
    },
    runtime::{
        payroll_form::plan::{NetPlanSource, TimingPlanSource},
        utility_lease::UtilityOwnerMarker,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{Arc, OnceLock};
pub(super) const MAX_CONTEXT_BYTES: usize = 16_777_216 - 262_144;
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WriteContextStamp {
    data_space_id: String,
    input_token: String,
    database_schema_version: u64,
}
fn token(s: &str) -> bool {
    s.len() == 32
        && s.bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
impl WriteContextStamp {
    pub fn from_raw(raw: &Value) -> Result<Self, WriteResourceError> {
        let s: Self =
            serde_json::from_value(raw.clone()).map_err(|_| WriteResourceError::InvalidStamp)?;
        s.validate()?;
        Ok(s)
    }
    pub(crate) fn validate(&self) -> Result<(), WriteResourceError> {
        if !token(&self.data_space_id)
            || !token(&self.input_token)
            || !(1..=crate::money::MAX_SAFE_INTEGER as u64).contains(&self.database_schema_version)
        {
            return Err(WriteResourceError::InvalidStamp);
        }
        Ok(())
    }
    pub(super) fn follows(&self, old: &Self, changed: bool) -> Result<(), WriteResourceError> {
        self.validate()?;
        if self.data_space_id != old.data_space_id
            || self.database_schema_version != old.database_schema_version
            || (changed && self.input_token == old.input_token)
            || (!changed && self.input_token != old.input_token)
        {
            return Err(WriteResourceError::InvalidStamp);
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteContextKind {
    Profile,
    Payroll,
    Day,
    Template,
}
pub(super) struct Binding {
    marker: UtilityOwnerMarker,
    pub stamp: WriteContextStamp,
}
impl Binding {
    pub fn shares_owner(&self, marker: &UtilityOwnerMarker) -> bool {
        self.marker.shares_owner(marker)
    }
    pub fn current(&self) -> Result<(), WriteResourceError> {
        match self.marker.is_current() {
            Ok(true) => Ok(()),
            Ok(false) => Err(WriteResourceError::OwnerChanged),
            Err(_) => Err(WriteResourceError::Poisoned),
        }
    }
}
struct PayrollSource {
    raw_timeline: Arc<Vec<Value>>,
    timeline: OnceLock<Result<Arc<RawNetPayTimeline>, InputError>>,
    preference: Option<Value>,
}
impl PayrollSource {
    fn timeline(&self) -> Result<Arc<RawNetPayTimeline>, InputError> {
        self.timeline
            .get_or_init(|| {
                RawNetPayTimeline::try_from_rows(Arc::clone(&self.raw_timeline)).map(Arc::new)
            })
            .clone()
    }
}
enum Source {
    Profile(ProfileWriteSource),
    Payroll(PayrollSource),
    Day(NativeDayWriteSource),
    Template(NativeTemplateWriteSource),
}
pub struct NativeWriteContext {
    pub(super) binding: Arc<Binding>,
    source: Source,
}
impl NativeWriteContext {
    pub(crate) fn shares_owner(&self, marker: &UtilityOwnerMarker) -> bool {
        self.binding.marker.shares_owner(marker)
    }
    pub(crate) fn committed_day(
        &self,
        committed: super::CommittedNativeWrite,
    ) -> Result<Value, WriteResourceError> {
        committed.into_entry(&self.binding)
    }
    pub fn take_calendar_delta(
        &self,
        committed: &mut super::CommittedNativeWrite,
    ) -> Result<super::CommittedCalendarDelta, WriteResourceError> {
        if !matches!(&self.source, Source::Day(_) | Source::Template(_)) {
            return Err(WriteResourceError::InvalidContext);
        }
        committed.take_calendar_delta(&self.binding)
    }
    pub fn committed_template(
        &self,
        committed: super::CommittedNativeWrite,
    ) -> Result<Value, WriteResourceError> {
        committed.into_template(&self.binding)
    }
    pub(crate) fn committed_profile(
        &self,
        origin: &crate::contract::SnapshotIdentity,
        committed: super::CommittedNativeWrite,
    ) -> Result<Arc<Value>, WriteResourceError> {
        let owner = crate::contract::OwnerIdentity::new(origin.owner_scope(), origin.owner_epoch())
            .map_err(|_| WriteResourceError::InvalidContext)?;
        if !self
            .binding
            .marker
            .matches_owner(&owner)
            .map_err(|_| WriteResourceError::Poisoned)?
        {
            return Err(WriteResourceError::OwnerChanged);
        }
        committed.into_profile(&self.binding)
    }
    /// Private SQL capture under the existing exact stamp, never UI Ready data.
    pub fn from_raw(
        marker: UtilityOwnerMarker,
        stamp: WriteContextStamp,
        kind: WriteContextKind,
        bytes: &[u8],
    ) -> Result<Self, WriteResourceError> {
        stamp.validate()?;
        let binding = Arc::new(Binding { marker, stamp });
        binding.current()?;
        if bytes.len() > MAX_CONTEXT_BYTES {
            return Err(WriteResourceError::InputTooLarge);
        }
        let raw =
            crate::contract::bounded_json(bytes).map_err(|_| WriteResourceError::InvalidContext)?;
        let rows = raw
            .as_object()
            .ok_or(WriteResourceError::InvalidContext)?
            .values()
            .filter_map(Value::as_array)
            .map(Vec::len)
            .sum::<usize>();
        if rows > 100_000 {
            return Err(WriteResourceError::InputTooLarge);
        }
        let source = match kind {
            WriteContextKind::Profile => {
                Source::Profile(ProfileWriteSource::try_from_raw_state(raw)?)
            }
            WriteContextKind::Payroll => Source::Payroll(payroll_source(raw)?),
            WriteContextKind::Day => {
                let Value::Object(mut raw) = raw else {
                    return Err(WriteResourceError::InvalidContext);
                };
                if raw.len() != 2 {
                    return Err(WriteResourceError::InvalidContext);
                }
                let Value::Array(shifts) = raw
                    .remove("shiftRows")
                    .ok_or(WriteResourceError::InvalidContext)?
                else {
                    return Err(WriteResourceError::InvalidContext);
                };
                let Value::Array(appointments) = raw
                    .remove("appointmentRows")
                    .ok_or(WriteResourceError::InvalidContext)?
                else {
                    return Err(WriteResourceError::InvalidContext);
                };
                Source::Day(NativeDayWriteSource::from_raw_rows(
                    Arc::from(shifts),
                    Arc::from(appointments),
                )?)
            }
            WriteContextKind::Template => {
                let Value::Object(mut raw) = raw else {
                    return Err(WriteResourceError::InvalidContext);
                };
                if raw.len() != 1 {
                    return Err(WriteResourceError::InvalidContext);
                }
                let Some(Value::Array(rows)) = raw.remove("templateRows") else {
                    return Err(WriteResourceError::InvalidContext);
                };
                Source::Template(NativeTemplateWriteSource::from_raw_rows(rows.into())?)
            }
        };
        binding.current()?;
        Ok(Self { binding, source })
    }
    pub fn stamp(&self) -> &WriteContextStamp {
        &self.binding.stamp
    }
    fn permit(&self, plan: Plan) -> Result<NativeWritePermit, WriteResourceError> {
        self.binding.current()?;
        Ok(NativeWritePermit::new(Arc::clone(&self.binding), plan))
    }
    pub fn prepare_profile(
        &self,
        input: &impl ProfileFields,
        route: ProfileWriteRoute,
        epoch: f64,
    ) -> Result<NativeWritePermit, WriteResourceError> {
        self.binding.current()?;
        let Source::Profile(source) = &self.source else {
            return Err(WriteResourceError::InvalidContext);
        };
        self.permit(Plan::Profile(Box::new(
            source.prepare(input, route, epoch)?,
        )))
    }
    pub(crate) fn prepare_day(
        &self,
        operation: &str,
        input: &Value,
        epoch: f64,
        allocated_id: &str,
    ) -> Result<NativeWritePermit, WriteResourceError> {
        self.binding.current()?;
        let Source::Day(source) = &self.source else {
            return Err(WriteResourceError::InvalidContext);
        };
        self.permit(Plan::Day(source.prepare(
            operation,
            input,
            epoch,
            allocated_id,
        )?))
    }
    pub fn prepare_net(
        &self,
        settings: &InitialNetSettings,
        epoch: f64,
    ) -> Result<NativeWritePermit, WriteResourceError> {
        self.binding.current()?;
        let Source::Payroll(source) = &self.source else {
            return Err(WriteResourceError::InvalidContext);
        };
        self.permit(Plan::Payroll(
            NetPlanSource::new(source.timeline()?, epoch).continuous_save(settings)?,
        ))
    }
    pub fn prepare_template(
        &self,
        operation: TemplateWriteOperation,
        input: &Value,
        epochs: &[f64],
        allocated_id: Option<&str>,
    ) -> Result<NativeWritePermit, WriteResourceError> {
        self.binding.current()?;
        let Source::Template(source) = &self.source else {
            return Err(WriteResourceError::InvalidContext);
        };
        self.permit(Plan::Template(
            source
                .prepare(operation, input, epochs, allocated_id)
                .into_result()?,
        ))
    }
    pub fn prepare_annual_reset(
        &self,
        year: i32,
        epoch: f64,
    ) -> Result<NativeWritePermit, WriteResourceError> {
        self.binding.current()?;
        let Source::Payroll(source) = &self.source else {
            return Err(WriteResourceError::InvalidContext);
        };
        self.permit(Plan::Payroll(
            NetPlanSource::new(source.timeline()?, epoch).reset_annual(year)?,
        ))
    }
    pub fn prepare_timing(
        &self,
        month: &str,
        choice: &str,
        epoch: f64,
    ) -> Result<NativeWritePermit, WriteResourceError> {
        self.binding.current()?;
        let Source::Payroll(source) = &self.source else {
            return Err(WriteResourceError::InvalidContext);
        };
        self.permit(Plan::Payroll(
            TimingPlanSource::from_raw_row(source.preference.as_ref(), epoch)?
                .set_lag(month, choice)?,
        ))
    }
    pub fn take(
        &self,
        p: &NativeWritePermit,
    ) -> Result<super::TakenNativeWrite, WriteResourceError> {
        p.take(&self.binding)
    }
    pub fn acknowledge(
        &self,
        p: &NativeWritePermit,
        stamp: WriteContextStamp,
    ) -> Result<super::CommittedNativeWrite, WriteResourceError> {
        p.acknowledge(&self.binding, stamp)
    }
    /// Rolled-back writes discard the capability; they are never cache-replayed.
    pub fn abort(&self, p: &NativeWritePermit) -> Result<(), WriteResourceError> {
        p.abort(&self.binding)
    }
}
fn payroll_source(raw: Value) -> Result<PayrollSource, WriteResourceError> {
    let Value::Object(mut raw) = raw else {
        return Err(WriteResourceError::InvalidContext);
    };
    if raw.len() != 4 {
        return Err(WriteResourceError::InvalidContext);
    }
    let Value::Array(rows) = raw
        .remove("netProfiles")
        .ok_or(WriteResourceError::InvalidContext)?
    else {
        return Err(WriteResourceError::InvalidContext);
    };
    let preference = raw
        .remove("salaryPreference")
        .ok_or(WriteResourceError::InvalidContext)?;
    let profiles = raw
        .remove("profileRows")
        .ok_or(WriteResourceError::InvalidContext)?;
    let tests = raw
        .remove("testMonths")
        .ok_or(WriteResourceError::InvalidContext)?;
    if !profiles.as_array().is_some_and(|a| {
        a.len() <= 1
            && a.iter().all(|r| {
                r.as_object()
                    .is_some_and(|o| o.len() == 1 && o.get("id").is_some_and(|i| i == "singleton"))
            })
    }) || !tests.as_array().is_some_and(|a| {
        a.len() <= 50_000
            && a.iter().all(|r| {
                r.as_object()
                    .is_some_and(|o| o.len() == 1 && o.get("month").is_some_and(Value::is_string))
            })
    }) || (!preference.is_null()
        && !preference.as_object().is_some_and(|o| {
            o.len() == 2
                && ["value", "updated_at"]
                    .iter()
                    .all(|k| o.get(*k).is_some_and(Value::is_string))
        }))
    {
        return Err(WriteResourceError::InvalidContext);
    }
    // Old preference timestamps are unparsed CAS text in the original repository.
    Ok(PayrollSource {
        raw_timeline: Arc::new(rows),
        timeline: OnceLock::new(),
        preference: (!preference.is_null()).then_some(preference),
    })
}
