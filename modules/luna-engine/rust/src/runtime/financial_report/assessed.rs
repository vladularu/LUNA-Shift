use super::model;
use crate::{
    contract::ReportPeriod,
    report::financial::assessed::{
        AssessedMonthProvider, AssessedReportStatus, annual_assessed_financial_report,
    },
    runtime::{facts::SnapshotFacts, report::ReportIssue},
};
use serde_json::Value;
pub(super) fn gross(facts: &SnapshotFacts, period: &ReportPeriod) -> Result<Value, ReportIssue> {
    let book = facts.assessed_book().map_err(model::source_error)?;
    let mut session = book.session();
    match period {
        ReportPeriod::Month { month } => {
            let result = session
                .assessed_month(month)
                .map_err(model::calculation_error)?
                .ok_or_else(|| ReportIssue::new("REMUNERATION_RULES_UNAVAILABLE"))?;
            model::output(&result)
        }
        ReportPeriod::Year { year } => {
            let result = annual_assessed_financial_report(
                i32::from(*year),
                AssessedReportStatus::Ready,
                &mut session,
            )
            .map_err(model::calculation_error)?;
            model::output(&result)
        }
    }
}
