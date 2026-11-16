//! Half-open coverage intervals measured in rounded epoch minutes.
use crate::EngineError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub struct MinuteInterval {
    pub start: i64,
    pub end: i64,
}

pub fn merge_interval(intervals: &[MinuteInterval], next: MinuteInterval) -> Vec<MinuteInterval> {
    let mut sorted = intervals.to_vec();
    sorted.push(next);
    sorted.sort_by_key(|value| value.start);
    let mut merged: Vec<MinuteInterval> = Vec::new();
    for interval in sorted {
        if let Some(last) = merged.last_mut().filter(|last| interval.start <= last.end) {
            last.end = last.end.max(interval.end);
        } else {
            merged.push(interval);
        }
    }
    merged
}

pub fn overlapping_minutes(
    interval: MinuteInterval,
    coverage: &[MinuteInterval],
) -> Result<i64, EngineError> {
    coverage.iter().try_fold(0_i64, |total, covered| {
        let difference = interval
            .end
            .min(covered.end)
            .checked_sub(interval.start.max(covered.start))
            .ok_or(EngineError::Overflow)?
            .max(0);
        total.checked_add(difference).ok_or(EngineError::Overflow)
    })
}
