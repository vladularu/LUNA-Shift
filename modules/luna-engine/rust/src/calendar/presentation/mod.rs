//! Native display policy over borrowed, already validated calendar rows.
//! These helpers do not admit raw source data or create READY source evidence.
pub mod navigation;
pub mod preview;
pub mod rows;
pub mod shared_entry;
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DisplayOptions {
    pub show_shift_times: bool,
    pub show_shift_duration: bool,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LabelMode {
    Full,
    Short,
    Symbol,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelPresentation {
    pub show_symbol: bool,
    pub text: Option<Vec<u16>>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewSelection {
    pub indices: Vec<u32>,
    pub overflow_count: u32,
}
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RowKind {
    Own,
    Shared,
}
#[derive(Debug, Clone, Copy, Serialize)]
pub struct SelectedRow {
    pub kind: RowKind,
    pub index: u32,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CombinedPreview {
    pub rows: Vec<SelectedRow>,
    pub heights: Vec<f64>,
    pub gaps: Vec<f64>,
    pub used_height: f64,
    pub hidden_rows: Vec<SelectedRow>,
    pub line_height: f64,
    pub header_height: f64,
    pub overflow_count: u32,
}
