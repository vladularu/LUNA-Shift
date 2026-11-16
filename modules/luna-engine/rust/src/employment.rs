//! Shared dated employment selection. Full source records are retained; this module never
//! treats a creation timestamp as an effective date or infers a new employment history.
pub mod profile_view;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::fmt;

pub const EMPLOYMENT_FIELDS: &[&str] = &[
    "federalState",
    "holidayRegion",
    "weeklyMinutes",
    "timeZone",
    "industry",
    "tariff",
    "manualMonthlyGrossCents",
    "nursingTrainingTariff",
    "vkaETariff",
    "tvlKrTariff",
    "tvUkNursingTariff",
    "tvhKrTariff",
    "tvalPflegeTariff",
    "regularRotatingNightWork",
    "sundayHolidayWorkEligible",
    "allEmploymentWorkRecorded",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EmploymentError {
    InvalidDate,
    AmbiguousHistory,
    InvalidInput,
    InvalidWorkPattern,
    InvalidOverrides,
}
impl fmt::Display for EmploymentError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidDate => "Bitte ein gültiges Gültigkeitsdatum angeben.",
            Self::AmbiguousHistory => "Mehrdeutige Vergütungshistorie.",
            Self::InvalidInput => "Die gespeicherten Beschäftigungsangaben sind ungültig.",
            Self::InvalidWorkPattern => "Das gespeicherte Schichtmodell ist ungültig.",
            Self::InvalidOverrides => "Die gespeicherte Zeitraumkorrektur ist ungültig.",
        })
    }
}
impl std::error::Error for EmploymentError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResolutionStatus {
    Dated,
    UnknownEffectiveDate,
    Missing,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RemunerationProfileResolution {
    pub status: ResolutionStatus,
    pub profile: Option<Value>,
}

pub fn require_remuneration_date(value: &str) -> Result<(), EmploymentError> {
    if value.len() != 10
        || value.as_bytes()[4] != b'-'
        || value.as_bytes()[7] != b'-'
        || value
            .bytes()
            .enumerate()
            .any(|(i, b)| i != 4 && i != 7 && !b.is_ascii_digit())
        || value < "1900-01-01"
    {
        return Err(EmploymentError::InvalidDate);
    }
    value
        .parse::<jiff::civil::Date>()
        .map(|_| ())
        .map_err(|_| EmploymentError::InvalidDate)
}
fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}
fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64().is_some_and(|n| n != 0.0),
        Value::String(value) => !value.is_empty(),
        Value::Object(_) | Value::Array(_) => true,
    }
}
fn has_truthy(value: &Value, key: &str) -> bool {
    value.get(key).is_some_and(truthy)
}
fn history(profile: &Value) -> Result<&[Value], EmploymentError> {
    history_value(profile.get("employmentTimeline"))
}
fn history_value(value: Option<&Value>) -> Result<&[Value], EmploymentError> {
    match value {
        Some(Value::Array(items)) => Ok(items),
        Some(Value::Null) | None => Ok(&[]),
        _ => Err(EmploymentError::InvalidInput),
    }
}
fn merged(base: &Value, overlay: &Value) -> Result<Value, EmploymentError> {
    let mut result = base
        .as_object()
        .cloned()
        .ok_or(EmploymentError::InvalidInput)?;
    for (key, value) in overlay.as_object().ok_or(EmploymentError::InvalidInput)? {
        result.insert(key.clone(), value.clone());
    }
    Ok(Value::Object(result))
}

pub fn resolve_remuneration_profile(
    profiles: &[Value],
    date: &str,
) -> Result<RemunerationProfileResolution, EmploymentError> {
    let resolved = resolve_remuneration_profile_ref(profiles, date)?;
    Ok(RemunerationProfileResolution {
        status: resolved.status,
        profile: resolved.profile.cloned(),
    })
}

