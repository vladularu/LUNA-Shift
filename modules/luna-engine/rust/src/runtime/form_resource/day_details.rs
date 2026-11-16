//! Read-only day-detail resources use the existing private source/owner pool.
use super::*;
use crate::runtime::day_details_source::{
    DayDetailsSourceError, NativeDayDetailsAssembly, NativeDayDetailsCompletion,
    NativeDayDetailsSource,
};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(super) enum Family {
    Calendar,
    Catalog,
}
pub(super) struct Opening {
    assembly: NativeDayDetailsAssembly,
    date: String,
    calendar_ranks: Option<Vec<u8>>,
    raw_bytes: usize,
}
pub(super) struct DayDetailsState {
    source: NativeDayDetailsSource,
    completion: Option<NativeDayDetailsCompletion>,
}
fn source_error(error: DayDetailsSourceError) -> FormResourceError {
    match error {
        DayDetailsSourceError::OwnerChanged => FormResourceError::OwnerChanged,
        DayDetailsSourceError::Poisoned => FormResourceError::Poisoned,
        _ => FormResourceError::InvalidSource,
    }
}
fn empty(raw: &[u8]) -> Result<(), FormResourceError> {
    if raw.is_empty() {
        Ok(())
    } else {
        Err(FormResourceError::InvalidHeader)
    }
}
impl DayDetailsState {
    fn check(&self, revision: u64, epoch: i64) -> Result<(), FormResourceError> {
        if revision != 0 {
            return Err(FormResourceError::StaleResource);
        }
        if !self.source.is_fresh_at(epoch).map_err(source_error)? {
            return Err(FormResourceError::StaleResource);
        }
        Ok(())
    }
    fn outcome(&self, id: u64, epoch: i64) -> Result<Value, FormResourceError> {
        self.check(0, epoch)?;
        match &self.completion {
            Some(view) => Ok(
                json!({"state":"DAY_DETAILS_READY","resourceId":id,"resourceRevision":0,"validUntilEpochMilliseconds":self.source.valid_until_epoch_milliseconds().map_err(source_error)?,"view":view.metadata().map_err(source_error)?,"rowCount":view.entry_count().map_err(source_error)?}),
            ),
            None => Ok(
                json!({"state":"DAY_DETAILS_LOADING","resourceId":id,"resourceRevision":0,"validUntilEpochMilliseconds":self.source.valid_until_epoch_milliseconds().map_err(source_error)?,"rowCount":0}),
            ),
        }
    }
}
impl FormResourcePool {
    pub(super) fn run_day_details(
        &self,
        marker: &UtilityOwnerMarker,
        r: &request::Request,
        raw: &[u8],
    ) -> Result<Value, FormResourceError> {
        use request::Command::*;
        match &r.command {
            BeginDayDetails {
                stamp,
                observed_epoch_milliseconds,
                date,
            } => {
                empty(raw)?;
                if r.guard.draft_revision() != 0 {
                    return Err(FormResourceError::InvalidHeader);
                }
                stamp
                    .validate()
                    .map_err(|_| FormResourceError::InvalidHeader)?;
                crate::calendar::parse_date(date).map_err(|_| FormResourceError::InvalidHeader)?;
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
                let builder = Arc::new(source::Builder {
                    owner: marker.clone(),
                    request_id: r.guard.request_id().into(),
                    active: AtomicBool::new(true),
                    stamp: stamp.clone(),
                    epoch: *observed_epoch_milliseconds,
                    source: Mutex::new(Some(source::BuilderBody {
                        assembly,
                        kind: source::BuilderKind::DayDetails { date: date.clone() },
                        raw_bytes: 0,
                    })),
                    day_details: Mutex::new(None),
                });
                let mut state = self.state.lock().map_err(|_| FormResourceError::Poisoned)?;
                if state.builders.len() >= 4 || state.resources.len() >= 8 {
                    return Err(FormResourceError::Capacity);
                }
                state.builders.insert(id, builder);
                Ok(json!({"state":"DAY_DETAILS_SOURCE_OPEN","builderId":id}))
            }
            DayDetailsCatalog { builder_id, group } => {
                let builder = self.builder(*builder_id, &r.guard)?;
                let mut slot = builder
                    .source
                    .try_lock()
                    .map_err(|_| FormResourceError::Busy)?;
                let body = slot.as_mut().ok_or(FormResourceError::UnknownBuilder)?;
                if !matches!(body.kind, source::BuilderKind::DayDetails { .. }) {
                    return Err(FormResourceError::InvalidHeader);
                }
                let bytes = body
                    .raw_bytes
                    .checked_add(raw.len())
                    .filter(|n| *n <= MAX_FORM_BODY_BYTES)
                    .ok_or(FormResourceError::InputTooLarge)?;
                body.assembly
                    .catalog(
                        &serde_json::to_vec(group).map_err(|_| FormResourceError::InvalidSource)?,
                        raw,
                    )
                    .map_err(|_| FormResourceError::InvalidSource)?;
                body.raw_bytes = bytes;
                builder.check(&r.guard)?;
                Ok(json!({"state":"DAY_DETAILS_SOURCE_OPEN","builderId":builder_id}))
            }
            PrepareDayDetails { builder_id } => {
                empty(raw)?;
                let builder = self.builder(*builder_id, &r.guard)?;
                let mut prepared = builder
                    .day_details
                    .try_lock()
                    .map_err(|_| FormResourceError::Busy)?;
                if prepared.is_some() {
                    return Err(FormResourceError::StaleResource);
                }
                let mut source_slot = builder
                    .source
                    .try_lock()
                    .map_err(|_| FormResourceError::Busy)?;
                if !source_slot
                    .as_ref()
                    .is_some_and(|body| matches!(body.kind, source::BuilderKind::DayDetails { .. }))
                {
                    return Err(FormResourceError::InvalidHeader);
                }
                let body = source_slot
                    .take()
                    .ok_or(FormResourceError::UnknownBuilder)?;
                drop(source_slot);
                let source::BuilderKind::DayDetails { date } = body.kind else {
                    return Err(FormResourceError::InvalidHeader);
                };
                let mut assembly = NativeDayDetailsAssembly::new(
                    builder.owner.clone(),
                    builder.stamp.clone(),
                    body.assembly,
                    builder.epoch,
                    &date,
                )
                .map_err(source_error)?;
                assembly.prepare().map_err(source_error)?;
                builder.check(&r.guard)?;
                *prepared = Some(Opening {
                    assembly,
                    date,
                    calendar_ranks: None,
                    raw_bytes: body.raw_bytes,
                });
                Ok(json!({"state":"DAY_DETAILS_PREFLIGHT_READY","builderId":builder_id}))
            }
            DayDetailsCandidates {
                builder_id,
                family,
                offset,
            } => {
                empty(raw)?;
                let builder = self.builder(*builder_id, &r.guard)?;
                let slot = builder
                    .day_details
                    .try_lock()
                    .map_err(|_| FormResourceError::Busy)?;
                let opening = slot.as_ref().ok_or(FormResourceError::UnknownBuilder)?;
                let names = match family {
                    Family::Calendar => opening.assembly.calendar_candidates(),
                    Family::Catalog => opening.assembly.catalog_candidates(),
                }
                .map_err(source_error)?;
                if *offset as usize > names.len() {
                    return Err(FormResourceError::InvalidHeader);
                }
                let mut page = Vec::new();
                let mut size = 0;
                for name in names.iter().skip(*offset as usize).take(128) {
                    let bytes = serde_json::to_vec(name)
                        .map_err(|_| FormResourceError::OutputTooLarge)?
                        .len();
                    if size + bytes > 131_072 {
                        break;
                    }
                    size += bytes;
                    page.push(name);
                }
                if page.is_empty() && (*offset as usize) < names.len() {
                    return Err(FormResourceError::OutputTooLarge);
                }
                builder.check(&r.guard)?;
                Ok(
                    json!({"state":"DAY_DETAILS_CANDIDATES","builderId":builder_id,"offset":offset,"total":names.len(),"values":page}),
                )
            }
            DayDetailsCalendarRanks { builder_id } => {
                let builder = self.builder(*builder_id, &r.guard)?;
                let mut slot = builder
                    .day_details
                    .try_lock()
                    .map_err(|_| FormResourceError::Busy)?;
                let opening = slot.as_mut().ok_or(FormResourceError::UnknownBuilder)?;
                if opening.calendar_ranks.is_some() {
                    return Err(FormResourceError::StaleResource);
                }
                opening.raw_bytes = opening
                    .raw_bytes
                    .checked_add(raw.len())
                    .filter(|n| *n <= MAX_FORM_BODY_BYTES)
                    .ok_or(FormResourceError::InputTooLarge)?;
                opening.calendar_ranks = Some(raw.to_vec());
                builder.check(&r.guard)?;
                Ok(json!({"state":"DAY_DETAILS_PREFLIGHT_READY","builderId":builder_id}))
            }
            OpenDayDetails {
                builder_id,
                observed_epoch_milliseconds,
            } => {
                let builder = self.builder(*builder_id, &r.guard)?;
                let opening = builder
                    .day_details
                    .try_lock()
                    .map_err(|_| FormResourceError::Busy)?
                    .take()
                    .ok_or(FormResourceError::UnknownBuilder)?;
                if opening
                    .raw_bytes
                    .checked_add(raw.len())
                    .is_none_or(|n| n > MAX_FORM_BODY_BYTES)
                {
                    return Err(FormResourceError::InputTooLarge);
                }
                let ranks = opening
                    .calendar_ranks
                    .ok_or(FormResourceError::InvalidSource)?;
                let source = opening.assembly.finish(&ranks, raw).map_err(source_error)?;
                if !source
                    .is_fresh_at(*observed_epoch_milliseconds)
                    .map_err(source_error)?
                {
                    return Err(FormResourceError::StaleResource);
                }
                let completion = source.project(&opening.date).map_err(source_error)?;
                let details = Box::new(DayDetailsState { source, completion });
                let id = self.next()?;
                let outcome = details.outcome(id, *observed_epoch_milliseconds)?;
                builder.check(&r.guard)?;
                let resource = Arc::new(source::Resource {
                    owner: builder.owner.clone(),
                    request_id: builder.request_id.clone(),
                    active: AtomicBool::new(true),
                    data: source::ResourceData::DayDetails {
                        state: Mutex::new(details),
                    },
                });
                let mut state = self.state.lock().map_err(|_| FormResourceError::Poisoned)?;
                if state.resources.len() >= 8 {
                    return Err(FormResourceError::Capacity);
                }
                state.resources.insert(id, resource);
                builder.active.store(false, Ordering::Release);
                Ok(outcome)
            }
            DayDetailsRows {
                resource_id,
                resource_revision,
                observed_epoch_milliseconds,
                offset,
                limit,
            } => {
                empty(raw)?;
                let resource = self.resource(*resource_id, &r.guard, *resource_revision)?;
                let source::ResourceData::DayDetails { state } = &resource.data else {
                    return Err(FormResourceError::InvalidHeader);
                };
                let state = state.try_lock().map_err(|_| FormResourceError::Busy)?;
                state.check(*resource_revision, *observed_epoch_milliseconds)?;
                let completion = state
                    .completion
                    .as_ref()
                    .ok_or(FormResourceError::InvalidSource)?;
                let rows = completion.rows(*offset, *limit).map_err(source_error)?;
                crate::report::cache_budget::serialized_bytes(&rows, 131_072)
                    .ok_or(FormResourceError::OutputTooLarge)?;
                resource.check(&r.guard)?;
                Ok(
                    json!({"state":"DAY_DETAILS_ROWS","resourceId":resource_id,"resourceRevision":0,"offset":offset,"total":completion.entry_count().map_err(source_error)?,"rows":rows}),
                )
            }
            _ => Err(FormResourceError::InvalidHeader),
        }
    }
}
