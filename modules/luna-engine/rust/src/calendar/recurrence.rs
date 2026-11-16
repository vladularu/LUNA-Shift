//! Civil-date recurrence expansion. Platform locale collation enters as snapshot ranks.
use super::parse_date;
use crate::EngineError;
use jiff::{Span, civil::Date};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

/// The host supplies one rank per unique comparison string. Equal ranks represent
/// localeCompare equality, including canonically equivalent Unicode spellings.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct CollationRanks(BTreeMap<String, u32>);

impl From<BTreeMap<String, u32>> for CollationRanks {
    fn from(ranks: BTreeMap<String, u32>) -> Self {
        Self(ranks)
    }
}

impl CollationRanks {
    pub(crate) fn comparison_strings(&self) -> impl ExactSizeIterator<Item = &str> {
        self.0.keys().map(String::as_str)
    }
    pub(crate) fn rank(&self, text: &str) -> Result<u32, EngineError> {
        self.0
            .get(text)
            .copied()
            .ok_or(EngineError::InvalidCollation)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum Frequency {
    Day,
    Week,
    Month,
    Year,
}

#[derive(Deserialize)]
struct RecurrenceRule {
    #[serde(deserialize_with = "deserialize_integral_number")]
    interval: i64,
    frequency: Frequency,
}

/// Native form arithmetic may retain 1.0 instead of passing through JS JSON's
/// integer spelling. Preserve the same integral Number value, not token kind.
pub(crate) fn deserialize_integral_number<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<i64, D::Error> {
    let value = Value::deserialize(deserializer)?;
    value
        .as_i64()
        .or_else(|| {
            value
                .as_f64()
                .filter(|n| {
                    n.is_finite()
                        && n.fract() == 0.0
                        && (i64::MIN as f64..-(i64::MIN as f64)).contains(n)
                })
                .map(|n| n as i64)
        })
        .ok_or_else(|| serde::de::Error::custom("Expected an integral JSON number"))
}

fn string<'a>(entry: &'a Value, field: &str) -> Result<&'a str, EngineError> {
    entry
        .get(field)
        .and_then(Value::as_str)
        .ok_or(EngineError::InvalidCalendarEntry)
}

fn occurrence_date(start: Date, rule: &RecurrenceRule, index: i64) -> Result<Date, EngineError> {
    let amount = rule
        .interval
        .checked_mul(index)
        .ok_or(EngineError::Overflow)?;
    let span = match rule.frequency {
        Frequency::Day => Span::new().try_days(amount),
        Frequency::Week => Span::new().try_weeks(amount),
        Frequency::Month => Span::new().try_months(amount),
        Frequency::Year => Span::new().try_years(amount),
    }
    .map_err(|_| EngineError::Overflow)?;
    // Always add to the original date. Repeatedly adding one month would drift
    // Jan 31 -> Feb 28 -> Mar 28, unlike Temporal's Jan 31 -> Feb 28 -> Mar 31.
    start.checked_add(span).map_err(|_| EngineError::Overflow)
}

/// Attempted steps are exposed internally so prepared windows can account for
/// work without skipping the source's 10,000-index legacy guard.
pub(crate) enum AppointmentStep {
    Outside,
    Occurrence(Option<Date>),
}
pub(crate) struct AppointmentDates {
    range_start: Date,
    range_end: Date,
    series_start: Date,
    rule: Option<RecurrenceRule>,
    index: i64,
    finished: bool,
}
pub(crate) fn appointment_dates(
    appointment: &Value,
    start_date: &str,
    end_date: &str,
) -> Result<AppointmentDates, EngineError> {
    let range_start = parse_date(start_date)?;
    let range_end = parse_date(end_date)?;
    let date_text = string(appointment, "date")?;
    let series_start = parse_date(date_text)?;
    let mut result = AppointmentDates {
        range_start,
        range_end,
        series_start,
        rule: None,
        index: 0,
        finished: false,
    };
    if range_end < series_start {
        result.finished = true;
        return Ok(result);
    }
    let Some(recurrence) = appointment
        .get("recurrence")
        .filter(|value| !value.is_null())
    else {
        result.finished = !(date_text >= start_date && date_text <= end_date);
        return Ok(result);
    };
    result.rule = Some(
        serde_json::from_value(recurrence.clone()).map_err(|_| EngineError::InvalidRecurrence)?,
    );
    Ok(result)
}
impl Iterator for AppointmentDates {
    type Item = Result<AppointmentStep, EngineError>;
    fn next(&mut self) -> Option<Self::Item> {
        if self.finished || self.index >= 10_000 {
            return None;
        }
        let Some(rule) = &self.rule else {
            self.finished = true;
            return Some(Ok(AppointmentStep::Occurrence(None)));
        };
        let date = match occurrence_date(self.series_start, rule, self.index) {
            Ok(date) => date,
            Err(error) => {
                self.finished = true;
                return Some(Err(error));
            }
        };
        self.index += 1;
        if date > self.range_end {
            self.finished = true;
            return None;
        }
        Some(Ok(if date < self.range_start {
            AppointmentStep::Outside
        } else {
            AppointmentStep::Occurrence(Some(date))
        }))
    }
}
/// Expand civil dates without changing ids or unrelated/unknown metadata.
/// Whole-entry deletion remains expand_calendar_entries' responsibility.
pub fn expand_appointment_series(
    appointment: &Value,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<Value>, EngineError> {
    let mut occurrences = Vec::new();
    for step in appointment_dates(appointment, start_date, end_date)? {
        let AppointmentStep::Occurrence(date) = step? else {
            continue;
        };
        let mut occurrence = appointment.clone();
        if let Some(date) = date {
            occurrence
                .as_object_mut()
                .ok_or(EngineError::InvalidCalendarEntry)?
                .insert("date".to_owned(), Value::String(date.to_string()));
        }
        occurrences.push(occurrence);
    }
    Ok(occurrences)
}

fn priority<'a>(get: &impl Fn(&str) -> Option<&'a Value>) -> u8 {
    if get("kind").and_then(Value::as_str) == Some("APPOINTMENT") {
        return 2;
    }
    match get("type").and_then(Value::as_str) {
        Some("TRAINING" | "VACATION" | "SICK" | "FREE") => 1,
        _ => 0,
    }
}