/// Borrowed identity is required when adjacent remuneration days are coalesced.
/// Cloning a whole saved profile per calendar day would also copy all unrelated input fields.
#[derive(Debug, Clone, Copy)]
pub struct RemunerationProfileResolutionRef<'a> {
    pub status: ResolutionStatus,
    pub profile: Option<&'a Value>,
}
pub fn resolve_remuneration_profile_ref<'a>(
    profiles: &'a [Value],
    date: &str,
) -> Result<RemunerationProfileResolutionRef<'a>, EmploymentError> {
    require_remuneration_date(date)?;
    if profiles.len() > 50_000 {
        return Err(EmploymentError::InvalidInput);
    }
    let mut dates = BTreeSet::new();
    let (mut baseline, mut selected): (Option<&Value>, Option<&Value>) = (None, None);
    for profile in profiles {
        let on = profile
            .get("effectiveFrom")
            .ok_or(EmploymentError::InvalidInput)?;
        if !dates.insert(on.to_string()) {
            return Err(EmploymentError::AmbiguousHistory);
        }
        if on.is_null() {
            baseline = Some(profile)
        } else {
            let on = on.as_str().ok_or(EmploymentError::InvalidDate)?;
            require_remuneration_date(on)?;
            if on <= date
                && selected.is_none_or(|previous| {
                    text(previous, "effectiveFrom").is_none_or(|before| before < on)
                })
            {
                selected = Some(profile)
            }
        }
    }
    let (status, profile) = if let Some(selected) = selected {
        (ResolutionStatus::Dated, Some(selected))
    } else if let Some(baseline) = baseline {
        (ResolutionStatus::UnknownEffectiveDate, Some(baseline))
    } else {
        (ResolutionStatus::Missing, None)
    };
    Ok(RemunerationProfileResolutionRef { status, profile })
}

pub fn employment_profile_at(profile: &Value, date: &str) -> Result<Value, EmploymentError> {
    match employment_overlay_at(profile, date)? {
        Some(overlay) => merged(profile, overlay),
        None => Ok(profile.clone()),
    }
}

/// Borrowed selected employment overlay for request-local target/day caches.
/// None preserves the entire supplied base profile. Present null fields in an overlay
/// are explicit overrides and must not be treated as missing by a field-view adapter.
pub fn employment_overlay_at<'a>(
    profile: &'a Value,
    date: &str,
) -> Result<Option<&'a Value>, EmploymentError> {
    employment_overlay_from_fields(
        profile.get("salaryBasisConflict"),
        profile.get("employmentTimeline"),
        date,
    )
}
pub fn employment_overlay_from_fields<'a>(
    salary_basis_conflict: Option<&Value>,
    timeline: Option<&'a Value>,
    date: &str,
) -> Result<Option<&'a Value>, EmploymentError> {
    if salary_basis_conflict.is_some_and(truthy) {
        return Ok(None);
    }
    let history = history_value(timeline)?;
    employment_overlay_from_profiles(salary_basis_conflict, history, date)
}
/// Borrow the already checked history owner without constructing/cloning a
/// complete profile JSON object just to read one effective employment field.
pub fn employment_overlay_from_profiles<'a>(
    salary_basis_conflict: Option<&Value>,
    history: &'a [Value],
    date: &str,
) -> Result<Option<&'a Value>, EmploymentError> {
    if salary_basis_conflict.is_some_and(truthy) {
        return Ok(None);
    }
    if history.len() > 50_000 {
        return Err(EmploymentError::InvalidInput);
    }
    if !history.iter().any(|p| has_truthy(p, "employment")) {
        return Ok(None);
    }
    let selected = resolve_remuneration_profile_ref(history, date)?.profile;
    match selected.filter(|p| has_truthy(p, "employment")) {
        Some(selected) => selected["employment"]
            .as_object()
            .map(|_| Some(&selected["employment"]))
            .ok_or(EmploymentError::InvalidInput),
        None => Ok(None),
    }
}

pub fn employment_work_pattern_at(
    profile: &Value,
    fallback: &Value,
    date: &str,
) -> Result<Value, EmploymentError> {
    employment_work_pattern_from_history(profile, fallback, date, history(profile)?)
}

/// Explicit immutable timeline view for dated remuneration; no whole-profile clone.
pub fn employment_work_pattern_from_history(
    profile: &Value,
    fallback: &Value,
    date: &str,
    history: &[Value],
) -> Result<Value, EmploymentError> {
    let selected = if history.is_empty() {
        None
    } else {
        resolve_remuneration_profile_ref(history, date)?.profile
    };
    let answers = selected
        .as_ref()
        .and_then(|p| p.get("employment"))
        .and_then(|e| e.get("workPattern"))
        .filter(|v| !v.is_null())
        .or_else(|| profile.get("workPattern"));
    if let Some(answers) = answers.filter(|v| truthy(v)) {
        let updated = selected
            .as_ref()
            .and_then(|p| p.get("updatedAt"))
            .filter(|v| !v.is_null())
            .or_else(|| fallback.get("updatedAt"))
            .cloned()
            .unwrap_or(Value::Null);
        merged(answers, &json!({"updatedAt":updated}))
    } else {
        Ok(fallback.clone())
    }
}

