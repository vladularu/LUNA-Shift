//! R0 wire foundations. Untranslated source payloads are input-only, never calculation results.
pub mod assembly;
pub mod calendar_only;
pub mod calendar_window;
mod canonical;
pub mod checks_details;
mod snapshot_digest;
pub(crate) use canonical::{Borrowed as CanonicalValueRef, HashWriter as CanonicalHashWriter};
pub mod export_report;
pub mod financial_collation;
pub mod financial_details;
mod payroll_page;
mod payroll_panel;
pub use payroll_panel::PayrollPanel;
pub mod utility;
use serde::de::{DeserializeSeed, Error as DeError, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Number, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fmt;
use std::sync::Arc;

pub const SCHEMA_VERSION: u32 = 1;
pub const CONTRACT_VERSION: &str = "luna-engine-contract-v1";
pub const MAX_INPUT_BYTES: u32 = 33_554_432;
pub const MAX_JSON_DEPTH: u32 = 48;
pub const MAX_JSON_NODES: u32 = 2_000_000;
pub const MAX_SOURCE_ITEMS: u32 = 100_000;
// Saved roster bindings accept 100,000 UTF-16 code units in the source. Three
// UTF-8 bytes per unit covers even the largest valid BMP-string representation.
// Field validators keep their own smaller limits; the total input cap remains.
pub const MAX_STRING_BYTES: u32 = 300_000;
pub const MAX_ID_BYTES: u32 = 96;
pub const MAX_SAFE_REVISION: u64 = 9_007_199_254_740_991;

/// Authentication/lifecycle data is available before loading any calculation
/// snapshot. This checked owner handle therefore needs no placeholder digests.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnerIdentity {
    scope: String,
    epoch: u64,
}
impl OwnerIdentity {
    pub fn new(scope: &str, epoch: u64) -> Result<Self, ContractError> {
        identifier(scope)?;
        revision(epoch)?;
        if epoch == 0 {
            return Err(ContractError::InvalidRevision);
        }
        Ok(Self {
            scope: scope.to_owned(),
            epoch,
        })
    }
    pub fn scope(&self) -> &str {
        &self.scope
    }
    pub fn epoch(&self) -> u64 {
        self.epoch
    }
}

/// Separate checked lifecycle command; authentication is available before the
/// calculation snapshot and does not need fabricated snapshot IDs or digests.
pub fn parse_owner_binding(bytes: &[u8]) -> Result<OwnerIdentity, ContractError> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Input {
        owner_scope: String,
        owner_epoch: u64,
    }
    if bytes.len() > 1024 {
        return Err(ContractError::InputTooLarge);
    }
    let input: Input = serde_json::from_value(bounded_json(bytes)?)
        .map_err(|_| ContractError::MalformedEnvelope)?;
    OwnerIdentity::new(&input.owner_scope, input.owner_epoch)
}
/// A small admission fence is available before a large source snapshot has
/// finished loading/serializing. It grants no data or calculation readiness.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RevisionFence {
    owner: OwnerIdentity,
    snapshot_revision: u64,
}
impl RevisionFence {
    pub fn new(owner: OwnerIdentity, snapshot_revision: u64) -> Result<Self, ContractError> {
        revision(snapshot_revision)?;
        Ok(Self {
            owner,
            snapshot_revision,
        })
    }
    pub fn owner(&self) -> &OwnerIdentity {
        &self.owner
    }
    pub fn snapshot_revision(&self) -> u64 {
        self.snapshot_revision
    }
}
pub fn parse_revision_fence(bytes: &[u8]) -> Result<RevisionFence, ContractError> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Input {
        owner_scope: String,
        owner_epoch: u64,
        snapshot_revision: u64,
    }
    if bytes.len() > 1024 {
        return Err(ContractError::InputTooLarge);
    }
    let input: Input = serde_json::from_value(bounded_json(bytes)?)
        .map_err(|_| ContractError::MalformedEnvelope)?;
    RevisionFence::new(
        OwnerIdentity::new(&input.owner_scope, input.owner_epoch)?,
        input.snapshot_revision,
    )
}
const MAX_HISTORY_CATALOGS: usize = 32;
const MAX_PERIODS: usize = 24;
const MAX_COVERAGE_RANGES: usize = 256;
const MAX_PACKAGE_IDS: usize = 256;

/// Stable errors deliberately contain no input values, paths, or personal data.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ContractError {
    InvalidJson,
    DuplicateJsonKey,
    MalformedEnvelope,
    UnsupportedSchema,
    UnsupportedEngine,
    UnsupportedContract,
    UnsupportedSourceSchema,
    InputTooLarge,
    JsonTooDeep,
    TooManyJsonNodes,
    CollectionTooLarge,
    StringTooLarge,
    InvalidIdentifier,
    InvalidDigest,
    DigestMismatch,
    InvalidRevision,
    InvalidDate,
    InvalidCoverage,
    InvalidPresence,
    MissingSource,
    DuplicateSource,
    InvalidRequest,
    IdentityMismatch,
}

