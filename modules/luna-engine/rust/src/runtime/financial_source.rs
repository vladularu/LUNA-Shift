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
    let decisions = facts.tariff_decisions()?;
    let pattern = facts.work_pattern()?;
    let test_months = facts.test_months()?;
    let catalog = facts.catalog()?;
    let input = FinancialSnapshotInput {
        profile,
        entries: calendar.entries(),
        tariff_decisions: decisions.decisions(),
        work_pattern_settings: pattern.settings(),
        test_months: test_months.months(),
    };
    let context = if let Some(reuse) = facts.financial_reuse() {
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
