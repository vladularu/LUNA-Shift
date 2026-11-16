//! Native sharing draft. Host code only allocates public IDs and encodes UTF-16.
pub(crate) mod command;
mod projection;
mod selection;
mod text;
pub(crate) use text::{utf16_len, utf16_prefix};

use serde::Serialize;
use serde_json::Value;
use std::{collections::BTreeMap, fmt, sync::Arc};

const MAX_SOURCE_ROWS: usize = 50_000;
const MAX_PROJECTED: usize = 10_000;
const MAX_PAGE: usize = 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct SharingError {
    pub name: &'static str,
    pub code: &'static str,
}
impl SharingError {
    const fn invalid() -> Self {
        Self {
            name: "Error",
            code: "SHARE_INVALID_SOURCE",
        }
    }
    const fn time() -> Self {
        Self {
            name: "RangeError",
            code: "SHARE_TIME_UNAVAILABLE",
        }
    }
    const fn code(code: &'static str) -> Self {
        Self {
            name: "Error",
            code,
        }
    }
}
impl fmt::Display for SharingError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code)
    }
}
impl std::error::Error for SharingError {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityCandidate {
    pub slot: usize,
    pub kind: String,
    pub private_id: String,
    pub local_key: String,
}
pub struct PublicIdBinding {
    pub slot: usize,
    pub public_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedEntry {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note_utf16: Option<Option<Vec<u16>>>,
    pub id: String,
    pub break_minutes: Option<f64>,
    pub starts_at: String,
    pub ends_at: String,
    pub time_zone: String,
    pub all_day: bool,
    pub title_utf16: Vec<u16>,
    pub symbol: String,
    pub color: String,
}
#[derive(Serialize)]
pub struct SharingProjectionResult {
    pub entries: Vec<SharedEntry>,
    pub signature: String,
}

struct Content {
    shifts: bool,
    all_appointments: bool,
    notes: bool,
}
struct Options {
    time_zone: String,
    neutral: bool,
    content: Option<Content>,
    selected: std::collections::BTreeSet<String>,
}
impl Options {
    fn parse(value: &Value) -> Result<Self, SharingError> {
        let object = value.as_object().ok_or_else(SharingError::invalid)?;
        if object.keys().any(|key| {
            !matches!(
                key.as_str(),
                "timeZone" | "visibility" | "content" | "selectedAppointmentIds"
            )
        }) {
            return Err(SharingError::invalid());
        }
        let time_zone = required_string(value, "timeZone")?.to_owned();
        let neutral = match required_string(value, "visibility")? {
            "AVAILABILITY" => true,
            "DETAILS" => false,
            _ => return Err(SharingError::invalid()),
        };
        let content = value
            .get("content")
            .filter(|v| !v.is_null())
            .map(|value| {
                let fields = value.as_object().ok_or_else(SharingError::invalid)?;
                if fields.keys().any(|key| {
                    !matches!(
                        key.as_str(),
                        "version" | "shifts" | "allAppointments" | "notes" | "consentReset"
                    )
                }) || value.get("version").and_then(Value::as_i64) != Some(2)
                    || value
                        .get("consentReset")
                        .is_some_and(|v| v != &Value::Bool(true))
                {
                    return Err(SharingError::invalid());
                }
                let boolean = |key| {
                    value
                        .get(key)
                        .and_then(Value::as_bool)
                        .ok_or_else(SharingError::invalid)
                };
                Ok(Content {
                    shifts: boolean("shifts")?,
                    all_appointments: boolean("allAppointments")?,
                    notes: boolean("notes")?,
                })
            })
            .transpose()?;
        let selected = match value.get("selectedAppointmentIds") {
            None | Some(Value::Null) => Default::default(),
            Some(Value::Array(values)) if values.len() <= MAX_SOURCE_ROWS => values
                .iter()
                .map(|v| {
                    v.as_str()
                        .map(str::to_owned)
                        .ok_or_else(SharingError::invalid)
                })
                .collect::<Result<_, _>>()?,
            _ => return Err(SharingError::invalid()),
        };
        Ok(Self {
            time_zone,
            neutral,
            content,
            selected,
        })
    }
}
fn required_string<'a>(value: &'a Value, key: &str) -> Result<&'a str, SharingError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(SharingError::invalid)
}

