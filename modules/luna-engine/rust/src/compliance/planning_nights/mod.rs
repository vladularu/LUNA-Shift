//! Scientific night guidance consumes Rust-created interval evidence and original raw entries.
use super::model::{ComplianceError, ComplianceInterval};
use serde_json::Value;
mod evidence;
mod recovery;
pub fn check_planning_nights(
    intervals: &[ComplianceInterval],
    original: &[Value],
    time_zone: &str,
    options: &Value,
) -> Result<Vec<Value>, ComplianceError> {
    if intervals.is_empty() {
        return Ok(vec![]);
    }
    let mut evidence = evidence::prepare(intervals, time_zone)?;
    recovery::assess(&mut evidence, original, options)
}
