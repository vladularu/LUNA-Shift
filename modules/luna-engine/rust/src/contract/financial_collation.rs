//! Small raw structural-collation frames, never a deserializable native proof.
use super::{ContractError, SalaryPerspective, utility::UtilityGuard};
use serde::de::{DeserializeOwned, DeserializeSeed};
use serde::{Deserialize, Serialize};

pub const MAX_PREPARE_BYTES: usize = 8192;
pub const MAX_CONTROL_BYTES: usize = 1024;
pub const MAX_RANK_BYTES: usize = 33_554_432;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FinancialIntent {
    month: String,
    perspective: SalaryPerspective,
    #[serde(deserialize_with = "present_filter")]
    filter: Option<String>,
    include_special_duty_pay: bool,
}
fn present_filter<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}
impl FinancialIntent {
    pub fn month(&self) -> &str {
        &self.month
    }
    pub fn perspective(&self) -> SalaryPerspective {
        self.perspective
    }
    pub fn filter(&self) -> Option<&str> {
        self.filter.as_deref()
    }
    pub fn include_special_duty_pay(&self) -> bool {
        self.include_special_duty_pay
    }
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrepareRequest {
    wire_schema_version: u32,
    expected_engine_version: String,
    calculation_contract_version: String,
    guard: UtilityGuard,
    intent: FinancialIntent,
    locale_key: String,
}
impl PrepareRequest {
    pub fn guard(&self) -> &UtilityGuard {
        &self.guard
    }
    pub fn intent(&self) -> &FinancialIntent {
        &self.intent
    }
    pub fn locale_key(&self) -> &str {
        &self.locale_key
    }
    pub fn versions(&self) -> (u32, &str, &str) {
        (
            self.wire_schema_version,
            &self.expected_engine_version,
            &self.calculation_contract_version,
        )
    }
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidatesRequest {
    draft_id: u64,
    candidate_digest: String,
    #[serde(default)]
    after: Option<u32>,
    limit: u16,
}
impl CandidatesRequest {
    pub fn draft_id(&self) -> u64 {
        self.draft_id
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
    draft_id: u64,
    candidate_digest: String,
    #[serde(default)]
    reuse_cached: bool,
}
impl FinalizeRequest {
    pub fn draft_id(&self) -> u64 {
        self.draft_id
    }
    pub fn candidate_digest(&self) -> &str {
        &self.candidate_digest
    }
    pub fn reuse_cached(&self) -> bool {
        self.reuse_cached
    }
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AbortRequest {
    draft_id: u64,
}
impl AbortRequest {
    pub fn draft_id(&self) -> u64 {
        self.draft_id
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
    if value.guard.snapshot().is_none() {
        return Err(ContractError::InvalidRequest);
    }
    if value.intent.month.len() != 7 {
        return Err(ContractError::InvalidDate);
    }
    super::date(&format!("{}-01", value.intent.month))?;
    if value.intent.filter.as_ref().is_some_and(|s| s.len() > 128)
        || value.locale_key.is_empty()
        || value.locale_key.len() > 512
        || value.locale_key.chars().any(char::is_control)
    {
        return Err(ContractError::InvalidRequest);
    }
    Ok(value)
}
pub fn parse_candidates(bytes: &[u8]) -> Result<CandidatesRequest, ContractError> {
    let value: CandidatesRequest = frame(bytes, MAX_CONTROL_BYTES)?;
    resource(value.draft_id)?;
    super::digest(&value.candidate_digest)?;
    if !(1..=1024).contains(&value.limit)
        || value.after.is_some_and(|n| n > super::MAX_SOURCE_ITEMS)
    {
        return Err(ContractError::InvalidRequest);
    }
    Ok(value)
}
pub fn parse_finalize(bytes: &[u8]) -> Result<FinalizeRequest, ContractError> {
    let value: FinalizeRequest = frame(bytes, MAX_CONTROL_BYTES)?;
    resource(value.draft_id)?;
    super::digest(&value.candidate_digest)?;
    Ok(value)
}
pub fn parse_abort(bytes: &[u8]) -> Result<AbortRequest, ContractError> {
    let value: AbortRequest = frame(bytes, MAX_CONTROL_BYTES)?;
    resource(value.draft_id)?;
    Ok(value)
}
