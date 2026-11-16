use super::model::{ComplianceError, text};
use crate::{EngineError, calendar::parse_date};
use jiff::ToSpan;
use serde_json::{Value, json};
use std::collections::BTreeSet;
pub fn finish_monthly_compliance(
    month: &str,
    issues: &[Value],
    start: &str,
    end: &str,
) -> Result<Value, ComplianceError> {
    let through = parse_date(end)?
        .checked_add(1.days())
        .map_err(|_| EngineError::InvalidDate)?
        .to_string();
    let range = json!({"from":start,"through":through});
    let mut selected = Vec::new();
    let prefix = format!("{month}-");
    let mut dates = BTreeSet::new();
    let mut critical = 0;
    let mut warning = 0;
    let mut info = 0;
    for finding in issues {
        if !text(finding, "date")?.starts_with(&prefix) {
            continue;
        }
        let mut finding = finding.clone();
        if finding["kind"] == "LEGAL"
            && finding.get("assessmentRanges").is_none()
            && matches!(
                finding["rule"].as_str(),
                Some(
                    "ARBZG_5_REST_11H"
                        | "ARBZG_11_SUNDAY_REST"
                        | "ARBZG_11_HOLIDAY_REST"
                        | "ARBZG_11_REST_CONNECTION"
                        | "HOLIDAY_CATALOG_COVERAGE"
                )
            )
        {
            finding
                .as_object_mut()
                .ok_or(ComplianceError::InvalidInput)?
                .insert("assessmentRanges".into(), json!([range]));
        }
        dates.insert(text(&finding, "date")?.to_owned());
        match text(&finding, "severity")? {
            "critical" => critical += 1,
            "warning" => warning += 1,
            "info" => info += 1,
            _ => {}
        }
        selected.push(finding);
    }
    Ok(
        json!({"month":month,"assessmentRange":range,"issues":selected,"criticalCount":critical,"warningCount":warning,"infoCount":info,"affectedDates":dates.into_iter().collect::<Vec<_>>()}),
    )
}
