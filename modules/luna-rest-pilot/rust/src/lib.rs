//! Numeric rest kernel for the explicitly invoked native Preview comparison.
//! The normal application calculation does not call this pilot.
mod ffi;
mod year;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Day {
    pub day: i32,
    pub date: String,
    pub start_ms: i64,
    pub end_ms: i64,
}

fn nullable<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Shift {
    pub id: String,
    pub date: String,
    #[serde(rename = "type")]
    pub shift_type: String,
    #[serde(deserialize_with = "nullable")]
    pub start_time: Option<String>,
    #[serde(deserialize_with = "nullable")]
    pub end_time: Option<String>,
    #[serde(deserialize_with = "nullable")]
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Interval {
    pub shift_id: String,
    pub start_ms: i64,
    pub end_ms: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub schema_version: u32,
    pub id: String,
    pub month: String,
    pub time_zone: String,
    pub coverage_start: i32,
    pub coverage_end: i32,
    pub sunday_period_days: i32,
    pub holiday_period_days: i32,
    pub required_rest_minutes: i64,
    pub evidence_shift_type: String,
    pub days: Vec<Day>,
    pub holidays: Vec<i32>,
    pub shifts: Vec<Shift>,
    pub intervals: Vec<Interval>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ObligationKind {
    Sunday,
    WeekdayHoliday,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkDate {
    pub day: i32,
    pub shift_ids: Vec<String>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Obligation {
    pub kind: ObligationKind,
    pub day: i32,
    pub window_start: i32,
    pub window_end: i32,
    pub shift_ids: Vec<String>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub day: i32,
    pub evidence_shift_ids: Vec<String>,
    pub observed_rest_minutes: Option<i64>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Match {
    pub obligation_index: usize,
    pub candidate_index: usize,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Output {
    pub work_dates: Vec<WorkDate>,
    pub obligations: Vec<Obligation>,
    pub candidate_dates: Vec<i32>,
    pub candidates: Vec<Candidate>,
    pub matched: Vec<Match>,
    pub unmatched: Vec<usize>,
}

fn epoch_day(value: &str) -> Result<i32, String> {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || !value.is_ascii() || bytes[4] != b'-' || bytes[7] != b'-' {
        return Err("invalid ISO date".into());
    }
    let year: i32 = value[0..4].parse().map_err(|_| "invalid year")?;
    let month: usize = value[5..7].parse().map_err(|_| "invalid month")?;
    let day: i32 = value[8..10].parse().map_err(|_| "invalid day")?;
    if !(1900..=4099).contains(&year) || !(1..=12).contains(&month) {
        return Err("unsupported calendar date".into());
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let lengths = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    if day < 1 || day > lengths[month - 1] {
        return Err("invalid day of month".into());
    }
    let leaps_before = |y: i32| (y - 1) / 4 - (y - 1) / 100 + (y - 1) / 400;
    Ok(
        365 * (year - 1970) + leaps_before(year) - leaps_before(1970)
            + lengths[..month - 1].iter().sum::<i32>()
            + day
            - 1,
    )
}

pub fn validate(request: &Request) -> Result<(), String> {
    if request.schema_version != 1
        || request.id.is_empty()
        || request.time_zone.is_empty()
        || request.month.len() != 7
        || epoch_day(&format!("{}-01", request.month)).is_err()
    {
        return Err("invalid request identity or protocol".into());
    }
    if request.days.is_empty()
        || request.days.len() > 4000
        || request.intervals.len() > 100_000
        || request.shifts.len() > 100_000
        || request.coverage_start > request.coverage_end
        || !(1..=366).contains(&request.sunday_period_days)
        || !(1..=366).contains(&request.holiday_period_days)
        || !(0..=MAX_SAFE_INTEGER).contains(&request.required_rest_minutes)
    {
        return Err("invalid coverage or rest parameters".into());
    }
    let safe = |number: i64| (-MAX_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(&number);
    for (index, day) in request.days.iter().enumerate() {
        if epoch_day(&day.date)? != day.day
            || !safe(day.start_ms)
            || !safe(day.end_ms)
            || day.start_ms >= day.end_ms
            || (index > 0
                && (day.day != request.days[index - 1].day + 1
                    || day.start_ms != request.days[index - 1].end_ms))
        {
            return Err("invalid day table".into());
        }
    }
    let first = &request.days[0];
    let last = &request.days[request.days.len() - 1];
    if request.coverage_start < first.day || request.coverage_end > last.day {
        return Err("coverage exceeds day table".into());
    }
    let mut ids = HashSet::new();
    for shift in &request.shifts {
        epoch_day(&shift.date)?;
        if shift.id.is_empty() || !ids.insert(shift.id.as_str()) {
            return Err("invalid shift identity".into());
        }
    }
    let mut previous_start = i64::MIN;
    for interval in &request.intervals {
        if !ids.contains(interval.shift_id.as_str())
            || !safe(interval.start_ms)
            || !safe(interval.end_ms)
            || interval.start_ms >= interval.end_ms
            || interval.start_ms < previous_start
            || interval.start_ms < first.start_ms
            || interval.end_ms > last.end_ms
        {
            return Err("invalid or unsorted interval".into());
        }
        previous_start = interval.start_ms;
    }
    Ok(())
}

/// Caller validates the immutable request before timing repeated kernel work.
pub fn calculate(request: &Request) -> Output {
    let is_sunday = |day: i32| (day + 4).rem_euclid(7) == 0;
    let holidays: HashSet<i32> = request.holidays.iter().copied().collect();
    let mut work: HashMap<i32, Vec<String>> = HashMap::new();
    for interval in &request.intervals {
        let start = request
            .days
            .partition_point(|day| day.end_ms <= interval.start_ms);
        for day in &request.days[start..] {
            if day.start_ms >= interval.end_ms {
                break;
            }
            work.entry(day.day)
                .or_default()
                .push(interval.shift_id.clone());
        }
    }
    let mut obligations = Vec::new();
    for (&day, shift_ids) in &work {
        let sunday = is_sunday(day);
        if !sunday && !holidays.contains(&day) {
            continue;
        }
        let reach = if sunday {
            request.sunday_period_days
        } else {
            request.holiday_period_days
        } - 1;
        obligations.push(Obligation {
            kind: if sunday {
                ObligationKind::Sunday
            } else {
                ObligationKind::WeekdayHoliday
            },
            day,
            window_start: day - reach,
            window_end: day + reach,
            shift_ids: shift_ids.clone(),
        });
    }
    obligations.sort_by_key(|item| (item.window_end, item.day, item.kind));
    let mut possible = HashSet::new();
    for item in &obligations {
        for day in item.window_start.max(request.coverage_start)
            ..=item.window_end.min(request.coverage_end)
        {
            if !is_sunday(day) {
                possible.insert(day);
            }
        }
    }
    let mut candidate_dates: Vec<i32> = possible.into_iter().collect();
    candidate_dates.sort_unstable();
    let mut entries: HashMap<&str, Vec<&Shift>> = HashMap::new();
    for shift in &request.shifts {
        if shift.deleted_at.is_none() {
            entries.entry(&shift.date).or_default().push(shift);
        }
    }
    let mut candidates = Vec::new();
    for &day in &candidate_dates {
        if holidays.contains(&day) || work.contains_key(&day) {
            continue;
        }
        let boundary = &request.days[(day - request.days[0].day) as usize];
        let evidence = entries
            .get(boundary.date.as_str())
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        if evidence.iter().any(|entry| {
            entry.shift_type != request.evidence_shift_type
                || entry.start_time.is_some()
                || entry.end_time.is_some()
        }) {
            continue;
        }
        let mut previous_end: Option<i64> = None;
        let mut next_start: Option<i64> = None;
        for interval in &request.intervals {
            if interval.end_ms <= boundary.start_ms {
                previous_end =
                    Some(previous_end.map_or(interval.end_ms, |value| value.max(interval.end_ms)));
                continue;
            }
            if interval.start_ms >= boundary.end_ms {
                next_start = Some(interval.start_ms);
                break;
            }
        }
        candidates.push(Candidate {
            day,
            evidence_shift_ids: evidence.iter().map(|item| item.id.clone()).collect(),
            observed_rest_minutes: previous_end
                .zip(next_start)
                .map(|(before, after)| (after - before + 30_000) / 60_000),
        });
    }
    let qualities: Vec<u8> = candidates
        .iter()
        .map(|item| match item.observed_rest_minutes {
            None => 2,
            Some(value) if value >= request.required_rest_minutes => 0,
            Some(_) => 1,
        })
        .collect();
    let mut available = vec![true; candidates.len()];
    let mut matched = Vec::new();
    let mut unmatched = Vec::new();
    for (obligation_index, item) in obligations.iter().enumerate() {
        let best = candidates
            .iter()
            .enumerate()
            .filter(|(index, candidate)| {
                available[*index]
                    && candidate.day >= item.window_start
                    && candidate.day <= item.window_end
            })
            .min_by_key(|(index, candidate)| {
                (
                    qualities[*index],
                    (candidate.day - item.day).abs(),
                    candidate.day,
                )
            })
            .map(|(index, _)| index);
        if let Some(candidate_index) = best {
            available[candidate_index] = false;
            matched.push(Match {
                obligation_index,
                candidate_index,
            });
        } else {
            unmatched.push(obligation_index);
        }
    }
    let mut work_dates: Vec<WorkDate> = work
        .into_iter()
        .map(|(day, shift_ids)| WorkDate { day, shift_ids })
        .collect();
    work_dates.sort_by_key(|item| item.day);
    Output {
        work_dates,
        obligations,
        candidate_dates,
        candidates,
        matched,
        unmatched,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calendar_day_arithmetic_handles_leaps_and_negative_epochs() {
        assert_eq!(epoch_day("1970-01-01"), Ok(0));
        assert_eq!(epoch_day("1969-12-31"), Ok(-1));
        assert_eq!(
            epoch_day("2000-03-01").unwrap() - epoch_day("2000-02-28").unwrap(),
            2
        );
        assert!(epoch_day("1900-02-29").is_err());
        assert!(epoch_day("2026-02-30").is_err());
        assert!(epoch_day("20ä6-01-01").is_err());
    }

    #[test]
    fn nullable_shift_fields_are_required_in_the_protocol() {
        assert!(
            serde_json::from_str::<Shift>(r#"{"id":"a","date":"2026-01-01","type":"FREE"}"#)
                .is_err()
        );
    }
}
