//! Manually enabled youth duty-time checks; age/training confirmations stay separate.
use super::model::{ComplianceError, ComplianceInterval};
use super::{average::add_days, model::text};
use crate::rules::RuleResolver;
use crate::{EngineError, calendar::parse_date};
use jiff::ToSpan;
use serde_json::Value;
use serde_json::json;
use std::collections::BTreeSet;
mod daily;
mod days;
mod week;
/// Full native projection for consumers needing the source's public day ledger.
/// Calculated intervals remain Rust-only inputs, never a deserializable host table.
pub fn youth_duty_days(intervals: &[ComplianceInterval]) -> Result<Value, ComplianceError> {
    let references = intervals.iter().collect::<Vec<_>>();
    Ok(json!(days::calculate(&references)?.iter().map(|d|json!({"date":d.date,"intervals":d.intervals.iter().map(|i|i.to_json()).collect::<Vec<_>>(),"workMinutes":d.work,"breakMinutes":d.pauses,"hasGap":d.has_gap})).collect::<Vec<_>>()))
}
pub fn calculate_simple_youth_compliance(
    month: &str,
    intervals: &[ComplianceInterval],
    options: &Value,
    shared: &[Value],
    resolver: &RuleResolver,
) -> Result<Value, ComplianceError> {
    let first = parse_date(&format!("{month}-01"))?;
    let from = add_days(first, -7)?.to_string();
    let through = first
        .checked_add(1.months().days(21))
        .map_err(|_| EngineError::InvalidDate)?
        .to_string();
    let relevant = intervals
        .iter()
        .filter(|v| {
            v.end.date().to_string() >= from
                && v.shift["date"]
                    .as_str()
                    .is_some_and(|d| d <= through.as_str())
        })
        .collect::<Vec<_>>();
    let days = days::calculate(&relevant)?;
    let mut issues = shared.to_vec();
    issues.extend(daily::daily_findings(&days)?);
    issues.extend(daily::service_findings(&relevant)?);
    issues.extend(week::findings(month, &days, options, resolver)?);
    issues.extend(daily::scope_findings(month, &days)?);
    let prefix = format!("{month}-");
    let mut selected = Vec::new();
    let mut dates = BTreeSet::new();
    let (mut critical, mut warning, mut info) = (0, 0, 0);
    for mut issue in issues {
        if !text(&issue, "date")?.starts_with(&prefix) {
            continue;
        }
        if issue["kind"] == "LEGAL" {
            issue
                .as_object_mut()
                .ok_or(ComplianceError::InvalidInput)?
                .insert(
                    "assessmentRanges".into(),
                    json!([{"from":from,"through":through}]),
                );
        }
        dates.insert(text(&issue, "date")?.to_owned());
        match text(&issue, "severity")? {
            "critical" => critical += 1,
            "warning" => warning += 1,
            "info" => info += 1,
            _ => {}
        }
        selected.push(issue);
    }
    Ok(
        json!({"month":month,"issues":selected,"assessmentRange":{"from":from,"through":through},"criticalCount":critical,"warningCount":warning,"infoCount":info,"affectedDates":dates.into_iter().collect::<Vec<_>>()}),
    )
}
