use super::{
    super::FinancialError,
    cache::{CacheStats, MonthCache},
    input::*,
    requirements::required_sources,
    session::AssessedSession,
};
use crate::{
    input::{
        calendar::validate_monthly_tariff_decision, draft_rows::DraftRowsKind,
        remuneration_rows::RemunerationRowsKind,
    },
    remuneration::{
        base::prepared::PaidAbsenceIndex, draft_facts::model::ConfirmationKind,
        overtime::prepared::OvertimeAllocationIndex,
    },
};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
pub struct AssessedSourceBook {
    pub(super) reuse: Option<super::reuse::ReuseBinding>,
    pub(super) input: AssessedSourceInput,
    pub(super) settings: Value,
    pub(super) legacy: BTreeMap<String, u32>,
    pub(super) scoped: BTreeMap<String, u32>,
    pub(super) inactive_paid: PaidAbsenceIndex,
    pub(super) inactive_overtime: OvertimeAllocationIndex,
    pub(super) cache: MonthCache,
}
impl AssessedSourceBook {
    pub fn new(input: AssessedSourceInput) -> Result<Self, FinancialError> {
        let invalid = || FinancialError::invalid("Ungültige native Vergütungsquellen.");
        let max = crate::contract::MAX_SOURCE_ITEMS as usize;
        if input.active_shifts.len() > max
            || input.history.len() > 50_000
            || input.legacy_decisions.len() > max
            || input
                .active_shifts
                .iter()
                .any(|s| s["kind"] != "SHIFT" || s.get("deletedAt") != Some(&Value::Null))
        {
            return Err(invalid());
        }
        if input
            .scoped_decisions
            .ready()
            .is_some_and(|r| r.kind() != RemunerationRowsKind::ScopedAllowances)
            || input
                .tvl_shift_work
                .ready()
                .is_some_and(|r| r.kind() != DraftRowsKind::TvlShiftWork)
            || input
                .annex_month
                .ready()
                .is_some_and(|r| r.kind() != ConfirmationKind::AnnexA)
            || input
                .sue_month
                .ready()
                .is_some_and(|r| r.kind() != ConfirmationKind::SueMonth)
            || input
                .sue_allowance
                .ready()
                .is_some_and(|r| r.kind() != ConfirmationKind::SueAllowance)
        {
            return Err(invalid());
        }
        let mut legacy = BTreeMap::new();
        for (i, row) in input.legacy_decisions.iter().enumerate() {
            validate_monthly_tariff_decision(row)
                .map_err(|e| FinancialError::invalid(e.to_string()))?;
            legacy
                .entry(row["month"].as_str().ok_or_else(invalid)?.to_owned())
                .or_insert(i as u32);
        }
        let mut scoped = BTreeMap::new();
        if let Some(rows) = input.scoped_decisions.ready() {
            for (i, row) in rows.saved().iter().enumerate() {
                scoped
                    .entry(row["month"].as_str().ok_or_else(invalid)?.to_owned())
                    .or_insert(i as u32);
            }
        }
        let settings = serde_json::to_value(&input.settings).map_err(|_| invalid())?;
        let empty = Arc::new(vec![]);
        // These neutral channels apply only when the native context proves the
        // source is irrelevant. The original Evidence state is retained.
        let inactive_paid = PaidAbsenceIndex::new(Arc::clone(&empty)).map_err(|_| invalid())?;
        let inactive_overtime = OvertimeAllocationIndex::new(empty).map_err(|_| invalid())?;
        Ok(Self {
            reuse: None,
            input,
            settings,
            legacy,
            scoped,
            inactive_paid,
            inactive_overtime,
            cache: MonthCache::new(),
        })
    }
    pub fn session(&self) -> AssessedSession<'_> {
        AssessedSession::new(self)
    }
    /// Only immutable native sources and closed producer results may be shared.
    pub fn new_with_reuse(
        input: AssessedSourceInput,
        space: super::super::fingerprint::StableFinancialDataSpace,
        cache: Arc<super::SharedAssessedReuseCache>,
    ) -> Result<Self, FinancialError> {
        let mut book = Self::new(input)?;
        // Derived reuse is optional. A cache/index failure must not replace or
        // block the ordinary native source calculation.
        book.reuse = super::fingerprint::AssessedFingerprintIndex::new(&book)
            .ok()
            .map(|index| super::reuse::ReuseBinding {
                space,
                cache,
                index,
            });
        Ok(book)
    }
    pub fn requirements(&self, month: &str) -> Result<BTreeSet<EvidenceKind>, FinancialError> {
        required_sources(
            month,
            &self.input.history,
            &self.input.active_shifts,
            &self.input.resolver,
        )
    }
    pub fn cache_stats(&self) -> Result<CacheStats, FinancialError> {
        self.cache.stats()
    }
    pub fn evidence_state(&self, kind: EvidenceKind) -> EvidenceState {
        match kind {
            EvidenceKind::ActualAnnualPayments => self.input.actual_annual_payments.state(),
            EvidenceKind::TariffAnnualClaims => self.input.tariff_annual_claims.state(),
            EvidenceKind::PaidAbsences => self.input.paid_absences.state(),
            EvidenceKind::OvertimeAllocations => self.input.overtime_allocations.state(),
            EvidenceKind::ScopedAllowances => self.input.scoped_decisions.state(),
            EvidenceKind::TvlShiftWork => self.input.tvl_shift_work.state(),
            EvidenceKind::AnnexMonth => self.input.annex_month.state(),
            EvidenceKind::AnnexPremium => self.input.annex_premium.state(),
            EvidenceKind::SueMonth => self.input.sue_month.state(),
            EvidenceKind::SueAllowance => self.input.sue_allowance.state(),
        }
    }
}
