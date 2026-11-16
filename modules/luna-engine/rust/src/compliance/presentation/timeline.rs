use super::{PresentationError, dates, facts, legacy, number_text, summary, text};
use crate::calendar::recurrence::CollationRanks;
use crate::time::{self, ShiftTime, TimedShiftBounds};
use jiff::{Timestamp, ToSpan};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

fn special(shift: &Value) -> bool {
    crate::credit::summary::truthy(shift.get("specialDuty"))
}
fn numeric(value: f64) -> Value {
    if value.is_finite() {
        serde_json::from_str(&number_text(value)).unwrap_or(Value::Null)
    } else {
        Value::Null
    }
}
fn bounds(shift: &Value, zone: &str) -> Option<TimedShiftBounds> {
    if crate::credit::summary::truthy(shift.get("allDay")) {
        return None;
    }
    let raw = ShiftTime {
        date: dates::parse(shift["date"].as_str()?)?.to_string(),
        start_time: Some(shift["startTime"].as_str()?.into()),
        end_time: Some(shift["endTime"].as_str()?.into()),
        break_minutes: 0,
        all_day: false,
        special_duty: None,
    };
    // The presentation only reads rounded time bounds; it must not reject a
    // fractional projected pause whose unused netMinutes would be fractional.
    time::shift_bounds(&raw, zone).ok().flatten()
}
fn zoned(minute: i64, zone: &str) -> Option<jiff::Zoned> {
    let zone = time::zone(zone).ok()?;
    Some(
        Timestamp::from_millisecond(minute.checked_mul(60_000)?)
            .ok()?
            .to_zoned(zone),
    )
}
fn local_date(minute: i64, zone: &str) -> Option<String> {
    Some(zoned(minute, zone)?.date().to_string())
}
fn duty_period(shifts: &[&Value], zone: &str) -> Option<Value> {
    let mut entries = Vec::new();
    for &shift in shifts {
        if special(shift) {
            return None;
        }
        let bounds = bounds(shift, zone)?;
        if bounds.gross_minutes <= 0 {
            return None;
        }
        let start = zoned(bounds.start_epoch_minutes, zone)?;
        let end = zoned(bounds.end_epoch_minutes, zone)?;
        let clock =
            |date: &jiff::Zoned| format!("{:02}:{:02}", date.time().hour(), date.time().minute());
        if clock(&start) != text(shift, "startTime") || clock(&end) != text(shift, "endTime") {
            return None;
        }
        entries.push((bounds, start, end));
    }
    let first = entries
        .iter()
        .min_by_key(|entry| entry.0.start_epoch_minutes)?;
    // JS reduce retains the first row for equal extrema.
    let last = entries
        .iter()
        .enumerate()
        .max_by_key(|(index, entry)| (entry.0.end_epoch_minutes, std::cmp::Reverse(*index)))?
        .1;
    Some(
        json!({"fromDate":first.1.date().to_string(),"fromTime":format!("{:02}:{:02}",first.1.time().hour(),first.1.time().minute()),"untilDate":last.2.date().to_string(),"untilTime":format!("{:02}:{:02}",last.2.time().hour(),last.2.time().minute())}),
    )
}
pub fn collation_candidates(shifts: &[Value]) -> Result<BTreeSet<String>, PresentationError> {
    let mut result = BTreeSet::new();
    for shift in shifts {
        result.insert(shift["date"].as_str().ok_or(PresentationError)?.to_owned());
        result.insert(shift["id"].as_str().ok_or(PresentationError)?.to_owned());
        result.insert(shift["startTime"].as_str().unwrap_or("").to_owned());
    }
    Ok(result)
}
pub fn prepare(
    issue: &Value,
    shifts: &[Value],
    time_zone: &str,
    collation: &CollationRanks,
) -> Result<Value, PresentationError> {
    TimelineSource::new(shifts).prepare(issue, time_zone, collation)
}
/// One borrowed raw-entry index per native presentation request. It has no
/// Deserialize/ready-input path and never copies unrelated metadata trees.
pub struct TimelineSource<'a> {
    shifts: &'a [Value],
    by_id: BTreeMap<&'a str, Vec<usize>>,
}
impl<'a> TimelineSource<'a> {
    pub fn new(shifts: &'a [Value]) -> Self {
        let mut by_id: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
        for (index, shift) in shifts.iter().enumerate() {
            if let Some(id) = shift["id"].as_str() {
                by_id.entry(id).or_default().push(index);
            }
        }
        Self { shifts, by_id }
    }
    pub fn prepare(
        &self,
        issue: &Value,
        time_zone: &str,
        collation: &CollationRanks,
    ) -> Result<Value, PresentationError> {
        let ids = issue["relatedShiftIds"]
            .as_array()
            .ok_or(PresentationError)?;
        let mut positions = BTreeSet::new();
        for id in ids {
            let id = id.as_str().ok_or(PresentationError)?;
            if let Some(indices) = self.by_id.get(id) {
                positions.extend(indices.iter().copied());
            }
        }
        let matching = positions
            .into_iter()
            .map(|index| &self.shifts[index])
            .collect::<Vec<_>>();
        prepare_related(issue, &matching, time_zone, collation)
    }
}
fn prepare_related(
    issue: &Value,
    shifts: &[&Value],
    time_zone: &str,
    collation: &CollationRanks,
) -> Result<Value, PresentationError> {
    let ids = issue["relatedShiftIds"]
        .as_array()
        .ok_or(PresentationError)?
        .iter()
        .map(|value| value.as_str().ok_or(PresentationError))
        .collect::<Result<BTreeSet<_>, _>>()?;
    let mut ranked = Vec::new();
    for &shift in shifts {
        if shift.get("deletedAt") == Some(&Value::Null)
            && shift["id"].as_str().is_some_and(|id| ids.contains(id))
        {
            let rank = |value: &str| collation.rank(value).map_err(|_| PresentationError);
            ranked.push((
                shift,
                (
                    rank(shift["date"].as_str().ok_or(PresentationError)?)?,
                    rank(shift["startTime"].as_str().unwrap_or(""))?,
                    rank(shift["id"].as_str().ok_or(PresentationError)?)?,
                ),
            ));
        }
    }
    ranked.sort_by_key(|row| row.1);
    let related = ranked.into_iter().map(|row| row.0).collect::<Vec<_>>();
    let missing = related.len() != ids.len();
    let facts = facts::valid(&issue["facts"], text(issue, "rule"));
    let sequence = facts
        .filter(|f| {
            matches!(
                text(f, "rule"),
                "PLANNING_NIGHT_SERIES" | "PLANNING_NIGHT_RECOVERY"
            )
        })
        .and_then(|f| f.get("nightSequence"));
    let endpoints = related
        .iter()
        .copied()
        .filter(|shift| {
            sequence.is_none_or(|sequence| {
                shift["id"] == sequence["lastShiftId"] || shift["id"] == sequence["nextShiftId"]
            })
        })
        .collect::<Vec<_>>();
    let mut rest = Value::Null;
    if (matches!(
        text(issue, "rule"),
        "ARBZG_5_REST_10H" | "ARBZG_5_REST_11H" | "JARBSCHG_13_REST" | "PLANNING_LATE_EARLY"
    ) || sequence.is_some_and(|s| !s["restMinutes"].is_null()))
        && !missing
        && endpoints.len() == 2
        && !endpoints.iter().any(|shift| special(shift))
    {
        let mut ordered = endpoints
            .iter()
            .filter_map(|&shift| Some((shift, bounds(shift, time_zone)?)))
            .collect::<Vec<_>>();
        ordered.sort_by_key(|entry| entry.1.start_epoch_minutes);
        if ordered.len() == 2 {
            let ((previous, p), (next, n)) = (&ordered[0], &ordered[1]);
            let minutes = n.start_epoch_minutes - p.end_epoch_minutes;
            if minutes >= 0
                && let Some((end, start)) = local_date(p.end_epoch_minutes, time_zone)
                    .zip(local_date(n.start_epoch_minutes, time_zone))
            {
                rest = json!({"previous":previous,"next":next,"minutes":minutes,"endDate":end,"startDate":start});
            }
        }
    }
    let historical = issue.get("facts").is_none();
    let count = if historical {
        legacy::count(issue)
    } else {
        facts
            .filter(|facts| {
                matches!(
                    text(facts, "rule"),
                    "PLANNING_7_DAYS" | "PLANNING_NIGHT_SERIES"
                )
            })
            .and_then(|f| f["count"].as_f64())
    };
    let mut series = Value::Null;
    if let Some(count) = count {
        let mut days = related
            .iter()
            .map(|shift| text(shift, "date"))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        days.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
        let mut complete = !missing && days.len() as f64 == count;
        for (index, date) in days.iter().enumerate() {
            if dates::parse(date).is_none()
                || index > 0
                    && dates::parse(days[index - 1])
                        .and_then(|day| day.checked_add(1.days()).ok())
                        .is_none_or(|day| day.to_string() != *date)
            {
                complete = false;
            }
        }
        let unit = if issue["rule"] == "PLANNING_7_DAYS" {
            "Diensttage"
        } else if sequence.is_some() {
            "Nächte"
        } else {
            "Nachtdienste"
        };
        series = json!({"count":numeric(count),"unit":unit});
        if let Some(sequence) = sequence.filter(|_| !missing) {
            series["from"] = sequence["firstNight"].clone();
            series["until"] = sequence["lastNight"].clone();
        } else if complete {
            if let Some(first) = days.first() {
                series["from"] = json!(first);
            }
            if let Some(last) = days.last() {
                series["until"] = json!(last);
            }
        } else {
            series["from"] = Value::Null;
            series["until"] = Value::Null;
        }
        if complete
            && issue["rule"] == "PLANNING_7_DAYS"
            && let Some(period) = duty_period(&related, time_zone)
        {
            series["dutyPeriod"] = period;
        }
    }
    let mut title = text(issue, "title").to_owned();
    let mut note = summary::issue(issue);
    if !rest.is_null() {
        if historical {
            let value = legacy::rest(issue, &note);
            title = text(&value, "title").to_owned();
            note = text(&value, "note").to_owned();
        } else if let Some(facts) = facts {
            match text(facts, "rule") {
                "ARBZG_5_REST_10H" => {
                    title = "Ruhezeit zu kurz".into();
                    note = format!(
                        "Mindestens {} Std. Ruhezeit nötig.",
                        summary::limit(facts["minimumRestMinutes"].as_f64().unwrap())
                    );
                }
                "ARBZG_5_REST_11H" => note = summary::compensation(facts),
                "JARBSCHG_13_REST" => {
                    note = format!(
                        "Jugendliche brauchen mindestens {} Std. Ruhezeit.",
                        summary::limit(facts["minimumRestMinutes"].as_f64().unwrap())
                    )
                }
                _ => (),
            }
        }
    }
    if !series.is_null() {
        title = format!(
            "{}{} {} hintereinander",
            if sequence.is_some_and(|s| s["countIsMinimum"] == true) {
                "Mindestens "
            } else {
                ""
            },
            number_text(count.unwrap()),
            text(&series, "unit")
        );
    }
    Ok(
        json!({"related":related,"missing":missing,"rest":rest,"series":series,"title":title,"note":note,"nightSequence":sequence}),
    )
}
