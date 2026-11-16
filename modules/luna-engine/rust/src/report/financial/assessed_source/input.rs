use super::super::FinancialError;
use crate::{
    input::{
        annual_rows::{RawActualAnnualPayments, RawTariffAnnualClaims},
        draft_rows::RawDraftRows,
        remuneration_rows::RawRemunerationRows,
        training_rows::RawShiftTraining,
    },
    pay::pattern::WorkPatternSettings,
    remuneration::{
        base::prepared::PaidAbsenceIndex,
        draft_facts::prepared::{AnnexPremiumOwner, DraftConfirmationOwner},
        overtime::prepared::OvertimeAllocationIndex,
    },
    rules::RuleResolver,
};
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EvidenceState {
    NotRequested,
    Loading,
    Missing,
    Failed,
    Ready,
}
/// A native owner is the only Ready payload. Missing or failed I/O never
/// becomes a fabricated successful empty source.
pub enum Evidence<T> {
    NotRequested,
    Loading,
    Missing,
    Failed,
    Ready(Arc<T>),
}
impl<T> Evidence<T> {
    pub fn state(&self) -> EvidenceState {
        match self {
            Self::NotRequested => EvidenceState::NotRequested,
            Self::Loading => EvidenceState::Loading,
            Self::Missing => EvidenceState::Missing,
            Self::Failed => EvidenceState::Failed,
            Self::Ready(_) => EvidenceState::Ready,
        }
    }
    pub fn ready(&self) -> Option<&Arc<T>> {
        match self {
            Self::Ready(value) => Some(value),
            _ => None,
        }
    }
    pub(super) fn require(&self, kind: EvidenceKind) -> Result<&T, FinancialError> {
        self.ready().map(Arc::as_ref).ok_or_else(|| {
            FinancialError::invalid(format!(
                "Vergütungsdaten nicht vollständig verfügbar: {} ({:?}).",
                kind.label(),
                self.state()
            ))
        })
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EvidenceKind {
    ActualAnnualPayments,
    TariffAnnualClaims,
    PaidAbsences,
    OvertimeAllocations,
    ScopedAllowances,
    TvlShiftWork,
    AnnexMonth,
    AnnexPremium,
    SueMonth,
    SueAllowance,
}
impl EvidenceKind {
    fn label(self) -> &'static str {
        match self {
            Self::ActualAnnualPayments => "bestätigte Sonderzahlungen",
            Self::TariffAnnualClaims => "Tarif-Jahresansprüche",
            Self::PaidAbsences => "bezahlte Abwesenheiten",
            Self::OvertimeAllocations => "Überstundenaufteilungen",
            Self::ScopedAllowances => "Zulagenbestätigungen",
            Self::TvlShiftWork => "TV-L-Dienstbestätigungen",
            Self::AnnexMonth => "TVöD-Monatsbestätigungen",
            Self::AnnexPremium => "TVöD-Zuschlagsbestätigungen",
            Self::SueMonth => "SuE-Monatsbestätigungen",
            Self::SueAllowance => "SuE-Zulagenbestätigungen",
        }
    }
}
/// Immutable source inputs only. Raw SQL admission and snapshot owner/revision
/// fences belong to the enclosing runtime, not to a caller-supplied validity flag.
pub struct AssessedSourceInput {
    pub work_profile: Arc<Value>,
    pub active_shifts: Arc<Vec<Value>>,
    pub history: Arc<Vec<Value>>,
    pub resolver: Arc<RuleResolver>,
    pub settings: WorkPatternSettings,
    pub legacy_decisions: Arc<Vec<Value>>,
    pub scoped_decisions: Evidence<RawRemunerationRows>,
    pub paid_absences: Evidence<PaidAbsenceIndex>,
    pub overtime_allocations: Evidence<OvertimeAllocationIndex>,
    pub actual_annual_payments: Evidence<RawActualAnnualPayments>,
    pub tariff_annual_claims: Evidence<RawTariffAnnualClaims>,
    pub tvl_shift_work: Evidence<RawDraftRows>,
    pub annex_month: Evidence<DraftConfirmationOwner>,
    pub annex_premium: Evidence<AnnexPremiumOwner>,
    pub sue_month: Evidence<DraftConfirmationOwner>,
    pub sue_allowance: Evidence<DraftConfirmationOwner>,
    pub pause_details: Evidence<RawShiftTraining>,
}
