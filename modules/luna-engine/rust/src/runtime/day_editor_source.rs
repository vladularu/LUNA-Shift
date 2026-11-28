//! Source-bound day-editor domain. Shared FormResource owns handles/publication, never a second pool.
use super::{profile_editor_source::LightProfileContext, write_resource::WriteContextStamp};
use crate::input::{
    InputError, calendar_rows,
    entry_editor_draft::{EntryEditorDraft, EntryEditorMode},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
#[derive(Debug)]
pub enum DayEditorSourceError {
    OwnerChanged,
    StampChanged,
    InvalidSource,
    MissingEntry,
    SourceFailed,
    Input(InputError),
}
impl From<InputError> for DayEditorSourceError {
    fn from(error: InputError) -> Self {
        Self::Input(error)
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DayEntrySourceKind {
    EntryShift,
    EntryAppointment,
    EntryTemplate,
    Templates,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DayEntryReadState {
    Value,
    Null,
    Failed,
}
/// Reported raw IO state, not a deserializable checked Source or Ready DTO.
pub struct RawDayEntrySource<'a> {
    pub kind: DayEntrySourceKind,
    pub state: DayEntryReadState,
    pub body: &'a [u8],
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DayEditorOpenRequest {
    pub entry_id: Option<String>,
    pub mode: EntryEditorMode,
    pub date: String,
}
pub struct NativeDayEditorSource {
    light: LightProfileContext,
    request: DayEditorOpenRequest,
    mode: EntryEditorMode,
    initial: Option<Value>,
    unjoined: Option<Value>,
    templates: Option<Vec<Value>>,
}
impl NativeDayEditorSource {
    pub fn from_light(
        light: LightProfileContext,
        stamp: &WriteContextStamp,
        request: DayEditorOpenRequest,
        raw: &[RawDayEntrySource<'_>],
    ) -> Result<Self, DayEditorSourceError> {
        use DayEditorSourceError as E;
        use DayEntrySourceKind as K;
        if !light.is_current().map_err(|_| E::OwnerChanged)? {
            return Err(E::OwnerChanged);
        }
        if light.stamp() != stamp {
            return Err(E::StampChanged);
        }
        crate::input::calendar::require_local_date(&Value::String(request.date.clone()))?;
        if request
            .entry_id
            .as_ref()
            .is_some_and(|id| id.is_empty() || id.encode_utf16().count() > 256)
        {
            return Err(E::InvalidSource);
        }
        let mut groups: [Option<&RawDayEntrySource<'_>>; 4] = [None; 4];
        let mut bytes = 0usize;
        for group in raw {
            bytes = bytes
                .checked_add(group.body.len())
                .ok_or(E::InvalidSource)?;
            if bytes > 16_777_216 - 262_144 {
                return Err(E::InvalidSource);
            }
            let slot = &mut groups[group.kind as usize];
            if slot.replace(group).is_some() {
                return Err(E::InvalidSource);
            }
        }
        let mut initial = None;
        let mut unjoined = None;
        if let Some(id) = request.entry_id.as_deref() {
            let shift = read(groups[K::EntryShift as usize])?;
            let appointment = read(groups[K::EntryAppointment as usize])?;
            let mut service = None;
            let mut appt = None;
            if let Some(row) = shift.as_ref() {
                check_columns(row, calendar_rows::SHIFT_ROW_FIELDS)?;
                check_id(row, id)?;
                if row["deleted_at"].is_null() && repository_date(row, false) {
                    let linked = read(groups[K::EntryTemplate as usize])?;
                    if let Some(template) = linked.as_ref() {
                        check_columns(template, calendar_rows::TEMPLATE_ROW_FIELDS)?;
                        if template["id"] != row["template_id"] {
                            return Err(E::InvalidSource);
                        }
                    }
                    service = Some((
                        calendar_rows::map_shift_display(row, linked.as_ref())?,
                        calendar_rows::map_shift(row)?,
                    ));
                }
            }
            if let Some(row) = appointment.as_ref() {
                check_columns(row, calendar_rows::APPOINTMENT_ROW_FIELDS)?;
                check_id(row, id)?;
                if row["deleted_at"].is_null() && repository_date(row, true) {
                    let value = calendar_rows::map_appointment(row)?;
                    appt = Some((value.clone(), value));
                }
            }
            // Only one record per physical table can have this ID. For equal ISO
            // dates every SHIFT priority precedes APPOINTMENT; later sort fields
            // are therefore never reached. No fabricated locale ranks are used.
            let selected = match (service, appt) {
                (Some(s), Some(a)) => Some(if a.0["date"].as_str() < s.0["date"].as_str() {
                    a
                } else {
                    s
                }),
                (s, None) => s,
                (None, a) => a,
            }
            .ok_or(E::MissingEntry)?;
            initial = Some(selected.0);
            unjoined = Some(selected.1);
        } else if groups[..3].iter().any(Option::is_some) {
            return Err(E::InvalidSource);
        }
        let mode = match initial.as_ref().and_then(|v| v["kind"].as_str()) {
            Some("SHIFT") => EntryEditorMode::Shift,
            Some("APPOINTMENT") => EntryEditorMode::Appointment,
            None => request.mode,
            _ => return Err(E::InvalidSource),
        };
        let templates = if mode == EntryEditorMode::Shift {
            let source = read(groups[K::Templates as usize])?.ok_or(E::InvalidSource)?;
            let rows = source
                .as_array()
                .filter(|v| v.len() <= 50_000)
                .ok_or(E::InvalidSource)?;
            let mut ids = std::collections::BTreeSet::new();
            let mut normalized = Vec::with_capacity(rows.len());
            for row in rows {
                check_columns(row, calendar_rows::TEMPLATE_ROW_FIELDS)?;
                if !row["deleted_at"].is_null()
                    || !ids.insert(row["id"].as_str().ok_or(E::InvalidSource)?)
                {
                    return Err(E::InvalidSource);
                }
                normalized.push(calendar_rows::map_template(row)?);
            }
            Some(normalized)
        } else {
            None
        };
        if !light.is_current().map_err(|_| E::OwnerChanged)? {
            return Err(E::OwnerChanged);
        }
        Ok(Self {
            light,
            request,
            mode,
            initial,
            unjoined,
            templates,
        })
    }
    pub fn mode(&self) -> EntryEditorMode {
        self.mode
    }
    pub fn initial(&self) -> Option<&Value> {
        self.initial.as_ref()
    }
    pub fn unjoined(&self) -> Option<&Value> {
        self.unjoined.as_ref()
    }
    pub fn templates(&self) -> Option<&[Value]> {
        self.templates.as_deref()
    }
    pub fn request(&self) -> &DayEditorOpenRequest {
        &self.request
    }
    pub fn is_current(&self) -> Result<bool, DayEditorSourceError> {
        self.light
            .is_current()
            .map_err(|_| DayEditorSourceError::OwnerChanged)
    }
    pub fn new_draft(&self, default_color: &str) -> Result<EntryEditorDraft, DayEditorSourceError> {
        if !self.is_current()? {
            return Err(DayEditorSourceError::OwnerChanged);
        }
        let empty = Value::Null;
        let shift = self
            .initial
            .as_ref()
            .filter(|v| v["kind"] == "SHIFT")
            .unwrap_or(&empty);
        let appointment = self
            .initial
            .as_ref()
            .filter(|v| v["kind"] == "APPOINTMENT")
            .unwrap_or(&empty);
        Ok(EntryEditorDraft::new_raw(
            shift,
            appointment,
            self.mode,
            default_color,
        )?)
    }
    pub(crate) fn profile(&self) -> Option<&Value> {
        self.light.context().map(|c| c.profile().as_ref())
    }
    pub(crate) fn provider_context(
        &self,
    ) -> Option<&std::sync::Arc<super::profile_editor_source::ProfileEditorContext>> {
        self.light.context()
    }
    pub(crate) fn stamp(&self) -> &WriteContextStamp {
        self.light.stamp()
    }
    pub(crate) fn shares_lease(&self, lease: &super::utility_lease::UtilityLease) -> bool {
        self.light.shares_lease(lease)
    }
    pub(crate) fn shares_write_context(
        &self,
        context: &super::write_resource::NativeWriteContext,
    ) -> bool {
        self.light.shares_write_context(context)
    }
    pub fn display(&self, draft: &EntryEditorDraft) -> Result<Value, DayEditorSourceError> {
        if !self.is_current()? {
            return Err(DayEditorSourceError::OwnerChanged);
        }
        let empty = Value::Null;
        let initial = self.initial.as_ref().unwrap_or(&empty);
        let mode = match self.mode {
            EntryEditorMode::Shift => "SHIFT",
            EntryEditorMode::Appointment => "APPOINTMENT",
        };
        let value = crate::input::entry_editor_display::prepare(
            &draft.view()?["fields"],
            self.profile().unwrap_or(&empty),
            &self.request.date,
            mode,
            if self.mode == EntryEditorMode::Shift {
                initial
            } else {
                &empty
            },
            if self.mode == EntryEditorMode::Appointment {
                initial
            } else {
                &empty
            },
        )?;
        if !self.is_current()? {
            return Err(DayEditorSourceError::OwnerChanged);
        }
        Ok(value)
    }
}

fn read(group: Option<&RawDayEntrySource<'_>>) -> Result<Option<Value>, DayEditorSourceError> {
    use DayEditorSourceError as E;
    let group = group.ok_or(E::InvalidSource)?;
    match group.state {
        DayEntryReadState::Failed => Err(E::SourceFailed),
        DayEntryReadState::Null => {
            if group.body.is_empty() {
                Ok(None)
            } else {
                Err(E::InvalidSource)
            }
        }
        DayEntryReadState::Value => {
            let text = std::str::from_utf8(group.body).map_err(|_| E::InvalidSource)?;
            let value = crate::input::raw_json::parse(text).map_err(|_| E::InvalidSource)?;
            if value.is_null() {
                return Err(E::InvalidSource);
            }
            Ok(Some(value))
        }
    }
}
fn check_columns(row: &Value, columns: &[&str]) -> Result<(), DayEditorSourceError> {
    if row.as_object().is_some_and(|v| {
        v.len()
            == columns.len()
                + usize::from(
                    columns == calendar_rows::SHIFT_ROW_FIELDS
                        && v.contains_key("absence_pay_json"),
                )
            && columns.iter().all(|c| v.contains_key(*c))
    }) {
        Ok(())
    } else {
        Err(DayEditorSourceError::InvalidSource)
    }
}
fn check_id(row: &Value, id: &str) -> Result<(), DayEditorSourceError> {
    if row["id"].as_str() == Some(id) {
        Ok(())
    } else {
        Err(DayEditorSourceError::InvalidSource)
    }
}
fn repository_date(row: &Value, appointment: bool) -> bool {
    row["date"].as_str().is_some_and(|date| {
        date <= "4099-12-31"
            && (date >= "1900-01-01" || (appointment && !row["recurrence_frequency"].is_null()))
    })
}
