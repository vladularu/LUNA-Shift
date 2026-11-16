//! Private source-bound editable state. No Deserialize/host cache constructor.
use super::profile_editor_receipt::ProfileEditorReceipt;
use super::profile_editor_source::ProfileEditorContext;
use crate::{
    contract::SnapshotIdentity,
    input::{
        profile_editor::{
            EditorIntent, EditorSection, EditorSession, NativeEditorBaseline, NativeEditorState,
            NativeSubmissionPolicy, ProfileEditorSource, ProfileSaveInput, build_native,
            capture_native,
        },
        profile_form::{FormClock, ProfileFormError},
    },
    rules::RuleResolver,
};
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;
#[derive(Debug)]
pub enum EditorDraftError {
    StaleSource,
    StaleRevision,
    InvalidInstant,
    RevisionOverflow,
    Form(ProfileFormError),
}
impl From<ProfileFormError> for EditorDraftError {
    fn from(e: ProfileFormError) -> Self {
        Self::Form(e)
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorDraftView {
    pub draft_revision: u64,
    pub state: Value,
    #[serde(skip_serializing)]
    pub(crate) editor_metadata: Value,
}
#[derive(Clone)]
enum EditorOrigin {
    Initial(Arc<ProfileEditorContext>),
    Receipt(Arc<ProfileEditorReceipt>),
}
/// A source-owned role, optionally projected to a known native history date.
/// Neither a UI profile nor serialized Ready facts are constructors.
#[derive(Clone)]
pub(crate) struct NativeEditorBase {
    origin: EditorOrigin,
    profile: Arc<Value>,
}
impl NativeEditorBase {
    pub(crate) fn initial(source: Arc<ProfileEditorContext>) -> Self {
        Self {
            profile: source.profile().clone(),
            origin: EditorOrigin::Initial(source),
        }
    }
    pub(crate) fn receipt(source: Arc<ProfileEditorReceipt>) -> Self {
        Self {
            profile: source.profile().clone(),
            origin: EditorOrigin::Receipt(source),
        }
    }
    pub(crate) fn profile(&self) -> &Arc<Value> {
        &self.profile
    }
    pub(crate) fn identity(&self) -> &SnapshotIdentity {
        match &self.origin {
            EditorOrigin::Initial(source) => source.identity(),
            EditorOrigin::Receipt(source) => source.identity(),
        }
    }
    pub(crate) fn at_date(&self, date: &str) -> Result<Self, ProfileFormError> {
        Ok(Self {
            origin: self.origin.clone(),
            profile: Arc::new(crate::employment::employment_profile_at(
                self.profile(),
                date,
            )?),
        })
    }
    pub(crate) fn clock(&self, epoch: i64) -> Result<(FormClock, String), EditorDraftError> {
        if epoch.unsigned_abs() > crate::money::MAX_SAFE_INTEGER as u64 {
            return Err(EditorDraftError::InvalidInstant);
        }
        let stamp = jiff::Timestamp::from_millisecond(epoch)
            .map_err(|_| EditorDraftError::InvalidInstant)?;
        let clock = FormClock::from_instant(&stamp.to_string()).map_err(ProfileFormError::from)?;
        let date = clock
            .date_in(
                self.profile()["timeZone"]
                    .as_str()
                    .expect("checked native base zone"),
            )
            .map_err(ProfileFormError::from)?;
        Ok((clock, date))
    }
}
pub struct ProfileEditorDraft {
    base: NativeEditorBase,
    baseline: NativeEditorBaseline,
    state: NativeEditorState,
    revision: u64,
}
pub struct CapturedEditorDraft {
    base: NativeEditorBase,
    baseline: NativeEditorBaseline,
    state: NativeEditorState,
    policy: NativeSubmissionPolicy,
}
impl ProfileEditorDraft {
    pub fn open(
        context: Arc<ProfileEditorContext>,
        section: EditorSection,
        from_more: bool,
        resolver: &RuleResolver,
    ) -> Result<Self, ProfileFormError> {
        let source = ProfileEditorSource::new(
            context.profile(),
            section,
            from_more,
            context.reference_date(),
            context.form_clock(),
            resolver,
        )?;
        let state = EditorSession::new(&source).into_native();
        let baseline = source.native_baseline();
        Ok(Self {
            base: NativeEditorBase::initial(context),
            baseline,
            state,
            revision: 0,
        })
    }
    pub(crate) fn open_base(
        base: NativeEditorBase,
        section: EditorSection,
        from_more: bool,
        epoch: i64,
        resolver: &RuleResolver,
    ) -> Result<Self, EditorDraftError> {
        let (clock, date) = base.clock(epoch)?;
        let source =
            ProfileEditorSource::new(base.profile(), section, from_more, &date, &clock, resolver)?;
        let state = EditorSession::new(&source).into_native();
        let baseline = source.native_baseline();
        Ok(Self {
            base,
            baseline,
            state,
            revision: 0,
        })
    }
    pub fn identity(&self) -> &SnapshotIdentity {
        self.base.identity()
    }
    fn guard(&self, identity: &SnapshotIdentity, revision: u64) -> Result<(), EditorDraftError> {
        if identity != self.identity() {
            return Err(EditorDraftError::StaleSource);
        }
        if revision != self.revision {
            return Err(EditorDraftError::StaleRevision);
        }
        Ok(())
    }
    fn clock(&self, epoch: i64) -> Result<(FormClock, String), EditorDraftError> {
        self.base.clock(epoch)
    }
    pub fn view(
        &self,
        identity: &SnapshotIdentity,
        revision: u64,
        epoch: i64,
        resolver: &RuleResolver,
    ) -> Result<EditorDraftView, EditorDraftError> {
        self.guard(identity, revision)?;
        let (_, date) = self.clock(epoch)?;
        let source = ProfileEditorSource::from_native_baseline(self.base.profile(), &self.baseline);
        let session = EditorSession::from_native(&source, self.state.clone());
        let state = session.state(&date, resolver)?;
        let editor_metadata = source.native_editor_metadata(&state["draft"])?;
        Ok(EditorDraftView {
            draft_revision: self.revision,
            state,
            editor_metadata,
        })
    }
    pub fn apply(
        &mut self,
        identity: &SnapshotIdentity,
        revision: u64,
        epoch: i64,
        intent: &EditorIntent,
        resolver: &RuleResolver,
    ) -> Result<EditorDraftView, EditorDraftError> {
        self.guard(identity, revision)?;
        let next = self
            .revision
            .checked_add(1)
            .filter(|n| *n <= crate::money::MAX_SAFE_INTEGER as u64)
            .ok_or(EditorDraftError::RevisionOverflow)?;
        let (clock, date) = self.clock(epoch)?;
        let source = ProfileEditorSource::from_native_baseline(self.base.profile(), &self.baseline);
        // Apply and render a small native candidate. Any rejected intent leaves
        // the prior draft and its publication revision intact.
        let mut session = EditorSession::from_native(&source, self.state.clone());
        session.apply(intent, &date, &clock, resolver)?;
        let state = session.state(&date, resolver)?;
        let editor_metadata = source.native_editor_metadata(&state["draft"])?;
        self.state = session.into_native();
        self.revision = next;
        Ok(EditorDraftView {
            draft_revision: next,
            state,
            editor_metadata,
        })
    }
    pub fn capture(
        &self,
        identity: &SnapshotIdentity,
        revision: u64,
        epoch: i64,
        resolver: &RuleResolver,
    ) -> Result<CapturedEditorDraft, EditorDraftError> {
        self.guard(identity, revision)?;
        let (_, date) = self.clock(epoch)?;
        let policy = capture_native(
            self.base.profile(),
            &self.baseline,
            &self.state,
            &date,
            resolver,
        )?;
        Ok(CapturedEditorDraft {
            base: self.base.clone(),
            baseline: self.baseline.clone(),
            state: self.state.clone(),
            policy,
        })
    }
}
impl CapturedEditorDraft {
    pub fn source_profile(&self) -> &Arc<Value> {
        self.base.profile()
    }
    pub(crate) fn identity(&self) -> &SnapshotIdentity {
        self.base.identity()
    }
    pub fn feedback(&self) -> Value {
        self.policy.feedback()
    }
    pub fn build(
        &self,
        date: &str,
        final_stage: bool,
        resolver: &RuleResolver,
    ) -> Result<Option<ProfileSaveInput<'_>>, ProfileFormError> {
        build_native(
            self.base.profile(),
            &self.baseline,
            &self.state,
            &self.policy,
            date,
            final_stage,
            resolver,
        )
    }
}
