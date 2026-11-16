//! Readable export rows over native calendar/credit facts; document layout stays host-owned.
use crate::calendar::window::CalendarRecordRef;
use crate::credit::{daily, duty, prepared::PreparedCreditEntries};
use crate::{
    EngineError,
    calendar::recurrence::CollationRanks,
    credit::context::{DailyCreditContextCache, DailyCreditError},
};
use serde::Serialize;
use serde_json::Value;
use std::{borrow::Cow, collections::BTreeMap};
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportEntry {
    pub date: String,
    pub title: String,
    pub kind: String,
    pub type_label: String,
    pub color: String,
    pub all_day: bool,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub next_day: bool,
    pub break_minutes: Option<f64>,
    pub duration_minutes: Option<f64>,
    pub credit_minutes: Option<f64>,
}
#[derive(Debug)]
pub enum ReportEntryError {
    Credit(DailyCreditError),
    Time(EngineError),
    InvalidEntry,
    TooLarge,
}
impl std::fmt::Display for ReportEntryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Credit(error) => error.fmt(f),
            Self::Time(error) => error.fmt(f),
            Self::InvalidEntry => f.write_str("Die Berichtseinträge sind ungültig."),
            Self::TooLarge => f.write_str("Der Bericht enthält zu viele Einträge."),
        }
    }
}
impl std::error::Error for ReportEntryError {}
impl From<DailyCreditError> for ReportEntryError {
    fn from(error: DailyCreditError) -> Self {
        Self::Credit(error)
    }
}
impl From<EngineError> for ReportEntryError {
    fn from(error: EngineError) -> Self {
        Self::Time(error)
    }
}
/// Native structural output only; never accepted as a host Ready proof.
pub struct ReportComparisonCandidates {
    strings: Vec<String>,
    readable_count: usize,
    reserved_bytes: usize,
}
impl ReportComparisonCandidates {
    pub fn strings(&self) -> &[String] {
        &self.strings
    }
    pub fn readable_entry_count(&self) -> usize {
        self.readable_count
    }
    /// Candidate owner plus conservative reservation for its future rank owner.
    pub fn reserved_bytes(&self) -> usize {
        self.reserved_bytes
    }
}
#[derive(Clone, Copy)]
struct InputRecord<'a> {
    base: &'a Value,
    title: Option<&'a Value>,
    color: Option<&'a Value>,
}
impl<'a> InputRecord<'a> {
    fn plain(base: &'a Value) -> Self {
        Self {
            base,
            title: None,
            color: None,
        }
    }
    fn calendar(record: CalendarRecordRef<'a>) -> Self {
        Self {
            base: record.base_value(),
            title: record.get("title"),
            color: record.get("color"),
        }
    }
    fn field(&self, key: &str) -> Option<&'a Value> {
        match key {
            "title" => self.title.or_else(|| self.base.get(key)),
            "color" => self.color.or_else(|| self.base.get(key)),
            _ => self.base.get(key),
        }
    }
}
struct ExpandedRecord<'a> {
    value: Cow<'a, Value>,
    title: Option<&'a Value>,
    color: Option<&'a Value>,
}
impl ExpandedRecord<'_> {
    fn as_ref(&self) -> &Value {
        self.value.as_ref()
    }
    fn field(&self, key: &str) -> Option<&Value> {
        match key {
            "title" => self.title.or_else(|| self.value.get(key)),
            "color" => self.color.or_else(|| self.value.get(key)),
            _ => self.value.get(key),
        }
    }
}
pub fn report_comparison_candidates<'a>(
    entries: impl IntoIterator<Item = &'a Value>,
    max_entries: usize,
    max_candidate_bytes: usize,
) -> Result<ReportComparisonCandidates, ReportEntryError> {
    comparison_candidates_iter(
        entries.into_iter().map(InputRecord::plain),
        max_entries,
        max_candidate_bytes,
    )
}
fn comparison_candidates_iter<'a>(
    entries: impl IntoIterator<Item = InputRecord<'a>>,
    max_entries: usize,
    max_candidate_bytes: usize,
) -> Result<ReportComparisonCandidates, ReportEntryError> {
    use std::collections::BTreeSet;
    let mut strings = BTreeSet::<String>::new();
    let mut reserved_bytes = 8192usize;
    if reserved_bytes > max_candidate_bytes {
        return Err(ReportEntryError::TooLarge);
    }
    let mut add = |text: &str| -> Result<(), ReportEntryError> {
        if text.len() > 300_000 {
            return Err(ReportEntryError::TooLarge);
        }
        if !strings.contains(text) {
            // Original + future rank key text, Vec/BTree nodes and bookkeeping.
            let next = reserved_bytes
                .saturating_add(text.len().saturating_mul(2))
                .saturating_add(224);
            if next > max_candidate_bytes {
                return Err(ReportEntryError::TooLarge);
            }
            strings.insert(text.to_owned());
            reserved_bytes = next;
        }
        Ok(())
    };
    let mut readable_count = 0usize;
    let mut credit_count = 0usize;
    for entry in entries {
        for key in ["date", "startTime", "createdAt", "title", "id"] {
            let value = if matches!(key, "startTime" | "createdAt") {
                entry.field(key).and_then(Value::as_str).unwrap_or("")
            } else {
                entry
                    .field(key)
                    .and_then(Value::as_str)
                    .ok_or(ReportEntryError::InvalidEntry)?
            };
            add(value)?;
        }
        let expanded = expand([entry], Some(max_entries - readable_count))?;
        readable_count += expanded.len();
        for row in &expanded {
            let row = row.as_ref();
            add(text(row, "id")?)?;
            if row["kind"] == "SHIFT" {
                if let Some(parts) = duty::project_duty_calendar_day_parts(row)? {
                    for part in &parts {
                        if credit_count >= max_entries {
                            return Err(ReportEntryError::TooLarge);
                        }
                        credit_count += 1;
                        add(text(part, "id")?)?;
                    }
                } else {
                    // The shared projector returns the original for ordinary
                    // work. Its ID is already present; no one-row index needed.
                    if credit_count >= max_entries {
                        return Err(ReportEntryError::TooLarge);
                    }
                    credit_count += 1;
                }
            }
        }
    }
    Ok(ReportComparisonCandidates {
        strings: strings.into_iter().collect(),
        readable_count,
        reserved_bytes,
    })
}
/// Borrowed effective native calendar fields; no Ready JSON constructor.
pub fn report_comparison_candidates_from_records(
    entries: &[CalendarRecordRef<'_>],
    max_entries: usize,
    max_candidate_bytes: usize,
) -> Result<ReportComparisonCandidates, ReportEntryError> {
    comparison_candidates_iter(
        entries.iter().copied().map(InputRecord::calendar),
        max_entries,
        max_candidate_bytes,
    )
}
pub fn report_entries_from_records_bounded(
    entries: &[CalendarRecordRef<'_>],
    cache: &mut DailyCreditContextCache<'_>,
    collation: &CollationRanks,
    max_entries: usize,
) -> Result<Vec<ReportEntry>, ReportEntryError> {
    report_entries_iter(
        entries.iter().copied().map(InputRecord::calendar),
        cache,
        collation,
        Some(max_entries),
    )
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, ReportEntryError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or(ReportEntryError::InvalidEntry)
}
fn number(value: &Value, key: &str) -> Result<f64, ReportEntryError> {
    value
        .get(key)
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite())
        .ok_or(ReportEntryError::InvalidEntry)
}
fn special(entry: &Value) -> Option<&Value> {
    entry.get("specialDuty").filter(|v| !v.is_null())
}
fn expand<'a>(
    entries: impl IntoIterator<Item = InputRecord<'a>>,
    max_entries: Option<usize>,
) -> Result<Vec<ExpandedRecord<'a>>, ReportEntryError> {
    let mut result = Vec::new();
    for input in entries {
        let entry = input.base;
        let original = || ExpandedRecord {
            value: Cow::Borrowed(entry),
            title: input.title,
            color: input.color,
        };
        let duty = special(entry);
        if entry["kind"] != "SHIFT"
            || duty.is_none()
            || duty.is_some_and(|v| v["kind"] == "STANDBY")
        {
            append(&mut result, original(), max_entries)?;
            continue;
        }
        let split = duty.is_some_and(|v| v["kind"] == "SPLIT");
        let parts = duty::project_duty_work(entry)?;
        if !split {
            append(&mut result, original(), max_entries)?;
        }
        for (index, mut part) in parts.into_iter().enumerate() {
            part["id"] = Value::String(format!("{}:report:{index}", text(entry, "id")?));
            part["title"] = Value::String(format!(
                "{} · {}",
                if split {
                    "Geteilter Dienst"
                } else {
                    "Einsatz in Rufbereitschaft"
                },
                index + 1
            ));
            append(
                &mut result,
                ExpandedRecord {
                    value: Cow::Owned(part),
                    title: None,
                    color: input.color,
                },
                max_entries,
            )?;
        }
    }
    Ok(result)
}
fn append<'a>(
    rows: &mut Vec<ExpandedRecord<'a>>,
    row: ExpandedRecord<'a>,
    limit: Option<usize>,
) -> Result<(), ReportEntryError> {
    if limit.is_some_and(|limit| rows.len() >= limit) {
        return Err(ReportEntryError::TooLarge);
    }
    rows.push(row);
    Ok(())
}
fn type_label(entry: &Value) -> Result<&'static str, ReportEntryError> {
    if entry["kind"] == "APPOINTMENT" {
        return Ok("Termin");
    }
    if entry["kind"] != "SHIFT" {
        return Err(ReportEntryError::InvalidEntry);
    }
    if let Some(duty) = special(entry) {
        return match text(duty, "kind")? {
            "SPLIT" => Ok("Geteilter Dienst"),
            "ON_CALL" => Ok("Rufbereitschaft"),
            "STANDBY" => Ok("Bereitschaftsdienst"),
            _ => Err(ReportEntryError::InvalidEntry),
        };
    }
    match text(entry, "type")? {
        "EARLY" => Ok("Früh"),
        "LATE" => Ok("Spät"),
        "NIGHT" => Ok("Nacht"),
        "DAY" => Ok("Tag"),
        "TRAINING" => Ok("Fortbildung"),
        "VACATION" => Ok("Urlaub"),
        "SICK" => Ok("Krank"),
        "FREE" => Ok("Frei"),
        "CUSTOM" => Ok("Dienst"),
        _ => Err(ReportEntryError::InvalidEntry),
    }
}
fn title(entry: &Value, title: Option<&Value>) -> Result<String, ReportEntryError> {
    let title = title
        .or_else(|| entry.get("title"))
        .and_then(Value::as_str)
        .ok_or(ReportEntryError::InvalidEntry)?;
    if entry["kind"] != "SHIFT" {
        return Ok(title.to_owned());
    }
    let Some(duty) = special(entry) else {
        return Ok(title.to_owned());
    };
    let description = match text(duty, "kind")? {
        "ON_CALL" => {
            let day = crate::calendar::parse_date(text(entry, "date")?)?;
            let end_day = duty["endDay"]
                .as_i64()
                .ok_or(ReportEntryError::InvalidEntry)?;
            let until = day
                .checked_add(jiff::Span::new().days(end_day))
                .map_err(|_| ReportEntryError::Time(EngineError::InvalidDate))?;
            let end = entry
                .get("endTime")
                .and_then(Value::as_str)
                .unwrap_or("null");
            let callouts = duty["callouts"]
                .as_array()
                .ok_or(ReportEntryError::InvalidEntry)?
                .len();
            format!(
                "Rufbereitschaft · bis {until} {end} · {callouts} Einsätze{}",
                if duty["calloutsComplete"] == true {
                    ""
                } else {
                    " · offen"
                }
            )
        }
        "STANDBY" => {
            let level = text(duty, "standbyLevel")?;
            format!(
                "Bereitschaftsdienst · {}",
                if level == "UNKNOWN" {
                    "Stufe offen".to_owned()
                } else {
                    format!("Stufe {level}")
                }
            )
        }
        // SPLIT records have already been replaced by their ordinary work parts.
        _ => return Err(ReportEntryError::InvalidEntry),
    };
    Ok(format!("{title} · {description}"))
}
fn duration(entry: &Value, zone: &str) -> Result<f64, ReportEntryError> {
    use serde::Deserialize;
    if entry["kind"] == "SHIFT" && special(entry).is_some() {
        let time = crate::time::ShiftTime::deserialize(entry)
            .map_err(|_| ReportEntryError::InvalidEntry)?;
        return Ok(crate::time::shift_minutes(&time, zone)?);
    }
    // Ordinary projected parts can carry a fractional pause. Keep the original
    // Number subtraction instead of forcing that derived pause into raw i64.
    let time = crate::time::ShiftTime {
        date: text(entry, "date")?.to_owned(),
        start_time: Some(text(entry, "startTime")?.to_owned()),
        end_time: Some(text(entry, "endTime")?.to_owned()),
        break_minutes: 0,
        all_day: false,
        special_duty: None,
    };
    let gross = crate::time::shift_bounds(&time, zone)?
        .ok_or(ReportEntryError::InvalidEntry)?
        .gross_minutes as f64;
    let pause = if entry["kind"] == "SHIFT" {
        number(entry, "breakMinutes")?
    } else {
        0.0
    };
    Ok((gross - pause).max(0.0))
}
struct AbsenceCredit {
    sick: f64,
    vacation: f64,
}
pub fn report_entries_from_refs(
    entries: &[&Value],
    cache: &mut DailyCreditContextCache<'_>,
    collation: &CollationRanks,
) -> Result<Vec<ReportEntry>, ReportEntryError> {
    report_entries_iter(
        entries.iter().copied().map(InputRecord::plain),
        cache,
        collation,
        None,
    )
}
pub fn report_entries_from_refs_bounded(
    entries: &[&Value],
    cache: &mut DailyCreditContextCache<'_>,
    collation: &CollationRanks,
    max_entries: usize,
) -> Result<Vec<ReportEntry>, ReportEntryError> {
    report_entries_iter(
        entries.iter().copied().map(InputRecord::plain),
        cache,
        collation,
        Some(max_entries),
    )
}
pub fn report_entries(
    entries: &[Value],
    cache: &mut DailyCreditContextCache<'_>,
    collation: &CollationRanks,
) -> Result<Vec<ReportEntry>, ReportEntryError> {
    report_entries_iter(
        entries.iter().map(InputRecord::plain),
        cache,
        collation,
        None,
    )
}
fn report_entries_iter<'a>(
    entries: impl IntoIterator<Item = InputRecord<'a>>,
    cache: &mut DailyCreditContextCache<'_>,
    collation: &CollationRanks,
    max_entries: Option<usize>,
) -> Result<Vec<ReportEntry>, ReportEntryError> {
    let entries = expand(entries, max_entries)?;
    let shifts = entries
        .iter()
        .map(ExpandedRecord::as_ref)
        .filter(|entry| entry["kind"] == "SHIFT")
        .collect::<Vec<_>>();
    let mut prepared = None;
    let mut credits: BTreeMap<String, Option<AbsenceCredit>> = BTreeMap::new();
    let mut result = Vec::with_capacity(entries.len());
    for record in &entries {
        let entry = record.as_ref();
        let date = text(entry, "date")?;
        let is_shift = entry["kind"] == "SHIFT";
        let absence = is_shift
            && matches!(
                entry.get("type").and_then(Value::as_str),
                Some("VACATION" | "SICK" | "FREE")
            );
        let start = entry
            .get("startTime")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty());
        let end = entry
            .get("endTime")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty());
        let all_day = entry["allDay"] == true || absence || start.is_none() || end.is_none();
        let mut credit = Some(0.0);
        if is_shift
            && matches!(
                entry.get("type").and_then(Value::as_str),
                Some("VACATION" | "SICK")
            )
        {
            if !credits.contains_key(date) {
                // Source context/target failure precedes projection validation.
                let resolved = match cache.resolve(date) {
                    Ok(value) => Some(value),
                    Err(DailyCreditError::Target(_)) => None,
                    Err(error) => return Err(error.into()),
                };
                let totals = if let Some(resolved) = resolved {
                    if prepared.is_none() {
                        prepared = Some(PreparedCreditEntries::from_refs(shifts.clone())?);
                    }
                    let summary = daily::calculate_daily_work_credit_summary_prepared(
                        date,
                        prepared.as_ref().unwrap(),
                        &resolved.time_zone,
                        &resolved.context,
                        collation,
                    )?;
                    let sick = crate::credit::number(&summary.sick_minutes)?
                        .as_f64()
                        .ok_or(ReportEntryError::InvalidEntry)?;
                    let vacation = crate::credit::number(&summary.vacation_minutes)?
                        .as_f64()
                        .ok_or(ReportEntryError::InvalidEntry)?;
                    Some(AbsenceCredit { sick, vacation })
                } else {
                    None
                };
                credits.insert(date.to_owned(), totals);
            }
            credit = credits.get(date).and_then(Option::as_ref).map(|totals| {
                let kind = if totals.sick != 0.0 {
                    "SICK"
                } else {
                    "VACATION"
                };
                let owner = shifts
                    .iter()
                    .find(|shift| shift["date"] == entry["date"] && shift["type"] == kind);
                if owner.is_some_and(|owner| owner.get("id") == entry.get("id")) {
                    totals.sick + totals.vacation
                } else {
                    0.0
                }
            });
        }
        let duty = if is_shift { special(entry) } else { None };
        let on_call = duty.is_some_and(|duty| duty["kind"] == "ON_CALL");
        let credit_minutes = if on_call
            && duty.is_some_and(|duty| {
                duty["calloutsComplete"] == true
                    && duty["callouts"].as_array().is_some_and(Vec::is_empty)
                    && duty["settlement"] != "TIME_OFF"
            }) {
            Some(0.0)
        } else if !is_shift || duty.is_some_and(|duty| duty["kind"] != "SPLIT") {
            None
        } else {
            credit
        };
        // Keep property evaluation order: title/date errors precede duration.
        let title = title(entry, record.field("title"))?;
        let type_label = type_label(entry)?.to_owned();
        let color = record
            .field("color")
            .and_then(Value::as_str)
            .ok_or(ReportEntryError::InvalidEntry)?
            .to_owned();
        let duration_minutes = if all_day || on_call {
            None
        } else {
            Some(duration(entry, text(cache.profile(), "timeZone")?)?)
        };
        result.push(ReportEntry {
            date: date.to_owned(),
            title,
            kind: text(entry, "kind")?.to_owned(),
            type_label,
            color,
            all_day,
            start_time: if all_day {
                None
            } else {
                start.map(str::to_owned)
            },
            end_time: if all_day {
                None
            } else {
                end.map(str::to_owned)
            },
            next_day: !all_day && end <= start,
            break_minutes: if all_day || !is_shift {
                None
            } else {
                Some(number(entry, "breakMinutes")?)
            },
            duration_minutes,
            credit_minutes,
        });
    }
    Ok(result)
}
