//! Connect independent raw snapshot reads to the native assessed-month book.
//! Unavailable evidence stays unavailable; its relevance is decided by Rust
//! for the requested remuneration context, never by a host-supplied flag.
use super::{
    facts::{FactError, SnapshotFacts},
    financial_source::FinancialSourceError,
    sources::SourceReadError,
};
use crate::{
    contract::SourceKind,
    input::draft_rows::DraftRowsKind,
    remuneration::{
        base::prepared::PaidAbsenceIndex,
        draft_facts::{
            model::ConfirmationKind,
            prepared::{AnnexPremiumOwner, DraftConfirmationOwner},
        },
        overtime::prepared::OvertimeAllocationIndex,
    },
    report::financial::assessed_source::{
        AssessedSourceBook,
        input::{AssessedSourceInput, Evidence},
    },
    report::financial::fingerprint::StableFinancialDataSpace,
};
use std::sync::Arc;

fn evidence<T>(result: Result<Arc<T>, FactError>) -> Evidence<T> {
    match result {
        Ok(owner) => Evidence::Ready(owner),
        Err(FactError::Source { error, .. }) => match error {
            SourceReadError::NotRequested => Evidence::NotRequested,
            SourceReadError::Loading => Evidence::Loading,
            SourceReadError::MissingRecord | SourceReadError::InsufficientCoverage => {
                Evidence::Missing
            }
            _ => Evidence::Failed,
        },
        Err(_) => Evidence::Failed,
    }
}
fn confirmation(
    facts: &SnapshotFacts,
    rows: DraftRowsKind,
    kind: ConfirmationKind,
) -> Evidence<DraftConfirmationOwner> {
    match facts.draft_evidence(rows) {
        Ok(rows) => match DraftConfirmationOwner::new(kind, Arc::clone(rows.saved())) {
            Ok(owner) => Evidence::Ready(Arc::new(owner)),
            Err(_) => Evidence::Failed,
        },
        Err(error) => evidence(Err(error)),
    }
}
pub(crate) fn from_facts(
    facts: &SnapshotFacts,
) -> Result<AssessedSourceBook, FinancialSourceError> {
    let work_profile = facts
        .financial_profile()?
        .ok_or(FinancialSourceError::MissingProfile)?;
    let calendar = facts.calendar()?;
    let history = facts.employment_history()?;
    let catalog = facts.catalog()?;
    let pattern = facts.work_pattern()?;
    let legacy = facts.tariff_decisions()?;
    let paid_absences = evidence(facts.paid_absences().and_then(|rows| {
        PaidAbsenceIndex::new(Arc::clone(rows.saved()))
            .map(Arc::new)
            .map_err(|_| FactError::InvalidShape(SourceKind::PaidAbsences))
    }));
    let overtime_allocations = evidence(facts.overtime_allocations().and_then(|rows| {
        OvertimeAllocationIndex::new(Arc::clone(rows.saved()))
            .map(Arc::new)
            .map_err(|_| FactError::InvalidShape(SourceKind::OvertimeAllocations))
    }));
    let input = AssessedSourceInput {
        work_profile: Arc::clone(work_profile),
        active_shifts: Arc::clone(calendar.active_shifts()),
        history: Arc::clone(history.profiles()),
        resolver: Arc::clone(catalog.resolver()),
        settings: pattern.settings().clone(),
        legacy_decisions: Arc::clone(legacy.decisions()),
        scoped_decisions: evidence(facts.scoped_allowances().cloned()),
        paid_absences,
        overtime_allocations,
        actual_annual_payments: evidence(facts.actual_annual_payments().cloned()),
        tariff_annual_claims: evidence(facts.tariff_annual_claims().cloned()),
        tvl_shift_work: evidence(facts.draft_evidence(DraftRowsKind::TvlShiftWork).cloned()),
        annex_month: confirmation(facts, DraftRowsKind::AnnexAMonth, ConfirmationKind::AnnexA),
        annex_premium: match facts.draft_evidence(DraftRowsKind::AnnexAPremium) {
            Ok(rows) => match AnnexPremiumOwner::new(Arc::clone(rows.saved())) {
                Ok(owner) => Evidence::Ready(Arc::new(owner)),
                Err(_) => Evidence::Failed,
            },
            Err(error) => evidence(Err(error)),
        },
        sue_month: confirmation(facts, DraftRowsKind::SueMonth, ConfirmationKind::SueMonth),
        sue_allowance: confirmation(
            facts,
            DraftRowsKind::SueAllowance,
            ConfirmationKind::SueAllowance,
        ),
        pause_details: evidence(facts.annex_pause_details().cloned()),
    };
    let book = if let Some(reuse) = facts.financial_reuse() {
        match StableFinancialDataSpace::new(facts.snapshot().identity().owner_scope()) {
            Ok(space) => {
                AssessedSourceBook::new_with_reuse(input, space, Arc::clone(&reuse.assessed))
            }
            Err(_) => AssessedSourceBook::new(input),
        }
    } else {
        AssessedSourceBook::new(input)
    };
    book.map_err(|_| FinancialSourceError::InvalidNativeInput)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::SourceFailure;
    #[test]
    fn raw_read_states_and_failed_native_admission_never_become_empty_ready_evidence() {
        for (error, expected) in [
            (SourceReadError::NotRequested, "NotRequested"),
            (SourceReadError::Loading, "Loading"),
            (SourceReadError::MissingRecord, "Missing"),
            (SourceReadError::InsufficientCoverage, "Missing"),
            (SourceReadError::NullRecord, "Failed"),
            (SourceReadError::InvalidCoverage, "Failed"),
            (SourceReadError::Failed(SourceFailure::ReadFailed), "Failed"),
        ] {
            let value: Evidence<Vec<serde_json::Value>> = evidence(Err(FactError::Source {
                kind: SourceKind::PaidAbsences,
                error,
            }));
            assert_eq!(format!("{:?}", value.state()), expected);
            assert!(value.ready().is_none());
        }
        let invalid: Evidence<Vec<serde_json::Value>> =
            evidence(Err(FactError::InvalidShape(SourceKind::PaidAbsences)));
        assert!(matches!(invalid, Evidence::Failed));
        let empty = Arc::new(Vec::<serde_json::Value>::new());
        let admitted = evidence(Ok(Arc::clone(&empty)));
        assert!(Arc::ptr_eq(admitted.ready().unwrap(), &empty));
    }
}
