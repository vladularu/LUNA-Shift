//! Closed resource frames. A source selector is an untrusted locator, never a
//! Ready claim; the runtime must acquire its own current native source lease.
use super::{ContractError, SnapshotIdentity, utility::UtilityGuard};
use crate::calendar::window::{WindowOptions, WindowSpec};
use serde::de::{DeserializeOwned, DeserializeSeed};
use serde::{Deserialize, Serialize};

pub const MAX_PREPARE_BYTES: usize = 8192;
pub const MAX_CONTROL_BYTES: usize = 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum WindowSource {
    ReportSnapshot {
        identity: SnapshotIdentity,
    },
    CalendarOnly {
        identity: super::calendar_only::CalendarRowIdentity,
    },
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrepareRequest {
    wire_schema_version: u32,
    expected_engine_version: String,
    calculation_contract_version: String,
    guard: UtilityGuard,
    source: WindowSource,
    spec: WindowSpec,
    options: WindowOptions,
    locale_key: String,
    #[serde(default, deserialize_with = "present_presentation")]
    presentation: Option<NavigationPresentation>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NavigationPresentation {
    pub clock_identity: super::calendar_only::CalendarClockIdentity,
    pub observed_epoch_milliseconds: i64,
    pub anchor_month: String,
    #[serde(deserialize_with = "present_selection")]
    pub selected_date: Option<String>,
    pub before: u16,
    pub after: u16,
    #[serde(
        default,
        deserialize_with = "present_entries",
        skip_serializing_if = "Option::is_none"
    )]
    pub entries: Option<EntryPresentation>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EntryPresentation {
    pub label_mode: crate::calendar::presentation::LabelMode,
    pub show_shift_times: bool,
    pub show_shift_duration: bool,
    pub row_capacity: u16,
    pub detailed_shifts: bool,
    pub reserve_overflow: bool,
}
fn present_entries<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<EntryPresentation>, D::Error> {
    EntryPresentation::deserialize(d).map(Some)
}
fn present_selection<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(d)
}
fn present_presentation<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<NavigationPresentation>, D::Error> {
    NavigationPresentation::deserialize(d).map(Some)
}
impl PrepareRequest {
    pub fn presentation(&self) -> Option<&NavigationPresentation> {
        self.presentation.as_ref()
    }
    pub fn guard(&self) -> &UtilityGuard {
        &self.guard
    }
    pub fn source(&self) -> &WindowSource {
        &self.source
    }
    pub fn spec(&self) -> &WindowSpec {
        &self.spec
    }
    pub fn options(&self) -> WindowOptions {
        self.options
    }
    pub fn locale_key(&self) -> &str {
        &self.locale_key
    }
    /// Locator-only guard. Runtime admission must still acquire/check its own
    /// full native snapshot lease; this cannot bind a CalendarOnly slot.
    pub fn report_snapshot_guard(&self) -> Result<UtilityGuard, ContractError> {
        match &self.source {
            WindowSource::ReportSnapshot { identity } => self.guard.bind_report_snapshot(identity),
            WindowSource::CalendarOnly { .. } => Err(ContractError::InvalidRequest),
        }
    }
    /// Native source acquisition remains mandatory. The CalendarOnly arm uses
    /// only the owner/draft utility channel; it never binds a finance snapshot.
    pub fn source_guard(&self) -> Result<UtilityGuard, ContractError> {
        match &self.source {
            WindowSource::ReportSnapshot { identity } => self.guard.bind_report_snapshot(identity),
            WindowSource::CalendarOnly { identity } => {
                identity.validate()?;
                if self.guard.snapshot().is_some() {
                    return Err(ContractError::InvalidRequest);
                }
                if identity.owner_scope() != self.guard.owner_scope()
                    || identity.owner_epoch() != self.guard.owner_epoch()
                {
                    return Err(ContractError::IdentityMismatch);
                }
                Ok(self.guard.clone())
            }
        }
    }
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidatesRequest {
    resource_id: u64,
    candidate_digest: String,
    #[serde(default)]
    after: Option<u32>,
    limit: u16,
}
impl CandidatesRequest {
    pub fn resource_id(&self) -> u64 {
        self.resource_id
    }
    pub fn candidate_digest(&self) -> &str {
        &self.candidate_digest
    }
    pub fn after(&self) -> Option<u32> {
        self.after
    }
    pub fn limit(&self) -> u16 {
        self.limit
    }
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FinalizeRequest {
    resource_id: u64,
    candidate_digest: String,
}
impl FinalizeRequest {
    pub fn resource_id(&self) -> u64 {
        self.resource_id
    }
    pub fn candidate_digest(&self) -> &str {
        &self.candidate_digest
    }
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PageView {
    Expanded,
    Visible,
    VisibleIndices,
    Dates,
    Months,
    Navigation,
    EntryPresentations,
    DatePreviews,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadRequest {
    resource_id: u64,
    view: PageView,
    #[serde(default)]
    after: Option<u32>,
    limit: u16,
}
impl ReadRequest {
    pub fn resource_id(&self) -> u64 {
        self.resource_id
    }
    pub fn view(&self) -> PageView {
        self.view
    }
    pub fn after(&self) -> Option<u32> {
        self.after
    }
    pub fn limit(&self) -> u16 {
        self.limit
    }
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AbortRequest {
    resource_id: u64,
}
impl AbortRequest {
    pub fn resource_id(&self) -> u64 {
        self.resource_id
    }
}

fn frame<T: DeserializeOwned>(bytes: &[u8], maximum: usize) -> Result<T, ContractError> {
    if bytes.len() > maximum {
        return Err(ContractError::InputTooLarge);
    }
    let mut budget = super::JsonBudget {
        nodes: super::MAX_JSON_NODES - 1024,
        error: None,
    };
    let mut parser = serde_json::Deserializer::from_slice(bytes);
    let value = super::BoundedSeed {
        depth: super::MAX_JSON_DEPTH - 24,
        budget: &mut budget,
    }
    .deserialize(&mut parser)
    .map_err(|_| budget.error.unwrap_or(ContractError::InvalidJson))?;
    parser.end().map_err(|_| ContractError::InvalidJson)?;
    serde_json::from_value(value).map_err(|_| ContractError::MalformedEnvelope)
}
fn resource(id: u64) -> Result<(), ContractError> {
    if id == 0 || id > super::MAX_SAFE_REVISION {
        Err(ContractError::InvalidIdentifier)
    } else {
        Ok(())
    }
}
fn page(after: Option<u32>, limit: u16) -> Result<(), ContractError> {
    if !(1..=1024).contains(&limit) || after.is_some_and(|n| n > super::MAX_SOURCE_ITEMS) {
        Err(ContractError::InvalidRequest)
    } else {
        Ok(())
    }
}
pub fn parse_prepare(bytes: &[u8]) -> Result<PrepareRequest, ContractError> {
    let value: PrepareRequest = frame(bytes, MAX_PREPARE_BYTES)?;
    if value.wire_schema_version != super::SCHEMA_VERSION {
        return Err(ContractError::UnsupportedSchema);
    }
    if value.expected_engine_version != crate::ENGINE_VERSION {
        return Err(ContractError::UnsupportedEngine);
    }
    if value.calculation_contract_version != super::CONTRACT_VERSION {
        return Err(ContractError::UnsupportedContract);
    }
    value.guard.validate()?;
    value.source_guard()?;
    if let Some(p) = &value.presentation {
        if p.entries.as_ref().is_some_and(|e| e.row_capacity > 128) {
            return Err(ContractError::InvalidRequest);
        }
        p.clock_identity.validate()?;
        if !matches!(value.source, WindowSource::CalendarOnly { .. })
            || p.clock_identity.owner_scope() != value.guard.owner_scope()
            || p.clock_identity.owner_epoch() != value.guard.owner_epoch()
            || usize::from(p.before) + usize::from(p.after) + 1 > 128
            || p.observed_epoch_milliseconds.unsigned_abs() > crate::money::MAX_SAFE_INTEGER as u64
        {
            return Err(ContractError::InvalidRequest);
        }
        let anchor = crate::calendar::month_range(&p.anchor_month)
            .map_err(|_| ContractError::InvalidRequest)?;
        let bounds = value
            .spec
            .bounds()
            .map_err(|_| ContractError::InvalidRequest)?;
        if anchor.end < bounds.start_date || anchor.start > bounds.end_date {
            return Err(ContractError::InvalidRequest);
        }
        if let Some(date) = &p.selected_date {
            crate::calendar::parse_date(date).map_err(|_| ContractError::InvalidRequest)?;
        }
    }
    value
        .spec
        .bounds()
        .map_err(|_| ContractError::InvalidRequest)?;
    if value.locale_key.is_empty()
        || value.locale_key.len() > 512
        || value.locale_key.chars().any(char::is_control)
    {
        return Err(ContractError::InvalidRequest);
    }
    Ok(value)
}
pub fn parse_candidates(bytes: &[u8]) -> Result<CandidatesRequest, ContractError> {
    let value: CandidatesRequest = frame(bytes, MAX_CONTROL_BYTES)?;
    resource(value.resource_id)?;
    super::digest(&value.candidate_digest)?;
    page(value.after, value.limit)?;
    Ok(value)
}
pub fn parse_finalize(bytes: &[u8]) -> Result<FinalizeRequest, ContractError> {
    let value: FinalizeRequest = frame(bytes, MAX_CONTROL_BYTES)?;
    resource(value.resource_id)?;
    super::digest(&value.candidate_digest)?;
    Ok(value)
}
pub fn parse_read(bytes: &[u8]) -> Result<ReadRequest, ContractError> {
    let value: ReadRequest = frame(bytes, MAX_CONTROL_BYTES)?;
    resource(value.resource_id)?;
    page(value.after, value.limit)?;
    Ok(value)
}
pub fn parse_abort(bytes: &[u8]) -> Result<AbortRequest, ContractError> {
    let value: AbortRequest = frame(bytes, MAX_CONTROL_BYTES)?;
    resource(value.resource_id)?;
    Ok(value)
}
