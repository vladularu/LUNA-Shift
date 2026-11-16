//! Native time reports depend on checked plan facts, not salary/check readiness.
use super::{
    catalog_source::CatalogSourceError,
    facts::{FactError, SnapshotFacts},
};
use crate::report::time::TimeReportContext;
use std::sync::Arc;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TimeSourceError {
    Facts(FactError),
    Catalog(CatalogSourceError),
    MissingProfile,
    InvalidNativeInput,
}
impl From<FactError> for TimeSourceError {
    fn from(error: FactError) -> Self {
        Self::Facts(error)
    }
}
impl From<CatalogSourceError> for TimeSourceError {
    fn from(error: CatalogSourceError) -> Self {
        Self::Catalog(error)
    }
}
pub(crate) fn from_facts(facts: &SnapshotFacts) -> Result<TimeReportContext, TimeSourceError> {
    let profile = facts
        .calculation_profile()?
        .ok_or(TimeSourceError::MissingProfile)?;
    let source = facts
        .prepared_targets()?
        .ok_or(TimeSourceError::MissingProfile)?;
    let calendar = facts.calendar()?;
    let catalog = facts.catalog()?;
    TimeReportContext::with_shared_collation(
        Arc::clone(profile),
        Arc::clone(source),
        Arc::clone(calendar.entries()),
        Arc::clone(catalog.resolver()),
        Arc::clone(calendar.collation()),
    )
    .map_err(|_| TimeSourceError::InvalidNativeInput)
}
