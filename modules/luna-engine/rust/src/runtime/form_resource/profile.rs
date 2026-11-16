//! Opaque native profile interaction. UI fields never reconstruct a source,
//! baseline, confirmation cache or committed return profile.
use super::*;
use crate::{
    input::profile_editor::{EditorIntent, SaveScope},
    rules::RuleResolver,
    runtime::{
        profile_editor_draft::{CapturedEditorDraft, ProfileEditorDraft},
        profile_editor_flow::{ProfileEditorFlow, ProfileEditorWrite, ProfileFlowIoFailure},
        profile_editor_presentation::ProfilePresentationCache,
        profile_editor_receipt::ProfileEditorReceipt,
        write_resource::{
            NativeWriteContext, NativeWritePermit, WriteContextStamp, WriteResourceError,
        },
    },
};
use serde::Deserialize;
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub(super) enum Event {
    View,
    Intent { intent: EditorIntent },
    IntentBody,
    Submit,
    Scope { value: Option<SaveScope> },
    Date { value: String },
    Confirm,
    Undo,
    CloseDialog,
    Discard,
    EndHistory,
    EditPeriod { value: String },
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(super) enum IoFailure {
    SourceChanged,
    IoFailed,
}
enum Submission {
    Flow(Arc<ProfileEditorWrite>),
    Direct(Arc<CapturedEditorDraft>),
}
struct WriteIo {
    context: NativeWriteContext,
    permit: NativeWritePermit,
}
struct Write {
    id: u64,
    submission: Submission,
    io: Option<WriteIo>,
}
pub(super) struct ProfileState {
    pub revision: u64,
    pub flow: ProfileEditorFlow,
    draft: ProfileEditorDraft,
    draft_revision: u64,
    flow_revision: u64,
    feedback: Option<Value>,
    direct_saved: u64,
    write: Option<Write>,
    next_write: u64,
    pub stamp: WriteContextStamp,
    presentation: std::cell::RefCell<ProfilePresentationCache>,
}
fn next(value: u64) -> Result<u64, FormResourceError> {
    value
        .checked_add(1)
        .filter(|v| *v <= crate::money::MAX_SAFE_INTEGER as u64)
        .ok_or(FormResourceError::Capacity)
}
impl ProfileState {
    pub fn new(
        flow: ProfileEditorFlow,
        draft: ProfileEditorDraft,
        stamp: WriteContextStamp,
    ) -> Self {
        Self {
            revision: 0,
            flow,
            draft,
            draft_revision: 0,
            flow_revision: 0,
            feedback: None,
            direct_saved: 0,
            write: None,
            next_write: 0,
            stamp,
            presentation: std::cell::RefCell::new(ProfilePresentationCache::default()),
        }
    }
    pub fn check(&self, revision: u64) -> Result<(), FormResourceError> {
        if revision != self.revision {
            return Err(FormResourceError::StaleResource);
        }
        Ok(())
    }
    fn render(&self, epoch: i64, rules: &RuleResolver) -> Result<(Value, Value), Value> {
        let mut flow = self.flow.ui_state(epoch).map_err(source::flow_error)?;
        flow["hasReceipt"] = json!(self.flow.receipt_profiles().is_some());
        let editor = self
            .draft
            .view(self.draft.identity(), self.draft_revision, epoch, rules)
            .map_err(|e| {
                source::flow_error(crate::runtime::profile_editor_flow::ProfileFlowError::Draft(e))
            })?;
        Ok((
            json!({"flow":flow,"editor":editor.state,"feedback":self.feedback,"direct":{"saving":matches!(self.write.as_ref().map(|w|&w.submission),Some(Submission::Direct(_))),"savedCalls":self.direct_saved}}),
            editor.editor_metadata,
        ))
    }
    pub fn outcome(
        &self,
        id: u64,
        epoch: i64,
        rules: &RuleResolver,
    ) -> Result<Value, FormResourceError> {
        let (view, editor_metadata) = match self.render(epoch, rules) {
            Ok(v) => v,
            Err(frame) => return Ok(frame),
        };
        let dirty = view["editor"]["preview"]["dirty"]
            .as_bool()
            .ok_or(FormResourceError::InvalidSource)?;
        let mut presentation = match self.presentation.borrow_mut().present_with_state(
            &self.flow,
            &view["flow"],
            dirty,
        ) {
            Ok(value) => value,
            Err(error) => return Ok(source::flow_error(error)),
        };
        presentation["editor"] = editor_metadata;
        let mut value = json!({"state":"PROFILE_READY","resourceId":id,"resourceRevision":self.revision,"view":view,"presentation":presentation});
        if let Some(write) = &self.write {
            value["state"] = json!(if write.io.is_some() {
                "WRITE_PERMIT_READY"
            } else {
                "WRITE_CONTEXT_REQUIRED"
            });
            value["writeId"] = json!(write.id);
        }
        Ok(value)
    }
    fn start(&mut self, submission: Submission) -> Result<(), FormResourceError> {
        let id = next(self.next_write)?;
        self.next_write = id;
        self.write = Some(Write {
            id,
            submission,
            io: None,
        });
        Ok(())
    }
    fn flow_write(
        &mut self,
        write: Option<Arc<ProfileEditorWrite>>,
    ) -> Result<(), FormResourceError> {
        if let Some(write) = write {
            self.start(Submission::Flow(write))?
        }
        Ok(())
    }
    fn sync(&mut self, epoch: i64, rules: &RuleResolver) -> Result<(), FormResourceError> {
        let revision = self
            .flow
            .ui_state(epoch)
            .map_err(|_| FormResourceError::InvalidSource)?["revision"]
            .as_u64()
            .expect("native flow revision");
        if revision != self.flow_revision {
            self.draft = self
                .flow
                .open_editor(epoch, rules)
                .map_err(|_| FormResourceError::InvalidSource)?;
            self.draft_revision = 0;
            self.flow_revision = revision;
        }
        Ok(())
    }
    pub fn event(
        &mut self,
        event: &Event,
        epoch: i64,
        rules: &RuleResolver,
    ) -> Result<(), FormResourceError> {
        let revision = if matches!(event, Event::View) {
            self.revision
        } else {
            next(self.revision)?
        };
        match event {
            Event::View => {}
            Event::IntentBody => return Err(FormResourceError::InvalidHeader),
            Event::Intent { intent } => {
                let v = self
                    .draft
                    .apply(
                        &self.draft.identity().clone(),
                        self.draft_revision,
                        epoch,
                        intent,
                        rules,
                    )
                    .map_err(|_| FormResourceError::InvalidSource)?;
                self.draft_revision = v.draft_revision;
                self.feedback = None;
            }
            Event::Submit => {
                if self.write.is_none() {
                    let c = self
                        .draft
                        .capture(self.draft.identity(), self.draft_revision, epoch, rules)
                        .map_err(|_| FormResourceError::InvalidSource)?;
                    let feedback = c.feedback();
                    let kind = feedback["kind"].as_str().expect("native submit kind");
                    if kind == "DIRECT" {
                        self.start(Submission::Direct(Arc::new(c)))?
                    } else if kind == "REQUEST" {
                        let write = self
                            .flow
                            .request(c, epoch, rules)
                            .map_err(|_| FormResourceError::InvalidSource)?;
                        self.flow_write(write)?
                    }
                    self.feedback = Some(feedback);
                }
            }
            Event::Scope { value } => self.flow.set_scope(*value),
            Event::Date { value } => self.flow.set_date(value.clone()),
            Event::Confirm => {
                if self.write.is_none() {
                    let w = self
                        .flow
                        .confirm(epoch, rules)
                        .map_err(|_| FormResourceError::InvalidSource)?;
                    self.flow_write(w)?
                }
            }
            Event::Undo => {
                if self.write.is_none() {
                    let w = self
                        .flow
                        .undo()
                        .map_err(|_| FormResourceError::InvalidSource)?;
                    self.flow_write(w)?
                }
            }
            Event::CloseDialog => self.flow.close(),
            Event::Discard => self
                .flow
                .discard()
                .map_err(|_| FormResourceError::InvalidSource)?,
            Event::EndHistory => self
                .flow
                .end_history()
                .map_err(|_| FormResourceError::InvalidSource)?,
            Event::EditPeriod { value } => self
                .flow
                .edit_period(value)
                .map_err(|_| FormResourceError::InvalidSource)?,
        }
        self.sync(epoch, rules)?;
        self.revision = revision;
        Ok(())
    }
    fn write(&self, id: u64) -> Result<&Write, FormResourceError> {
        self.write
            .as_ref()
            .filter(|w| w.id == id)
            .ok_or(FormResourceError::StaleResource)
    }
    fn failure(&mut self, failure: ProfileFlowIoFailure) -> Result<(), FormResourceError> {
        let w = self.write.take().ok_or(FormResourceError::StaleResource)?;
        match w.submission {
            Submission::Flow(write) => self
                .flow
                .fail(write.id(), failure)
                .map_err(|_| FormResourceError::InvalidSource)?,
            Submission::Direct(_) => {
                let message = match failure {
                    ProfileFlowIoFailure::Generic => {
                        "Profil konnte nicht gespeichert werden.".to_owned()
                    }
                    ProfileFlowIoFailure::UserFacing(m) => m,
                    ProfileFlowIoFailure::Concurrency => {
                        "Der Eintrag wurde zwischenzeitlich geändert. Bitte neu laden.".to_owned()
                    }
                };
                if let Some(feedback) = &mut self.feedback {
                    feedback["delta"]["error"] = json!(message);
                }
            }
        }
        Ok(())
    }
    pub fn prepare_write(
        &mut self,
        id: u64,
        context: NativeWriteContext,
        epoch: i64,
        rules: &RuleResolver,
    ) -> Result<(), FormResourceError> {
        if context.stamp() != &self.stamp || self.write(id)?.io.is_some() {
            return Err(FormResourceError::StaleResource);
        }
        let result = match &self.write(id)?.submission {
            Submission::Flow(write) => context.prepare_profile(
                &write.input(),
                crate::input::profile_write::ProfileWriteRoute::AppPort,
                epoch as f64,
            ),
            Submission::Direct(captured) => {
                let date = self
                    .flow
                    .ui_state(epoch)
                    .map_err(|_| FormResourceError::InvalidSource)?["referenceDate"]
                    .as_str()
                    .expect("native date")
                    .to_owned();
                let input = captured
                    .build(&date, true, rules)
                    .map_err(|_| FormResourceError::InvalidSource)?
                    .ok_or(FormResourceError::InvalidSource)?;
                context.prepare_profile(
                    &input,
                    crate::input::profile_write::ProfileWriteRoute::AppPort,
                    epoch as f64,
                )
            }
        };
        match result {
            Ok(permit) => {
                self.write.as_mut().expect("checked write").io = Some(WriteIo { context, permit })
            }
            Err(error) => {
                let failure = match error {
                    WriteResourceError::Profile(e) if e.is_user_facing() => {
                        ProfileFlowIoFailure::UserFacing(e.message().into())
                    }
                    WriteResourceError::Input(e) => e
                        .user_facing_message()
                        .map_or(ProfileFlowIoFailure::Generic, |m| {
                            ProfileFlowIoFailure::UserFacing(m.into())
                        }),
                    _ => ProfileFlowIoFailure::Generic,
                };
                self.failure(failure)?;
            }
        }
        self.revision = next(self.revision)?;
        Ok(())
    }
    pub fn take(
        &self,
        id: u64,
    ) -> Result<crate::runtime::write_resource::TakenNativeWrite, FormResourceError> {
        let io = self
            .write(id)?
            .io
            .as_ref()
            .ok_or(FormResourceError::StaleResource)?;
        io.context
            .take(&io.permit)
            .map_err(|_| FormResourceError::StaleResource)
    }
    pub fn ack(
        &mut self,
        id: u64,
        stamp: WriteContextStamp,
        origin: &crate::contract::SnapshotIdentity,
        epoch: i64,
        rules: &RuleResolver,
    ) -> Result<(), FormResourceError> {
        let io = self
            .write(id)?
            .io
            .as_ref()
            .ok_or(FormResourceError::StaleResource)?;
        let committed = io
            .context
            .acknowledge(&io.permit, stamp.clone())
            .map_err(|_| FormResourceError::StaleResource)?;
        let receipt = ProfileEditorReceipt::from_committed_native(origin, &io.context, committed)
            .map_err(|_| FormResourceError::StaleResource)?;
        let write = self.write.take().expect("checked write");
        match write.submission {
            Submission::Flow(write) => self
                .flow
                .complete(write.id(), receipt)
                .map_err(|_| FormResourceError::InvalidSource)?,
            Submission::Direct(_) => self.direct_saved = next(self.direct_saved)?,
        }
        self.stamp = stamp;
        self.sync(epoch, rules)?;
        self.revision = next(self.revision)?;
        Ok(())
    }
    pub fn abort(&mut self, id: u64, failure: &IoFailure) -> Result<(), FormResourceError> {
        let write = self.write(id)?;
        if let Some(io) = &write.io {
            io.context
                .abort(&io.permit)
                .map_err(|_| FormResourceError::StaleResource)?;
        }
        self.failure(match failure {
            IoFailure::SourceChanged => ProfileFlowIoFailure::Concurrency,
            IoFailure::IoFailed => ProfileFlowIoFailure::Generic,
        })?;
        self.revision = next(self.revision)?;
        Ok(())
    }
}