pub(crate) type SortKey = (u32, u8, u32, u32, u32, u32);

fn sort_key(entry: &Value, collation: &CollationRanks) -> Result<SortKey, EngineError> {
    sort_key_for_date(entry, string(entry, "date")?, collation)
}
pub(crate) fn sort_key_for_date(
    entry: &Value,
    date: &str,
    collation: &CollationRanks,
) -> Result<SortKey, EngineError> {
    sort_key_for_fields(|field| entry.get(field), date, collation)
}
pub(crate) fn sort_key_for_fields<'a>(
    get: impl Fn(&str) -> Option<&'a Value>,
    date: &str,
    collation: &CollationRanks,
) -> Result<SortKey, EngineError> {
    let required = |field| {
        get(field)
            .and_then(Value::as_str)
            .ok_or(EngineError::InvalidCalendarEntry)
    };
    let start_time = match get("startTime") {
        None | Some(Value::Null) => "",
        Some(Value::String(text)) => text,
        Some(_) => return Err(EngineError::InvalidCalendarEntry),
    };
    Ok((
        collation.rank(date)?,
        priority(&get),
        collation.rank(start_time)?,
        collation.rank(required("createdAt")?)?,
        collation.rank(required("title")?)?,
        collation.rank(required("id")?)?,
    ))
}

/// Expand active entries and order them by the frozen calendar comparator.
/// Host-provided collation equivalence ranks preserve the user's platform locale
/// without a JavaScript calculation fallback or per-comparison FFI calls.
pub fn expand_calendar_entries(
    entries: &[Value],
    start_date: &str,
    end_date: &str,
    collation: &CollationRanks,
) -> Result<Vec<Value>, EngineError> {
    sort_calendar_entries(
        prepare_calendar_entries(entries, start_date, end_date)?,
        collation,
    )
}

/// Native recurrence projection before host collation. The host may receive
/// only candidates, never manufacture occurrence or entry facts.
pub fn prepare_calendar_entries(
    entries: &[Value],
    start_date: &str,
    end_date: &str,
) -> Result<Vec<Value>, EngineError> {
    let mut expanded = Vec::new();
    for entry in entries {
        // Missing deletedAt is also skipped by TS's strict !== null comparison.
        if entry.get("deletedAt") != Some(&Value::Null) {
            continue;
        }
        if entry.get("kind").and_then(Value::as_str) == Some("SHIFT") {
            let date = string(entry, "date")?;
            if date >= start_date && date <= end_date {
                expanded.push(entry.clone());
            }
        } else {
            expanded.extend(expand_appointment_series(entry, start_date, end_date)?);
        }
    }
    Ok(expanded)
}

/// Exactly the strings used by the source comparator, after native input/date
/// normalization or recurrence projection. Enumeration order has no meaning.
pub fn collation_candidates(entries: &[Value]) -> Result<BTreeSet<String>, EngineError> {
    let mut candidates = BTreeSet::new();
    for entry in entries {
        for key in ["date", "createdAt", "title", "id"] {
            candidates.insert(string(entry, key)?.to_owned());
        }
        candidates.insert(
            match entry.get("startTime") {
                None | Some(Value::Null) => "",
                Some(Value::String(s)) => s,
                Some(_) => return Err(EngineError::InvalidCalendarEntry),
            }
            .to_owned(),
        );
    }
    Ok(candidates)
}

/// Stable source order with explicit platform collation equivalence classes.
pub fn sort_calendar_entries(
    entries: Vec<Value>,
    collation: &CollationRanks,
) -> Result<Vec<Value>, EngineError> {
    if entries.len() < 2 {
        return Ok(entries);
    }
    let mut ranked: Vec<_> = entries
        .into_iter()
        .map(|entry| sort_key(&entry, collation).map(|key| (key, entry)))
        .collect::<Result<_, _>>()?;
    // Stable sorting retains input order when every locale-comparison field is equal.
    ranked.sort_by_key(|(key, _)| *key);
    Ok(ranked.into_iter().map(|(_, entry)| entry).collect())
}
