//! Shared-pool adapter for the genuine source-bound day controller. A save
//! preview remains an intent. Actual saves use the shared private write permit.
#[path = "day_billing.rs"]
mod billing;
#[path = "day_review.rs"]
mod review;
#[path = "day_write.rs"]
mod write;
use super::*;
use crate::{
    input::{entry_editor_delete::RawDeletePreparation, entry_editor_save::RawSavePreparation},
    runtime::{
        day_editor_controller::NativeDayController,
        day_editor_source::{
            DayEditorOpenRequest, DayEditorSourceError, DayEntryReadState, DayEntrySourceKind,
            NativeDayEditorSource, RawDayEntrySource,
        },
        profile_editor_source::LightProfileContext,
    },
};
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(super) enum ReadState {
    Value,
    Null,
    Failed,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Group {
    pub kind: DayEntrySourceKind,
    pub state: ReadState,
}
pub(super) struct OwnedGroup {
    kind: DayEntrySourceKind,
    state: DayEntryReadState,
    body: Vec<u8>,
}
pub(super) struct Opening {
    pub request: DayEditorOpenRequest,
    pub appearance: Value,
    pub groups: Vec<OwnedGroup>,
}
impl Opening {
    pub fn supply(&mut self, group: &Group, raw: &[u8]) -> Result<(), FormResourceError> {
        if self.groups.iter().any(|old| old.kind == group.kind) {
            return Err(FormResourceError::InvalidSource);
        }
        let state = match group.state {
            ReadState::Value => DayEntryReadState::Value,
            ReadState::Null => DayEntryReadState::Null,
            ReadState::Failed => DayEntryReadState::Failed,
        };
        if state != DayEntryReadState::Value && !raw.is_empty() {
            return Err(FormResourceError::InvalidSource);
        }
        self.groups.push(OwnedGroup {
            kind: group.kind,
            state,
            body: raw.to_vec(),
        });
        Ok(())
    }
}
pub(super) enum Open {
    Ready(Box<DayState>),
    Unavailable(Value),
}
pub(super) fn unavailable(error: DayEditorSourceError) -> Result<Value, FormResourceError> {
    let (code, error) = match error {
        DayEditorSourceError::OwnerChanged => return Err(FormResourceError::OwnerChanged),
        DayEditorSourceError::StampChanged => return Err(FormResourceError::StaleResource),
        DayEditorSourceError::MissingEntry => ("DAY_ENTRY_MISSING", None),
        DayEditorSourceError::SourceFailed => ("DAY_SOURCE_READ_FAILED", None),
        DayEditorSourceError::InvalidSource => ("DAY_SOURCE_INVALID", None),
        DayEditorSourceError::Input(error) => (
            "DAY_SOURCE_INVALID",
            Some(
                json!({"name":error.name(),"message":error.message(),"userFacing":error.user_facing_message().is_some()}),
            ),
        ),
    };
    let mut frame = json!({"state":"FORM_UNAVAILABLE","reason":{"code":code}});
    if let Some(error) = error {
        frame["error"] = error;
    }
    Ok(frame)
}
pub(super) fn open(
    builder: &source::Builder,
    body: source::BuilderBody,
) -> Result<Open, FormResourceError> {
    let source::BuilderKind::Day(opening) = body.kind else {
        return Err(FormResourceError::InvalidHeader);
    };
    let light = match LightProfileContext::prepare(
        builder.owner.clone(),
        builder.stamp.clone(),
        body.assembly,
        builder.epoch,
    ) {
        Ok(light) => light,
        Err(crate::runtime::profile_editor_source::LightProfileError::OwnerChanged) => {
            return Err(FormResourceError::OwnerChanged);
        }
        Err(crate::runtime::profile_editor_source::LightProfileError::Facts(error)) => {
            return Ok(Open::Unavailable(source::fact_error(error)));
        }
        Err(_) => {
            return Ok(Open::Unavailable(
                json!({"state":"FORM_UNAVAILABLE","reason":{"code":"DAY_PROFILE_INVALID"}}),
            ));
        }
    };
    let rows = opening
        .groups
        .iter()
        .map(|group| RawDayEntrySource {
            kind: group.kind,
            state: group.state,
            body: &group.body,
        })
        .collect::<Vec<_>>();
    let native =
        match NativeDayEditorSource::from_light(light, &builder.stamp, opening.request, &rows) {
            Ok(source) => Arc::new(source),
            Err(error) => return Ok(Open::Unavailable(unavailable(error)?)),
        };
    match NativeDayController::new(native, opening.appearance) {
        Ok(controller) => Ok(Open::Ready(Box::new(DayState {
            revision: 0,
            controller,
            preview: None,
            stamp: builder.stamp.clone(),
            write: None,
            next_write: 0,
            terminal: false,
            feedback: None,
            receipt: None,
            review: None,
            review_notice: None,
            billing: billing::BillingSelection::default(),
        }))),
        Err(error) => Ok(Open::Unavailable(unavailable(error)?)),
    }
}
#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(super) enum Event {
    View,
    BillingView {
        offset: usize,
        open: bool,
    },
    BillingToggleBody {
        revision: Value,
        open: bool,
        #[serde(default)]
        offset: usize,
    },
    BillingClear {
        open: bool,
        #[serde(default)]
        offset: usize,
    },
    ReviewBegin {
        stamp: crate::runtime::write_resource::WriteContextStamp,
    },
    ReviewCalendar {
        source: Value,
    },
    ReviewCatalog {
        catalog_kind: crate::contract::assembly::CatalogKind,
        source: Value,
    },
    ReviewPrepare,
    ReviewCandidates {
        family: review::CandidateFamily,
        offset: usize,
    },
    ReviewFinish,
    Set {
        field: String,
        value: Value,
    },
    SetBody {
        field: String,
    },
    ChooseType {
        value: String,
    },
    ChangeDuty,
    PrepareSave {
        close_after_save: bool,
    },
    Save {
        close_after_save: bool,
        #[serde(default)]
        require_review: bool,
    },
    Delete,
    DutyDraft {
        operation: String,
        args: Value,
    },
    DutyInline {
        operation: String,
        index: usize,
        arg: Value,
        structure_revision: u64,
    },
    DutyBlock {
        edit: crate::runtime::day_editor_controller::DutyBlockEdit,
    },
    DutyStandby {
        component: usize,
        action: Value,
    },
    DutyStandbyBody {
        component: usize,
    },
}
pub(super) struct DayState {
    pub revision: u64,
    controller: NativeDayController,
    preview: Option<RawSavePreparation>,
    pub stamp: crate::runtime::write_resource::WriteContextStamp,
    write: Option<write::Write>,
    next_write: u64,
    terminal: bool,
    feedback: Option<Value>,
    receipt: Option<Value>,
    review: Option<review::ReviewSlot>,
    review_notice: Option<Value>,
    billing: billing::BillingSelection,
}
impl DayState {
    pub fn check(&self, revision: u64) -> Result<(), FormResourceError> {
        if self.revision != revision {
            return Err(FormResourceError::StaleResource);
        }
        Ok(())
    }
    pub fn outcome(&self, id: u64) -> Result<Value, FormResourceError> {
        let view = self
            .controller
            .view()
            .map_err(|_| FormResourceError::InvalidSource)?;
        let mut frame = json!({"state":"DAY_READY","resourceId":id,"resourceRevision":self.revision,"view":view});
        if let Some(notice) = &self.review_notice {
            frame["reviewNotice"] = notice.clone();
        }
        self.write_frame(&mut frame);
        Ok(frame)
    }
    pub fn event(&mut self, event: &Event, raw: &[u8]) -> Result<Option<Value>, FormResourceError> {
        if !matches!(
            event,
            Event::ChangeDuty | Event::SetBody { .. } | Event::DutyStandbyBody { .. }
        ) && !raw.is_empty()
        {
            return Err(FormResourceError::InvalidHeader);
        }
        let revision = if matches!(event, Event::View) {
            self.revision
        } else {
            self.revision
                .checked_add(1)
                .filter(|value| *value <= crate::money::MAX_SAFE_INTEGER as u64)
                .ok_or(FormResourceError::Capacity)?
        };
        let mut feedback = None;
        match event {
            Event::View => {}
            Event::Set { field, value } => {
                self.controller
                    .set(field, value.clone())
                    .map_err(|_| FormResourceError::InvalidSource)?;
                self.preview = None;
            }
            Event::SetBody { field } => {
                if raw.len() > 256 * 1024 {
                    return Err(FormResourceError::InputTooLarge);
                }
                let value = crate::contract::bounded_json(raw)
                    .map_err(|_| FormResourceError::InvalidHeader)?;
                self.controller
                    .set(field, value)
                    .map_err(|_| FormResourceError::InvalidSource)?;
                self.preview = None;
            }
            Event::ChooseType { value } => {
                self.controller
                    .choose_type(value)
                    .map_err(|_| FormResourceError::InvalidSource)?;
                self.preview = None;
            }
            Event::DutyDraft { operation, args } => {
                self.controller
                    .duty_draft_event(operation, args)
                    .map_err(|_| FormResourceError::InvalidSource)?;
                self.preview = None;
            }
            Event::DutyInline {
                operation,
                index,
                arg,
                structure_revision,
            } => {
                self.controller
                    .duty_inline_event(operation, *index, arg, *structure_revision)
                    .map_err(|_| FormResourceError::InvalidSource)?;
                self.preview = None;
            }
            Event::DutyBlock { edit } => {
                self.controller
                    .duty_block_event(crate::runtime::day_editor_controller::DutyBlockEdit {
                        target: edit.target,
                        operation: edit.operation,
                        text: edit.text.clone(),
                        structure_revision: edit.structure_revision,
                    })
                    .map_err(|_| FormResourceError::InvalidSource)?;
                self.preview = None;
            }
            Event::DutyStandby { component, action } => {
                self.controller
                    .standby_event(*component, action)
                    .map_err(|_| FormResourceError::InvalidSource)?;
                self.preview = None;
            }
            Event::DutyStandbyBody { component } => {
                if raw.len() > 256 * 1024 {
                    return Err(FormResourceError::InputTooLarge);
                }
                let action = crate::contract::bounded_json(raw)
                    .map_err(|_| FormResourceError::InvalidHeader)?;
                self.controller
                    .standby_event(*component, &action)
                    .map_err(|_| FormResourceError::InvalidSource)?;
                self.preview = None;
            }
            Event::ChangeDuty => {
                if raw.len() > 256 * 1024 {
                    return Err(FormResourceError::InputTooLarge);
                }
                let duty = crate::contract::bounded_json(raw)
                    .map_err(|_| FormResourceError::InvalidHeader)?;
                self.controller
                    .change_duty(&duty)
                    .map_err(|_| FormResourceError::InvalidSource)?;
                self.preview = None;
            }
            Event::PrepareSave { close_after_save } => {
                let prepared = self
                    .controller
                    .prepare_save(false, *close_after_save)
                    .map_err(|_| FormResourceError::InvalidSource)?;
                if prepared.write_intent().is_some() {
                    feedback = Some(json!({"state":"WRITE_INTENT_ONLY","stored":false}));
                    self.preview = Some(prepared);
                } else {
                    // No SQL is requested by this terminal original validation /
                    // no-change branch. Only those original UI events are exposed.
                    feedback = Some(prepared.finish(None));
                    self.preview = None;
                }
            }
            Event::Save {
                close_after_save,
                require_review,
            } => {
                feedback = self.capture(*close_after_save, *require_review)?;
            }
            Event::Delete => self.capture_delete()?,
            Event::BillingView { .. }
            | Event::BillingToggleBody { .. }
            | Event::BillingClear { .. }
            | Event::ReviewBegin { .. }
            | Event::ReviewCalendar { .. }
            | Event::ReviewCatalog { .. }
            | Event::ReviewPrepare
            | Event::ReviewCandidates { .. }
            | Event::ReviewFinish => {
                return Err(FormResourceError::InvalidHeader);
            }
        }
        self.revision = revision;
        Ok(feedback)
    }
}
