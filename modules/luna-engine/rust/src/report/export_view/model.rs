use crate::{report::export_rows::ReportEntry, target::MonthlyTarget};
use serde::Serialize;
use serde_json::Value;

/// Output text made by native report producers, never a deserialized source proof.
pub struct ReportRow {
    pub section: String,
    pub period: String,
    pub field: String,
    pub value: String,
}
pub struct ReportDocumentRef<'a> {
    pub period: &'a str,
    pub created_at: &'a str,
    pub rows: &'a [ReportRow],
    pub entries: &'a [ReportEntry],
    pub targets: &'a [MonthlyTarget],
}
/// Full reference serialization is on demand. Production PDF planning borrows
/// entries/targets and serializes only its prepared display groups.
#[derive(Serialize)]
pub struct ReportView<'a> {
    #[serde(flatten)]
    pub facts: Value,
    #[serde(rename = "workingTimeTargets")]
    pub targets: &'a [MonthlyTarget],
    pub entries: &'a [ReportEntry],
}
