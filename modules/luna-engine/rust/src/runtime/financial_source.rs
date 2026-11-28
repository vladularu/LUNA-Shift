//! Compose the salary provider only from the snapshot's checked native facts.
//! Tax setup and payment preferences are consumed later by their own requests.
use super::{
    catalog_source::CatalogSourceError,
    facts::{FactError, SnapshotFacts},
};
use crate::report::financial::{
    FinancialSnapshotInput, fingerprint::StableFinancialDataSpace, source::FinancialContext,
};
use std::sync::Arc;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FinancialSourceError {
    Facts(FactError),
    Catalog(CatalogSourceError),
    MissingProfile,
    InvalidNativeInput,
}
impl From<FactError> for FinancialSourceError {
    fn from(error: FactError) -> Self {
        Self::Facts(error)
    }
}
impl From<CatalogSourceError> for FinancialSourceError {
    fn from(error: CatalogSourceError) -> Self {
        Self::Catalog(error)
    }
}
pub(crate) fn from_facts(
    facts: &SnapshotFacts,
) -> Result<FinancialContext<'static>, FinancialSourceError> {
    let profile = facts
        .financial_profile()?
        .ok_or(FinancialSourceError::MissingProfile)?;
    let calendar = facts.calendar()?;
    let has_vka = crate::net::absence_pay::eligible(profile)
        || profile["employmentTimeline"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|period| crate::net::absence_pay::eligible(&period["employment"]));
    let has_absences = has_vka
        && calendar
            .entries()
            .iter()
            .any(crate::net::absence_pay::absence);
    let profile = if has_absences {
        facts
            .calculation_profile()
            .ok()
            .flatten()
            .unwrap_or(profile)
    } else {
        profile
    };
    let mut profile = Arc::clone(profile);
    if has_absences
        && let Ok(rows) = facts.paid_absences()
        && !rows.saved().is_empty()
        && let Ok(index) =
            crate::remuneration::base::prepared::PaidAbsenceIndex::new(Arc::clone(rows.saved()))
    {
        let zone = profile["timeZone"].as_str().unwrap_or("");
        let dates: std::collections::BTreeSet<_> = calendar
            .entries()
            .iter()
            .filter(|s| crate::net::absence_pay::absence(s))
            .filter(|s| {
                s["id"]
                    .as_str()
                    .and_then(|id| index.get(id))
                    .is_some_and(|saved| {
                        saved.paid_minutes.is_some_and(|minutes| minutes > 0)
                            && crate::remuneration::base::absence::is_current_paid_absence(
                                saved, s, zone,
                            )
                    })
            })
            .filter_map(|s| s["date"].as_str())
            .collect();
        if !dates.is_empty() {
            Arc::make_mut(&mut profile)["workingTimeTarget"]["context"]["confirmedPaidDates"] =
                serde_json::json!(dates);
        }
    }
    let decisions = facts.tariff_decisions()?;
    let pattern = facts.work_pattern()?;
    let test_months = facts.test_months()?;
    let catalog = facts.catalog()?;
    let input = FinancialSnapshotInput {
        profile: &profile,
        entries: calendar.entries(),
        tariff_decisions: decisions.decisions(),
        work_pattern_settings: pattern.settings(),
        test_months: test_months.months(),
    };
    let context = if let Some(reuse) = facts.financial_reuse().filter(|_| !has_absences) {
        match StableFinancialDataSpace::new(facts.snapshot().identity().owner_scope()) {
            Ok(space) => FinancialContext::new_shared_with_reuse(
                &input,
                Arc::clone(catalog.resolver()),
                space,
                Arc::clone(&reuse.gross),
            )
            .map(|mut context| {
                context.enable_shared_net_reuse(Arc::clone(&reuse.net));
                context
            }),
            // Optional derived reuse never makes valid original facts fail.
            Err(_) => FinancialContext::new_shared(&input, Arc::clone(catalog.resolver())),
        }
    } else {
        FinancialContext::new_shared(&input, Arc::clone(catalog.resolver()))
    };
    context.map_err(|_| FinancialSourceError::InvalidNativeInput)
}
