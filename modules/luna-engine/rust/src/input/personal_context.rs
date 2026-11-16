//! Personal confirmations are raw facts, not statutory thresholds or externally
//! assessed maturity. Loading and read failures are handled by SourceState.
use crate::{employment, pay::pattern::WorkPatternSettings};
use serde_json::{Value, json};
use std::{collections::BTreeSet, sync::Arc};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextError {
    name: &'static str,
    message: &'static str,
}
impl ContextError {
    fn invalid(message: &'static str) -> Self {
        Self {
            name: "Error",
            message,
        }
    }
    pub fn name(&self) -> &str {
        self.name
    }
    pub fn message(&self) -> &str {
        self.message
    }
}
impl std::fmt::Display for ContextError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message)
    }
}
impl std::error::Error for ContextError {}
const BOOLEANS: &[&str] = &[
    "careInstitution",
    "medicalEmergencyService",
    "multiShiftOperation",
    "otherExceptions",
    "allWorkAndSchoolRecorded",
    "pausesPredefined",
];
const FIELDS: &[&str] = &[
    "careInstitution",
    "medicalEmergencyService",
    "multiShiftOperation",
    "otherExceptions",
    "allWorkAndSchoolRecorded",
    "pausesPredefined",
    "averageDailyTrainingMinutes",
    "averageWeeklyTrainingMinutes",
    "shortenedWorkingDays",
    "blockTrainingShiftIds",
    "holidayLostMinutes",
];
fn minutes(value: &Value, maximum: f64, minimum: f64) -> Result<Value, ContextError> {
    if value.is_null() {
        return Ok(Value::Null);
    }
    let number = value
        .as_f64()
        .filter(|n| n.is_finite() && n.fract() == 0.0 && *n >= minimum && *n <= maximum)
        .ok_or(ContextError::invalid(
            "Ungültige Minutenangabe für die Jugendprüfung.",
        ))?;
    Ok(json!(number as i64))
}
fn strings(value: &Value, maximum: usize, length: usize) -> Result<Vec<&str>, ContextError> {
    let error =
        || ContextError::invalid("Ungültige oder doppelte Zuordnung für die Jugendprüfung.");
    let values = value
        .as_array()
        .filter(|v| v.len() <= maximum)
        .ok_or_else(error)?;
    let mut seen = BTreeSet::new();
    let mut output = Vec::with_capacity(values.len());
    for value in values {
        let text = value
            .as_str()
            .filter(|s| !super::trim_javascript(s).is_empty() && s.encode_utf16().count() <= length)
            .ok_or_else(error)?;
        if !seen.insert(text) {
            return Err(error());
        }
        output.push(text);
    }
    Ok(output)
}
fn date(value: &str) -> Result<(), ContextError> {
    employment::require_remuneration_date(value).map_err(|_| ContextError {
        name: "RemunerationProfileError",
        message: "Bitte ein gültiges Gültigkeitsdatum angeben.",
    })
}
/// Exact existing form-domain normalization, including original error order.
pub fn validate_youth_context(value: &Value) -> Result<Value, ContextError> {
    let object = value.as_object().ok_or(ContextError::invalid(
        "Angaben für die Jugendprüfung fehlen.",
    ))?;
    if object.len() != FIELDS.len() || FIELDS.iter().any(|k| !object.contains_key(*k)) {
        return Err(ContextError::invalid(
            "Unbekanntes Format der Jugendangaben.",
        ));
    }
    for field in BOOLEANS {
        if !value[*field].is_null() && !value[*field].is_boolean() {
            return Err(ContextError::invalid(
                "Prüfungsvoraussetzung bitte ausdrücklich bestätigen.",
            ));
        }
    }
    let days = strings(&value["shortenedWorkingDays"], 3660, 200)?;
    for day in &days {
        date(day)?;
    }
    let bindings = strings(&value["blockTrainingShiftIds"], 10_000, 2048)?;
    let lost = value["holidayLostMinutes"]
        .as_object()
        .filter(|v| v.len() <= 3660)
        .ok_or(ContextError::invalid("Ungültige Feiertagsangaben."))?;
    let mut lost_minutes = serde_json::Map::new();
    for (day, amount) in lost {
        date(day)?;
        let amount = minutes(amount, 1440.0, 0.0)?;
        if amount.is_null() {
            return Err(ContextError::invalid(
                "Feiertagsausfall bitte als Minuten bestätigen.",
            ));
        }
        lost_minutes.insert(day.clone(), amount);
    }
    let mut result = serde_json::Map::new();
    for field in BOOLEANS {
        result.insert((*field).into(), value[*field].clone());
    }
    result.insert(
        "averageDailyTrainingMinutes".into(),
        minutes(&value["averageDailyTrainingMinutes"], 1440.0, 1.0)?,
    );
    result.insert(
        "averageWeeklyTrainingMinutes".into(),
        minutes(&value["averageWeeklyTrainingMinutes"], 10_080.0, 1.0)?,
    );
    result.insert("shortenedWorkingDays".into(), json!(days));
    result.insert("blockTrainingShiftIds".into(), json!(bindings));
    result.insert("holidayLostMinutes".into(), Value::Object(lost_minutes));
    Ok(Value::Object(result))
}

