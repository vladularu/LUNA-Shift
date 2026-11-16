use crate::{
    EngineError,
    compliance::model::{ComplianceError, ComplianceInterval, minutes_between, number},
};
use jiff::{ToSpan, Zoned};
use std::collections::{BTreeMap, BTreeSet};
pub(super) struct YouthDay<'a> {
    pub date: String,
    pub intervals: Vec<&'a ComplianceInterval>,
    pub work: f64,
    pub pauses: f64,
    pub has_gap: bool,
}
struct Part<'a> {
    item: &'a ComplianceInterval,
    start: Zoned,
    end: Zoned,
}
pub(super) fn elapsed(start: &Zoned, end: &Zoned) -> Result<f64, ComplianceError> {
    Ok(minutes_between(start, end)?.max(0.0))
}
pub(super) fn calculate<'a>(
    intervals: &[&'a ComplianceInterval],
) -> Result<Vec<YouthDay<'a>>, ComplianceError> {
    let mut parts = BTreeMap::<String, Vec<Part<'a>>>::new();
    for item in intervals {
        let mut start = item.start.clone();
        while start.timestamp() < item.end.timestamp() {
            let midnight = start
                .start_of_day()
                .and_then(|z| z.checked_add(1.days()))
                .map_err(|_| EngineError::InvalidDate)?;
            let end = if midnight.timestamp() < item.end.timestamp() {
                midnight
            } else {
                item.end.clone()
            };
            parts
                .entry(start.date().to_string())
                .or_default()
                .push(Part {
                    item,
                    start: start.clone(),
                    end: end.clone(),
                });
            start = end;
        }
    }
    let mut result = Vec::new();
    for (date, mut values) in parts {
        values.sort_by_key(|p| p.start.timestamp());
        let mut end = values[0].end.clone();
        let mut gross = elapsed(&values[0].start, &end)?;
        let mut has_gap = false;
        for part in &values[1..] {
            if part.start.timestamp() > end.timestamp() {
                has_gap |= elapsed(&end, &part.start)? >= 15.0;
                gross += elapsed(&part.start, &part.end)?;
            } else if part.end.timestamp() > end.timestamp() {
                gross += elapsed(&end, &part.end)?;
            }
            if part.end.timestamp() > end.timestamp() {
                end = part.end.clone();
            }
        }
        let mut intervals = Vec::new();
        let mut seen = BTreeSet::new();
        for part in values {
            if seen.insert(part.item as *const ComplianceInterval as usize) {
                intervals.push(part.item);
            }
        }
        let mut pauses = 0.0;
        for item in &intervals {
            pauses += number(&item.shift, "breakMinutes")?;
        }
        result.push(YouthDay {
            date,
            intervals,
            work: (gross - pauses).max(0.0),
            pauses,
            has_gap,
        });
    }
    Ok(result)
}