impl fmt::Display for ContractError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidJson => "Invalid JSON",
            Self::DuplicateJsonKey => "Duplicate JSON key",
            Self::MalformedEnvelope => "Invalid request envelope",
            Self::UnsupportedSchema => "Unsupported wire schema",
            Self::UnsupportedEngine => "Unsupported engine version",
            Self::UnsupportedContract => "Unsupported calculation contract",
            Self::UnsupportedSourceSchema => "Unsupported source schema",
            Self::InputTooLarge => "Input byte limit exceeded",
            Self::JsonTooDeep => "Input depth limit exceeded",
            Self::TooManyJsonNodes => "Input node limit exceeded",
            Self::CollectionTooLarge => "Input collection limit exceeded",
            Self::StringTooLarge => "Input string limit exceeded",
            Self::InvalidIdentifier => "Invalid opaque identifier",
            Self::InvalidDigest => "Invalid content digest",
            Self::DigestMismatch => "Content digest mismatch",
            Self::InvalidRevision => "Invalid revision",
            Self::InvalidDate => "Invalid calendar date",
            Self::InvalidCoverage => "Invalid source coverage",
            Self::InvalidPresence => "Invalid explicit presence",
            Self::MissingSource => "Source registry is incomplete",
            Self::DuplicateSource => "Duplicate source group",
            Self::InvalidRequest => "Invalid calculation request",
            Self::IdentityMismatch => "Snapshot identity mismatch",
        })
    }
}

impl std::error::Error for ContractError {}

/// Required explicit presence: omission of this wrapper is a malformed envelope.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum DataPresence<T> {
    Missing,
    Null,
    Value { value: T },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SourceKind {
    CalendarEntries,
    WorkProfile,
    RemunerationProfiles,
    WorkingTimeTarget,
    WorkPatternSettings,
    LegacyTariffDecisions,
    AllowanceDecisions,
    ScopedAllowanceDecisions,
    OvertimeAllocations,
    PaidAbsences,
    ActualAnnualPayments,
    TariffAnnualClaims,
    TvlShiftWork,
    AnnexAMonthConfirmations,
    AnnexAPremiumFacts,
    AnnexAPauseDetails,
    SueMonthConfirmations,
    SueAllowanceConfirmations,
    TrainingProfiles,
    TrainingShiftDetails,
    YouthPreference,
    YouthContext,
    NetPaySettingsTimeline,
    SalaryPaymentPreferences,
    CaritasMonthFacts,
    CaritasWorkDays,
    CaritasOvertimeConfirmations,
    DrkEmployeeMonthConfirmations,
    DrkTrainingMonthConfirmations,
    TestMonths,
}

pub const ALL_SOURCE_KINDS: &[SourceKind] = &[
    SourceKind::CalendarEntries,
    SourceKind::WorkProfile,
    SourceKind::RemunerationProfiles,
    SourceKind::WorkingTimeTarget,
    SourceKind::WorkPatternSettings,
    SourceKind::LegacyTariffDecisions,
    SourceKind::AllowanceDecisions,
    SourceKind::ScopedAllowanceDecisions,
    SourceKind::OvertimeAllocations,
    SourceKind::PaidAbsences,
    SourceKind::ActualAnnualPayments,
    SourceKind::TariffAnnualClaims,
    SourceKind::TvlShiftWork,
    SourceKind::AnnexAMonthConfirmations,
    SourceKind::AnnexAPremiumFacts,
    SourceKind::AnnexAPauseDetails,
    SourceKind::SueMonthConfirmations,
    SourceKind::SueAllowanceConfirmations,
    SourceKind::TrainingProfiles,
    SourceKind::TrainingShiftDetails,
    SourceKind::YouthPreference,
    SourceKind::YouthContext,
    SourceKind::NetPaySettingsTimeline,
    SourceKind::SalaryPaymentPreferences,
    SourceKind::CaritasMonthFacts,
    SourceKind::CaritasWorkDays,
    SourceKind::CaritasOvertimeConfirmations,
    SourceKind::DrkEmployeeMonthConfirmations,
    SourceKind::DrkTrainingMonthConfirmations,
    SourceKind::TestMonths,
];