pub struct CheckedYouthContext(Arc<Value>);
impl CheckedYouthContext {
    pub fn try_from_raw(value: &Value) -> Result<Self, ContextError> {
        validate_youth_context(value).map(|v| Self(Arc::new(v)))
    }
    pub fn value(&self) -> &Value {
        &self.0
    }
    pub fn shared(&self) -> &Arc<Value> {
        &self.0
    }
}

/// A missing *successfully read* preference row means disabled in the source.
/// A failed/not-yet-read SourceState never calls this function with a fake null.
pub fn load_youth_protection_preference(row: &Value) -> Result<bool, ContextError> {
    if row.is_null() {
        return Ok(false);
    }
    match row.get("value").and_then(Value::as_str) {
        Some("true") => Ok(true),
        Some("false") => Ok(false),
        _ => Err(ContextError::invalid(
            "Ungültige Jugendlichenprüfungseinstellung.",
        )),
    }
}

/// Pure existing preference-row projection. Unknown stored choices preserve the
/// original UNKNOWN fallback; timestamps retain the source's UTF-16 sort order.
pub fn load_work_pattern_settings(rows: &Value) -> Result<Value, ContextError> {
    let rows = rows.as_array().ok_or(ContextError::invalid(
        "Ungültige Angaben zum Schichtmodell.",
    ))?;
    let coverage = rows.iter().find(|v| v["key"] == "tvoed_workplace_coverage");
    let assignment = rows.iter().find(|v| v["key"] == "tvoed_assignment");
    let coverage_value = coverage
        .and_then(|v| v["value"].as_str())
        .filter(|v| ["UNKNOWN", "AROUND_THE_CLOCK", "NOT_AROUND_THE_CLOCK"].contains(v))
        .unwrap_or("UNKNOWN");
    let assignment_value = assignment
        .and_then(|v| v["value"].as_str())
        .filter(|v| ["UNKNOWN", "PERMANENT", "TEMPORARY"].contains(v))
        .unwrap_or("UNKNOWN");
    let updated = [coverage, assignment]
        .into_iter()
        .flatten()
        .filter_map(|v| v["updated_at"].as_str())
        .max_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    Ok(
        json!({"workplaceCoverage":coverage_value,"assignment":assignment_value,"updatedAt":updated}),
    )
}
/// Production row-set guard: no precomputed assessment, extra preference key,
/// ambiguous duplicate row or fabricated timestamp can enter a native snapshot.
pub struct CheckedWorkPatternSettings(WorkPatternSettings);
impl CheckedWorkPatternSettings {
    pub fn try_from_raw_rows(value: &Value) -> Result<Self, ContextError> {
        let error =
            || ContextError::invalid("Die gespeicherten Schichtmodellangaben sind ungültig.");
        let rows = value
            .as_array()
            .filter(|v| v.len() <= 2)
            .ok_or_else(error)?;
        let mut seen = BTreeSet::new();
        for row in rows {
            let object = row.as_object().ok_or_else(error)?;
            if object.len() != 3
                || ["key", "value", "updated_at"]
                    .iter()
                    .any(|k| !object.contains_key(*k))
            {
                return Err(error());
            }
            let key = row["key"]
                .as_str()
                .filter(|v| ["tvoed_workplace_coverage", "tvoed_assignment"].contains(v))
                .ok_or_else(error)?;
            if !seen.insert(key) || !row["value"].is_string() {
                return Err(error());
            }
            row["updated_at"]
                .as_str()
                .ok_or_else(error)?
                .parse::<jiff::Timestamp>()
                .map_err(|_| error())?;
        }
        let projected = load_work_pattern_settings(value)?;
        serde_json::from_value(projected)
            .map(Self)
            .map_err(|_| error())
    }
    pub fn settings(&self) -> &WorkPatternSettings {
        &self.0
    }
}
