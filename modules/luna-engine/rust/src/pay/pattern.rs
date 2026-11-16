//! Existing tariff work-pattern assessment, independently of legal checks.
pub mod calendar_nights;
use crate::{
    EngineError,
    calendar::parse_date,
    rules::{RulePackage, RuleResolver},
    time::clock,
};
use jiff::ToSpan;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WorkplaceCoverage {
    #[default]
    Unknown,
    AroundTheClock,
    NotAroundTheClock,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Assignment {
    #[default]
    Unknown,
    Permanent,
    Temporary,
}
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkPatternSettings {
    pub workplace_coverage: WorkplaceCoverage,
    pub assignment: Assignment,
    pub updated_at: Option<String>,
}
#[derive(Debug, Clone, Copy)]
pub struct CalendarNightEvidence {
    pub met: bool,
    pub count: usize,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PatternError {
    Time(EngineError),
    InvalidPolicy,
    InvalidInput,
    InvalidRuleDate,
}
impl From<EngineError> for PatternError {
    fn from(error: EngineError) -> Self {
        Self::Time(error)
    }
}
impl std::fmt::Display for PatternError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Time(e) => e.fmt(f),
            Self::InvalidPolicy => f.write_str("Invalid work-pattern rules"),
            Self::InvalidInput => f.write_str("Invalid work-pattern inputs"),
            Self::InvalidRuleDate => f.write_str("Das Regeldatum muss im Prüfmonat liegen."),
        }
    }
}
impl std::error::Error for PatternError {}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TimeWindow {
    start_minute: f64,
    end_minute: f64,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowBoundaries {
    night_end_minute: f64,
    night_start_minute: f64,
    early_end_minute: f64,
    day_end_minute: f64,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PatternPolicy {
    assessment_lookback_months: i64,
    shift_window_boundaries: WindowBoundaries,
    night_window: TimeWindow,
    night_qualification_minutes: f64,
    recurring_window_months: i32,
    recurring_night_shift_count: usize,
    regular_change_count: usize,
    alternating_minimum_shifts: usize,
    alternating_minimum_windows: usize,
    shift_work_minimum_shifts: usize,
    shift_work_minimum_windows: usize,
}

fn fallback_policy() -> Result<&'static PatternPolicy, PatternError> {
    static POLICY: OnceLock<Result<PatternPolicy, PatternError>> = OnceLock::new();
    POLICY
        .get_or_init(|| {
            let data: Value = serde_json::from_str(include_str!("../rules/bundled.json"))
                .map_err(|_| PatternError::InvalidPolicy)?;
            let p = data["catalog"]["tariff"]
                .as_array()
                .and_then(|p| p.last())
                .ok_or(PatternError::InvalidPolicy)?;
            PatternPolicy::deserialize(&p["rules"]["workPatternPolicy"])
                .map_err(|_| PatternError::InvalidPolicy)
        })
        .as_ref()
        .map_err(Clone::clone)
}

/// The original allowance selector uses the last bundled policy when tariff
/// resolution is unavailable. Assessment availability remains a separate result.
pub(crate) fn assessment_lookback_months(
    date: &str,
    resolver: &RuleResolver,
) -> Result<i64, PatternError> {
    match super::tariff::get_tariff_rule_package(date, resolver) {
        Some(package) => package.rules()["workPatternPolicy"]["assessmentLookbackMonths"]
            .as_i64()
            .ok_or(PatternError::InvalidPolicy),
        None => Ok(fallback_policy()?.assessment_lookback_months),
    }
}

pub fn is_pay_work_shift(shift: &Value) -> bool {
    shift
        .get("specialDuty")
        .is_none_or(|d| d.is_null() || d == &Value::Bool(false))
        && shift.get("allDay").and_then(Value::as_bool) != Some(true)
        && matches!(
            shift.get("type").and_then(Value::as_str),
            Some("EARLY" | "LATE" | "NIGHT" | "DAY" | "CUSTOM")
        )
        && shift.get("startTime").and_then(Value::as_str).is_some()
        && shift.get("endTime").and_then(Value::as_str).is_some()
}
fn shift_clock(shift: &Value, key: &str) -> Result<f64, PatternError> {
    let time = clock(
        shift
            .get(key)
            .and_then(Value::as_str)
            .ok_or(PatternError::InvalidInput)?,
    )?;
    Ok(f64::from(time.hour()) * 60.0 + f64::from(time.minute()))
}
fn shift_window(shift: &Value, policy: &PatternPolicy) -> Result<&'static str, PatternError> {
    let minute = shift_clock(shift, "startTime")?;
    let b = &policy.shift_window_boundaries;
    Ok(
        if minute < b.night_end_minute || minute >= b.night_start_minute {
            "Nacht"
        } else if minute < b.early_end_minute {
            "Früh"
        } else if minute < b.day_end_minute {
            "Tag"
        } else {
            "Spät"
        },
    )
}
fn overlap(start: f64, end: f64, from: f64, until: f64) -> f64 {
    (end.min(until) - start.max(from)).max(0.0)
}
fn window_overlap(start: f64, end: f64, window: &TimeWindow) -> f64 {
    (-1..=2)
        .map(|day| {
            let day = f64::from(day) * 1440.0;
            if window.start_minute < window.end_minute {
                overlap(
                    start,
                    end,
                    day + window.start_minute,
                    day + window.end_minute,
                )
            } else {
                overlap(start, end, day + window.start_minute, day + 1440.0)
                    + overlap(start, end, day, day + window.end_minute)
            }
        })
        .sum()
}
fn tariff_night_minutes(shift: &Value, policy: &PatternPolicy) -> Result<f64, PatternError> {
    let start = shift_clock(shift, "startTime")?;
    let raw_end = shift_clock(shift, "endTime")?;
    let end = raw_end + if raw_end <= start { 1440.0 } else { 0.0 };
    let gross = (end - start).max(0.0);
    let pause = shift
        .get("breakMinutes")
        .and_then(Value::as_f64)
        .ok_or(PatternError::InvalidInput)?
        .min(gross);
    let pause_start = start + ((gross - pause) / 2.0).floor();
    let pause_end = pause_start + pause;
    Ok(window_overlap(start, end, &policy.night_window)
        - window_overlap(pause_start, pause_end, &policy.night_window))
}