/// This is a transport bucket, not a validated business-domain DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InputOnlyPayload {
    schema_version: u32,
    data: DataPresence<Value>,
}
impl InputOnlyPayload {
    pub fn data(&self) -> &DataPresence<Value> {
        &self.data
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DateRange {
    start: String,
    end: String,
}
impl DateRange {
    pub fn new(start: &str, end: &str) -> Result<Self, ContractError> {
        date(start)?;
        date(end)?;
        if start > end {
            return Err(ContractError::InvalidCoverage);
        }
        Ok(Self {
            start: start.to_owned(),
            end: end.to_owned(),
        })
    }
    pub fn start(&self) -> &str {
        &self.start
    }
    pub fn end(&self) -> &str {
        &self.end
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum Coverage {
    AllHistory,
    DateRanges { ranges: Vec<DateRange> },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SourceFailure {
    ReadFailed,
    Unavailable,
    InvalidStoredData,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "state",
    rename_all = "SCREAMING_SNAKE_CASE",
    deny_unknown_fields
)]
pub enum SourceState {
    NotRequested,
    Loading,
    Failed {
        code: SourceFailure,
    },
    Ready {
        revision: u64,
        coverage: Coverage,
        payload: InputOnlyPayload,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceGroup {
    kind: SourceKind,
    source: SourceState,
}

impl SourceGroup {
    pub fn kind(&self) -> SourceKind {
        self.kind
    }

    pub fn state(&self) -> &SourceState {
        &self.source
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PackageIds {
    tariff: Vec<String>,
    legal: Vec<String>,
    holiday: Vec<String>,
}
impl PackageIds {
    pub fn tariff(&self) -> &[String] {
        &self.tariff
    }
    pub fn legal(&self) -> &[String] {
        &self.legal
    }
    pub fn holiday(&self) -> &[String] {
        &self.holiday
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogSet {
    selected_package_ids: PackageIds,
    tariff: SourceState,
    legal: SourceState,
    holiday: SourceState,
}
impl CatalogSet {
    pub fn selected_package_ids(&self) -> &PackageIds {
        &self.selected_package_ids
    }
    pub fn tariff(&self) -> &SourceState {
        &self.tariff
    }
    pub fn legal(&self) -> &SourceState {
        &self.legal
    }
    pub fn holiday(&self) -> &SourceState {
        &self.holiday
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct CompatibilityCutoffs {
    tariff: DataPresence<String>,
    legal: DataPresence<String>,
    holiday: DataPresence<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HistoricalCatalog {
    catalog: CatalogSet,
    compatible_package_ids: PackageIds,
    valid_before: CompatibilityCutoffs,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Catalogs {
    current: CatalogSet,
    history: Vec<HistoricalCatalog>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ContextCompleteness {
    entries: DataPresence<bool>,
    history: DataPresence<bool>,
    annex_a_entries: DataPresence<bool>,
    annex_a_pause_details: DataPresence<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SnapshotIdentity {
    owner_scope: String,
    owner_epoch: u64,
    snapshot_id: String,
    snapshot_revision: u64,
    input_digest: String,
    catalog_digest: String,
}
impl SnapshotIdentity {
    pub fn owner_scope(&self) -> &str {
        &self.owner_scope
    }
    pub fn owner_epoch(&self) -> u64 {
        self.owner_epoch
    }
    pub fn snapshot_revision(&self) -> u64 {
        self.snapshot_revision
    }
}

/// A raw immutable clock observation. It never carries a host-computed date,
/// selected profile, timezone, calculation status or admission proof.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RawClockContext {
    observed_epoch_milliseconds: i64,
}
impl RawClockContext {
    pub fn observed_epoch_milliseconds(&self) -> i64 {
        self.observed_epoch_milliseconds
    }
    pub(crate) fn from_epoch_milliseconds(value: i64) -> Result<Self, ContractError> {
        if value.unsigned_abs() > crate::money::MAX_SAFE_INTEGER as u64 {
            return Err(ContractError::InvalidDate);
        }
        jiff::Timestamp::from_millisecond(value).map_err(|_| ContractError::InvalidDate)?;
        Ok(Self {
            observed_epoch_milliseconds: value,
        })
    }
}
fn present_clock_context<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<RawClockContext>, D::Error> {
    RawClockContext::deserialize(deserializer).map(Some)
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SnapshotInput {
    identity: SnapshotIdentity,
    reference_date: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present_clock_context"
    )]
    clock_context: Option<RawClockContext>,
    sources: Vec<SourceGroup>,
    catalogs: Catalogs,
    completeness: ContextCompleteness,
}

/// A validated, immutable source snapshot. Clones share storage, not copied month payloads.
#[derive(Debug, Clone)]
pub struct ImmutableSnapshot(Arc<SnapshotInput>);

impl ImmutableSnapshot {
    pub fn current_catalog(&self) -> &CatalogSet {
        &self.0.catalogs.current
    }
    pub fn historical_catalog_count(&self) -> usize {
        self.0.catalogs.history.len()
    }
    pub fn reference_date(&self) -> &str {
        &self.0.reference_date
    }
    pub fn clock_context(&self) -> Option<&RawClockContext> {
        self.0.clock_context.as_ref()
    }
    pub fn identity(&self) -> &SnapshotIdentity {
        &self.0.identity
    }

    pub fn sources(&self) -> &[SourceGroup] {
        &self.0.sources
    }

    pub fn shares_storage_with(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RequestGuard {
    snapshot: SnapshotIdentity,
    request_id: String,
    request_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum ReportPeriod {
    Month { month: String },
    Year { year: i16 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RequestedSections {
    time: bool,
    gross: bool,
    net: bool,
    checks: bool,
}
impl RequestedSections {
    pub fn time(&self) -> bool {
        self.time
    }
    pub fn gross(&self) -> bool {
        self.gross
    }
    pub fn net(&self) -> bool {
        self.net
    }
    pub fn checks(&self) -> bool {
        self.checks
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SalaryPerspective {
    Earned,
    Payout,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RequestPriority {
    Interactive,
    Background,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CalculationRequest {
    guard: RequestGuard,
    periods: Vec<ReportPeriod>,
    sections: RequestedSections,
    perspective: SalaryPerspective,
    priority: RequestPriority,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    annual_gross_summary: bool,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "financial_details::optional"
    )]
    financial_details: Option<financial_details::FinancialDetailsIntent>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "payroll_page::optional"
    )]
    payroll_page: Option<payroll_page::PayrollPageIntent>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "payroll_panel::optional"
    )]
    payroll_panel: Option<PayrollPanel>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "export_report::optional"
    )]
    export_report: Option<export_report::ExportIntent>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "checks_details::serialize",
        deserialize_with = "checks_details::optional"
    )]
    checks_details: Option<Arc<checks_details::ChecksDetailsIntent>>,
}
impl CalculationRequest {
    pub fn snapshot_identity(&self) -> &SnapshotIdentity {
        &self.guard.snapshot
    }
    pub fn request_id(&self) -> &str {
        &self.guard.request_id
    }
    pub fn request_revision(&self) -> u64 {
        self.guard.request_revision
    }
    pub fn periods(&self) -> &[ReportPeriod] {
        &self.periods
    }
    pub fn sections(&self) -> RequestedSections {
        self.sections
    }
    pub fn perspective(&self) -> SalaryPerspective {
        self.perspective
    }
    pub fn annual_gross_summary(&self) -> bool {
        self.annual_gross_summary
    }
    pub fn financial_details(&self) -> Option<&financial_details::FinancialDetailsIntent> {
        self.financial_details.as_ref()
    }
    pub fn payroll_page(&self) -> bool {
        self.payroll_page.is_some()
    }
    pub fn payroll_panel(&self) -> Option<PayrollPanel> {
        self.payroll_panel
    }
    pub fn export_report(&self) -> Option<&export_report::ExportIntent> {
        self.export_report.as_ref()
    }
    pub fn checks_details(&self) -> Option<&checks_details::ChecksDetailsIntent> {
        self.checks_details.as_deref()
    }
    pub fn priority(&self) -> RequestPriority {
        self.priority
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
enum CommandInput {
    RegisterSnapshot { snapshot: Box<SnapshotInput> },
    Calculate { request: Box<CalculationRequest> },
    ReleaseSnapshot { identity: SnapshotIdentity },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EnvelopeInput {
    wire_schema_version: u32,
    expected_engine_version: String,
    calculation_contract_version: String,
    command: CommandInput,
}

#[derive(Debug, Clone)]
pub enum ValidatedRequest {
    RegisterSnapshot(ImmutableSnapshot),
    Calculate(Box<CalculationRequest>),
    ReleaseSnapshot(SnapshotIdentity),
}

impl ValidatedRequest {
    pub fn snapshot(&self) -> Option<&ImmutableSnapshot> {
        match self {
            Self::RegisterSnapshot(snapshot) => Some(snapshot),
            Self::Calculate(_) | Self::ReleaseSnapshot(_) => None,
        }
    }

    pub fn calculation(&self) -> Option<&CalculationRequest> {
        match self {
            Self::Calculate(request) => Some(request),
            Self::RegisterSnapshot(_) | Self::ReleaseSnapshot(_) => None,
        }
    }
}

/// R0 has no completed business-domain result variant. Add typed results only after parity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SectionReadiness {
    NotRequested,
    NotImplemented,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct SectionResults {
    time: SectionReadiness,
    gross: SectionReadiness,
    net: SectionReadiness,
    checks: SectionReadiness,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct CalculationPreparation {
    guard: RequestGuard,
    periods: Vec<ReportPeriod>,
    perspective: SalaryPerspective,
    sections: SectionResults,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultEnvelope {
    wire_schema_version: u32,
    engine_version: &'static str,
    calculation_contract_version: &'static str,
    result: CalculationPreparation,
}

impl ResultEnvelope {
    /// Compare the whole request identity and shape; the caller must also recheck live DB ownership.
    pub fn matches_request(&self, request: &CalculationRequest) -> bool {
        self.result.guard == request.guard
            && self.result.periods == request.periods
            && self.result.perspective == request.perspective
            && self.result.sections == section_results(request.sections)
    }
}

pub fn prepare_calculation(
    snapshot: &ImmutableSnapshot,
    request: &CalculationRequest,
) -> Result<ResultEnvelope, ContractError> {
    if snapshot.identity() != &request.guard.snapshot {
        return Err(ContractError::IdentityMismatch);
    }
    Ok(ResultEnvelope {
        wire_schema_version: SCHEMA_VERSION,
        engine_version: crate::ENGINE_VERSION,
        calculation_contract_version: CONTRACT_VERSION,
        result: CalculationPreparation {
            guard: request.guard.clone(),
            periods: request.periods.clone(),
            perspective: request.perspective,
            sections: section_results(request.sections),
        },
    })
}

fn section_results(requested: RequestedSections) -> SectionResults {
    let state = |requested| {
        if requested {
            SectionReadiness::NotImplemented
        } else {
            SectionReadiness::NotRequested
        }
    };
    SectionResults {
        time: state(requested.time),
        gross: state(requested.gross),
        net: state(requested.net),
        checks: state(requested.checks),
    }
}

pub fn parse_request(bytes: &[u8]) -> Result<ValidatedRequest, ContractError> {
    let envelope: EnvelopeInput = serde_json::from_value(bounded_json(bytes)?)
        .map_err(|_| ContractError::MalformedEnvelope)?;
    if envelope.wire_schema_version != SCHEMA_VERSION {
        return Err(ContractError::UnsupportedSchema);
    }
    if envelope.expected_engine_version != crate::ENGINE_VERSION {
        return Err(ContractError::UnsupportedEngine);
    }
    if envelope.calculation_contract_version != CONTRACT_VERSION {
        return Err(ContractError::UnsupportedContract);
    }
    match envelope.command {
        CommandInput::RegisterSnapshot { snapshot } => {
            snapshot.validate()?;
            let digests = snapshot.digests()?;
            if snapshot.identity.input_digest != digests.input_digest
                || snapshot.identity.catalog_digest != digests.catalog_digest
            {
                return Err(ContractError::DigestMismatch);
            }
            Ok(ValidatedRequest::RegisterSnapshot(ImmutableSnapshot(
                Arc::new(*snapshot),
            )))
        }
        CommandInput::Calculate { request } => {
            request.validate()?;
            Ok(ValidatedRequest::Calculate(request))
        }
        CommandInput::ReleaseSnapshot { identity } => {
            identity.validate()?;
            Ok(ValidatedRequest::ReleaseSnapshot(identity))
        }
    }
}

/// Allows an adapter to obtain the exact Rust canonical hashes before registration.
/// The document is a SnapshotInput, not the outer request. Claimed hash labels are syntax-checked
/// but excluded from their own computation; no snapshot is registered by this helper.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotDigests {
    pub input_digest: String,
    pub catalog_digest: String,
}

pub fn snapshot_digests_json(bytes: &[u8]) -> Result<SnapshotDigests, ContractError> {
    let snapshot: SnapshotInput = serde_json::from_value(bounded_json(bytes)?)
        .map_err(|_| ContractError::MalformedEnvelope)?;
    snapshot.validate()?;
    snapshot.digests()
}

impl SnapshotIdentity {
    fn validate(&self) -> Result<(), ContractError> {
        identifier(&self.owner_scope)?;
        identifier(&self.snapshot_id)?;
        revision(self.owner_epoch)?;
        revision(self.snapshot_revision)?;
        if self.owner_epoch == 0 {
            return Err(ContractError::InvalidRevision);
        }
        digest(&self.input_digest)?;
        digest(&self.catalog_digest)
    }
}

impl SnapshotInput {
    fn validate(&self) -> Result<(), ContractError> {
        self.identity.validate()?;
        date(&self.reference_date)?;
        if let Some(clock) = &self.clock_context {
            RawClockContext::from_epoch_milliseconds(clock.observed_epoch_milliseconds)?;
        }
        if self.sources.len() != ALL_SOURCE_KINDS.len() {
            return Err(ContractError::MissingSource);
        }
        let mut seen = BTreeSet::new();
        for source in &self.sources {
            if !seen.insert(source.kind) {
                return Err(ContractError::DuplicateSource);
            }
            source.source.validate()?;
        }
        for kind in ALL_SOURCE_KINDS {
            if !seen.contains(kind) {
                return Err(ContractError::MissingSource);
            }
        }
        self.catalogs.current.validate()?;
        if self.catalogs.history.len() > MAX_HISTORY_CATALOGS {
            return Err(ContractError::CollectionTooLarge);
        }
        for historical in &self.catalogs.history {
            historical.catalog.validate()?;
            historical.compatible_package_ids.validate()?;
            for cutoff in [
                &historical.valid_before.tariff,
                &historical.valid_before.legal,
                &historical.valid_before.holiday,
            ] {
                match cutoff {
                    DataPresence::Value { value } => date(value)?,
                    DataPresence::Missing | DataPresence::Null => {}
                }
            }
        }
        Ok(())
    }

    fn digests(&self) -> Result<SnapshotDigests, ContractError> {
        snapshot_digest::digests(self)
    }
}

impl SourceState {
    fn validate(&self) -> Result<(), ContractError> {
        match self {
            Self::Ready {
                revision: source_revision,
                coverage,
                payload,
            } => {
                revision(*source_revision)?;
                coverage.validate()?;
                if payload.schema_version != 1 {
                    return Err(ContractError::UnsupportedSourceSchema);
                }
                if matches!(&payload.data, DataPresence::Value { value: Value::Null }) {
                    return Err(ContractError::InvalidPresence);
                }
                Ok(())
            }
            Self::NotRequested | Self::Loading | Self::Failed { .. } => Ok(()),
        }
    }
}

impl Coverage {
    pub fn covers(&self, required: &DateRange) -> Result<bool, ContractError> {
        Self::validate(self)?;
        DateRange::new(&required.start, &required.end)?;
        let Self::DateRanges { ranges } = self else {
            return Ok(true);
        };
        let mut cursor = required.start.clone();
        for range in ranges {
            if range.end < cursor {
                continue;
            }
            if range.start > cursor {
                return Ok(false);
            }
            if range.end >= required.end {
                return Ok(true);
            }
            use jiff::ToSpan;
            cursor = range
                .end
                .parse::<jiff::civil::Date>()
                .map_err(|_| ContractError::InvalidCoverage)?
                .checked_add(1.days())
                .map_err(|_| ContractError::InvalidCoverage)?
                .to_string();
        }
        Ok(false)
    }
    fn validate(&self) -> Result<(), ContractError> {
        match self {
            Self::AllHistory => Ok(()),
            Self::DateRanges { ranges } => {
                if ranges.is_empty() || ranges.len() > MAX_COVERAGE_RANGES {
                    return Err(ContractError::InvalidCoverage);
                }
                let mut last_end: Option<&str> = None;
                for range in ranges {
                    date(&range.start)?;
                    date(&range.end)?;
                    if range.start > range.end
                        || last_end.is_some_and(|last| last >= range.start.as_str())
                    {
                        return Err(ContractError::InvalidCoverage);
                    }
                    last_end = Some(&range.end);
                }
                Ok(())
            }
        }
    }
}

impl PackageIds {
    fn validate(&self) -> Result<(), ContractError> {
        for ids in [&self.tariff, &self.legal, &self.holiday] {
            if ids.len() > MAX_PACKAGE_IDS {
                return Err(ContractError::CollectionTooLarge);
            }
            let mut seen = BTreeSet::new();
            for id in ids {
                identifier(id)?;
                if !seen.insert(id) {
                    return Err(ContractError::InvalidIdentifier);
                }
            }
        }
        Ok(())
    }
}

impl CatalogSet {
    fn validate(&self) -> Result<(), ContractError> {
        self.selected_package_ids.validate()?;
        self.tariff.validate()?;
        self.legal.validate()?;
        self.holiday.validate()
    }
}

impl CalculationRequest {
    fn validate(&self) -> Result<(), ContractError> {
        self.guard.snapshot.validate()?;
        identifier(&self.guard.request_id)?;
        revision(self.guard.request_revision)?;
        if self.periods.is_empty()
            || self.periods.len() > MAX_PERIODS
            || !(self.sections.time
                || self.sections.gross
                || self.sections.net
                || self.sections.checks
                || self.financial_details.is_some()
                || self.payroll_page.is_some()
                || self.payroll_panel.is_some()
                || self.export_report.is_some()
                || self.checks_details.is_some())
        {
            return Err(ContractError::InvalidRequest);
        }
        if (self.payroll_page.is_some() || self.payroll_panel.is_some())
            && (self.sections.time
                || self.sections.gross
                || self.sections.net
                || self.sections.checks
                || self.financial_details.is_some()
                || self.export_report.is_some()
                || (self.payroll_page.is_some() && self.payroll_panel.is_some())
                || self.perspective != SalaryPerspective::Payout
                || !matches!(self.periods.as_slice(), [ReportPeriod::Month { .. }]))
        {
            return Err(ContractError::InvalidRequest);
        }
        if self.annual_gross_summary
            && (!self.sections.gross()
                || self.sections.time()
                || self.sections.net()
                || self.sections.checks()
                || self.financial_details.is_some()
                || self.export_report.is_some()
                || self.checks_details.is_some()
                || self.perspective != SalaryPerspective::Earned
                || !matches!(self.periods.as_slice(), [ReportPeriod::Year { .. }]))
        {
            return Err(ContractError::InvalidRequest);
        }
        if let Some(details) = &self.financial_details {
            details.validate()?;
            if self.sections.checks
                || self.export_report.is_some()
                || !matches!(self.periods.as_slice(), [ReportPeriod::Month { .. }])
            {
                return Err(ContractError::InvalidRequest);
            }
        }
        if let Some(export) = &self.export_report {
            export.validate()?;
            if self.periods.len() != 1
                || self.sections.time
                || self.sections.gross
                || self.sections.net
                || self.sections.checks
                || self.payroll_page.is_some()
                || self.payroll_panel.is_some()
                || self.financial_details.is_some()
                || self.perspective != SalaryPerspective::Payout
            {
                return Err(ContractError::InvalidRequest);
            }
        }
        if let Some(details) = &self.checks_details {
            details.validate()?;
            if self.sections.time
                || self.sections.gross
                || self.sections.net
                || self.sections.checks
                || self.payroll_page.is_some()
                || self.payroll_panel.is_some()
                || self.financial_details.is_some()
                || self.export_report.is_some()
                || self.perspective != SalaryPerspective::Earned
                || !matches!(self.periods.as_slice(), [ReportPeriod::Month { .. }])
            {
                return Err(ContractError::InvalidRequest);
            }
        }
        let mut seen = BTreeSet::new();
        for period in &self.periods {
            let key = match period {
                ReportPeriod::Month { month } => {
                    if month.len() != 7 {
                        return Err(ContractError::InvalidDate);
                    }
                    date(&format!("{month}-01"))?;
                    format!("M:{month}")
                }
                ReportPeriod::Year { year } => {
                    if !(1..=9999).contains(year) {
                        return Err(ContractError::InvalidDate);
                    }
                    format!("Y:{year}")
                }
            };
            if !seen.insert(key) {
                return Err(ContractError::InvalidRequest);
            }
        }
        Ok(())
    }
}

fn identifier(value: &str) -> Result<(), ContractError> {
    if value.is_empty()
        || value.len() > MAX_ID_BYTES as usize
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.:".contains(&byte))
    {
        return Err(ContractError::InvalidIdentifier);
    }
    Ok(())
}

fn revision(value: u64) -> Result<(), ContractError> {
    if value > MAX_SAFE_REVISION {
        return Err(ContractError::InvalidRevision);
    }
    Ok(())
}

fn digest(value: &str) -> Result<(), ContractError> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(ContractError::InvalidDigest);
    }
    Ok(())
}

fn date(value: &str) -> Result<(), ContractError> {
    if value.len() != 10
        || value.as_bytes()[4] != b'-'
        || value.as_bytes()[7] != b'-'
        || value
            .bytes()
            .enumerate()
            .any(|(index, byte)| index != 4 && index != 7 && !byte.is_ascii_digit())
    {
        return Err(ContractError::InvalidDate);
    }
    let date: jiff::civil::Date = value.parse().map_err(|_| ContractError::InvalidDate)?;
    if date.year() < 1 {
        return Err(ContractError::InvalidDate);
    }
    Ok(())
}

#[cfg(test)]
fn content_digest(domain: &[u8], value: &Value) -> Result<String, ContractError> {
    serialized_digest(domain, &canonical::Borrowed(value))
}
fn serialized_digest(domain: &[u8], value: &impl Serialize) -> Result<String, ContractError> {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(SCHEMA_VERSION.to_be_bytes());
    hasher.update(CONTRACT_VERSION.as_bytes());
    hasher.update([0]);
    serde_json::to_writer(canonical::HashWriter(&mut hasher), value)
        .map_err(|_| ContractError::MalformedEnvelope)?;
    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
fn canonical_value(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut pairs: Vec<_> = object.iter().collect();
            pairs.sort_unstable_by(|left, right| left.0.cmp(right.0));
            Value::Object(
                pairs
                    .into_iter()
                    .map(|(key, value)| (key.clone(), canonical_value(value)))
                    .collect(),
            )
        }
        Value::Array(values) => Value::Array(values.iter().map(canonical_value).collect()),
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => value.clone(),
    }
}

#[derive(Default)]
struct JsonBudget {
    nodes: u32,
    error: Option<ContractError>,
}

struct BoundedSeed<'a> {
    depth: u32,
    budget: &'a mut JsonBudget,
}

impl<'de> DeserializeSeed<'de> for BoundedSeed<'_> {
    type Value = Value;

    fn deserialize<D>(self, deserializer: D) -> Result<Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        if self.depth > MAX_JSON_DEPTH {
            self.budget.error = Some(ContractError::JsonTooDeep);
            return Err(D::Error::custom("Input depth limit exceeded"));
        }
        if self.budget.nodes >= MAX_JSON_NODES {
            self.budget.error = Some(ContractError::TooManyJsonNodes);
            return Err(D::Error::custom("Input node limit exceeded"));
        }
        self.budget.nodes += 1;
        deserializer.deserialize_any(self)
    }
}

impl BoundedSeed<'_> {
    fn reject<E: DeError>(&mut self, error: ContractError) -> E {
        self.budget.error = Some(error);
        E::custom("Input limit or shape rejected")
    }
}

impl<'de> Visitor<'de> for BoundedSeed<'_> {
    type Value = Value;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("bounded JSON")
    }

    fn visit_bool<E: DeError>(self, value: bool) -> Result<Value, E> {
        Ok(Value::Bool(value))
    }
    fn visit_i64<E: DeError>(self, value: i64) -> Result<Value, E> {
        Ok(Value::Number(value.into()))
    }
    fn visit_u64<E: DeError>(self, value: u64) -> Result<Value, E> {
        Ok(Value::Number(value.into()))
    }
    fn visit_f64<E: DeError>(self, value: f64) -> Result<Value, E> {
        Number::from_f64(value)
            .map(Value::Number)
            .ok_or_else(|| E::custom("Invalid number"))
    }
    fn visit_unit<E: DeError>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }
    fn visit_none<E: DeError>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }

    fn visit_str<E: DeError>(mut self, value: &str) -> Result<Value, E> {
        if value.len() > MAX_STRING_BYTES as usize {
            return Err(self.reject(ContractError::StringTooLarge));
        }
        Ok(Value::String(value.to_owned()))
    }

    fn visit_string<E: DeError>(self, value: String) -> Result<Value, E> {
        self.visit_str(&value)
    }

    fn visit_seq<A: SeqAccess<'de>>(mut self, mut sequence: A) -> Result<Value, A::Error> {
        let mut values = Vec::new();
        loop {
            let next = sequence.next_element_seed(BoundedSeed {
                depth: self.depth + 1,
                budget: self.budget,
            })?;
            let Some(value) = next else { break };
            if values.len() >= MAX_SOURCE_ITEMS as usize {
                return Err(self.reject(ContractError::CollectionTooLarge));
            }
            values.push(value);
        }
        Ok(Value::Array(values))
    }

    fn visit_map<A: MapAccess<'de>>(mut self, mut object: A) -> Result<Value, A::Error> {
        let mut values = Map::new();
        while let Some(key) = object.next_key::<String>()? {
            if key.len() > MAX_STRING_BYTES as usize {
                return Err(self.reject(ContractError::StringTooLarge));
            }
            if values.contains_key(&key) {
                return Err(self.reject(ContractError::DuplicateJsonKey));
            }
            if values.len() >= MAX_SOURCE_ITEMS as usize {
                return Err(self.reject(ContractError::CollectionTooLarge));
            }
            let value = object.next_value_seed(BoundedSeed {
                depth: self.depth + 1,
                budget: self.budget,
            })?;
            values.insert(key, value);
        }
        Ok(Value::Object(values))
    }
}

pub(crate) fn bounded_json(bytes: &[u8]) -> Result<Value, ContractError> {
    bounded_json_with_node_budget(bytes, MAX_JSON_NODES).map(|(value, _)| value)
}

/// Parse once, charging the existing strict visitor against a caller's remaining
/// decoded-tree allowance. This does not reserialize or traverse an owned tree.
/// Node counting is identical to the ordinary envelope parser (values, not keys).
pub(crate) fn bounded_json_with_node_budget(
    bytes: &[u8],
    remaining_nodes: u32,
) -> Result<(Value, u32), ContractError> {
    if bytes.len() > MAX_INPUT_BYTES as usize {
        return Err(ContractError::InputTooLarge);
    }
    let initial_nodes = MAX_JSON_NODES - remaining_nodes.min(MAX_JSON_NODES);
    let mut budget = JsonBudget {
        nodes: initial_nodes,
        error: None,
    };
    let mut deserializer = serde_json::Deserializer::from_slice(bytes);
    let value = BoundedSeed {
        depth: 0,
        budget: &mut budget,
    }
    .deserialize(&mut deserializer)
    .map_err(|_| budget.error.unwrap_or(ContractError::InvalidJson))?;
    deserializer.end().map_err(|_| ContractError::InvalidJson)?;
    Ok((value, budget.nodes - initial_nodes))
}
