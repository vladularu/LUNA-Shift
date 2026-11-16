//! Audited pure pilot kernel, copied into the full engine without its FFI/runtime.
//! Original calculate body SHA-256: e027b6b642170b32534bc8178ab394e41938c813237dd2f721d390746be12355
//! All inputs are Rust-created; this module has no Deserialize or host-wire constructor.
use serde::Serialize;
use std::collections::{HashMap, HashSet};
#[derive(Debug)]
pub(super) struct Day {
    pub day: i32,
    pub date: String,
    pub start_ms: i64,
    pub end_ms: i64,
}
#[derive(Debug)]
pub(super) struct Shift {
    pub id: String,
    pub date: String,
    pub shift_type: String,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub deleted_at: Option<String>,
}
#[derive(Debug)]
pub(super) struct Interval {
    pub shift_id: String,
    pub start_ms: i64,
    pub end_ms: i64,
}
pub(super) struct Request {
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
pub(super) enum ObligationKind {
    Sunday,
    WeekdayHoliday,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkDate {
    pub day: i32,
    pub shift_ids: Vec<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Obligation {
    pub kind: ObligationKind,
    pub day: i32,
    pub window_start: i32,
    pub window_end: i32,
    pub shift_ids: Vec<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Candidate {
    pub day: i32,
    pub evidence_shift_ids: Vec<String>,
    pub observed_rest_minutes: Option<i64>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Match {
    pub obligation_index: usize,
    pub candidate_index: usize,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Output {
    pub work_dates: Vec<WorkDate>,
    pub obligations: Vec<Obligation>,
    pub candidate_dates: Vec<i32>,
    pub candidates: Vec<Candidate>,
    pub matched: Vec<Match>,
    pub unmatched: Vec<usize>,
}
pub(super) fn calculate(request: &Request) -> Output {
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
    use serde_json::Value;
    fn s(v: &Value, k: &str) -> String {
        v[k].as_str().unwrap().into()
    }
    fn n(v: &Value, k: &str) -> i64 {
        v[k].as_i64().unwrap()
    }
    fn optional(v: &Value, k: &str) -> Option<String> {
        v[k].as_str().map(str::to_owned)
    }
    #[test]
    fn copied_kernel_replays_all_24_preexisting_pilot_requests() {
        let g: Value = serde_json::from_str(include_str!(
            "../../../reference/compliance-rest-golden.json"
        ))
        .unwrap();
        let p = &g["pilot"];
        let pools = &p["pools"];
        let mut count = 0;
        for c in p["cases"].as_array().unwrap() {
            for (index, v) in c["requests"].as_array().unwrap().iter().enumerate() {
                let rows = |key: &str| {
                    v[key]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|i| &pools[key][i.as_u64().unwrap() as usize])
                        .collect::<Vec<_>>()
                };
                let request = Request {
                    coverage_start: n(v, "coverageStart") as i32,
                    coverage_end: n(v, "coverageEnd") as i32,
                    sunday_period_days: n(v, "sundayPeriodDays") as i32,
                    holiday_period_days: n(v, "holidayPeriodDays") as i32,
                    required_rest_minutes: n(v, "requiredRestMinutes"),
                    evidence_shift_type: s(v, "evidenceShiftType"),
                    days: rows("days")
                        .into_iter()
                        .map(|d| Day {
                            day: n(d, "day") as i32,
                            date: s(d, "date"),
                            start_ms: n(d, "startMs"),
                            end_ms: n(d, "endMs"),
                        })
                        .collect(),
                    holidays: v["holidays"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|i| i.as_i64().unwrap() as i32)
                        .collect(),
                    shifts: rows("shifts")
                        .into_iter()
                        .map(|d| Shift {
                            id: s(d, "id"),
                            date: s(d, "date"),
                            shift_type: s(d, "type"),
                            start_time: optional(d, "startTime"),
                            end_time: optional(d, "endTime"),
                            deleted_at: optional(d, "deletedAt"),
                        })
                        .collect(),
                    intervals: rows("intervals")
                        .into_iter()
                        .map(|d| Interval {
                            shift_id: s(d, "shiftId"),
                            start_ms: n(d, "startMs"),
                            end_ms: n(d, "endMs"),
                        })
                        .collect(),
                };
                let result = serde_json::to_value(calculate(&request)).unwrap();
                let expected = &pools["results"][c["expected"][index].as_u64().unwrap() as usize];
                assert_eq!(&result, expected, "{}", v["id"]);
                count += 1;
            }
        }
        assert_eq!(count, 24);
    }
}