/// Small source-owned boundaries without cloning the full effective profile.
#[derive(Debug, PartialEq, Eq)]
pub struct EmploymentMonthBoundary {
    pub from: String,
    pub until: Option<String>,
}
pub fn employment_month_boundaries(
    profile: &Value,
    month: &str,
    last_day: &str,
) -> Result<Vec<EmploymentMonthBoundary>, EmploymentError> {
    employment_month_boundaries_from_fields(profile.get("employmentTimeline"), month, last_day)
}
pub fn employment_month_boundaries_from_fields(
    timeline: Option<&Value>,
    month: &str,
    last_day: &str,
) -> Result<Vec<EmploymentMonthBoundary>, EmploymentError> {
    let first = format!("{month}-01");
    let mut starts = BTreeSet::from([first.clone()]);
    for item in history_value(timeline)? {
        if has_truthy(item, "employment")
            && let Some(on) =
                text(item, "effectiveFrom").filter(|on| *on > first.as_str() && *on <= last_day)
        {
            starts.insert(on.to_owned());
        }
    }
    let starts: Vec<_> = starts.into_iter().collect();
    Ok(starts
        .iter()
        .enumerate()
        .map(|(index, from)| EmploymentMonthBoundary {
            from: from.clone(),
            until: starts.get(index + 1).cloned(),
        })
        .collect())
}
pub fn employment_month_periods(
    profile: &Value,
    month: &str,
    last_day: &str,
) -> Result<Value, EmploymentError> {
    employment_month_boundaries(profile,month,last_day)?.iter().map(|period| {
        Ok(json!({"from":period.from,"until":period.until,"profile":employment_profile_at(profile,&period.from)?}))
    }).collect::<Result<Vec<_>,EmploymentError>>().map(Value::Array)
}

pub fn employment_timeline_key(profiles: &[Value]) -> Result<String, EmploymentError> {
    serde_json::to_string(profiles).map_err(|_| EmploymentError::InvalidInput)
}

/// Capture repairable editor intent. This intentionally does not validate salary/profile fields.
pub fn capture_employment_profile(profile: &Value) -> Result<Value, EmploymentError> {
    let profile = profile.as_object().ok_or(EmploymentError::InvalidInput)?;
    let mut result = serde_json::Map::new();
    for key in EMPLOYMENT_FIELDS {
        result.insert(
            (*key).to_owned(),
            profile.get(*key).cloned().unwrap_or(Value::Null),
        );
    }
    result.insert(
        "workPattern".into(),
        profile.get("workPattern").cloned().unwrap_or(Value::Null),
    );
    Ok(Value::Object(result))
}

pub fn validate_work_pattern(value: Option<&Value>) -> Result<Value, EmploymentError> {
    let Some(value) = value.filter(|v| !v.is_null()) else {
        return Ok(Value::Null);
    };
    let object = value
        .as_object()
        .ok_or(EmploymentError::InvalidWorkPattern)?;
    if object.len() != 2
        || !matches!(
            text(value, "workplaceCoverage"),
            Some("UNKNOWN" | "AROUND_THE_CLOCK" | "NOT_AROUND_THE_CLOCK")
        )
        || !matches!(
            text(value, "assignment"),
            Some("UNKNOWN" | "PERMANENT" | "TEMPORARY")
        )
    {
        return Err(EmploymentError::InvalidWorkPattern);
    }
    Ok(json!({"workplaceCoverage":value["workplaceCoverage"],"assignment":value["assignment"]}))
}

/// Frozen localeCompare order on this finite set of ASCII identifiers is ASCII case-fold order.
/// The oracle covers the complete allowed key set; this is not a general locale comparator.
pub fn validate_employment_overrides(value: &Value) -> Result<Value, EmploymentError> {
    let entries = value.as_object().ok_or(EmploymentError::InvalidOverrides)?;
    if entries.is_empty()
        || entries.len() > EMPLOYMENT_FIELDS.len() + 1
        || entries
            .keys()
            .any(|key| !EMPLOYMENT_FIELDS.contains(&key.as_str()) && key != "workPattern")
    {
        return Err(EmploymentError::InvalidOverrides);
    }
    let mut keys: Vec<_> = entries.keys().collect();
    keys.sort_by_key(|key| key.to_ascii_lowercase());
    let mut output = serde_json::Map::new();
    for key in keys {
        let date = entries[key].as_str().ok_or(EmploymentError::InvalidDate)?;
        require_remuneration_date(date)?;
        output.insert(key.clone(), entries[key].clone());
    }
    Ok(Value::Object(output))
}
