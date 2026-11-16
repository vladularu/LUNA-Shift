//! Native employment-save interaction. Source and receipt constructors are
//! opaque checked Facts; the host supplies raw intents/IO completion only.
use super::{
    profile_editor_draft::{
        CapturedEditorDraft, EditorDraftError, NativeEditorBase, ProfileEditorDraft,
    },
    profile_editor_receipt::ProfileEditorReceipt,
    profile_editor_source::ProfileEditorContext,
};
use crate::{
    input::{
        profile_editor::{self, EditorSection, ProfileFields, SaveScope},
        profile_form::ProfileFormError,
    },
    rules::RuleResolver,
};
use serde::{Serialize, Serializer, ser::SerializeMap};
use serde_json::{Map, Value, json};
use std::sync::Arc;
#[derive(Debug)]
pub enum ProfileFlowError {
    Form(ProfileFormError),
    Draft(EditorDraftError),
    StaleSource,
    StaleWrite,
    CounterOverflow,
}
impl From<ProfileFormError> for ProfileFlowError {
    fn from(e: ProfileFormError) -> Self {
        Self::Form(e)
    }
}
impl From<EditorDraftError> for ProfileFlowError {
    fn from(e: EditorDraftError) -> Self {
        Self::Draft(e)
    }
}
pub enum ProfileFlowIoFailure {
    Generic,
    UserFacing(String),
    Concurrency,
}
impl ProfileFlowIoFailure {
    /// Native raw factories preserve actual source error ancestry. Do not infer
    /// a user-facing message from a mutable name or an arbitrary IO diagnostic.
    pub fn from_fact_error(error: &super::facts::FactError) -> Self {
        use super::facts::FactError;
        match error {
            FactError::Profile(error) | FactError::Remuneration(error) => error
                .user_facing_message()
                .map_or(Self::Generic, |message| Self::UserFacing(message.into())),
            _ => Self::Generic,
        }
    }
}
pub struct ProfileEditorWrite {
    id: u64,
    base: Arc<Value>,
    changes: Map<String, Value>,
}
impl ProfileEditorWrite {
    pub fn id(&self) -> u64 {
        self.id
    }
    pub fn input(&self) -> ProfileEditorWriteInput<'_> {
        ProfileEditorWriteInput(self)
    }
}
/// Read-only native write view. Even an undo's complete restore history remains
/// borrowed while validating/serializing the plan; no host constructor exists.
pub struct ProfileEditorWriteInput<'a>(&'a ProfileEditorWrite);
impl ProfileFields for ProfileEditorWriteInput<'_> {
    fn field(&self, key: &str) -> Option<&Value> {
        self.0.changes.get(key).or_else(|| self.0.base.get(key))
    }
}
impl Serialize for ProfileEditorWriteInput<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let base = self
            .0
            .base
            .as_object()
            .ok_or_else(|| serde::ser::Error::custom("Invalid native save source"))?;
        let mut output = serializer.serialize_map(None)?;
        for (key, value) in base {
            output.serialize_entry(key, self.0.changes.get(key).unwrap_or(value))?;
        }
        for (key, value) in &self.0.changes {
            if !base.contains_key(key) {
                output.serialize_entry(key, value)?;
            }
        }
        output.end()
    }
}
struct Pending {
    captured: Arc<CapturedEditorDraft>,
    lines: Vec<String>,
}
enum WriteKind {
    Save {
        before: NativeEditorBase,
        effective_from: Option<String>,
    },
    Undo,
}
struct ActiveWrite {
    id: u64,
    kind: WriteKind,
}
struct PreparedCommit {
    changes: Map<String, Value>,
    effective_from: Option<String>,
}
pub struct ProfileEditorFlow {
    base: NativeEditorBase,
    current: NativeEditorBase,
    section: EditorSection,
    from_more: bool,
    editing_from: Option<String>,
    revision: u64,
    pending: Option<Pending>,
    scope: Option<SaveScope>,
    date: String,
    message: Option<String>,
    error: Option<String>,
    receipt: Option<(NativeEditorBase, NativeEditorBase)>,
    active: Option<ActiveWrite>,
    next_write: u64,
}
impl ProfileEditorFlow {
    pub fn new(source: Arc<ProfileEditorContext>, section: EditorSection, from_more: bool) -> Self {
        let base = NativeEditorBase::initial(source);
        Self {
            current: base.clone(),
            base,
            section,
            from_more,
            editing_from: None,
            revision: 0,
            pending: None,
            scope: None,
            date: String::new(),
            message: None,
            error: None,
            receipt: None,
            active: None,
            next_write: 0,
        }
    }
    pub fn base(&self) -> &Arc<Value> {
        self.base.profile()
    }
    pub fn current(&self) -> &Arc<Value> {
        self.current.profile()
    }
    pub fn receipt_profiles(&self) -> Option<(&Arc<Value>, &Arc<Value>)> {
        self.receipt
            .as_ref()
            .map(|(before, saved)| (before.profile(), saved.profile()))
    }
    pub fn ui_state(&self, epoch: i64) -> Result<Value, ProfileFlowError> {
        let (_, today) = self.base.clock(epoch)?;
        Ok(
            json!({"editingFrom":self.editing_from,"revision":self.revision,"referenceDate":today,"pending":self.pending.as_ref().map(|p|json!({"lines":p.lines})),"scope":self.scope,"date":self.date,"saving":self.active.is_some(),"message":self.message,"error":self.error}),
        )
    }
    pub fn open_editor(
        &self,
        epoch: i64,
        resolver: &RuleResolver,
    ) -> Result<ProfileEditorDraft, ProfileFlowError> {
        Ok(ProfileEditorDraft::open_base(
            self.base.clone(),
            self.section,
            self.from_more,
            epoch,
            resolver,
        )?)
    }
    pub fn request(
        &mut self,
        captured: CapturedEditorDraft,
        epoch: i64,
        resolver: &RuleResolver,
    ) -> Result<Option<Arc<ProfileEditorWrite>>, ProfileFlowError> {
        if captured.identity() != self.current.identity() {
            return Err(ProfileFlowError::StaleSource);
        }
        if self.active.is_some() {
            return Ok(None);
        }
        let (clock, today) = self.base.clock(epoch)?;
        self.error = None;
        let captured = Arc::new(captured);
        let lines = (|| -> Result<Vec<String>, ProfileFormError> {
            let Some(input) = captured.build(&today, false, resolver)? else {
                return Ok(Vec::new());
            };
            profile_editor::change_lines(self.base().as_ref(), &input, &clock)
        })();
        let lines = match lines {
            Ok(lines) => lines,
            Err(error) => {
                self.error = Some(facing(&error, "Bitte deine Angaben prüfen."));
                return Ok(None);
            }
        };
        if lines.is_empty() {
            self.message = Some("Keine Änderungen zu speichern.".into());
            return Ok(None);
        }
        if initial_empty(self.base().as_ref()) {
            return self.begin_commit(captured, SaveScope::All, "", epoch, resolver);
        }
        self.scope = self.editing_from.as_ref().map(|_| SaveScope::Date);
        self.date = self
            .editing_from
            .as_deref()
            .map(german_date)
            .unwrap_or_default();
        self.pending = Some(Pending { captured, lines });
        Ok(None)
    }
    pub fn set_scope(&mut self, scope: Option<SaveScope>) {
        self.scope = scope;
    }
    pub fn set_date(&mut self, date: String) {
        self.date = date;
    }
    pub fn confirm(
        &mut self,
        epoch: i64,
        resolver: &RuleResolver,
    ) -> Result<Option<Arc<ProfileEditorWrite>>, ProfileFlowError> {
        if self.active.is_some() {
            return Ok(None);
        }
        let Some(pending) = &self.pending else {
            return Ok(None);
        };
        let captured = pending.captured.clone();
        let selected = self.scope.unwrap_or(SaveScope::Date);
        let day = self.date.clone();
        self.begin_commit(captured, selected, &day, epoch, resolver)
    }
    pub fn undo(&mut self) -> Result<Option<Arc<ProfileEditorWrite>>, ProfileFlowError> {
        if self.active.is_some() {
            return Ok(None);
        }
        let Some((before, saved)) = &self.receipt else {
            return Ok(None);
        };
        self.error = None;
        let changes = profile_editor::undo_input(before.profile(), saved.profile())
            .map(|v| v.into_native_changes());
        let changes = match changes {
            Ok(v) => v,
            Err(error) => {
                self.error = Some(facing(
                    &error,
                    "Die Änderung konnte nicht zurückgenommen werden.",
                ));
                return Ok(None);
            }
        };
        let base = before.profile().clone();
        self.start_write(base, changes, WriteKind::Undo).map(Some)
    }
    pub fn close(&mut self) {
        if self.active.is_none() {
            self.pending = None;
            self.error = None;
        }
    }
    pub fn discard(&mut self) -> Result<(), ProfileFlowError> {
        if self.active.is_none() {
            self.revision = increment(self.revision)?;
            self.message = None;
            self.error = None;
        }
        Ok(())
    }
    pub fn end_history(&mut self) -> Result<(), ProfileFlowError> {
        if self.active.is_none() {
            self.base = self.current.clone();
            self.editing_from = None;
            self.revision = increment(self.revision)?;
            self.message = None;
            self.error = None;
        }
        Ok(())
    }
    pub fn edit_period(&mut self, from: &str) -> Result<(), ProfileFlowError> {
        if self.active.is_some() || self.pending.is_some() {
            return Ok(());
        }
        let found = self.current()["employmentTimeline"]
            .as_array()
            .is_some_and(|rows| {
                rows.iter().any(|row| {
                    row["effectiveFrom"] == from && crate::net::js_truthy(&row["employment"])
                })
            });
        if !found {
            return Ok(());
        }
        self.base = self.current.at_date(from)?;
        self.editing_from = Some(from.into());
        self.revision = increment(self.revision)?;
        self.message = None;
        self.error = None;
        Ok(())
    }
    pub fn complete(
        &mut self,
        write: u64,
        receipt: Arc<ProfileEditorReceipt>,
    ) -> Result<(), ProfileFlowError> {
        let active = self
            .active
            .as_ref()
            .filter(|a| a.id == write)
            .ok_or(ProfileFlowError::StaleWrite)?;
        if receipt.identity().owner_scope() != self.current.identity().owner_scope()
            || receipt.identity().owner_epoch() != self.current.identity().owner_epoch()
        {
            return Err(ProfileFlowError::StaleSource);
        }
        let next = increment(self.revision)?;
        let saved = NativeEditorBase::receipt(receipt);
        match &active.kind {
            WriteKind::Save {
                before,
                effective_from,
            } => {
                let changed = profile_editor::timeline_key(saved.profile().as_ref())?
                    != profile_editor::timeline_key(before.profile().as_ref())?
                    || !profile_editor::changed_fields(
                        before.profile().as_ref(),
                        saved.profile().as_ref(),
                    )?
                    .is_empty();
                if changed {
                    self.receipt = Some((before.clone(), saved.clone()));
                }
                self.message = Some(if !changed {
                    "Diese Angaben sind für den Zeitraum bereits gespeichert.".into()
                } else if let Some(from) = effective_from {
                    format!("Gespeichert · ab {}", german_date(from))
                } else {
                    "Gespeichert · bisherige Angaben berichtigt".into()
                });
                self.pending = None;
            }
            WriteKind::Undo => {
                self.receipt = None;
                self.message = Some("Letzte Änderung zurückgenommen.".into());
            }
        }
        self.current = saved.clone();
        self.base = saved;
        self.editing_from = None;
        self.revision = next;
        self.active = None;
        Ok(())
    }
    pub fn fail(
        &mut self,
        write: u64,
        failure: ProfileFlowIoFailure,
    ) -> Result<(), ProfileFlowError> {
        let active = self
            .active
            .as_ref()
            .filter(|a| a.id == write)
            .ok_or(ProfileFlowError::StaleWrite)?;
        let fallback = match active.kind {
            WriteKind::Save { .. } => "Die Angaben konnten nicht gespeichert werden.",
            WriteKind::Undo => "Die Änderung konnte nicht zurückgenommen werden.",
        };
        self.error = Some(match failure {
            ProfileFlowIoFailure::Generic => fallback.into(),
            ProfileFlowIoFailure::UserFacing(message) => message,
            ProfileFlowIoFailure::Concurrency => {
                "Der Eintrag wurde zwischenzeitlich geändert. Bitte neu laden.".into()
            }
        });
        self.active = None;
        Ok(())
    }
    fn begin_commit(
        &mut self,
        captured: Arc<CapturedEditorDraft>,
        selected: SaveScope,
        day: &str,
        epoch: i64,
        resolver: &RuleResolver,
    ) -> Result<Option<Arc<ProfileEditorWrite>>, ProfileFlowError> {
        if self.active.is_some() {
            return Ok(None);
        }
        let (_, today) = self.base.clock(epoch)?;
        let prepared = (|| -> Result<Option<PreparedCommit>, ProfileFormError> {
            let effective = profile_editor::effective_date(selected, day)?;
            let Some(input) =
                captured.build(effective.as_deref().unwrap_or(&today), true, resolver)?
            else {
                return Ok(None);
            };
            if profile_editor::changed_fields(self.base().as_ref(), &input)?.is_empty() {
                return Ok(None);
            }
            let validity =
                profile_editor::save_validity(self.base().as_ref(), &input, effective.as_deref())?;
            let mut changes = input.into_native_changes();
            changes.insert("validity".into(), validity);
            Ok(Some(PreparedCommit {
                changes,
                effective_from: effective,
            }))
        })();
        match prepared {
            Err(error) => {
                self.error = Some(facing(
                    &error,
                    "Die Angaben konnten nicht gespeichert werden.",
                ));
                Ok(None)
            }
            Ok(None) => {
                self.pending = None;
                self.message = Some("Keine Änderungen zu speichern.".into());
                Ok(None)
            }
            Ok(Some(prepared)) => {
                let write = self.start_write(
                    captured.source_profile().clone(),
                    prepared.changes,
                    WriteKind::Save {
                        before: self.current.clone(),
                        effective_from: prepared.effective_from,
                    },
                )?;
                self.error = None;
                Ok(Some(write))
            }
        }
    }
    fn start_write(
        &mut self,
        base: Arc<Value>,
        changes: Map<String, Value>,
        kind: WriteKind,
    ) -> Result<Arc<ProfileEditorWrite>, ProfileFlowError> {
        let id = increment(self.next_write)?;
        self.next_write = id;
        self.active = Some(ActiveWrite { id, kind });
        Ok(Arc::new(ProfileEditorWrite { id, base, changes }))
    }
}
fn facing(error: &ProfileFormError, fallback: &str) -> String {
    error
        .user_facing_message()
        .unwrap_or_else(|| fallback.into())
}
fn increment(value: u64) -> Result<u64, ProfileFlowError> {
    value
        .checked_add(1)
        .filter(|n| *n <= crate::money::MAX_SAFE_INTEGER as u64)
        .ok_or(ProfileFlowError::CounterOverflow)
}
fn german_date(value: &str) -> String {
    value.split('-').rev().collect::<Vec<_>>().join(".")
}
fn initial_empty(base: &Value) -> bool {
    !crate::net::js_truthy(&base["salaryBasisConflict"])
        && [
            "regularRotatingNightWork",
            "sundayHolidayWorkEligible",
            "allEmploymentWorkRecorded",
        ]
        .iter()
        .all(|key| base.get(*key).is_none_or(Value::is_null))
        && (!crate::net::js_truthy(&base["workPattern"])
            || (base["workPattern"]["workplaceCoverage"] == "UNKNOWN"
                && base["workPattern"]["assignment"] == "UNKNOWN"))
        && base["employmentTimeline"]
            .as_array()
            .is_none_or(Vec::is_empty)
        && !crate::input::profile::SALARY_FIELDS
            .iter()
            .any(|key| crate::net::js_truthy(&base[*key]))
}
