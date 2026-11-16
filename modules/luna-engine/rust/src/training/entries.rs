//! Raw source-bound training entry preparation; calculated intervals have no wire constructor.
use super::{
    TrainingError, bindings, helpers,
    interval_math::{self, YouthSpan, plain},
};
use crate::calendar::parse_date;
use jiff::ToSpan;
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{
        Arc, OnceLock,
        atomic::{AtomicUsize, Ordering},
    },
};

/// Prepared by native time/detail validation only, never deserialized from a host.
#[derive(Clone)]
pub struct YouthEntry {
    pub(super) shift: Arc<Value>,
    pub(super) start_milliseconds: i64,
    pub(super) end_milliseconds: i64,
    pub(super) pauses: Option<Vec<YouthSpan>>,
    pub(super) school: Option<Value>,
    pub(super) exam: Option<Value>,
    block_training_binding: Option<String>,
}
impl YouthEntry {
    pub(super) fn clipped(&self, start: i64, end: i64) -> Self {
        let mut entry = self.clone();
        entry.start_milliseconds = start.max(self.start_milliseconds);
        entry.end_milliseconds = end.min(self.end_milliseconds);
        entry.pauses = self.pauses.as_ref().map(|pauses| {
            pauses
                .iter()
                .filter(|p| p.start_milliseconds < end && p.end_milliseconds > start)
                .map(|p| {
                    let mut p = p.clone();
                    p.start_milliseconds = p.start_milliseconds.max(start);
                    p.end_milliseconds = p.end_milliseconds.min(end);
                    p
                })
                .collect()
        });
        entry
    }
    pub fn work_spans(&self, minimum_pause: f64) -> Vec<YouthSpan> {
        interval_math::work_spans(self, minimum_pause)
    }
    pub fn bounds(&self) -> YouthSpan {
        plain(self.start_milliseconds, self.end_milliseconds)
    }
    pub fn shift(&self) -> &Value {
        &self.shift
    }
    pub fn start_epoch_milliseconds(&self) -> i64 {
        self.start_milliseconds
    }
    pub fn end_epoch_milliseconds(&self) -> i64 {
        self.end_milliseconds
    }
    pub fn pauses(&self) -> Option<&[YouthSpan]> {
        self.pauses.as_deref()
    }
    pub fn school(&self) -> Option<&Value> {
        self.school.as_ref()
    }
    pub fn exam(&self) -> Option<&Value> {
        self.exam.as_ref()
    }
    pub fn block_training_binding(&self) -> Option<&str> {
        self.block_training_binding.as_deref()
    }
    pub fn to_json(&self) -> Value {
        json!({"shift":self.shift.as_ref(),"start":self.start_milliseconds,"end":self.end_milliseconds,"pauses":self.pauses.as_ref().map(|p|p.iter().map(YouthSpan::to_json).collect::<Vec<_>>()),"school":self.school,"exam":self.exam,"blockTrainingBinding":self.block_training_binding})
    }
}
#[derive(Clone)]
pub struct PreparationProblem {
    date: String,
    code: &'static str,
    message: &'static str,
    id: String,
}
impl PreparationProblem {
    pub fn date(&self) -> &str {
        &self.date
    }
    pub fn code(&self) -> &'static str {
        self.code
    }
    pub fn message(&self) -> &'static str {
        self.message
    }
    pub fn shift_id(&self) -> &str {
        &self.id
    }
    pub fn to_json(&self) -> Value {
        json!({"date":self.date,"code":self.code,"message":self.message,"id":self.id})
    }
}
struct CachedEntry {
    entry: Option<YouthEntry>,
    problems: Vec<PreparationProblem>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct YouthPreparationStats {
    pub entry_preparations: usize,
}
/// Binds immutable raw source facts once. Runtime SourceFacts performs calendar
/// identity/schema checks first; no host interval table or calculated credit is accepted.
pub struct YouthSource {
    shifts: Arc<[Value]>,
    details: Arc<[Value]>,
    profile: Arc<Value>,
    dates: BTreeMap<String, Vec<usize>>,
    first_details: BTreeMap<String, usize>,
    first_null_detail: Option<usize>,
    slots: Vec<OnceLock<Result<CachedEntry, TrainingError>>>,
    preparations: AtomicUsize,
}
impl YouthSource {
    pub fn new(shifts: Arc<[Value]>, details: Arc<[Value]>, profile: Arc<Value>) -> Self {
        let mut dates = BTreeMap::<String, Vec<usize>>::new();
        for (index, shift) in shifts.iter().enumerate() {
            if !shift.get("deletedAt").is_some_and(Value::is_null)
                || matches!(
                    shift.get("type").and_then(Value::as_str),
                    Some("FREE" | "VACATION" | "SICK")
                )
            {
                continue;
            }
            if let Some(date) = shift.get("date").and_then(Value::as_str) {
                dates.entry(date.into()).or_default().push(index);
            }
        }
        let mut first_details = BTreeMap::new();
        let mut first_null_detail = None;
        for (index, row) in details.iter().enumerate() {
            if row.is_null() {
                first_null_detail.get_or_insert(index);
            }
            if let Some(id) = row.get("shiftId").and_then(Value::as_str) {
                first_details.entry(id.into()).or_insert(index);
            }
        }
        let slots = (0..shifts.len()).map(|_| OnceLock::new()).collect();
        Self {
            shifts,
            details,
            profile,
            dates,
            first_details,
            first_null_detail,
            slots,
            preparations: AtomicUsize::new(0),
        }
    }
    pub fn profile(&self) -> &Value {
        &self.profile
    }
    pub(crate) fn shares_source_owner(&self, shifts: &[Value], profile: &Value) -> bool {
        std::ptr::eq(self.shifts.as_ref(), shifts) && std::ptr::eq(self.profile.as_ref(), profile)
    }
    pub fn stats(&self) -> YouthPreparationStats {
        YouthPreparationStats {
            entry_preparations: self.preparations.load(Ordering::Relaxed),
        }
    }
    fn build(&self, index: usize) -> Result<CachedEntry, TrainingError> {
        let shift = &self.shifts[index];
        let id = shift
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| TrainingError::invalid("Ungültige Dienstzuordnung."))?;
        let date = shift
            .get("date")
            .and_then(Value::as_str)
            .ok_or_else(helpers::date_error)?;
        let problem = |code, message| PreparationProblem {
            date: date.into(),
            code,
            message,
            id: id.into(),
        };
        if helpers::truthy(shift.get("allDay"))
            || !helpers::truthy(shift.get("startTime"))
            || !helpers::truthy(shift.get("endTime"))
        {
            return Ok(CachedEntry {
                entry: None,
                problems: vec![problem(
                    "TIMES_MISSING",
                    "Für diesen Eintrag fehlen eindeutige Uhrzeiten.",
                )],
            });
        }
        let mut problems = Vec::new();
        let mut parse = || -> Result<YouthEntry, TrainingError> {
            let zone = self
                .profile
                .get("timeZone")
                .and_then(Value::as_str)
                .ok_or_else(helpers::temporal)?;
            let (start, end) = bindings::span(shift, zone)?;
            let selected = self.first_details.get(id).copied();
            // Array.find stops at its first matching row, including a stale one.
            if self
                .first_null_detail
                .is_some_and(|bad| selected.is_none_or(|found| bad < found))
            {
                return Err(TrainingError::invalid("Ungültige Ausbildungsdaten."));
            }
            let details = if let Some(row) = selected
                .map(|i| &self.details[i])
                .filter(|row| bindings::is_current_shift_training(row, shift, zone))
            {
                let row = bindings::validate_saved_shift_training(row)?;
                bindings::require_shift_training_parent(&row, shift)?;
                Some(row)
            } else {
                None
            };
            let school = details
                .as_ref()
                .and_then(|d| d["data"].get("school"))
                .filter(|v| !v.is_null())
                .cloned();
            let exam = details
                .as_ref()
                .and_then(|d| d["data"].get("exam"))
                .filter(|v| !v.is_null())
                .cloned();
            let activity = school
                .as_ref()
                .and_then(|s| s["lessons"].as_array())
                .or_else(|| {
                    exam.as_ref()
                        .and_then(|e| e["participation"].as_array())
                        .filter(|p| !p.is_empty())
                });
            let (active_start, active_end) = if let Some(parts) = activity {
                let starts = parts
                    .iter()
                    .map(|p| helpers::millis(&p["start"]).ok_or_else(helpers::temporal))
                    .collect::<Result<Vec<_>, _>>()?;
                let ends = parts
                    .iter()
                    .map(|p| helpers::millis(&p["end"]).ok_or_else(helpers::temporal))
                    .collect::<Result<Vec<_>, _>>()?;
                (
                    *starts.iter().min().ok_or_else(helpers::temporal)?,
                    *ends.iter().max().ok_or_else(helpers::temporal)?,
                )
            } else {
                (start, end)
            };
            let raw_pauses = details
                .as_ref()
                .and_then(|d| d["data"]["pauses"].as_array());
            if exam.is_some()
                && raw_pauses.is_some_and(|pauses| {
                    pauses.iter().any(|p| {
                        helpers::millis(&p["start"]).is_some_and(|v| v < active_start)
                            || helpers::millis(&p["end"]).is_some_and(|v| v > active_end)
                    })
                })
            {
                problems.push(problem("EXAM_PAUSE_OUTSIDE_PARTICIPATION","Eine Prüfungspause liegt außerhalb der bestätigten Teilnahme; die Anrechnung bleibt offen."));
            }
            let pauses = raw_pauses
                .map(|pauses| -> Result<Vec<YouthSpan>, TrainingError> {
                    let mut result = Vec::new();
                    for pause in pauses {
                        let start =
                            helpers::millis(&pause["start"]).ok_or_else(helpers::temporal)?;
                        let end = helpers::millis(&pause["end"]).ok_or_else(helpers::temporal)?;
                        if start >= active_start && end <= active_end {
                            result.push(YouthSpan {
                                start_milliseconds: i64::try_from(start)
                                    .map_err(|_| helpers::temporal())?,
                                end_milliseconds: i64::try_from(end)
                                    .map_err(|_| helpers::temporal())?,
                                original_minutes: Some((end - start) as f64 / 60000.0),
                            });
                        }
                    }
                    Ok(result)
                })
                .transpose()?;
            let binding = details
                .as_ref()
                .map(|d| bindings::youth_block_shift_binding(shift, d, zone))
                .transpose()?
                .flatten();
            Ok(YouthEntry {
                shift: Arc::new(shift.clone()),
                start_milliseconds: i64::try_from(active_start).map_err(|_| helpers::temporal())?,
                end_milliseconds: i64::try_from(active_end).map_err(|_| helpers::temporal())?,
                pauses,
                school,
                exam,
                block_training_binding: binding,
            })
        };
        let entry = match parse() {
            Ok(entry) => Some(entry),
            Err(_) => {
                problems.push(problem("TIMES_AMBIGUOUS","Dienstzeiten oder Pausen sind nicht eindeutig. Bitte Datum, Zeitumstellung und gespeicherte Intervalle prüfen."));
                None
            }
        };
        Ok(CachedEntry { entry, problems })
    }
    pub fn prepare(&self, month: &str) -> Result<PreparedYouthEntries<'_>, TrainingError> {
        let first = parse_date(&format!("{month}-01")).map_err(|_| helpers::temporal())?;
        let start = first
            .checked_sub(14.days())
            .map_err(|_| helpers::temporal())?
            .to_string();
        let end = first
            .checked_add(1.months().days(14))
            .map_err(|_| helpers::temporal())?
            .to_string();
        let mut indices = self
            .dates
            .range(start..end)
            .flat_map(|(_, indices)| indices.iter().copied())
            .collect::<Vec<_>>();
        indices.sort_unstable();
        let mut entries = Vec::new();
        let mut problems = Vec::new();
        for index in indices {
            let result = self.slots[index]
                .get_or_init(|| {
                    self.preparations.fetch_add(1, Ordering::Relaxed);
                    self.build(index)
                })
                .as_ref()
                .map_err(Clone::clone)?;
            if let Some(entry) = &result.entry {
                entries.push(entry);
            }
            problems.extend(result.problems.iter().cloned());
        }
        entries.sort_by_key(|e| (e.start_milliseconds, e.end_milliseconds));
        Ok(PreparedYouthEntries {
            source: self,
            entries,
            problems,
        })
    }
}
pub struct PreparedYouthEntries<'a> {
    source: &'a YouthSource,
    entries: Vec<&'a YouthEntry>,
    problems: Vec<PreparationProblem>,
}
impl PreparedYouthEntries<'_> {
    pub(super) fn raw_shifts(&self) -> &[Value] {
        &self.source.shifts
    }
    pub fn profile(&self) -> &Value {
        self.source.profile()
    }
    pub fn entries(&self) -> &[&YouthEntry] {
        &self.entries
    }
    pub fn problems(&self) -> &[PreparationProblem] {
        &self.problems
    }
    pub fn to_json(&self) -> Value {
        json!({"entries":self.entries.iter().map(|e|e.to_json()).collect::<Vec<_>>(),"problems":self.problems.iter().map(PreparationProblem::to_json).collect::<Vec<_>>()})
    }
}
