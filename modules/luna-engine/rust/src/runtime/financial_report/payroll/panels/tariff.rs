use crate::{
    contract::SourceKind,
    runtime::{facts::SnapshotFacts, report::ReportIssue},
};
use serde_json::Value;

/// A requested assessment uses the existing checked report sources only. It
/// precedes the payroll path, so setup, payment and annual pricing are unused.
pub(in crate::runtime::financial_report::payroll) fn calculate(
    facts: &SnapshotFacts,
    month: &str,
) -> Result<Value, ReportIssue> {
    let profile = if let Some(environment) = facts.profile_clock_environment()? {
        let state = facts
            .snapshot()
            .sources()
            .iter()
            .find(|s| s.kind() == SourceKind::WorkPatternSettings)
            .expect("complete native source set")
            .state();
        environment.editor_profile(state)?
    } else {
        // Existing clockless report contract: keep its native date projection.
        facts.financial_profile()?.cloned()
    }
    .ok_or_else(|| ReportIssue::new("PROFILE_MISSING"))?;
    let settings = facts.work_pattern()?;
    let entries = facts.calendar()?;
    let decisions = facts.tariff_decisions()?;
    let decision = decisions.decisions().iter().find(|d| d["month"] == month);
    let catalog = facts.catalog().map_err(ReportIssue::from)?;
    crate::report::tariff_assessment::calculate(
        month,
        entries.entries().as_slice(),
        &profile,
        settings.settings(),
        decision,
        catalog.resolver(),
    )
    .map_err(|_| ReportIssue::new("TARIFF_ASSESSMENT_FAILED"))
}