/// Retains the original immutable owner. It cannot be deserialized or forged as Ready.
pub struct SharingProjectionDraft {
    source: Arc<Vec<Value>>,
    options: Options,
    groups: Vec<selection::IdentityGroup>,
    selected: Vec<selection::SelectedEntry>,
    identity_count: usize,
}
impl SharingProjectionDraft {
    pub fn prepare(source: Arc<Vec<Value>>, options: &Value) -> Result<Self, SharingError> {
        if source.len() > MAX_SOURCE_ROWS {
            return Err(SharingError::code("SHARE_INPUT_TOO_LARGE"));
        }
        let options = Options::parse(options)?;
        let (groups, selected, identity_count) = selection::prepare(&source, &options)?;
        Ok(Self {
            source,
            options,
            groups,
            selected,
            identity_count,
        })
    }
    pub fn identity_candidate_count(&self) -> usize {
        self.identity_count
    }
    pub fn source_owner(&self) -> &Arc<Vec<Value>> {
        &self.source
    }
    /// Ordinary source rows are borrowed; only bounded split time facts are owned.
    pub fn owned_projection_time_count(&self) -> usize {
        self.selected
            .iter()
            .filter(|entry| entry.projected_time.is_some())
            .count()
    }
    pub fn identity_candidates_page(
        &self,
        offset: usize,
        limit: usize,
    ) -> Result<Vec<IdentityCandidate>, SharingError> {
        if limit > MAX_PAGE || offset > self.identity_count {
            return Err(SharingError::code("SHARE_INVALID_PAGE"));
        }
        let end = offset.saturating_add(limit).min(self.identity_count);
        (offset..end).map(|slot| self.candidate(slot)).collect()
    }
    fn candidate(&self, slot: usize) -> Result<IdentityCandidate, SharingError> {
        let group_index = self
            .groups
            .partition_point(|group| group.first_slot <= slot)
            .checked_sub(1)
            .ok_or_else(SharingError::invalid)?;
        let group = &self.groups[group_index];
        let entry = &self.source[group.raw_index];
        let kind = required_string(entry, "kind")?.to_owned();
        let raw_id = required_string(entry, "id")?;
        let part = slot - group.first_slot;
        let private_id = if group.split && part > 0 {
            format!("{raw_id}:part:{part}")
        } else {
            raw_id.to_owned()
        };
        let local_key = format!("{kind}:{private_id}");
        Ok(IdentityCandidate {
            slot,
            kind,
            private_id,
            local_key,
        })
    }
    /// Only these slots need public bindings. Hidden identities remain separately pageable.
    pub fn projection_candidates(&self) -> Result<Vec<IdentityCandidate>, SharingError> {
        self.selected
            .iter()
            .map(|entry| self.candidate(entry.slot))
            .collect()
    }
    pub fn finish(
        self,
        bindings: &[PublicIdBinding],
    ) -> Result<SharingProjectionResult, SharingError> {
        if bindings.len() > MAX_PROJECTED + 1 {
            return Err(SharingError::code("SHARE_INVALID_BINDINGS"));
        }
        let mut ids = BTreeMap::new();
        for binding in bindings {
            if self
                .selected
                .binary_search_by_key(&binding.slot, |entry| entry.slot)
                .is_err()
                || ids
                    .insert(binding.slot, binding.public_id.as_str())
                    .is_some()
            {
                return Err(SharingError::code("SHARE_INVALID_BINDINGS"));
            }
        }
        let mut entries = Vec::with_capacity(self.selected.len().min(MAX_PROJECTED));
        for selected in &self.selected {
            let id = ids
                .get(&selected.slot)
                .ok_or_else(|| SharingError::code("SHARE_INVALID_BINDINGS"))?;
            if !text::valid_uuid(id) {
                return Err(SharingError::code("SHARE_INVALID_PUBLIC_ID"));
            }
            entries.push(projection::entry(
                &self.source[selected.raw_index],
                selected,
                id,
                &self.options,
            )?);
            if entries.len() > MAX_PROJECTED {
                return Err(SharingError::code("SHARE_SNAPSHOT_TOO_LARGE"));
            }
        }
        let signature = text::signature(&entries)?;
        Ok(SharingProjectionResult { entries, signature })
    }
}
