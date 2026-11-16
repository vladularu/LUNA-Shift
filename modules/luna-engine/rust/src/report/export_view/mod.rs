//! Semantic PDF facts over native reporting output; no source admission or UI calculation.
pub mod model;
mod selection;
use model::{ReportDocumentRef, ReportView};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportViewError {
    InvalidPeriod,
    InvalidData,
}
impl std::fmt::Display for ExportViewError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Die Berichtsdaten sind ungültig.")
    }
}
impl std::error::Error for ExportViewError {}
pub fn report_view<'a>(
    document: &'a ReportDocumentRef<'a>,
) -> Result<ReportView<'a>, ExportViewError> {
    selection::calculate(document)
}
