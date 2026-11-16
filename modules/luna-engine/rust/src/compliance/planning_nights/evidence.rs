//! Night evidence uses the same conservative IEEE arithmetic as the frozen source.
use crate::compliance::{
    average::add_days,
    model::{ComplianceError, ComplianceInterval, text},
    policy,
};
use crate::{EngineError, calendar::parse_date, time};
use jiff::{
    civil::Time,
    tz::{Disambiguation, TimeZone},
};
use std::collections::{BTreeMap, BTreeSet};
pub(super) fn minute(zoned: &jiff::Zoned) -> f64 {
    zoned.timestamp().as_millisecond() as f64 / 60_000.0
}
pub(super) struct Night {
    pub date: String,
    pub work: Vec<usize>,
}
pub(super) struct WindowCache {
    zone: TimeZone,
    values: BTreeMap<String, (f64, f64)>,
}
impl WindowCache {
    pub fn new(time_zone: &str) -> Result<Self, ComplianceError> {
        Ok(Self {
            zone: time::zone(time_zone)?,
            values: BTreeMap::new(),
        })
    }
    pub fn get(&mut self, date: &str) -> Result<(f64, f64), ComplianceError> {
        if let Some(value) = self.values.get(date) {
            return Ok(*value);
        }
        let day = parse_date(date)?;
        let at = |day: jiff::civil::Date, clock: i64| -> Result<f64, ComplianceError> {
            let clock = Time::new((clock / 60) as i8, (clock % 60) as i8, 0, 0)
                .map_err(|_| EngineError::InvalidTime)?;
            self.zone
                .to_ambiguous_zoned(day.to_datetime(clock))
                .disambiguate(Disambiguation::Compatible)
                .map(|z| minute(&z))
                .map_err(|_| EngineError::InvalidTime.into())
        };
        let value = (
            at(day, policy::NIGHT_START_MINUTE)?,
            at(add_days(day, 1)?, policy::NIGHT_END_MINUTE)?,
        );
        self.values.insert(date.into(), value);
        Ok(value)
    }
}
pub(super) struct Evidence<'a> {
    pub work: Vec<&'a ComplianceInterval>,
    pub blocks: Vec<Vec<Night>>,
    pub uncertain: BTreeSet<String>,
    pub ambiguous: BTreeSet<usize>,
    pub windows: WindowCache,
}
fn unambiguous(item: &ComplianceInterval) -> bool {
    for (field, zoned) in [("startTime", &item.start), ("endTime", &item.end)] {
        let Some(clock) = item
            .shift
            .get(field)
            .and_then(serde_json::Value::as_str)
            .filter(|s| !s.is_empty())
        else {
            return false;
        };
        let Ok(clock) = clock.parse::<Time>() else {
            return false;
        };
        if clock.hour() != zoned.time().hour()
            || clock.minute() != zoned.time().minute()
            || zoned
                .time_zone()
                .to_ambiguous_zoned(zoned.date().to_datetime(zoned.time()))
                .disambiguate(Disambiguation::Reject)
                .is_err()
        {
            return false;
        }
    }
    true
}
fn merged_minutes(mut ranges: Vec<(f64, f64)>) -> f64 {
    ranges.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut through = f64::NEG_INFINITY;
    let mut total = 0.0;
    for (start, end) in ranges {
        total += (end - start.max(through)).max(0.0);
        through = through.max(end);
    }
    total
}
pub(super) fn prepare<'a>(
    intervals: &'a [ComplianceInterval],
    time_zone: &str,
) -> Result<Evidence<'a>, ComplianceError> {
    let mut work: Vec<&ComplianceInterval> = vec![];
    let mut positions = BTreeMap::<(i64, i64), usize>::new();
    for item in intervals {
        if !item.gross_minutes.is_finite() || !item.net_minutes.is_finite() {
            return Err(ComplianceError::InvalidInput);
        }
        let key = (
            item.start.timestamp().as_millisecond(),
            item.end.timestamp().as_millisecond(),
        );
        if let Some(index) = positions.get(&key) {
            if item.net_minutes < work[*index].net_minutes {
                work[*index] = item;
            }
        } else {
            positions.insert(key, work.len());
            work.push(item);
        }
    }
    // Stable ordering retains original evidence when different intervals start together.
    work.sort_by_key(|item| item.start.timestamp());
    let mut windows = WindowCache::new(time_zone)?;
    let mut by_date = BTreeMap::<String, Vec<usize>>::new();
    let mut uncertain = BTreeSet::new();
    let mut ambiguous = BTreeSet::new();
    for (index, item) in work.iter().enumerate() {
        let known = unambiguous(item);
        if !known {
            ambiguous.insert(index);
        }
        let mut day = add_days(item.start.date(), -1)?;
        let last = item.end.date();
        while day <= last {
            let date = day.to_string();
            let (start, end) = windows.get(&date)?;
            if minute(&item.start) < end && minute(&item.end) > start {
                let entries = by_date.entry(date.clone()).or_default();
                if known {
                    entries.push(index);
                } else {
                    uncertain.insert(date);
                }
            }
            if day == last {
                break;
            }
            day = add_days(day, 1)?;
        }
    }
    let mut qualified = vec![];
    for (date, indexes) in by_date {
        let (start, end) = windows.get(&date)?;
        let overlap = merged_minutes(
            indexes
                .iter()
                .map(|i| {
                    (
                        start.max(minute(&work[*i].start)),
                        end.min(minute(&work[*i].end)),
                    )
                })
                .collect(),
        );
        let breaks = indexes.iter().fold(0.0, |sum, i| {
            sum + (work[*i].gross_minutes - work[*i].net_minutes).max(0.0)
        });
        let minimum = (overlap - breaks).max(0.0);
        let maximum = overlap.min(
            indexes
                .iter()
                .fold(0.0, |sum, i| sum + work[*i].net_minutes),
        );
        if minimum > policy::NIGHT_THRESHOLD_MINUTES as f64 {
            qualified.push(Night {
                date,
                work: indexes,
            });
        } else if maximum > policy::NIGHT_THRESHOLD_MINUTES as f64 {
            uncertain.insert(date);
        }
    }
    let mut blocks: Vec<Vec<Night>> = vec![];
    for night in qualified {
        let continues = blocks
            .last()
            .and_then(|b| b.last())
            .map(|last| add_days(parse_date(&last.date)?, 1).map(|d| d.to_string() == night.date))
            .transpose()?
            .unwrap_or(false);
        if continues {
            blocks
                .last_mut()
                .ok_or(ComplianceError::InvalidInput)?
                .push(night);
        } else {
            blocks.push(vec![night]);
        }
    }
    Ok(Evidence {
        work,
        blocks,
        uncertain,
        ambiguous,
        windows,
    })
}
pub(super) fn has_overlap(work: &[&ComplianceInterval], from: f64, through: f64) -> bool {
    let mut end = f64::NEG_INFINITY;
    for item in work {
        if minute(&item.end) <= from || minute(&item.start) >= through {
            continue;
        }
        if minute(&item.start) < end {
            return true;
        }
        end = end.max(minute(&item.end));
    }
    false
}
pub(super) fn unresolved(
    shifts: &[serde_json::Value],
    from: &str,
    through: &str,
) -> Result<bool, ComplianceError> {
    for shift in shifts {
        if shift.get("deletedAt") != Some(&serde_json::Value::Null)
            || !matches!(
                shift.get("type").and_then(serde_json::Value::as_str),
                Some("EARLY" | "LATE" | "NIGHT" | "DAY" | "TRAINING" | "CUSTOM")
            )
        {
            continue;
        }
        let on_call = shift
            .get("specialDuty")
            .is_some_and(|d| d["kind"] == "ON_CALL");
        let all_day = shift.get("allDay") == Some(&serde_json::Value::Bool(true));
        let start = shift
            .get("startTime")
            .is_some_and(super::super::holiday_coverage::truthy);
        let end = shift
            .get("endTime")
            .is_some_and(super::super::holiday_coverage::truthy);
        if !on_call && !all_day && start && end {
            continue;
        }
        let date = text(shift, "date")?;
        let end_day = match shift.get("specialDuty").and_then(|d| d.get("endDay")) {
            None | Some(serde_json::Value::Null) => 1,
            Some(_) => super::super::model::integer(&shift["specialDuty"], "endDay")?,
        };
        let until = add_days(parse_date(date)?, end_day)?.to_string();
        if date <= through && until.as_str() >= from {
            return Ok(true);
        }
    }
    Ok(false)
}
