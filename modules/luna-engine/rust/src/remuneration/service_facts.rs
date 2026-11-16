//! Saved TV-L/TVA-L service evidence, including actual burn-care intervals.
//! Optional activity evidence retains missing, null and explicitly empty states.
use super::{
    Presence,
    base::{BaseError, shift_days::remuneration_shift_days},
};
use crate::{
    EngineError,
    employment::{EmploymentError, require_remuneration_date, resolve_remuneration_profile_ref},
    input::{InputError, require_instant, simple_profile::js_milliseconds},
};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct BurnCareInterval {
    pub from: i64,
    pub until: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedTvlShiftWork<'a> {
    #[serde(skip_serializing_if = "Presence::is_missing")]
    pub burn_care_intervals: Presence<Vec<BurnCareInterval>>,
    pub shift_id: &'a str,
    pub shift_revision: i64,
    pub shift_date: &'a str,
    pub shift_updated_at: &'a str,
    pub time_zone: &'a str,
    pub profile_effective_from: &'a str,
    pub profile_revision: i64,
    pub shift_work: Option<bool>,
    pub revision: i64,
    pub confirmed_at: &'a str,
    pub updated_at: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServiceFactsError {
    Object,
    Format,
    ShiftId,
    Revision,
    ShiftWork,
    Zone,
    ConfirmationOrder,
    Intervals,
    ExceedsNetTime,
    OtherProfile,
    OutsideShift,
    Input(InputError),
    Employment(EmploymentError),
    Time(EngineError),
    Base(BaseError),
}
impl std::fmt::Display for ServiceFactsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Object => f.write_str("Ungültige TV-L-Dienstbestätigung."),
            Self::Format => f.write_str("Unbekanntes Format der TV-L-Dienstbestätigung."),
            Self::ShiftId => f.write_str("Ungültige Dienstzuordnung."),
            Self::Revision => f.write_str("Ungültige Bestätigungsrevision."),
            Self::ShiftWork => f.write_str("Bitte den Schichtarbeitsbezug ausdrücklich angeben."),
            Self::Zone => f.write_str("Ungültige Zeitzone."),
            Self::ConfirmationOrder => f.write_str("Ungültiger Bestätigungszeitpunkt."),
            Self::Intervals => {
                f.write_str("Bitte die tatsächlichen Schwerbrandpflegezeiten prüfen.")
            }
            Self::ExceedsNetTime => f.write_str(
                "Schwerbrandpflegezeiten überschreiten die tatsächliche Dienstzeit ohne Pause.",
            ),
            Self::OtherProfile => {
                f.write_str("Schwerbrandpflegezeit gehört zu einem anderen Vergütungszeitraum.")
            }
            Self::OutsideShift => {
                f.write_str("Schwerbrandpflegezeit liegt außerhalb des Dienstes.")
            }
            Self::Input(e) => e.fmt(f),
            Self::Employment(e) => e.fmt(f),
            Self::Time(e) => e.fmt(f),
            Self::Base(e) => e.fmt(f),
        }
    }
}
impl std::error::Error for ServiceFactsError {}
impl ServiceFactsError {
    pub fn class_name(&self) -> &str {
        match self {
            Self::Input(error) => error.name(),
            Self::Employment(EmploymentError::InvalidDate | EmploymentError::AmbiguousHistory) => {
                "RemunerationProfileError"
            }
            Self::Time(EngineError::InvalidTimeZone) => "RangeError",
            _ => "Error",
        }
    }
}
impl From<InputError> for ServiceFactsError {
    fn from(e: InputError) -> Self {
        Self::Input(e)
    }
}
impl From<EmploymentError> for ServiceFactsError {
    fn from(e: EmploymentError) -> Self {
        Self::Employment(e)
    }
}
impl From<EngineError> for ServiceFactsError {
    fn from(e: EngineError) -> Self {
        Self::Time(e)
    }
}
impl From<BaseError> for ServiceFactsError {
    fn from(e: BaseError) -> Self {
        Self::Base(e)
    }
}

fn integer(value: &Value) -> Option<i64> {
    let number = value.as_f64()?;
    (number.is_finite()
        && number.fract() == 0.0
        && number.abs() <= crate::money::MAX_SAFE_INTEGER as f64)
        .then_some(number as i64)
}
pub fn validate_burn_care_intervals(
    value: &Value,
) -> Result<Option<Vec<BurnCareInterval>>, ServiceFactsError> {
    if value.is_null() {
        return Ok(None);
    }
    let rows = value
        .as_array()
        .filter(|rows| rows.len() <= 96)
        .ok_or(ServiceFactsError::Intervals)?;
    let mut end = 0;
    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        let object = row
            .as_object()
            .filter(|o| o.len() == 2 && o.contains_key("from") && o.contains_key("until"))
            .ok_or(ServiceFactsError::Intervals)?;
        let from = integer(&object["from"]).ok_or(ServiceFactsError::Intervals)?;
        let until = integer(&object["until"]).ok_or(ServiceFactsError::Intervals)?;
        if from < end || until <= from || until > 1500 {
            return Err(ServiceFactsError::Intervals);
        }
        end = until;
        result.push(BurnCareInterval { from, until });
    }
    Ok(Some(result))
}

