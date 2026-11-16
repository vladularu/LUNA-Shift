//! Native source-derived semantic monetary keys; no lifecycle ID or host hashes.
pub(crate) mod canonical;
mod legacy;
mod plan;
#[cfg(test)]
mod tests;
use super::FinancialError;
use crate::{pay::pattern::WorkPatternSettings, rules::RuleResolver};
pub use plan::FinancialFingerprintPlan;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, Mutex},
};
#[derive(Clone)]
pub struct StableFinancialDataSpace(String);
impl StableFinancialDataSpace {
    pub(crate) fn part_hash(&self, part: &str, period: &str) -> canonical::CanonicalHash {
        let mut hash = canonical::CanonicalHash::new("luna:financial:part:v1");
        hash.array(2);
        hash.array(4);
        hash.string(crate::ENGINE_VERSION);
        hash.string(&self.0);
        hash.string(part);
        hash.string(period);
        hash
    }
    pub fn new(raw: &str) -> Result<Self, FinancialError> {
        if raw.is_empty()
            || raw.len() > 256
            || !raw
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b':' | b'_' | b'-' | b'.'))
        {
            return Err(FinancialError::invalid("Ungültiger Finanzdatenraum."));
        }
        Ok(Self(raw.to_owned()))
    }
}
impl std::fmt::Debug for StableFinancialDataSpace {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("StableFinancialDataSpace(..)")
    }
}
#[derive(Clone)]
pub struct FinancialFingerprintInput {
    pub profile: Arc<Value>,
    pub entries: Arc<Vec<Value>>,
    pub tariff_decisions: Arc<Vec<Value>>,
    pub settings: WorkPatternSettings,
    pub test_months: BTreeSet<String>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum LegacyFinancialView {
    Salary,
    Annual,
    Actual,
}
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct FinancialFingerprint([u8; 32]);
impl FinancialFingerprint {
    pub(crate) fn from_native_digest(digest: [u8; 32]) -> Self {
        Self(digest)
    }
}
impl std::fmt::Display for FinancialFingerprint {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        for byte in self.0 {
            write!(f, "{byte:02x}")?;
        }
        Ok(())
    }
}
pub struct FinancialFingerprintBook {
    space: StableFinancialDataSpace,
    input: FinancialFingerprintInput,
    resolver: Arc<RuleResolver>,
    plan: Arc<FinancialFingerprintPlan>,
    profile_digest: [u8; 32],
    settings_digest: [u8; 32],
    resolver_digest: [u8; 32],
    profile_visits: usize,
    keys: Mutex<BTreeMap<(String, LegacyFinancialView), FinancialFingerprint>>,
}
impl FinancialFingerprintBook {
    pub(crate) fn native_part_hash(&self, part: &str, period: &str) -> canonical::CanonicalHash {
        self.space.part_hash(part, period)
    }
    pub fn new(
        space: StableFinancialDataSpace,
        input: FinancialFingerprintInput,
        resolver: Arc<RuleResolver>,
    ) -> Result<Self, FinancialError> {
        let plan = Arc::new(FinancialFingerprintPlan::new(Arc::clone(&input.entries))?);
        Self::with_plan(space, input, resolver, plan)
    }
    pub fn with_plan(
        space: StableFinancialDataSpace,
        input: FinancialFingerprintInput,
        resolver: Arc<RuleResolver>,
        plan: Arc<FinancialFingerprintPlan>,
    ) -> Result<Self, FinancialError> {
        if !Arc::ptr_eq(&plan.entries, &input.entries) {
            return Err(FinancialError::invalid(
                "Finanzplan gehört zu einer anderen Quelle.",
            ));
        }
        let (profile_digest, profile_visits) = canonical::value_digest(&input.profile, true)?;
        let settings = serde_json::to_value(&input.settings)
            .map_err(|_| FinancialError::invalid("Ungültiges Arbeitsmuster."))?;
        let (settings_digest, _) = canonical::value_digest(&settings, false)?;
        let resolver_digest = canonical::resolver_digest(&resolver)?;
        Ok(Self {
            space,
            input,
            resolver,
            plan,
            profile_digest,
            settings_digest,
            resolver_digest,
            profile_visits,
            keys: Mutex::new(BTreeMap::new()),
        })
    }
    pub fn plan(&self) -> &Arc<FinancialFingerprintPlan> {
        &self.plan
    }
    pub fn diagnostics(&self) -> Value {
        json!({"profileValuesHashed":self.profile_visits,"recordValuesHashed":self.plan.visits,"recordCount":self.plan.records.len(),"cachedPeriodKeys":self.keys.lock().map(|k|k.len()).unwrap_or(0),"targetContextHashed":false})
    }
}
