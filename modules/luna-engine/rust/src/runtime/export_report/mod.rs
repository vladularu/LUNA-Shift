//! Native raw-source export producers. No transport, scheduling or host Ready input.
pub mod collation;
pub mod direct;
pub mod resource;
pub mod structure;
use super::{
    catalog_source::CatalogSourceError,
    facts::{FactError, SnapshotFacts},
};
use crate::{
    EngineError,
    calendar::recurrence::CollationRanks,
    contract::{SourceKind, SourceState},
    credit::context::{DailyCreditContextCache, DailyCreditError},
    input::calculation_profile::{
        TargetProfileFacts, YouthProtectionFacts, bind_calculation_profile,
    },
    report::{
        export_csv::{CsvError, report_to_csv},
        export_rows::{ReportEntry, ReportEntryError, report_entries_from_records_bounded},
    },
    rules::RuleResolver,
    target::{InputStatus, MonthlyTarget, PreparedTargetSource},
};
use std::sync::Arc;
use structure::ExportStructureIndex;
/// Isolated export-volume ceiling, including generated duty parts across a year.
pub const MAX_READABLE_ENTRIES: usize = 100_000;
#[derive(Debug)]
pub enum ExportTimeError {
    InvalidPeriod,
    MissingProfile,
    MissingClock,
    ForeignStructure,
    StaleSource,
    Loaded(crate::runtime::calendar_loaded::LoadedPoolError),
    Facts(FactError),
    Catalog(CatalogSourceError),
    Order(EngineError),
    Entries(ReportEntryError),
    Target(DailyCreditError),
    Csv(CsvError),
}
impl std::fmt::Display for ExportTimeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Original route displays a generic export failure, never SQL/raw parser data.
        f.write_str("Die Exportquellen sind nicht verf\u{00fc}gbar.")
    }
}
impl std::error::Error for ExportTimeError {}
impl ExportTimeError {
    pub fn source_error_name(&self) -> &str {
        "Error"
    }
}
/// Constructed by native sources only, never deserialized as a Ready proof.
pub struct TimeExportDocument {
    entries: Vec<ReportEntry>,
    targets: Vec<MonthlyTarget>,
}
impl TimeExportDocument {
    pub fn entries(&self) -> &[ReportEntry] {
        &self.entries
    }
    pub fn targets(&self) -> &[MonthlyTarget] {
        &self.targets
    }
    pub fn to_csv(&self, max_bytes: usize) -> Result<String, ExportTimeError> {
        report_to_csv(&self.entries, &self.targets, max_bytes).map_err(ExportTimeError::Csv)
    }
}
fn state(facts: &SnapshotFacts, kind: SourceKind) -> &SourceState {
    facts
        .snapshot()
        .sources()
        .iter()
        .find(|source| source.kind() == kind)
        .expect("complete native source registry")
        .state()
}
fn months(period: &str) -> Result<Vec<String>, ExportTimeError> {
    let year = period
        .get(..4)
        .filter(|v| v.len() == 4 && v.bytes().all(|b| b.is_ascii_digit()))
        .and_then(|v| v.parse::<i32>().ok())
        .filter(|v| (1900..=4099).contains(v))
        .ok_or(ExportTimeError::InvalidPeriod)?;
    if period.len() == 4 {
        return Ok((1..=12)
            .map(|month| format!("{year:04}-{month:02}"))
            .collect());
    }
    crate::calendar::month_range(period).map_err(|_| ExportTimeError::InvalidPeriod)?;
    Ok(vec![period.to_owned()])
}
/// Held once per export snapshot across its period jobs; ordinary calendar and
/// large target contexts stay in their original immutable owners.
enum ProfileRole {
    CalculationBase,
    ProvidedReference,
}
pub struct NativeTimeExportSource {
    targets: PreparedTargetSource,
    structure: Arc<ExportStructureIndex>,
    resolver: Arc<RuleResolver>,
}
impl NativeTimeExportSource {
    pub fn from_facts(facts: &SnapshotFacts) -> Result<Self, ExportTimeError> {
        Self::with_structure(facts, Arc::new(ExportStructureIndex::from_facts(facts)?))
    }
    /// Native reference wrapper for the formerly supplied provided-profile
    /// pipeline. Production uses the actual calculation-first caller above.
    pub fn from_provider_profile_reference(facts: &SnapshotFacts) -> Result<Self, ExportTimeError> {
        Self::with_structure_role(
            facts,
            Arc::new(ExportStructureIndex::from_facts(facts)?),
            ProfileRole::ProvidedReference,
        )
    }
    pub fn with_structure(
        facts: &SnapshotFacts,
        structure: Arc<ExportStructureIndex>,
    ) -> Result<Self, ExportTimeError> {
        Self::with_structure_role(facts, structure, ProfileRole::CalculationBase)
    }
    fn with_structure_role(
        facts: &SnapshotFacts,
        structure: Arc<ExportStructureIndex>,
        role: ProfileRole,
    ) -> Result<Self, ExportTimeError> {
        if !structure.shares_calendar(facts.calendar().map_err(ExportTimeError::Facts)?) {
            return Err(ExportTimeError::ForeignStructure);
        }
        let profile = profile_for_role(facts, role)?;
        let targets = PreparedTargetSource::new(profile);
        let resolver = Arc::clone(
            facts
                .catalog()
                .map_err(ExportTimeError::Catalog)?
                .resolver(),
        );
        Ok(Self {
            targets,
            structure,
            resolver,
        })
    }
    pub fn document(
        &self,
        period: &str,
        collation: &CollationRanks,
    ) -> Result<TimeExportDocument, ExportTimeError> {
        let periods = months(period)?;
        let mut cache = DailyCreditContextCache::with_source(&self.targets, &self.resolver);
        let mut targets = Vec::with_capacity(periods.len());
        let mut entries = Vec::new();
        for month in periods {
            if self
                .targets
                .profile()
                .get("workingTimeTarget")
                .is_some_and(|v| !v.is_null())
            {
                let target = cache
                    .base_monthly_target(&month, None)
                    .map_err(ExportTimeError::Target)?;
                targets.push(target.as_ref().clone());
            }
            // Stable locale-equivalent ties retain the original repository order.
            let borrowed = self.structure.ordered_month_records(&month, collation)?;
            entries.extend(
                report_entries_from_records_bounded(
                    &borrowed,
                    &mut cache,
                    collation,
                    MAX_READABLE_ENTRIES - entries.len(),
                )
                .map_err(ExportTimeError::Entries)?,
            );
        }
        Ok(TimeExportDocument { entries, targets })
    }
    pub fn structure(&self) -> &Arc<ExportStructureIndex> {
        &self.structure
    }
    /// On-demand native reference representation. Wire outputs never include it.
    pub fn profile_for_reference(&self) -> &serde_json::Value {
        self.targets.profile()
    }
    pub fn target_preparation_stats(&self) -> crate::target::TargetPreparationStats {
        self.targets.stats()
    }
}
/// Convenience wrapper for native callers; production resources retain Source.
pub fn prepare_time_document(
    facts: &SnapshotFacts,
    period: &str,
    collation: &CollationRanks,
) -> Result<TimeExportDocument, ExportTimeError> {
    months(period)?;
    NativeTimeExportSource::from_facts(facts)?.document(period, collation)
}
/// Existing original export role without a second calendar selection/index.
pub(crate) fn calculation_profile_from_facts(
    facts: &SnapshotFacts,
) -> Result<Arc<serde_json::Value>, ExportTimeError> {
    profile_for_role(facts, ProfileRole::CalculationBase)
}
fn profile_for_role(
    facts: &SnapshotFacts,
    role: ProfileRole,
) -> Result<Arc<serde_json::Value>, ExportTimeError> {
    let stored = facts
        .profile()
        .map_err(ExportTimeError::Facts)?
        .ok_or(ExportTimeError::MissingProfile)?;
    let env = facts
        .profile_clock_environment()
        .map_err(ExportTimeError::Facts)?
        .ok_or(ExportTimeError::MissingClock)?;
    let pattern_state = state(facts, SourceKind::WorkPatternSettings);
    let provider = match role {
        ProfileRole::CalculationBase => env.calculation_profile_base(pattern_state),
        ProfileRole::ProvidedReference => env.editor_profile(pattern_state),
    }
    .map_err(ExportTimeError::Facts)?
    .ok_or(ExportTimeError::MissingProfile)?;
    let youth = facts.youth_preference().map_err(ExportTimeError::Facts)?;
    let history = facts.employment_history().map_err(ExportTimeError::Facts)?;
    let calendar = Arc::clone(facts.calendar().map_err(ExportTimeError::Facts)?);
    let target = match state(facts, SourceKind::WorkingTimeTarget) {
        SourceState::NotRequested | SourceState::Loading => TargetProfileFacts::Loading,
        SourceState::Failed { .. } => TargetProfileFacts::Error,
        SourceState::Ready { .. } => TargetProfileFacts::Ready {
            saved: facts
                .saved_target()
                .map_err(ExportTimeError::Facts)?
                .map(Arc::as_ref),
            calendar: &calendar,
        },
    };
    bind_calculation_profile(
        stored,
        history,
        &provider,
        target,
        YouthProtectionFacts {
            value: Some(youth),
            status: InputStatus::Ready,
        },
    )
    .map_err(|e| ExportTimeError::Facts(FactError::Profile(e)))
}
