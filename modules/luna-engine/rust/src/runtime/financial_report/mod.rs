//! Display-only financial sections over retained checked native snapshot facts.
pub mod analysis_net_row;
pub mod annual_details;
pub mod annual_display;
mod assessed;
pub mod candidates;
mod dashboard;
mod detail_panels;
mod drafts;
pub mod earned_services_page;
mod legacy;
mod model;
pub(crate) mod net_display;
pub mod payroll;
pub mod presentation;
pub mod service_display;
use crate::{
    contract::{ReportPeriod, SalaryPerspective},
    runtime::{facts::SnapshotFacts, report::ReportIssue},
};
use serde_json::Value;

pub(crate) fn annual_gross_summary(facts: &SnapshotFacts, year: i16) -> Result<Value, ReportIssue> {
    let owner = facts.financial_context().map_err(model::source_error)?;
    let mut context = owner
        .lock()
        .map_err(|_| ReportIssue::new("FINANCIAL_CONTEXT_UNAVAILABLE"))?;
    let summary =
        crate::report::financial::gross::annual_monthly_earned_gross(i32::from(year), &mut context)
            .map_err(model::calculation_error)?;
    Ok(serde_json::json!({
        "legacy": crate::runtime::report::SectionOutput::Ready {
            value: model::output(&summary)?,
        }
    }))
}

pub fn gross(
    facts: &SnapshotFacts,
    period: &ReportPeriod,
    perspective: SalaryPerspective,
) -> Result<Value, ReportIssue> {
    // Draft snapshot loaders consume the stored profile independently of the
    // legacy employment projection. An unsupported legacy projection must not
    // suppress otherwise valid, explicitly incomplete native draft components.
    facts
        .profile()?
        .ok_or_else(|| ReportIssue::new("PROFILE_MISSING"))?;
    use crate::runtime::report::SectionOutput;
    let legacy = SectionOutput::from_result(legacy::gross(facts, period, perspective));
    let dashboard =
        match period {
            ReportPeriod::Month { month } => Some(SectionOutput::from_result(
                dashboard::for_gross(facts, month, perspective, &legacy),
            )),
            ReportPeriod::Year { .. } => None,
        };
    let mut value = serde_json::json!({"legacy":legacy,"assessedPerspective":"EARNED","assessed":SectionOutput::from_result(assessed::gross(facts,period)),"drafts":SectionOutput::from_result(drafts::gross(facts,period))});
    if let Some(dashboard) = dashboard {
        value["monthlyDashboard"] = serde_json::to_value(dashboard)
            .map_err(|_| ReportIssue::new("FINANCIAL_OUTPUT_INVALID"))?;
    }
    Ok(value)
}
pub fn net(
    facts: &SnapshotFacts,
    period: &ReportPeriod,
    perspective: SalaryPerspective,
) -> Result<Value, ReportIssue> {
    legacy::net(facts, period, perspective)
}
