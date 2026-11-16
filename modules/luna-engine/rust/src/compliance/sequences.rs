use super::model::{ComplianceError, ComplianceInterval, minutes_between, text};
use crate::{EngineError, calendar::parse_date};
use jiff::{ToSpan, Zoned};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

pub struct RestPeriod<'a> {
    pub current: &'a ComplianceInterval,
    pub next: &'a ComplianceInterval,
    pub minutes: f64,
}
impl RestPeriod<'_> {
    pub fn to_json(&self) -> Value {
        json!({"current":self.current.to_json(),"next":self.next.to_json(),"minutes":self.minutes})
    }
}
pub fn rest_periods(
    intervals: &[ComplianceInterval],
) -> Result<Vec<RestPeriod<'_>>, ComplianceError> {
    let mut dates = BTreeMap::<&str, Vec<&ComplianceInterval>>::new();
    for interval in intervals {
        dates
            .entry(text(&interval.shift, "date")?)
            .or_default()
            .push(interval);
    }
    let mut boundaries = Vec::new();
    for entries in dates.values() {
        let mut earliest = entries[0];
        let mut latest = entries[0];
        for item in &entries[1..] {
            if item.start.timestamp() < earliest.start.timestamp() {
                earliest = item;
            }
            if item.end.timestamp() > latest.end.timestamp() {
                latest = item;
            }
        }
        boundaries.push((earliest, latest));
    }
    boundaries
        .windows(2)
        .map(|pair| {
            let current = pair[0].1;
            let next = pair[1].0;
            Ok(RestPeriod {
                current,
                next,
                minutes: minutes_between(&current.end, &next.start)?,
            })
        })
        .collect()
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestDeviation {
    pub minimum_minutes: i64,
    pub compensation_minutes: i64,
    pub compensation_within_days: i64,
    #[serde(default)]
    pub compensation_within_calendar_months: Option<i64>,
}
pub fn compensation_deadline(
    start: &Zoned,
    deviation: &RestDeviation,
) -> Result<Zoned, ComplianceError> {
    let day = start
        .checked_add(deviation.compensation_within_days.days())
        .map_err(|_| EngineError::InvalidDate)?;
    let month = start
        .checked_add(
            deviation
                .compensation_within_calendar_months
                .unwrap_or(0)
                .months(),
        )
        .map_err(|_| EngineError::InvalidDate)?;
    Ok(if day.timestamp() >= month.timestamp() {
        day
    } else {
        month
    })
}
pub fn compensated_short_rest_indexes(
    periods: &[RestPeriod<'_>],
    deviation: Option<&RestDeviation>,
    default_minutes: i64,
) -> Result<BTreeSet<usize>, ComplianceError> {
    let mut compensated = BTreeSet::new();
    let Some(deviation) = deviation else {
        return Ok(compensated);
    };
    let mut used = BTreeSet::new();
    for (short_index, short) in periods.iter().enumerate() {
        if short.minutes < deviation.minimum_minutes as f64
            || short.minutes >= default_minutes as f64
        {
            continue;
        }
        let deadline = compensation_deadline(&short.next.start, deviation)?;
        for (candidate_index, candidate) in periods.iter().enumerate().skip(short_index + 1) {
            if used.contains(&candidate_index)
                || candidate.minutes < deviation.compensation_minutes as f64
            {
                continue;
            }
            let completed = candidate
                .current
                .end
                .checked_add(deviation.compensation_minutes.minutes())
                .map_err(|_| EngineError::InvalidDate)?;
            if completed.timestamp() > deadline.timestamp() {
                break;
            }
            compensated.insert(short_index);
            used.insert(candidate_index);
            break;
        }
    }
    Ok(compensated)
}
pub fn consecutive_date_streaks(
    shifts: &[Arc<Value>],
) -> Result<Vec<Vec<Arc<Value>>>, ComplianceError> {
    let mut unique = BTreeMap::new();
    for shift in shifts {
        unique.insert(text(shift, "date")?, Arc::clone(shift));
    }
    let mut streaks = Vec::new();
    let mut streak: Vec<Arc<Value>> = Vec::new();
    for (date, shift) in unique {
        if let Some(previous) = streak.last() {
            let previous = parse_date(text(previous, "date")?)?;
            let expected = previous
                .checked_add(1.days())
                .map_err(|_| EngineError::InvalidDate)?;
            if parse_date(date)? != expected {
                streaks.push(std::mem::take(&mut streak));
            }
        }
        streak.push(shift);
    }
    if !streak.is_empty() {
        streaks.push(streak);
    }
    Ok(streaks)
}
