//! Snapshot-bound target UI output; scheduling/persistence belongs to TIME jobs.
use super::{
    facts::SnapshotFacts,
    report::{ReportIssue, SectionOutput},
};
use crate::target;
use serde_json::Value;

pub fn month_title(month: &str) -> Result<String, crate::EngineError> {
    let date = crate::calendar::parse_date(&format!("{month}-01"))?;
    const MONTHS: [&str; 12] = [
        "Januar",
        "Februar",
        "März",
        "April",
        "Mai",
        "Juni",
        "Juli",
        "August",
        "September",
        "Oktober",
        "November",
        "Dezember",
    ];
    Ok(format!(
        "{} {}",
        MONTHS[date.month() as usize - 1],
        date.year()
    ))
}

pub fn time_presentation(facts: &SnapshotFacts, month: &str) -> SectionOutput {
    let output = overview(facts, month);
    match output {
        SectionOutput::Ready { mut value } => match month_title(month) {
            Ok(title) => {
                value["monthTitle"] = Value::String(title);
                SectionOutput::Ready { value }
            }
            Err(_) => SectionOutput::Unavailable {
                reason: ReportIssue::new("INVALID_PERIOD"),
            },
        },
        other => other,
    }
}
/// These are native result frames, never host-provided ready source facts.
pub fn with_time_overlay(base: SectionOutput, target_overview: SectionOutput) -> SectionOutput {
    let mut value = match base {
        SectionOutput::Ready { value } => value,
        other => serde_json::json!({"legacyState":other}),
    };
    value["targetOverview"] = serde_json::json!(target_overview);
    SectionOutput::Ready { value }
}

pub fn overview(facts: &SnapshotFacts, month: &str) -> SectionOutput {
    SectionOutput::from_result(value(facts, month))
}
fn value(facts: &SnapshotFacts, month: &str) -> Result<Value, ReportIssue> {
    let display = facts
        .profile_display_metadata()
        .map_err(ReportIssue::from)?;
    let provider = display
        .get("providerProfile")
        .filter(|v| !v.is_null())
        .ok_or(ReportIssue::new("PROFILE_MISSING"))?;
    let source = facts
        .prepared_targets()
        .map_err(ReportIssue::from)?
        .ok_or(ReportIssue::new("PROFILE_MISSING"))?;
    let catalog = facts.catalog().map_err(ReportIssue::from)?;
    target::presentation::overview(month, source, provider, catalog.resolver())
        .map_err(|_| ReportIssue::new("TARGET_VIEW_INVALID"))
}
