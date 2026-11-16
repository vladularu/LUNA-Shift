//! Structural preparation only. No profile, target, finance or legal calculation.
use crate::report::export_rows::report_comparison_candidates;
use serde::Deserialize;
use serde_json::{Value, json};
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Recorded {
    kind: RecordedKind,
    entries: Vec<Value>,
}
#[derive(Deserialize)]
enum RecordedKind {
    #[serde(rename = "RECORDED_ENTRIES")]
    Recorded,
}
/// The exact existing Provider.entries array is ordinary input, in its original
/// order. It is never a prepared report or a host-created admission proof.
pub fn execute(raw: &[u8]) -> Result<Value, &'static str> {
    let input = crate::contract::bounded_json(raw).map_err(|_| "INVALID_EXPORT_INPUT")?;
    let input: Recorded = serde_json::from_value(input).map_err(|_| "INVALID_EXPORT_INPUT")?;
    let RecordedKind::Recorded = input.kind;
    if input.entries.len() > 50_000 {
        return Err("EXPORT_LIMIT");
    }
    let candidates = report_comparison_candidates(&input.entries, 100_000, 32 * 1024 * 1024)
        .map_err(|_| "INVALID_EXPORT_INPUT")?;
    Ok(
        json!({"schemaVersion":1,"candidates":candidates.strings(),"readableEntryCount":candidates.readable_entry_count()}),
    )
}
