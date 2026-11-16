use super::rows::DocumentRow;
use crate::{
    calendar::recurrence::CollationRanks, pay::pattern::WorkPatternSettings,
    report::export_rows::ReportEntry, rules::RuleResolver, target::MonthlyTarget,
};
use serde::Serialize;
use serde_json::Value;
use std::{collections::BTreeSet, sync::Arc};
/// Native calculation arguments. This is deliberately not Deserialize and is
/// not a source/Ready admission API. Runtime callers supply checked owners.
pub struct ReportInput<'a> {
    pub period: &'a str,
    pub entries: Arc<Vec<Value>>,
    pub profile: Arc<Value>,
    pub tariff_decisions: &'a [Value],
    pub work_pattern_settings: &'a WorkPatternSettings,
    pub resolver: Arc<RuleResolver>,
    pub collation: Arc<CollationRanks>,
    pub created_at: &'a str,
    pub reference_date: &'a str,
    pub youth_protection: bool,
    pub test_months: &'a BTreeSet<String>,
    pub net_pay_timeline: &'a [Value],
    pub salary_payment_preferences: Option<&'a Value>,
    pub net_pay_profile: Option<Arc<Value>>,
}
/// Full reference serialization is useful for exact original comparison. The
/// production artifact writer selects CSV/PDF output, never a duplicated tree.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportDocument {
    pub(crate) period: String,
    pub(crate) created_at: String,
    pub(crate) rows: Vec<DocumentRow>,
    pub(crate) entries: Vec<ReportEntry>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) working_time_targets: Vec<MonthlyTarget>,
}
impl ReportDocument {
    pub fn to_csv(&self, max_bytes: usize) -> Result<String, crate::report::export_csv::CsvError> {
        crate::report::export_csv::report_to_csv(
            &self.entries,
            &self.working_time_targets,
            max_bytes,
        )
    }
    pub fn pdf_plan(
        &self,
        options: crate::report::export_pdf::model::PdfOptions,
    ) -> Result<crate::report::export_pdf::model::PdfPlan, crate::report::export_pdf::PdfError>
    {
        let rows = self
            .rows
            .iter()
            .map(|r| crate::report::export_view::model::ReportRow {
                section: r.section.clone(),
                period: r.period.clone(),
                field: r.field.clone(),
                value: r.value.clone(),
            })
            .collect::<Vec<_>>();
        crate::report::export_pdf::plan_pdf(
            &crate::report::export_view::model::ReportDocumentRef {
                period: &self.period,
                created_at: &self.created_at,
                rows: &rows,
                entries: &self.entries,
                targets: &self.working_time_targets,
            },
            options,
        )
    }
}
