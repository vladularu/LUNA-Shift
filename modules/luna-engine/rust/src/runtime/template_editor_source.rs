//! Original template-editor source roles. This does not mint a write permit.
use super::{
    calendar_loaded::{LoadedPoolError, LoadedReadSource, LoadedSubmissionCapture},
    profile_editor_source::LightProfileContext,
    write_resource::WriteContextStamp,
};
use crate::input::{
    InputError,
    profile_form::FormClock,
    template_editor::{TemplateEditorDraft, TemplateSubmitStart},
    template_write::NativeTemplateWriteSource,
};
use serde_json::Value;
use std::sync::Arc;

#[derive(Debug)]
pub enum TemplateEditorSourceError {
    OwnerChanged,
    StampChanged,
    InvalidSource,
    MissingTemplate,
    TemplatesNotRequested,
    TemplatesLoading,
    TemplatesFailed,
    ForeignLoadedSource,
    Loaded(LoadedPoolError),
    Input(InputError),
}
impl From<InputError> for TemplateEditorSourceError {
    fn from(error: InputError) -> Self {
        Self::Input(error)
    }
}

/// An observed IO result. The native source parses the physical SQL rows itself.
pub enum TemplateRowsRead<'a> {
    NotRequested,
    Loading,
    Failed,
    Null,
    Value(&'a [u8]),
}

/// A native immutable template list, never deserializable as a Ready UI list.
pub struct NativeTemplateCollection {
    templates: Vec<Value>,
}
impl NativeTemplateCollection {
    pub fn from_raw(read: TemplateRowsRead<'_>) -> Result<Self, TemplateEditorSourceError> {
        let bytes = match read {
            TemplateRowsRead::NotRequested => {
                return Err(TemplateEditorSourceError::TemplatesNotRequested);
            }
            TemplateRowsRead::Loading => return Err(TemplateEditorSourceError::TemplatesLoading),
            TemplateRowsRead::Failed => return Err(TemplateEditorSourceError::TemplatesFailed),
            TemplateRowsRead::Null => return Err(TemplateEditorSourceError::InvalidSource),
            TemplateRowsRead::Value(bytes) => bytes,
        };
        if bytes.len() > 16_515_072 {
            return Err(TemplateEditorSourceError::InvalidSource);
        }
        let text =
            std::str::from_utf8(bytes).map_err(|_| TemplateEditorSourceError::InvalidSource)?;
        let rows = crate::input::raw_json::parse(text)
            .map_err(|_| TemplateEditorSourceError::InvalidSource)?;
        let Value::Array(rows) = rows else {
            return Err(TemplateEditorSourceError::InvalidSource);
        };
        Self::from_raw_rows(rows.into())
    }
    pub fn from_raw_rows(rows: Arc<[Value]>) -> Result<Self, TemplateEditorSourceError> {
        Ok(Self {
            templates: NativeTemplateWriteSource::from_raw_rows(rows)?.active_templates()?,
        })
    }
    pub fn templates(&self) -> &[Value] {
        &self.templates
    }
}

/// Raw route intent. Initial selection and Provider role are resolved natively.
pub struct TemplateEditorOpenRequest {
    pub template_id: Option<String>,
    pub quick_entry_date: Option<String>,
}
pub struct NativeTemplateEditorSource {
    light: LightProfileContext,
    request: TemplateEditorOpenRequest,
    initial: Option<Value>,
    clock: FormClock,
}
impl NativeTemplateEditorSource {
    pub fn from_light(
        light: LightProfileContext,
        stamp: &WriteContextStamp,
        request: TemplateEditorOpenRequest,
        templates: &NativeTemplateCollection,
    ) -> Result<Self, TemplateEditorSourceError> {
        if !light
            .is_current()
            .map_err(|_| TemplateEditorSourceError::OwnerChanged)?
        {
            return Err(TemplateEditorSourceError::OwnerChanged);
        }
        if light.stamp() != stamp {
            return Err(TemplateEditorSourceError::StampChanged);
        }
        if request
            .template_id
            .as_ref()
            .is_some_and(|s| s.is_empty() || s.encode_utf16().count() > 256)
        {
            return Err(TemplateEditorSourceError::InvalidSource);
        }
        if let Some(date) = &request.quick_entry_date {
            crate::input::calendar::require_local_date(&Value::String(date.clone()))?;
        }
        let initial = request
            .template_id
            .as_ref()
            .map(|id| {
                templates
                    .templates
                    .iter()
                    .find(|t| t["id"].as_str() == Some(id))
                    .cloned()
                    .ok_or(TemplateEditorSourceError::MissingTemplate)
            })
            .transpose()?;
        let clock =
            FormClock::from_instant(&crate::input::javascript_date::iso_from_epoch_milliseconds(
                light.observed_epoch_milliseconds() as f64,
            )?)?;
        if !light
            .is_current()
            .map_err(|_| TemplateEditorSourceError::OwnerChanged)?
        {
            return Err(TemplateEditorSourceError::OwnerChanged);
        }
        Ok(Self {
            light,
            request,
            initial,
            clock,
        })
    }
    pub fn initial(&self) -> Option<&Value> {
        self.initial.as_ref()
    }
    pub fn request(&self) -> &TemplateEditorOpenRequest {
        &self.request
    }
    pub fn is_current(&self) -> Result<bool, TemplateEditorSourceError> {
        self.light
            .is_current()
            .map_err(|_| TemplateEditorSourceError::OwnerChanged)
    }
    pub fn new_draft(
        &self,
        appearance: &Value,
    ) -> Result<TemplateEditorDraft, TemplateEditorSourceError> {
        if !self.is_current()? {
            return Err(TemplateEditorSourceError::OwnerChanged);
        }
        Ok(TemplateEditorDraft::new_raw(
            self.initial.as_ref().unwrap_or(&Value::Null),
            appearance,
        )?)
    }
    pub fn render(
        &self,
        draft: &TemplateEditorDraft,
        ios: bool,
    ) -> Result<Value, TemplateEditorSourceError> {
        if !self.is_current()? {
            return Err(TemplateEditorSourceError::OwnerChanged);
        }
        let value = draft.render(
            self.light
                .context()
                .map_or(&Value::Null, |context| context.profile().as_ref()),
            &self.clock,
            self.request.quick_entry_date.as_deref(),
            ios,
        )?;
        if !self.is_current()? {
            return Err(TemplateEditorSourceError::OwnerChanged);
        }
        Ok(value)
    }
    pub fn prepare_submit(
        &self,
        draft: &mut TemplateEditorDraft,
        templates: &NativeTemplateCollection,
    ) -> Result<TemplateSubmitStart, TemplateEditorSourceError> {
        if !self.is_current()? {
            return Err(TemplateEditorSourceError::OwnerChanged);
        }
        Ok(draft.prepare_submit_borrowed(templates.templates.iter())?)
    }
    /// Pins exactly the current native entries before any SQL await. Later
    /// scope changes do not replace them. The controller must separately bind
    /// the selected FullLoad profile/template context and its private write ID.
    pub fn pin_entries_for_submission(
        &self,
        source: &LoadedReadSource,
        write_id: u64,
    ) -> Result<LoadedSubmissionCapture, TemplateEditorSourceError> {
        if !self.is_current()? {
            return Err(TemplateEditorSourceError::OwnerChanged);
        }
        if !self.light.shares_loaded_source(source) {
            return Err(TemplateEditorSourceError::ForeignLoadedSource);
        }
        source
            .pin_submission(write_id)
            .map_err(TemplateEditorSourceError::Loaded)
    }
}
