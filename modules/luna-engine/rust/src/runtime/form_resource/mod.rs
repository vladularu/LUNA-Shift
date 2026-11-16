//! Dedicated private form transport; it does not alter the utility or report
//! snapshot channels. Native domain producers remain the only plan constructors.
mod day;
mod day_details;
mod payroll;
mod profile;
mod request;
mod source;
use super::{
    SnapshotRegistry,
    utility_lease::{UtilityLease, UtilityOwnerMarker},
};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
pub const MAX_FORM_HEADER_BYTES: usize = 8192;
pub const MAX_FORM_BODY_BYTES: usize = 16_515_072;
pub const MAX_FORM_REPLY_BYTES: usize = 33_554_432;
pub const MAX_FORM_METADATA_BYTES: usize = 1_048_576;
pub const MAX_FORM_PLAN_BYTES: usize = 16_515_072;
#[derive(Debug)]
pub enum FormResourceError {
    NotImplemented,
    InvalidHeader,
    UnsupportedSchema,
    UnsupportedEngine,
    UnsupportedContract,
    OwnerChanged,
    UnknownBuilder,
    UnknownResource,
    StaleResource,
    InvalidSource,
    Busy,
    Capacity,
    InputTooLarge,
    OutputTooLarge,
    Poisoned,
    AlreadyPublished,
}
impl FormResourceError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotImplemented => "FORM_NOT_IMPLEMENTED",
            Self::InvalidHeader => "FORM_INVALID_HEADER",
            Self::UnsupportedSchema => "FORM_UNSUPPORTED_SCHEMA",
            Self::UnsupportedEngine => "FORM_UNSUPPORTED_ENGINE",
            Self::UnsupportedContract => "FORM_UNSUPPORTED_CONTRACT",
            Self::OwnerChanged => "FORM_OWNER_CHANGED",
            Self::UnknownBuilder => "FORM_UNKNOWN_BUILDER",
            Self::UnknownResource => "FORM_UNKNOWN_RESOURCE",
            Self::StaleResource => "FORM_STALE_RESOURCE",
            Self::InvalidSource => "FORM_INVALID_SOURCE",
            Self::Busy => "FORM_BUSY",
            Self::Capacity => "FORM_CAPACITY",
            Self::InputTooLarge => "FORM_INPUT_TOO_LARGE",
            Self::OutputTooLarge => "FORM_OUTPUT_TOO_LARGE",
            Self::Poisoned => "FORM_POISONED",
            Self::AlreadyPublished => "FORM_ALREADY_PUBLISHED",
        }
    }
}
#[derive(Default)]
struct State {
    sequence: u64,
    builders: BTreeMap<u64, Arc<source::Builder>>,
    resources: BTreeMap<u64, Arc<source::Resource>>,
}
#[derive(Default)]
pub struct FormResourcePool {
    state: Mutex<State>,
}
impl FormResourcePool {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn collect_retired(&self) -> Result<bool, FormResourceError> {
        let mut state = self.state.lock().map_err(|_| FormResourceError::Poisoned)?;
        let builders = state
            .builders
            .iter()
            .filter_map(|(id, b)| {
                (!b.active.load(Ordering::Acquire) || !b.owner.is_current().unwrap_or(false))
                    .then_some(*id)
            })
            .collect::<Vec<_>>();
        let resources = state
            .resources
            .iter()
            .filter_map(|(id, r)| {
                (!r.active.load(Ordering::Acquire) || !r.owner.is_current().unwrap_or(false))
                    .then_some(*id)
            })
            .collect::<Vec<_>>();
        let gone_builders = builders
            .into_iter()
            .filter_map(|id| state.builders.remove(&id))
            .collect::<Vec<_>>();
        let gone_resources = resources
            .into_iter()
            .filter_map(|id| state.resources.remove(&id))
            .collect::<Vec<_>>();
        drop(state);
        let removed = !gone_builders.is_empty() || !gone_resources.is_empty();
        drop(gone_builders);
        drop(gone_resources);
        Ok(removed)
    }
    pub fn prepare(
        &self,
        registry: &SnapshotRegistry,
        marker: &UtilityOwnerMarker,
        header: &[u8],
        raw_body: &[u8],
    ) -> Result<PreparedFormResource, FormResourceError> {
        if header.len() > MAX_FORM_HEADER_BYTES || raw_body.len() > MAX_FORM_BODY_BYTES {
            return Err(FormResourceError::InputTooLarge);
        }
        let r = request::parse(header)?;
        let lease = registry
            .lease_utility(
                marker,
                &r.guard,
                crate::contract::utility::UtilityKind::ProfileForm,
            )
            .map_err(|_| FormResourceError::OwnerChanged)?;
        self.collect_retired()?;
        let outcome = self.run(registry, marker, &r, raw_body)?;
        if !lease
            .is_current()
            .map_err(|_| FormResourceError::Poisoned)?
        {
            return Err(FormResourceError::OwnerChanged);
        }
        let Value::Object(mut reply) = outcome else {
            return Err(FormResourceError::InvalidSource);
        };
        for (key, value) in [
            ("ok", json!(true)),
            ("wireSchemaVersion", json!(crate::contract::SCHEMA_VERSION)),
            ("engineVersion", json!(crate::ENGINE_VERSION)),
            (
                "calculationContractVersion",
                json!(crate::contract::CONTRACT_VERSION),
            ),
            (
                "guard",
                serde_json::to_value(&r.guard).map_err(|_| FormResourceError::InvalidHeader)?,
            ),
        ] {
            reply.insert(key.into(), value);
        }
        let limit = if reply.contains_key("planBody") {
            MAX_FORM_REPLY_BYTES
        } else {
            MAX_FORM_METADATA_BYTES
        };
        crate::report::cache_budget::serialized_bytes(&reply, limit as u64)
            .ok_or(FormResourceError::OutputTooLarge)?;
        let reply = serde_json::to_vec(&reply).map_err(|_| FormResourceError::OutputTooLarge)?;
        Ok(PreparedFormResource {
            lease,
            reply: Mutex::new(Some(reply)),
        })
    }
    fn next(&self) -> Result<u64, FormResourceError> {
        let mut s = self.state.lock().map_err(|_| FormResourceError::Poisoned)?;
        s.sequence = s
            .sequence
            .checked_add(1)
            .filter(|n| *n <= crate::money::MAX_SAFE_INTEGER as u64)
            .ok_or(FormResourceError::Capacity)?;
        Ok(s.sequence)
    }
    fn builder(
        &self,
        id: u64,
        g: &crate::contract::utility::UtilityGuard,
    ) -> Result<Arc<source::Builder>, FormResourceError> {
        let b = self
            .state
            .lock()
            .map_err(|_| FormResourceError::Poisoned)?
            .builders
            .get(&id)
            .cloned()
            .ok_or(FormResourceError::UnknownBuilder)?;
        b.check(g)?;
        Ok(b)
    }
    fn resource(
        &self,
        id: u64,
        guard: &crate::contract::utility::UtilityGuard,
        revision: u64,
    ) -> Result<Arc<source::Resource>, FormResourceError> {
        if guard.draft_revision() != revision {
            return Err(FormResourceError::StaleResource);
        }
        let resource = self
            .state
            .lock()
            .map_err(|_| FormResourceError::Poisoned)?
            .resources
            .get(&id)
            .cloned()
            .ok_or(FormResourceError::UnknownResource)?;
        resource.check(guard)?;
        Ok(resource)
    }
    fn run(
        &self,
        registry: &SnapshotRegistry,
        marker: &UtilityOwnerMarker,
        r: &request::Request,
        raw: &[u8],
    ) -> Result<Value, FormResourceError> {
        use request::Command::*;
        match &r.command {
            BeginDayDetails { .. }
            | DayDetailsCatalog { .. }
            | PrepareDayDetails { .. }
            | DayDetailsCandidates { .. }
            | DayDetailsCalendarRanks { .. }
            | OpenDayDetails { .. }
            | DayDetailsRows { .. } => self.run_day_details(marker, r, raw),
            BeginDayEditor {
                stamp,
                observed_epoch_milliseconds,
                request,
                appearance,
            } => {
                if !raw.is_empty() || r.guard.draft_revision() != 0 {
                    return Err(FormResourceError::InvalidHeader);
                }
                stamp
                    .validate()
                    .map_err(|_| FormResourceError::InvalidHeader)?;
                crate::contract::RawClockContext::from_epoch_milliseconds(
                    *observed_epoch_milliseconds,
                )
                .map_err(|_| FormResourceError::InvalidHeader)?;
                let id = self.next()?;
                let header = json!({"ownerScope":r.guard.owner_scope(),"ownerEpoch":r.guard.owner_epoch(),"snapshotId":format!("form-{id}"),"snapshotRevision":1,"selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}});
                let assembly = crate::contract::assembly::SnapshotAssembly::begin(
                    &serde_json::to_vec(&header).map_err(|_| FormResourceError::InvalidHeader)?,
                )
                .map_err(|_| FormResourceError::InvalidHeader)?;
                let request = super::day_editor_source::DayEditorOpenRequest {
                    entry_id: request.entry_id.clone(),
                    mode: request.mode,
                    date: request.date.clone(),
                };
                let body = source::BuilderBody {
                    assembly,
                    kind: source::BuilderKind::Day(Box::new(day::Opening {
                        request,
                        appearance: appearance.clone(),
                        groups: Vec::new(),
                    })),
                    raw_bytes: 0,
                };
                let builder = Arc::new(source::Builder {
                    owner: marker.clone(),
                    request_id: r.guard.request_id().into(),
                    active: AtomicBool::new(true),
                    stamp: stamp.clone(),
                    epoch: *observed_epoch_milliseconds,
                    source: Mutex::new(Some(body)),
                    day_details: Mutex::new(None),
                });
                let mut state = self.state.lock().map_err(|_| FormResourceError::Poisoned)?;
                if state.builders.len() >= 4 || state.resources.len() >= 8 {
                    return Err(FormResourceError::Capacity);
                }
                state.builders.insert(id, builder);
                Ok(json!({"state":"DAY_SOURCE_OPEN","builderId":id}))
            }
            DaySource { builder_id, group } => {
                let builder = self.builder(*builder_id, &r.guard)?;
                let mut slot = builder
                    .source
                    .try_lock()
                    .map_err(|_| FormResourceError::Busy)?;
                let body = slot.as_mut().ok_or(FormResourceError::UnknownBuilder)?;
                let bytes = body
                    .raw_bytes
                    .checked_add(raw.len())
                    .filter(|value| *value <= MAX_FORM_BODY_BYTES)
                    .ok_or(FormResourceError::InputTooLarge)?;
                let source::BuilderKind::Day(opening) = &mut body.kind else {
                    return Err(FormResourceError::InvalidHeader);
                };
                opening.supply(group, raw)?;
                body.raw_bytes = bytes;
                builder.check(&r.guard)?;
                Ok(json!({"state":"DAY_SOURCE_OPEN","builderId":builder_id}))
            }
            OpenDayEditor { builder_id } => {
                if !raw.is_empty() {
                    return Err(FormResourceError::InvalidHeader);
                }
                let builder = self.builder(*builder_id, &r.guard)?;
                let body = builder
                    .source
                    .try_lock()
                    .map_err(|_| FormResourceError::Busy)?
                    .take()
                    .ok_or(FormResourceError::UnknownBuilder)?;
                let result = day::open(&builder, body);
                let current = builder.check(&r.guard);
                builder.active.store(false, Ordering::Release);
                current?;
                let day = match result? {
                    day::Open::Ready(day) => day,
                    day::Open::Unavailable(frame) => return Ok(frame),
                };
                let id = self.next()?;
                let outcome = day.outcome(id)?;
                let resource = Arc::new(source::Resource {
                    owner: marker.clone(),
                    request_id: r.guard.request_id().into(),
                    active: AtomicBool::new(true),
                    data: source::ResourceData::Day {
                        state: Mutex::new(day),
                    },
                });
                let mut state = self.state.lock().map_err(|_| FormResourceError::Poisoned)?;
                if state.resources.len() >= 8 {
                    return Err(FormResourceError::Capacity);
                }
                state.resources.insert(id, resource);
                Ok(outcome)
            }
            DayEvent {
                resource_id,
                resource_revision,
                observed_epoch_milliseconds,
                event,
            } => {
                crate::contract::RawClockContext::from_epoch_milliseconds(
                    *observed_epoch_milliseconds,
                )
                .map_err(|_| FormResourceError::InvalidHeader)?;
                let resource = self.resource(*resource_id, &r.guard, *resource_revision)?;
                let source::ResourceData::Day { state } = &resource.data else {
                    return Err(FormResourceError::InvalidHeader);
                };
                let mut state = state.try_lock().map_err(|_| FormResourceError::Busy)?;
                state.check(*resource_revision)?;
                if let Some(billing) = state.billing_event(event, raw)? {
                    let mut value = state.outcome(*resource_id)?;
                    if billing["state"] == "SOURCE_REQUIRED" {
                        value["feedback"] = json!({"state":"REVIEW_REQUIRED","stored":false});
                    } else {
                        value["billing"] = billing;
                    }
                    resource.check(&r.guard)?;
                    return Ok(value);
                }
                if let Some(review) =
                    state.review_event(event, raw, *observed_epoch_milliseconds)?
                {
                    let mut value = state.outcome(*resource_id)?;
                    value["review"] = review;
                    resource.check(&r.guard)?;
                    return Ok(value);
                }
                let feedback = state.event(event, raw)?;
                let mut value = state.outcome(*resource_id)?;
                if let Some(feedback) = feedback {
                    value["state"] = json!("DAY_SAVE_PREVIEW");
                    value["feedback"] = feedback;
                }
                resource.check(&r.guard)?;
                Ok(value)
            }
            BeginPayroll {
                stamp,
                observed_epoch_milliseconds,
                locator,
                month,
                mode,
            } => {
                use super::payroll_form::source::{PayrollSource, PayrollSourceOpen};
                if !raw.is_empty() || r.guard.draft_revision() != 0 {
                    return Err(FormResourceError::InvalidHeader);
                }
                stamp
                    .validate()
                    .map_err(|_| FormResourceError::InvalidHeader)?;
                crate::contract::RawClockContext::from_epoch_milliseconds(
                    *observed_epoch_milliseconds,
                )
                .map_err(|_| FormResourceError::InvalidHeader)?;
                let guard = r
                    .guard
                    .bind_report_snapshot(locator)
                    .map_err(|_| FormResourceError::InvalidHeader)?;
                let lease = registry
                    .lease_utility(
                        marker,
                        &guard,
                        crate::contract::utility::UtilityKind::PayrollForm,
                    )
                    .map_err(|_| FormResourceError::InvalidSource)?;
                let facts = lease.facts().ok_or(FormResourceError::InvalidSource)?;
                let source = match PayrollSource::open(facts, month, *mode) {
                    Ok(PayrollSourceOpen::Ready(source)) => source,
                    Ok(PayrollSourceOpen::NeedsFinance) => {
                        return Ok(json!({"state":"PAYROLL_NEEDS_FINANCE"}));
                    }
                    Ok(PayrollSourceOpen::Unavailable(value)) => {
                        return Ok(
                            json!({"state":"FORM_UNAVAILABLE","reason":value.get("reason").cloned().unwrap_or_else(||json!({"code":value["code"]}))}),
                        );
                    }
                    Err(error) => {
                        return Ok(
                            json!({"state":"FORM_UNAVAILABLE","reason":{"code":"PAYROLL_FORM_INVALID"},"error":{"name":error.name(),"message":error.message(),"userFacing":error.user_facing_message().is_some()}}),
                        );
                    }
                };
                if !lease
                    .is_current()
                    .map_err(|_| FormResourceError::Poisoned)?
                {
                    return Err(FormResourceError::InvalidSource);
                }
                let id = self.next()?;
                let state = payroll::PayrollState::new(source, stamp.clone())?;
                let outcome = state.outcome(id);
                let resource = Arc::new(source::Resource {
                    owner: marker.clone(),
                    request_id: r.guard.request_id().into(),
                    active: AtomicBool::new(true),
                    data: source::ResourceData::Payroll {
                        state: Mutex::new(Box::new(state)),
                    },
                });
                let mut pool = self.state.lock().map_err(|_| FormResourceError::Poisoned)?;
                if pool.resources.len() >= 8 {
                    return Err(FormResourceError::Capacity);
                }
                pool.resources.insert(id, resource);
                Ok(outcome)
            }
            PayrollEvent {
                resource_id,
                resource_revision,
                observed_epoch_milliseconds,
                event,
            } => {
                if !raw.is_empty() {
                    return Err(FormResourceError::InvalidHeader);
                }
                crate::contract::RawClockContext::from_epoch_milliseconds(
                    *observed_epoch_milliseconds,
                )
                .map_err(|_| FormResourceError::InvalidHeader)?;
                let resource = self.resource(*resource_id, &r.guard, *resource_revision)?;
                let source::ResourceData::Payroll { state } = &resource.data else {
                    return Err(FormResourceError::InvalidHeader);
                };
                let mut state = state.try_lock().map_err(|_| FormResourceError::Busy)?;
                state.check(*resource_revision)?;
                let closed = state.event(event)?;
                let value = if closed {
                    json!({"state":"CLOSED","effects":{"kind":"NO_CHANGE"}})
                } else {
                    state.outcome(*resource_id)
                };
                resource.check(&r.guard)?;
                if closed {
                    resource.active.store(false, Ordering::Release);
                }
                Ok(value)
            }
            ProfileEvent {
                resource_id,
                resource_revision,
                observed_epoch_milliseconds,
                event,
            } => {
                crate::contract::RawClockContext::from_epoch_milliseconds(
                    *observed_epoch_milliseconds,
                )
                .map_err(|_| FormResourceError::InvalidHeader)?;
                let resource = self.resource(*resource_id, &r.guard, *resource_revision)?;
                let rules = super::profile_form_facade::resolver()
                    .map_err(|_| FormResourceError::InvalidSource)?;
                let mut state = resource
                    .profile()?
                    .1
                    .try_lock()
                    .map_err(|_| FormResourceError::Busy)?;
                state.check(*resource_revision)?;
                let body_event;
                let event = if matches!(event, profile::Event::IntentBody) {
                    if raw.len() > 256 * 1024 {
                        return Err(FormResourceError::InputTooLarge);
                    }
                    let value = crate::contract::bounded_json(raw)
                        .map_err(|_| FormResourceError::InvalidHeader)?;
                    let intent = serde_json::from_value(value)
                        .map_err(|_| FormResourceError::InvalidHeader)?;
                    body_event = profile::Event::Intent { intent };
                    &body_event
                } else {
                    if !raw.is_empty() {
                        return Err(FormResourceError::InvalidHeader);
                    }
                    event
                };
                state.event(event, *observed_epoch_milliseconds, rules)?;
                let value = state.outcome(*resource_id, *observed_epoch_milliseconds, rules)?;
                resource.check(&r.guard)?;
                Ok(value)
            }
            WriteContext {
                resource_id,
                resource_revision,
                write_id,
                stamp,
                observed_epoch_milliseconds,
                allocated_id,
            } => {
                crate::contract::RawClockContext::from_epoch_milliseconds(
                    *observed_epoch_milliseconds,
                )
                .map_err(|_| FormResourceError::InvalidHeader)?;
                let resource = self.resource(*resource_id, &r.guard, *resource_revision)?;
                let value = match &resource.data {
                    source::ResourceData::DayDetails { .. } => {
                        return Err(FormResourceError::InvalidHeader);
                    }
                    source::ResourceData::Profile { state, .. } => {
                        if allocated_id.is_some() {
                            return Err(FormResourceError::InvalidHeader);
                        }
                        let rules = super::profile_form_facade::resolver()
                            .map_err(|_| FormResourceError::InvalidSource)?;
                        let mut state = state.try_lock().map_err(|_| FormResourceError::Busy)?;
                        state.check(*resource_revision)?;
                        if stamp != &state.stamp {
                            return Err(FormResourceError::StaleResource);
                        }
                        let context = super::write_resource::NativeWriteContext::from_raw(
                            resource.owner.clone(),
                            stamp.clone(),
                            super::write_resource::WriteContextKind::Profile,
                            raw,
                        )
                        .map_err(|_| FormResourceError::InvalidSource)?;
                        state.prepare_write(
                            *write_id,
                            context,
                            *observed_epoch_milliseconds,
                            rules,
                        )?;
                        state.outcome(*resource_id, *observed_epoch_milliseconds, rules)?
                    }
                    source::ResourceData::Payroll { state } => {
                        if allocated_id.is_some() {
                            return Err(FormResourceError::InvalidHeader);
                        }
                        let mut state = state.try_lock().map_err(|_| FormResourceError::Busy)?;
                        state.check(*resource_revision)?;
                        if stamp != &state.stamp {
                            return Err(FormResourceError::StaleResource);
                        }
                        let context = super::write_resource::NativeWriteContext::from_raw(
                            resource.owner.clone(),
                            stamp.clone(),
                            super::write_resource::WriteContextKind::Payroll,
                            raw,
                        )
                        .map_err(|_| FormResourceError::InvalidSource)?;
                        state.prepare_write(*write_id, context, *observed_epoch_milliseconds)?;
                        state.outcome(*resource_id)
                    }
                    source::ResourceData::Day { state } => {
                        let mut state = state.try_lock().map_err(|_| FormResourceError::Busy)?;
                        state.check(*resource_revision)?;
                        if stamp != &state.stamp {
                            return Err(FormResourceError::StaleResource);
                        }
                        let context = super::write_resource::NativeWriteContext::from_raw(
                            resource.owner.clone(),
                            stamp.clone(),
                            super::write_resource::WriteContextKind::Day,
                            raw,
                        )
                        .map_err(|_| FormResourceError::InvalidSource)?;
                        state.prepare_write(
                            *write_id,
                            context,
                            *observed_epoch_milliseconds,
                            allocated_id.as_deref().unwrap_or(""),
                        )?;
                        state.outcome(*resource_id)?
                    }
                };
                resource.check(&r.guard)?;
                Ok(value)
            }
            TakeWrite {
                resource_id,
                resource_revision,
                write_id,
            } => {
                if !raw.is_empty() {
                    return Err(FormResourceError::InvalidHeader);
                }
                let resource = self.resource(*resource_id, &r.guard, *resource_revision)?;
                let taken = match &resource.data {
                    source::ResourceData::DayDetails { .. } => {
                        return Err(FormResourceError::InvalidHeader);
                    }
                    source::ResourceData::Profile { state, .. } => {
                        let state = state.try_lock().map_err(|_| FormResourceError::Busy)?;
                        state.check(*resource_revision)?;
                        state.take(*write_id)?
                    }
                    source::ResourceData::Payroll { state } => {
                        let state = state.try_lock().map_err(|_| FormResourceError::Busy)?;
                        state.check(*resource_revision)?;
                        state.take(*write_id)?
                    }
                    source::ResourceData::Day { state } => {
                        let state = state.try_lock().map_err(|_| FormResourceError::Busy)?;
                        state.check(*resource_revision)?;
                        state.take(*write_id)?
                    }
                };
                if taken.body.len() > MAX_FORM_PLAN_BYTES {
                    return Err(FormResourceError::OutputTooLarge);
                }
                resource.check(&r.guard)?;
                Ok(
                    json!({"state":"WRITE_PLAN_TAKEN","resourceId":resource_id,"resourceRevision":resource_revision,"writeId":write_id,"stamp":taken.stamp,"planBody":taken.body}),
                )
            }
            AckWrite {
                resource_id,
                resource_revision,
                write_id,
                stamp,
                observed_epoch_milliseconds,
            } => {
                if !raw.is_empty() {
                    return Err(FormResourceError::InvalidHeader);
                }
                crate::contract::RawClockContext::from_epoch_milliseconds(
                    *observed_epoch_milliseconds,
                )
                .map_err(|_| FormResourceError::InvalidHeader)?;
                let resource = self.resource(*resource_id, &r.guard, *resource_revision)?;
                let (mut value, closed) = match &resource.data {
                    source::ResourceData::DayDetails { .. } => {
                        return Err(FormResourceError::InvalidHeader);
                    }
                    source::ResourceData::Profile { source, state } => {
                        let rules = super::profile_form_facade::resolver()
                            .map_err(|_| FormResourceError::InvalidSource)?;
                        let mut state = state.try_lock().map_err(|_| FormResourceError::Busy)?;
                        state.check(*resource_revision)?;
                        let origin = source
                            .context()
                            .ok_or(FormResourceError::InvalidSource)?
                            .identity();
                        state.ack(
                            *write_id,
                            stamp.clone(),
                            origin,
                            *observed_epoch_milliseconds,
                            rules,
                        )?;
                        (
                            state.outcome(*resource_id, *observed_epoch_milliseconds, rules)?,
                            false,
                        )
                    }
                    source::ResourceData::Payroll { state } => {
                        let mut state = state.try_lock().map_err(|_| FormResourceError::Busy)?;
                        state.check(*resource_revision)?;
                        state.ack(*write_id, stamp.clone())?;
                        (json!({"state":"CLOSED"}), true)
                    }
                    source::ResourceData::Day { state } => {
                        let mut state = state.try_lock().map_err(|_| FormResourceError::Busy)?;
                        state.check(*resource_revision)?;
                        let effect =
                            state.ack(*write_id, stamp.clone(), *observed_epoch_milliseconds)?;
                        let mut value = state.outcome(*resource_id)?;
                        value["effects"] = json!({"kind":effect});
                        (value, false)
                    }
                };
                if value.get("effects").is_none() {
                    value["effects"] = json!({"kind":"SAVED"});
                }
                resource.check(&r.guard)?;
                if closed {
                    resource.active.store(false, Ordering::Release);
                }
                Ok(value)
            }
            AbortWrite {
                resource_id,
                resource_revision,
                write_id,
                failure,
                observed_epoch_milliseconds,
            } => {
                if !raw.is_empty() {
                    return Err(FormResourceError::InvalidHeader);
                }
                crate::contract::RawClockContext::from_epoch_milliseconds(
                    *observed_epoch_milliseconds,
                )
                .map_err(|_| FormResourceError::InvalidHeader)?;
                let resource = self.resource(*resource_id, &r.guard, *resource_revision)?;
                let value = match &resource.data {
                    source::ResourceData::DayDetails { .. } => {
                        return Err(FormResourceError::InvalidHeader);
                    }
                    source::ResourceData::Profile { state, .. } => {
                        let rules = super::profile_form_facade::resolver()
                            .map_err(|_| FormResourceError::InvalidSource)?;
                        let mut state = state.try_lock().map_err(|_| FormResourceError::Busy)?;
                        state.check(*resource_revision)?;
                        state.abort(*write_id, failure)?;
                        state.outcome(*resource_id, *observed_epoch_milliseconds, rules)?
                    }
                    source::ResourceData::Payroll { state } => {
                        let mut state = state.try_lock().map_err(|_| FormResourceError::Busy)?;
                        state.check(*resource_revision)?;
                        state.abort(*write_id, failure)?;
                        state.outcome(*resource_id)
                    }
                    source::ResourceData::Day { state } => {
                        let mut state = state.try_lock().map_err(|_| FormResourceError::Busy)?;
                        state.check(*resource_revision)?;
                        state.abort(*write_id, failure)?;
                        state.outcome(*resource_id)?
                    }
                };
                resource.check(&r.guard)?;
                Ok(value)
            }

            BeginProfile {
                stamp,
                observed_epoch_milliseconds,
                section,
                from_more,
            } => {
                if !raw.is_empty() || r.guard.draft_revision() != 0 {
                    return Err(FormResourceError::InvalidHeader);
                }
                stamp
                    .validate()
                    .map_err(|_| FormResourceError::InvalidHeader)?;
                crate::contract::RawClockContext::from_epoch_milliseconds(
                    *observed_epoch_milliseconds,
                )
                .map_err(|_| FormResourceError::InvalidHeader)?;
                let id = self.next()?;
                let header = json!({"ownerScope":r.guard.owner_scope(),"ownerEpoch":r.guard.owner_epoch(),"snapshotId":format!("form-{id}"),"snapshotRevision":1,"selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}});
                let assembly = crate::contract::assembly::SnapshotAssembly::begin(
                    &serde_json::to_vec(&header).map_err(|_| FormResourceError::InvalidHeader)?,
                )
                .map_err(|_| FormResourceError::InvalidHeader)?;
                let b = Arc::new(source::Builder {
                    owner: marker.clone(),
                    request_id: r.guard.request_id().into(),
                    active: AtomicBool::new(true),
                    stamp: stamp.clone(),
                    epoch: *observed_epoch_milliseconds,
                    day_details: Mutex::new(None),
                    source: Mutex::new(Some(source::BuilderBody {
                        assembly,
                        kind: source::BuilderKind::Profile {
                            section: *section,
                            from_more: *from_more,
                        },
                        raw_bytes: 0,
                    })),
                });
                let mut state = self.state.lock().map_err(|_| FormResourceError::Poisoned)?;
                if state.builders.len() >= 4 || state.resources.len() >= 8 {
                    return Err(FormResourceError::Capacity);
                }
                state.builders.insert(id, b);
                Ok(json!({"state":"PROFILE_SOURCE_OPEN","builderId":id}))
            }
            Source { builder_id, group } | DayDetailsSource { builder_id, group } => {
                let details_request = matches!(r.command, DayDetailsSource { .. });
                let profile_kind = matches!(
                    group.kind,
                    crate::contract::SourceKind::WorkProfile
                        | crate::contract::SourceKind::RemunerationProfiles
                        | crate::contract::SourceKind::WorkPatternSettings
                );
                if !details_request && !profile_kind {
                    return Err(FormResourceError::InvalidSource);
                }

                let b = self.builder(*builder_id, &r.guard)?;
                let mut slot = b.source.try_lock().map_err(|_| FormResourceError::Busy)?;
                let body = slot.as_mut().ok_or(FormResourceError::UnknownBuilder)?;
                if details_request && !matches!(body.kind, source::BuilderKind::DayDetails { .. }) {
                    return Err(FormResourceError::InvalidHeader);
                }
                let details_kind = matches!(body.kind, source::BuilderKind::DayDetails { .. })
                    && matches!(
                        group.kind,
                        crate::contract::SourceKind::CalendarEntries
                            | crate::contract::SourceKind::WorkingTimeTarget
                            | crate::contract::SourceKind::YouthPreference
                    );
                if !profile_kind && !details_kind {
                    return Err(FormResourceError::InvalidSource);
                }
                let bytes = body
                    .raw_bytes
                    .checked_add(raw.len())
                    .filter(|value| *value <= MAX_FORM_BODY_BYTES)
                    .ok_or(FormResourceError::InputTooLarge)?;
                body.assembly
                    .source(
                        &serde_json::to_vec(&json!({"kind":group.kind,"source":group.source}))
                            .map_err(|_| FormResourceError::InvalidSource)?,
                        raw,
                    )
                    .map_err(|_| FormResourceError::InvalidSource)?;
                body.raw_bytes = bytes;
                b.check(&r.guard)?;
                Ok(
                    json!({"state":match body.kind {source::BuilderKind::Profile{..}=>"PROFILE_SOURCE_OPEN",source::BuilderKind::Day(_)=>"DAY_SOURCE_OPEN",source::BuilderKind::DayDetails{..}=>"DAY_DETAILS_SOURCE_OPEN"},"builderId":builder_id}),
                )
            }
            OpenProfile { builder_id } => {
                if !raw.is_empty() {
                    return Err(FormResourceError::InvalidHeader);
                }
                let b = self.builder(*builder_id, &r.guard)?;
                let body = b
                    .source
                    .try_lock()
                    .map_err(|_| FormResourceError::Busy)?
                    .take()
                    .ok_or(FormResourceError::UnknownBuilder)?;
                let result = source::open(&b, body);
                let current = b.check(&r.guard);
                b.active.store(false, Ordering::Release);
                current?;
                let resource = result?;
                let resource = match resource {
                    source::OpenProfile::Ready(resource) => resource,
                    source::OpenProfile::Unavailable(frame) => return Ok(frame),
                };
                let id = self.next()?;
                let outcome = match resource.profile_outcome(id, b.epoch) {
                    Ok(outcome) => outcome,
                    Err(frame) => return Ok(frame),
                };
                if outcome["state"] != "PROFILE_READY" {
                    return Ok(outcome);
                }
                let mut state = self.state.lock().map_err(|_| FormResourceError::Poisoned)?;
                if state.resources.len() >= 8 {
                    return Err(FormResourceError::Capacity);
                }
                state.resources.insert(id, Arc::from(resource));
                Ok(outcome)
            }
            CloseBuilder { builder_id } => {
                if !raw.is_empty() {
                    return Err(FormResourceError::InvalidHeader);
                }
                let b = match self.builder(*builder_id, &r.guard) {
                    Ok(builder) => builder,
                    Err(FormResourceError::UnknownBuilder) => return Ok(json!({"state":"CLOSED"})),
                    Err(error) => return Err(error),
                };
                b.active.store(false, Ordering::Release);
                Ok(json!({"state":"CLOSED"}))
            }
            CloseResource { resource_id } => {
                if !raw.is_empty() {
                    return Err(FormResourceError::InvalidHeader);
                }
                let resource = self
                    .state
                    .lock()
                    .map_err(|_| FormResourceError::Poisoned)?
                    .resources
                    .get(resource_id)
                    .cloned();
                let Some(resource) = resource else {
                    return Ok(json!({"state":"CLOSED"}));
                };
                if resource.request_id != r.guard.request_id()
                    || !resource
                        .owner
                        .is_current()
                        .map_err(|_| FormResourceError::OwnerChanged)?
                {
                    return Err(FormResourceError::OwnerChanged);
                }
                resource.active.store(false, Ordering::Release);
                Ok(json!({"state":"CLOSED"}))
            }
        }
    }
}
pub struct PreparedFormResource {
    lease: UtilityLease,
    reply: Mutex<Option<Vec<u8>>>,
}
impl PreparedFormResource {
    pub fn is_current(&self) -> Result<bool, FormResourceError> {
        self.lease
            .is_current()
            .map_err(|_| FormResourceError::Poisoned)
    }
    pub fn complete(&self) -> Result<Vec<u8>, FormResourceError> {
        if !self.is_current()? {
            return Err(FormResourceError::OwnerChanged);
        }
        let mut reply = self.reply.lock().map_err(|_| FormResourceError::Poisoned)?;
        let bytes = reply.as_ref().ok_or(FormResourceError::AlreadyPublished)?;
        if bytes.len() > MAX_FORM_REPLY_BYTES {
            return Err(FormResourceError::OutputTooLarge);
        }
        if !self.is_current()? {
            return Err(FormResourceError::OwnerChanged);
        }
        Ok(reply.take().expect("private single publication buffer"))
    }
}
