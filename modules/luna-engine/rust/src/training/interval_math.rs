use super::{TrainingError, entries::YouthEntry, helpers};
use crate::{calendar::parse_date, time};
use jiff::{Timestamp, ToSpan};
use serde_json::{Value, json};
/// Native computed spans carry exact epoch milliseconds and optional original
/// pause length through later clipping. There is deliberately no Deserialize.
#[derive(Debug, Clone)]
pub struct YouthSpan {
    pub(super) start_milliseconds: i64,
    pub(super) end_milliseconds: i64,
    pub(super) original_minutes: Option<f64>,
}
impl YouthSpan {
    pub fn start_epoch_milliseconds(&self) -> i64 {
        self.start_milliseconds
    }
    pub fn end_epoch_milliseconds(&self) -> i64 {
        self.end_milliseconds
    }
    pub fn original_minutes(&self) -> Option<f64> {
        self.original_minutes
    }
    pub fn to_json(&self) -> Value {
        let mut value = json!({"start":self.start_milliseconds,"end":self.end_milliseconds});
        if let Some(minutes) = self.original_minutes {
            value
                .as_object_mut()
                .expect("constructed span")
                .insert("originalMinutes".into(), json!(minutes));
        }
        value
    }
}
pub(super) fn plain(start: i64, end: i64) -> YouthSpan {
    YouthSpan {
        start_milliseconds: start,
        end_milliseconds: end,
        original_minutes: None,
    }
}
pub(super) fn work_spans(entry: &YouthEntry, minimum_pause: f64) -> Vec<YouthSpan> {
    let mut spans = Vec::new();
    let mut start = entry.start_milliseconds;
    for pause in entry.pauses.as_deref().unwrap_or_default() {
        if pause
            .original_minutes
            .unwrap_or((pause.end_milliseconds - pause.start_milliseconds) as f64 / 60000.0)
            < minimum_pause
        {
            continue;
        }
        if pause.start_milliseconds > start {
            spans.push(plain(start, pause.start_milliseconds));
        }
        start = pause.end_milliseconds;
    }
    if start < entry.end_milliseconds {
        spans.push(plain(start, entry.end_milliseconds));
    }
    spans
}
pub fn union_minutes(spans: &[YouthSpan]) -> f64 {
    let mut sorted = spans.iter().collect::<Vec<_>>();
    sorted.sort_by_key(|s| s.start_milliseconds);
    let mut total = 0.0;
    let mut end = f64::NEG_INFINITY;
    for span in sorted {
        let a = span.start_milliseconds as f64;
        let b = span.end_milliseconds as f64;
        total += (b - a.max(end)).max(0.0);
        end = end.max(b);
    }
    total / 60000.0
}
pub fn clock_minutes(instant: i64, zone: &str) -> Result<i64, TrainingError> {
    let z = Timestamp::from_millisecond(instant)
        .map_err(|_| helpers::temporal())?
        .to_zoned(time::zone(zone).map_err(|_| helpers::temporal())?);
    Ok(i64::from(z.hour()) * 60 + i64::from(z.minute()))
}
pub fn week_start(date: &str) -> Result<String, TrainingError> {
    let d = parse_date(date).map_err(|_| helpers::temporal())?;
    d.checked_sub((i64::from(d.weekday().to_monday_one_offset()) - 1).days())
        .map(|d| d.to_string())
        .map_err(|_| helpers::temporal())
}
