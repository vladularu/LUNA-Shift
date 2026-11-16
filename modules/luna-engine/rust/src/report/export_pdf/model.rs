use serde::Serialize;
use serde_json::Value;
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PdfLayout {
    Standard,
    Compact,
}
#[derive(Debug, Clone, Copy)]
pub struct PdfOptions {
    pub layout: PdfLayout,
    pub include_salary: bool,
}
#[derive(Serialize)]
pub struct PdfPlan {
    #[serde(flatten)]
    pub fields: Value,
}
