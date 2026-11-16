use super::{
    book::RankOwner,
    model::{FinancialPoolError, FinancialScope, Witness},
};
use crate::calendar::recurrence::CollationRanks;
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
/// Created only after native exact-rank validation. Never a wire/Serde type.
pub struct FinancialAdmissionProof {
    pub(super) token: u64,
    pub(super) digest: String,
    pub(super) candidate_digest: String,
    pub(super) scope: Arc<FinancialScope>,
    pub(super) witness: Arc<Witness>,
    pub(super) owner: Arc<RankOwner>,
    pub(super) ranks: Arc<CollationRanks>,
    pub(super) active: AtomicBool,
    pub(super) last: AtomicU64,
}
impl std::fmt::Debug for FinancialAdmissionProof {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("NativeFinancialAdmissionProof")
    }
}
impl FinancialAdmissionProof {
    pub(in crate::runtime) fn current_in_registry(
        &self,
        registry: &crate::runtime::SnapshotRegistry,
        state: &crate::runtime::State,
    ) -> bool {
        use std::sync::Weak;
        self.active.load(Ordering::Acquire)
            && self.owner.active.load(Ordering::Acquire)
            && Weak::ptr_eq(&self.witness.marker.registry, &Arc::downgrade(&registry.0))
            && Weak::ptr_eq(&self.owner.marker.registry, &Arc::downgrade(&registry.0))
            && self.witness.marker.generation == state.generation
            && self.owner.marker.generation == state.generation
            && self.witness.lease.current(state)
    }
    pub(in crate::runtime) fn matches_request(
        &self,
        request: &crate::contract::CalculationRequest,
    ) -> bool {
        let Some(details) = request.financial_details() else {
            return false;
        };
        let [crate::contract::ReportPeriod::Month { month }] = request.periods() else {
            return false;
        };
        let locator = details.collation();
        self.token == locator.token()
            && self.digest == locator.digest()
            && self.scope.guard.snapshot() == Some(request.snapshot_identity())
            && self.scope.intent.month() == month
            && self.scope.intent.perspective() == request.perspective()
            && self.scope.intent.filter() == details.filter()
            && self.scope.intent.include_special_duty_pay() == details.include_special_duty_pay()
            && self.scope.locale_key == locator.locale_key()
    }
    pub fn is_current(&self) -> Result<bool, FinancialPoolError> {
        Ok(self.active.load(Ordering::Acquire)
            && self.owner.active.load(Ordering::Acquire)
            && self.owner.marker.is_current()?
            && self.witness.current()?)
    }
    pub fn scope(&self) -> &FinancialScope {
        &self.scope
    }
    pub fn ranks(&self) -> &Arc<CollationRanks> {
        &self.ranks
    }
}
pub struct FinalizeCompletion {
    pub(super) proof: Arc<FinancialAdmissionProof>,
}
impl FinalizeCompletion {
    pub fn is_current(&self) -> Result<bool, FinancialPoolError> {
        self.proof.is_current()
    }
    pub fn serialize_current(&self) -> Result<Vec<u8>, FinancialPoolError> {
        super::model::response(
            "FINANCIAL_COLLATION_READY",
            &self.proof.scope,
            serde_json::json!({"token":self.proof.token,"digest":self.proof.digest,"candidateDigest":self.proof.candidate_digest}),
            || self.is_current(),
        )
    }
}
