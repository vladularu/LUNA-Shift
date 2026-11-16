use crate::{
    contract::{self, ContractError, financial_collation::FinancialIntent, utility::UtilityGuard},
    runtime::{
        PreparationMarker, RegistryError,
        report::ReportIssue,
        utility_lease::{UtilityFenceError, UtilityLease},
    },
};
use serde::Serialize;
use serde_json::Value;
use std::{fmt, sync::Arc};

pub const MAX_DRAFTS: usize = 4;
pub const MAX_PROOFS: usize = 8;
pub const MAX_OWNERS: usize = 2;
pub const MAX_RETAINED_BYTES: u64 = 32 * 1024 * 1024;
pub const MAX_PAGE_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FinancialPoolError {
    Contract(ContractError),
    Registry(RegistryError),
    Fence(UtilityFenceError),
    Stale,
    Busy,
    UnknownDraft,
    UnknownProof,
    InvalidRanks,
    RankConflict,
    ScopeMismatch,
    ResourceLimit,
    OutputLimit,
    SequenceExhausted,
    Poisoned,
}
impl FinancialPoolError {
    pub fn code(&self) -> String {
        match self {
            Self::Contract(e) => {
                return serde_json::to_value(e)
                    .expect("fixed contract code")
                    .as_str()
                    .unwrap()
                    .to_owned();
            }
            Self::Registry(e) => {
                return serde_json::to_value(e)
                    .expect("fixed registry code")
                    .as_str()
                    .unwrap()
                    .to_owned();
            }
            Self::Fence(e) => {
                return serde_json::to_value(e)
                    .expect("fixed fence code")
                    .as_str()
                    .unwrap()
                    .to_owned();
            }
            Self::Stale => "FINANCIAL_COLLATION_STALE",
            Self::Busy => "FINANCIAL_COLLATION_BUSY",
            Self::UnknownDraft => "FINANCIAL_COLLATION_UNKNOWN_DRAFT",
            Self::UnknownProof => "FINANCIAL_COLLATION_UNKNOWN_PROOF",
            Self::InvalidRanks => "FINANCIAL_COLLATION_INVALID_RANKS",
            Self::RankConflict => "FINANCIAL_COLLATION_RANK_CONFLICT",
            Self::ScopeMismatch => "FINANCIAL_COLLATION_SCOPE_MISMATCH",
            Self::ResourceLimit => "FINANCIAL_COLLATION_RESOURCE_LIMIT",
            Self::OutputLimit => "FINANCIAL_COLLATION_OUTPUT_LIMIT",
            Self::SequenceExhausted => "SEQUENCE_EXHAUSTED",
            Self::Poisoned => "POISONED",
        }
        .to_owned()
    }
}
impl fmt::Display for FinancialPoolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.code())
    }
}
impl std::error::Error for FinancialPoolError {}
impl From<ContractError> for FinancialPoolError {
    fn from(e: ContractError) -> Self {
        Self::Contract(e)
    }
}
impl From<RegistryError> for FinancialPoolError {
    fn from(e: RegistryError) -> Self {
        Self::Registry(e)
    }
}
impl From<UtilityFenceError> for FinancialPoolError {
    fn from(e: UtilityFenceError) -> Self {
        Self::Fence(e)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinancialScope {
    pub(super) guard: UtilityGuard,
    pub(super) intent: FinancialIntent,
    pub(super) locale_key: String,
}
impl FinancialScope {
    pub fn guard(&self) -> &UtilityGuard {
        &self.guard
    }
    pub fn intent(&self) -> &FinancialIntent {
        &self.intent
    }
    pub fn locale_key(&self) -> &str {
        &self.locale_key
    }
}

pub(super) struct Witness {
    pub marker: PreparationMarker,
    pub lease: Arc<UtilityLease>,
}
impl Witness {
    pub fn current(&self) -> Result<bool, FinancialPoolError> {
        Ok(self.marker.is_current()? && self.lease.is_current()?)
    }
    pub fn check(&self) -> Result<(), FinancialPoolError> {
        if self.current()? {
            Ok(())
        } else {
            Err(FinancialPoolError::Stale)
        }
    }
}

pub struct PrepareCompletion {
    pub(super) witness: Arc<Witness>,
    pub(super) scope: Arc<FinancialScope>,
    pub(super) outcome: PrepareOutcome,
}
pub(super) enum PrepareOutcome {
    Unavailable(ReportIssue),
    Prepared(Arc<super::book::Draft>),
}
impl fmt::Debug for PrepareCompletion {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("FinancialPrepareCompletion")
    }
}
impl PrepareCompletion {
    pub fn is_current(&self) -> Result<bool, FinancialPoolError> {
        match &self.outcome {
            PrepareOutcome::Unavailable(_) => self.witness.current(),
            PrepareOutcome::Prepared(d) => d.current(),
        }
    }
    pub fn serialize_current(&self) -> Result<Vec<u8>, FinancialPoolError> {
        self.witness.check()?;
        let body = match &self.outcome {
            PrepareOutcome::Unavailable(reason) => serde_json::json!({"reason":reason}),
            PrepareOutcome::Prepared(d) => {
                d.check()?;
                serde_json::json!({"draftId":d.id,"candidateDigest":d.owner.index.digest,"total":d.owner.index.strings.len(),"cachedVerifiedRanks":d.owner.has_ranks()?})
            }
        };
        response(
            if matches!(self.outcome, PrepareOutcome::Unavailable(_)) {
                "FINANCIAL_COLLATION_UNAVAILABLE"
            } else {
                "FINANCIAL_COLLATION_PREPARED"
            },
            &self.scope,
            body,
            || self.is_current(),
        )
    }
}
pub(super) fn response(
    state: &str,
    scope: &FinancialScope,
    body: Value,
    current: impl Fn() -> Result<bool, FinancialPoolError>,
) -> Result<Vec<u8>, FinancialPoolError> {
    if !current()? {
        return Err(FinancialPoolError::Stale);
    }
    let mut result = serde_json::json!({"ok":true,"state":state,"wireSchemaVersion":contract::SCHEMA_VERSION,"engineVersion":crate::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"scope":scope});
    result
        .as_object_mut()
        .unwrap()
        .extend(body.as_object().unwrap().clone());
    if crate::report::cache_budget::serialized_bytes(&result, MAX_PAGE_BYTES).is_none() {
        return Err(FinancialPoolError::OutputLimit);
    }
    let bytes = serde_json::to_vec(&result).map_err(|_| FinancialPoolError::OutputLimit)?;
    if !current()? {
        return Err(FinancialPoolError::Stale);
    }
    Ok(bytes)
}
#[derive(Debug, Clone, Copy)]
pub struct PoolStats {
    pub open_drafts: usize,
    pub intent_proofs: usize,
    pub shared_owners: usize,
    pub retained_bytes: u64,
    pub retired: usize,
    pub structure_builds: u64,
    pub rank_parses: u64,
    pub raw_operation: bool,
}
