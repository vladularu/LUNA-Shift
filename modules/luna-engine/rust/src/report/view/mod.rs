//! Section-owned UI projections. Every total is computed by a native engine;
//! the host only selects these fields by the already guarded exact month key.
pub(crate) mod annual;
pub mod dated;
pub(crate) mod monthly;
use crate::runtime::report::ReportIssue;
use serde::Serialize;
use serde_json::Value;
pub(crate) fn required<'a>(value: &'a Value, key: &str) -> Result<&'a Value, ReportIssue> {
    value
        .get(key)
        .ok_or_else(|| ReportIssue::new("VIEW_OUTPUT_INVALID"))
}
pub(crate) fn fields(value: &Value, names: &[&str]) -> Value {
    Value::Object(
        names
            .iter()
            .filter_map(|key| value.get(*key).map(|v| ((*key).to_owned(), v.clone())))
            .collect(),
    )
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyAnalysisOverlay {
    pub monthly_analysis: Value,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnualReportOverlay {
    pub annual_report: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annual_payments_state: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub training_state: Option<Value>,
}
