//! Save-helper policy only. Source/resource admission remains with its owner.
//! Active submissions own their immutable entry source until completion/abort.
//! Saved progress is produced only from a native committed-write proof.
use super::write_resource::{
    CommittedNativeWrite, NativeWriteContext, NativeWritePermit, WriteResourceError,
};
use crate::{
    calendar::window::CalendarRecordSource,
    input::{
        InputError,
        template_actions::{calendar_date, matches_entry, quick_input, reuses_previous},
        template_editor::TemplateSubmission,
        template_write::TemplateWriteOperation,
    },
};
use serde_json::Value;
use std::sync::Arc;
#[derive(Debug)]
pub enum TemplateSequenceError {
    InvalidStage,
    Input(InputError),
    Write(WriteResourceError),
}
impl From<WriteResourceError> for TemplateSequenceError {
    fn from(error: WriteResourceError) -> Self {
        Self::Write(error)
    }
}
impl From<InputError> for TemplateSequenceError {
    fn from(error: InputError) -> Self {
        Self::Input(error)
    }
}
pub enum TemplateSaveRequest<'a> {
    Template(&'a Value),
    Shift(&'a Value),
    Complete(&'a Value),
}
struct Progress {
    input: Arc<Value>,
    input_json: String,
    template: Arc<Value>,
}
enum Stage {
    Template(Value),
    Shift { input: Value, template: Arc<Value> },
    Complete(Arc<Value>),
}
struct Active<S> {
    input: Arc<Value>,
    input_json: String,
    quick_date: Option<String>,
    entries: S,
    template_saved: bool,
    stage: Stage,
}
pub struct NativeTemplateSaveSequence<S> {
    progress: Option<Progress>,
    active: Option<Active<S>>,
}
impl<S: CalendarRecordSource> Default for NativeTemplateSaveSequence<S> {
    fn default() -> Self {
        Self {
            progress: None,
            active: None,
        }
    }
}
impl<S: CalendarRecordSource> NativeTemplateSaveSequence<S> {
    pub fn begin(
        &mut self,
        submission: TemplateSubmission,
        quick_date: Option<&str>,
        entries: S,
    ) -> Result<(), TemplateSequenceError> {
        if self.active.is_some() {
            return Err(TemplateSequenceError::InvalidStage);
        }
        let input_json = submission.input_json()?;
        let (input, _pause) = submission.into_parts();
        let previous = self.progress.as_ref();
        let reused = previous.filter(|saved| reuses_previous(&input_json, Some(&saved.input_json)));
        let mut requested = input.clone();
        if let Some(saved) = previous {
            // Object spread overwrites existing keys without changing their order.
            requested["id"] = saved.template["id"].clone();
            requested["expectedRevision"] = saved.template["revision"].clone();
        }
        let mut active = Active {
            input: Arc::new(input),
            input_json,
            quick_date: quick_date
                .filter(|date| !date.is_empty())
                .map(str::to_owned),
            entries,
            template_saved: reused.is_some(),
            stage: Stage::Template(requested),
        };
        if let Some(saved) = reused {
            active.after_template(Arc::clone(&saved.template))?;
        }
        self.active = Some(active);
        Ok(())
    }
    pub fn request(&self) -> Option<TemplateSaveRequest<'_>> {
        self.active.as_ref().map(|active| match &active.stage {
            Stage::Template(input) => TemplateSaveRequest::Template(input),
            Stage::Shift { input, .. } => TemplateSaveRequest::Shift(input),
            Stage::Complete(template) => TemplateSaveRequest::Complete(template),
        })
    }
    pub fn progress(&self) -> Option<(&Value, &Value)> {
        self.progress
            .as_ref()
            .map(|p| (p.input.as_ref(), p.template.as_ref()))
    }
    pub fn template_saved_for_active(&self) -> bool {
        self.active
            .as_ref()
            .is_some_and(|active| active.template_saved)
    }
    pub fn prepare_write(
        &self,
        context: &NativeWriteContext,
        epochs: &[f64],
        allocated_id: Option<&str>,
    ) -> Result<NativeWritePermit, TemplateSequenceError> {
        match self.request() {
            Some(TemplateSaveRequest::Template(input)) => Ok(context.prepare_template(
                TemplateWriteOperation::Save,
                input,
                epochs,
                allocated_id,
            )?),
            Some(TemplateSaveRequest::Shift(input)) => Ok(context.prepare_day(
                "SHIFT",
                input,
                *epochs.first().ok_or(TemplateSequenceError::InvalidStage)?,
                allocated_id.ok_or(TemplateSequenceError::InvalidStage)?,
            )?),
            _ => Err(TemplateSequenceError::InvalidStage),
        }
    }
    pub fn template_committed(
        &mut self,
        context: &NativeWriteContext,
        committed: CommittedNativeWrite,
    ) -> Result<(), TemplateSequenceError> {
        let active = self
            .active
            .as_mut()
            .ok_or(TemplateSequenceError::InvalidStage)?;
        if !matches!(active.stage, Stage::Template(_)) {
            return Err(TemplateSequenceError::InvalidStage);
        }
        let template = Arc::new(context.committed_template(committed)?);
        active.template_saved = true;
        self.progress = Some(Progress {
            input: Arc::clone(&active.input),
            input_json: active.input_json.clone(),
            template: Arc::clone(&template),
        });
        active.after_template(template)?;
        Ok(())
    }
    pub fn shift_committed(
        &mut self,
        context: &NativeWriteContext,
        committed: CommittedNativeWrite,
    ) -> Result<(), TemplateSequenceError> {
        let active = self
            .active
            .as_mut()
            .ok_or(TemplateSequenceError::InvalidStage)?;
        let Stage::Shift { template, .. } = &active.stage else {
            return Err(TemplateSequenceError::InvalidStage);
        };
        context.committed_day(committed)?;
        active.stage = Stage::Complete(Arc::clone(template));
        Ok(())
    }
    pub fn abort(&mut self) {
        self.active = None;
    }
    pub fn take_completed(&mut self) -> Option<Arc<Value>> {
        if !matches!(self.active.as_ref()?.stage, Stage::Complete(_)) {
            return None;
        }
        let Stage::Complete(template) = self.active.take()?.stage else {
            unreachable!()
        };
        Some(template)
    }
}
impl<S: CalendarRecordSource> Active<S> {
    fn after_template(&mut self, template: Arc<Value>) -> Result<(), InputError> {
        let Some(date) = calendar_date(&self.input, self.quick_date.as_deref()) else {
            self.stage = Stage::Complete(template);
            return Ok(());
        };
        let found = (0..self.entries.entries_len())
            .any(|index| matches_entry(&template, date, |key| self.entries.field(index, key)));
        if found {
            self.stage = Stage::Complete(template);
            return Ok(());
        }
        let input = quick_input(&template, date)?;
        self.stage = Stage::Shift { input, template };
        Ok(())
    }
}