pub fn validate_tvl_shift_work(value: &Value) -> Result<SavedTvlShiftWork<'_>, ServiceFactsError> {
    let object = value.as_object().ok_or(ServiceFactsError::Object)?;
    let keys = [
        "shiftId",
        "shiftRevision",
        "shiftDate",
        "shiftUpdatedAt",
        "timeZone",
        "profileEffectiveFrom",
        "profileRevision",
        "shiftWork",
        "revision",
        "confirmedAt",
        "updatedAt",
    ];
    let burn = object.get("burnCareIntervals");
    if object.len() != keys.len() + usize::from(burn.is_some())
        || keys.iter().any(|key| !object.contains_key(*key))
    {
        return Err(ServiceFactsError::Format);
    }
    let shift_id = value["shiftId"]
        .as_str()
        .filter(|s| {
            !s.trim_matches(super::own_config::javascript_space)
                .is_empty()
                && s.encode_utf16().count() <= 200
        })
        .ok_or(ServiceFactsError::ShiftId)?;
    let revision = |key: &str| {
        integer(&value[key])
            .filter(|n| *n >= 1)
            .ok_or(ServiceFactsError::Revision)
    };
    let shift_revision = revision("shiftRevision")?;
    let profile_revision = revision("profileRevision")?;
    let revision = revision("revision")?;
    let shift_work = match &value["shiftWork"] {
        Value::Null => None,
        Value::Bool(v) => Some(*v),
        _ => return Err(ServiceFactsError::ShiftWork),
    };
    let time_zone = value["timeZone"]
        .as_str()
        .filter(|s| !s.is_empty() && !s.starts_with(['+', '-']))
        .ok_or(ServiceFactsError::Zone)?;
    crate::time_zone::zone(time_zone)?;
    let confirmed_at = require_instant(&value["confirmedAt"], "Bestätigung")?;
    let updated_at = require_instant(&value["updatedAt"], "Aktualisierung")?;
    if js_milliseconds(&value["confirmedAt"])
        .zip(js_milliseconds(&value["updatedAt"]))
        .is_some_and(|(a, b)| a > b)
    {
        return Err(ServiceFactsError::ConfirmationOrder);
    }
    let burn_care_intervals = match burn {
        None => Presence::Missing,
        Some(v) => match validate_burn_care_intervals(v)? {
            None => Presence::Null,
            Some(v) => Presence::Value(v),
        },
    };
    let date = |key: &str| -> Result<&str, ServiceFactsError> {
        let text = value[key].as_str().ok_or(EmploymentError::InvalidDate)?;
        require_remuneration_date(text)?;
        Ok(text)
    };
    let shift_date = date("shiftDate")?;
    let shift_updated_at = require_instant(&value["shiftUpdatedAt"], "Dienständerung")?;
    let profile_effective_from = date("profileEffectiveFrom")?;
    Ok(SavedTvlShiftWork {
        burn_care_intervals,
        shift_id,
        shift_revision,
        shift_date,
        shift_updated_at,
        time_zone,
        profile_effective_from,
        profile_revision,
        shift_work,
        revision,
        confirmed_at,
        updated_at,
    })
}

/// Matches the source's raw-record predicate, including undefined versus null.
/// This predicate does not validate the record; use validate_tvl_shift_work at admission.
fn source_equal(left: Option<&Value>, right: Option<&Value>) -> bool {
    match (left, right) {
        (Some(Value::Number(left)), Some(Value::Number(right))) => left.as_f64() == right.as_f64(),
        _ => left == right,
    }
}
fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64().is_some_and(|value| value != 0.0),
        Value::String(value) => !value.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}
pub fn is_current_tvl_service_facts(
    value: &Value,
    shift: &Value,
    time_zone: &str,
    profile: &Value,
) -> bool {
    source_equal(value.get("shiftId"), shift.get("id"))
        && source_equal(value.get("shiftRevision"), shift.get("revision"))
        && source_equal(value.get("shiftDate"), shift.get("date"))
        && source_equal(value.get("shiftUpdatedAt"), shift.get("updatedAt"))
        && shift.get("deletedAt") == Some(&Value::Null)
        && !truthy(&shift["allDay"])
        && shift.get("startTime") != Some(&Value::Null)
        && shift.get("endTime") != Some(&Value::Null)
        && !matches!(shift["type"].as_str(), Some("VACATION" | "SICK" | "FREE"))
        && value["timeZone"] == time_zone
        && source_equal(
            value.get("profileEffectiveFrom"),
            profile.get("effectiveFrom"),
        )
        && source_equal(value.get("profileRevision"), profile.get("revision"))
        && profile["data"]["selection"]["kind"] == "tariff"
        && matches!(
            profile["data"]["selection"]["packageId"].as_str(),
            Some("tvl-kr-tdl" | "tval-pflege-tdl")
        )
}
pub fn is_current_tvl_shift_work(
    value: &Value,
    shift: &Value,
    time_zone: &str,
    profile: &Value,
) -> bool {
    value.get("shiftWork") != Some(&Value::Null)
        && is_current_tvl_service_facts(value, shift, time_zone, profile)
}

pub fn require_burn_care_interval_parents(
    intervals: &[BurnCareInterval],
    shift: &Value,
    time_zone: &str,
    profile: &Value,
    history: &[Value],
) -> Result<(), ServiceFactsError> {
    let days = remuneration_shift_days(shift, time_zone)?;
    let total = intervals
        .iter()
        .map(|i| (i.until - i.from) as f64)
        .sum::<f64>();
    if days.is_empty() || total > days.iter().map(|d| d.net_minutes).sum::<f64>() {
        return Err(ServiceFactsError::ExceedsNetTime);
    }
    for interval in intervals {
        let mut covered = 0.0;
        for day in &days {
            let duration = 0.0_f64
                .max(day.until.min(interval.until as f64) - day.from.max(interval.from as f64));
            if duration != 0.0
                && !resolve_remuneration_profile_ref(history, &day.date)?
                    .profile
                    .is_some_and(|p| std::ptr::eq(p, profile))
            {
                return Err(ServiceFactsError::OtherProfile);
            }
            covered += duration;
        }
        if covered != (interval.until - interval.from) as f64 {
            return Err(ServiceFactsError::OutsideShift);
        }
    }
    Ok(())
}