pub fn assess_tvoed_pattern(
    shifts: &[Value],
    settings: &WorkPatternSettings,
    resolver: &RuleResolver,
    effective_date: Option<&str>,
    calendar_evidence: Option<CalendarNightEvidence>,
    tariff_override: Option<&RulePackage>,
) -> Result<Value, PatternError> {
    let refs: Vec<&Value> = shifts.iter().collect();
    assess_tvoed_pattern_refs(
        &refs,
        settings,
        resolver,
        effective_date,
        calendar_evidence,
        tariff_override,
    )
}

pub(crate) fn assess_tvoed_pattern_refs(
    shifts: &[&Value],
    settings: &WorkPatternSettings,
    resolver: &RuleResolver,
    effective_date: Option<&str>,
    calendar_evidence: Option<CalendarNightEvidence>,
    tariff_override: Option<&RulePackage>,
) -> Result<Value, PatternError> {
    let mut work: Vec<&Value> = shifts
        .iter()
        .copied()
        .filter(|s| is_pay_work_shift(s))
        .collect();
    work.sort_by(|a, b| {
        a["date"]
            .as_str()
            .cmp(&b["date"].as_str())
            .then_with(|| a["startTime"].as_str().cmp(&b["startTime"].as_str()))
    });
    let effective_date = effective_date
        .or_else(|| work.last().and_then(|s| s["date"].as_str()))
        .unwrap_or("");
    let resolved = tariff_override.or_else(|| resolver.resolve_tariff(effective_date, None).ok());
    let local = resolved
        .and_then(|p| p.rules().get("workPatternPolicy"))
        .filter(|v| !v.is_null())
        .map(|v| PatternPolicy::deserialize(v).map_err(|_| PatternError::InvalidPolicy))
        .transpose()?;
    let policy = match local {
        Some(ref policy) => policy,
        None => fallback_policy()?,
    };
    let ordered = work
        .iter()
        .map(|s| shift_window(s, policy))
        .collect::<Result<Vec<_>, _>>()?;
    let mut windows = Vec::new();
    for window in &ordered {
        if !windows.contains(window) {
            windows.push(*window);
        }
    }
    let mut nights = Vec::new();
    for shift in &work {
        if tariff_night_minutes(shift, policy)? >= policy.night_qualification_minutes {
            nights.push(*shift);
        }
    }
    let night_count = calendar_evidence.map_or(nights.len(), |e| e.count);
    let changes = ordered.windows(2).filter(|pair| pair[0] != pair[1]).count();
    let regular = changes >= policy.regular_change_count;
    let recurring = if let Some(evidence) = calendar_evidence {
        evidence.met
    } else {
        let mut recurring = false;
        for (index, night) in nights.iter().enumerate() {
            let date = night["date"].as_str().ok_or(PatternError::InvalidInput)?;
            let deadline = parse_date(date)?
                .checked_add(policy.recurring_window_months.months())
                .map_err(|_| PatternError::InvalidInput)?
                .to_string();
            if nights[index + 1..]
                .iter()
                .filter(|s| s["date"].as_str().is_some_and(|d| d <= deadline.as_str()))
                .count()
                >= policy.recurring_night_shift_count.saturating_sub(1)
            {
                recurring = true;
                break;
            }
        }
        recurring
    };
    let alternating = work.len() >= policy.alternating_minimum_shifts
        && windows.len() >= policy.alternating_minimum_windows
        && recurring
        && regular;
    let shift_state = if work.is_empty() {
        "NOT_DETECTED"
    } else if work.len() >= policy.shift_work_minimum_shifts
        && windows.len() >= policy.shift_work_minimum_windows
        && regular
    {
        "DETECTED"
    } else {
        "REVIEW"
    };
    let alternating_state = if work.is_empty()
        || night_count == 0
        || settings.workplace_coverage == WorkplaceCoverage::NotAroundTheClock
    {
        "NOT_DETECTED"
    } else if alternating && settings.workplace_coverage == WorkplaceCoverage::AroundTheClock {
        "DETECTED"
    } else if alternating || windows.len() >= 2 {
        "REVIEW"
    } else {
        "NOT_DETECTED"
    };
    let detected = if alternating_state == "DETECTED" {
        Some("ALTERNATING")
    } else if shift_state == "DETECTED" {
        Some("SHIFT")
    } else {
        None
    };
    let requires_coverage =
        alternating && settings.workplace_coverage == WorkplaceCoverage::Unknown;
    let allowance = if requires_coverage {
        "NONE"
    } else {
        match (detected, settings.assignment) {
            (Some("ALTERNATING"), Assignment::Permanent) => "ALTERNATING_MONTHLY",
            (Some("ALTERNATING"), Assignment::Temporary) => "ALTERNATING_HOURLY",
            (Some("SHIFT"), Assignment::Permanent) => "SHIFT_MONTHLY",
            (Some("SHIFT"), Assignment::Temporary) => "SHIFT_HOURLY",
            _ => "NONE",
        }
    };
    let coverage_detail = match settings.workplace_coverage {
        WorkplaceCoverage::AroundTheClock => "Vom Nutzer bestätigt",
        WorkplaceCoverage::NotAroundTheClock => "Vom Nutzer verneint",
        WorkplaceCoverage::Unknown => "Kann nicht aus Dienstzeiten abgeleitet werden",
    };
    let coverage_state = match settings.workplace_coverage {
        WorkplaceCoverage::AroundTheClock => "MET",
        WorkplaceCoverage::NotAroundTheClock => "NOT_MET",
        WorkplaceCoverage::Unknown => "OPEN",
    };
    let assignment_detail = match settings.assignment {
        Assignment::Permanent => "Dauerhaft Teil der Stelle",
        Assignment::Temporary => "Nur gelegentlich oder vertretungsweise",
        Assignment::Unknown => "Kann nicht aus Kalendereinträgen abgeleitet werden",
    };
    let qualification = ((policy.night_qualification_minutes / 60.0) * 100.0 + 0.5).floor() / 100.0;
    Ok(json!({
      "shiftWork":shift_state,"alternatingShiftWork":alternating_state,"suggestedAllowance":allowance,"requiresConfirmation":requires_coverage || detected.is_some()&&settings.assignment==Assignment::Unknown,
      "evidence":[format!("{} Arbeitsdienste",work.len()),format!("{} Dienstlagen{}",windows.len(),if windows.is_empty(){String::new()}else{format!(": {}",windows.join(", "))}),format!("{changes} Wechsel der Dienstlage"),if night_count>0{format!("{night_count} Nachtschichten mit mindestens {qualification} Stunden Nachtarbeit")}else{"Keine tarifliche Nachtschicht erkannt".to_owned()}],
      "criteria":[
        {"key":"SHIFT_CHANGES","label":"Regelmäßiger Wechsel","detail":if regular{format!("{changes} Wechsel zwischen {} Dienstlagen erkannt",windows.len())}else{"Für eine belastbare Erkennung fehlen regelmäßige Wechsel".to_owned()},"state":if regular{"MET"}else if work.is_empty(){"NOT_MET"}else{"OPEN"}},
        {"key":"NIGHT_SHIFTS","label":"Wiederkehrende Nachtschichten","detail":if recurring{format!("Mindestens {} tarifliche Nachtschichten innerhalb von {} Monat(en) erkannt",policy.recurring_night_shift_count,policy.recurring_window_months)}else{format!("{night_count} tarifliche Nachtschichten im Prüfzeitraum erkannt")},"state":if recurring{"MET"}else if night_count==0{"NOT_MET"}else{"OPEN"}},
        {"key":"AROUND_THE_CLOCK","label":"Arbeitsbereich rund um die Uhr","detail":coverage_detail,"state":coverage_state},
        {"key":"ASSIGNMENT","label":"Dauerhafte Zuordnung","detail":assignment_detail,"state":if settings.assignment==Assignment::Unknown{"OPEN"}else{"MET"}}
      ]
    }))
}

pub use calendar_nights::assess_tvoed_k_calendar_month;
pub(crate) use calendar_nights::assess_tvoed_k_calendar_month_refs;
