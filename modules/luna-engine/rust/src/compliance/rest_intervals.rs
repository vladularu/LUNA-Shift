//! Sorted endpoint index: overlapping duties retain the greatest prior end.
use super::model::ComplianceInterval;
pub(super) struct RestIntervalIndex {
    starts: Vec<i64>,
    ends: Vec<i64>,
}
impl RestIntervalIndex {
    pub fn new(intervals: &[ComplianceInterval]) -> Self {
        let mut starts: Vec<_> = intervals
            .iter()
            .map(|i| i.start.timestamp().as_millisecond())
            .collect();
        let mut ends: Vec<_> = intervals
            .iter()
            .map(|i| i.end.timestamp().as_millisecond())
            .collect();
        starts.sort_unstable();
        ends.sort_unstable();
        Self { starts, ends }
    }
    pub fn observed_rest(&self, start: i64, end: i64) -> Option<i64> {
        let previous = self.ends.partition_point(|v| *v <= start);
        let next = self.starts.partition_point(|v| *v < end);
        if previous == 0 || next == self.starts.len() {
            None
        } else {
            Some((self.starts[next] - self.ends[previous - 1] + 30_000) / 60_000)
        }
    }
}
