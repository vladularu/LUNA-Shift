use crate::{
    EngineError,
    rules::{RuleResolutionFailure, holidays::HolidayError},
};
use jiff::Zoned;
use serde_json::{Value, json};
use std::{
    fmt,
    sync::{Arc, OnceLock},
};

#[derive(Debug)]
pub enum ComplianceError {
    InvalidInput,
    Calculation(EngineError),
    Rules(RuleResolutionFailure),
    Holiday(HolidayError),
    Employment(crate::employment::EmploymentError),
}
impl fmt::Display for ComplianceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidInput => f.write_str("Die Angaben zur Arbeitszeitprüfung sind ungültig."),
            Self::Calculation(e) => fmt::Display::fmt(e, f),
            Self::Rules(e) => fmt::Display::fmt(e, f),
            Self::Holiday(e) => fmt::Display::fmt(e, f),
            Self::Employment(e) => fmt::Display::fmt(e, f),
        }
    }
}
impl std::error::Error for ComplianceError {}
impl From<EngineError> for ComplianceError {
    fn from(e: EngineError) -> Self {
        Self::Calculation(e)
    }
}
impl From<RuleResolutionFailure> for ComplianceError {
    fn from(e: RuleResolutionFailure) -> Self {
        Self::Rules(e)
    }
}
impl From<HolidayError> for ComplianceError {
    fn from(e: HolidayError) -> Self {
        Self::Holiday(e)
    }
}
impl From<crate::employment::EmploymentError> for ComplianceError {
    fn from(e: crate::employment::EmploymentError) -> Self {
        Self::Employment(e)
    }
}
impl ComplianceError {
    pub fn source_error_name(&self) -> &'static str {
        match self {
            Self::Rules(_) | Self::Holiday(HolidayError::Resolution(_)) => "RuleResolutionError",
            _ => "Error",
        }
    }
}
#[derive(Debug, Clone)]
pub struct ComplianceInterval {
    pub shift: Arc<Value>,
    pub start: Zoned,
    pub end: Zoned,
    pub gross_minutes: f64,
    pub net_minutes: f64,
    pub(crate) night_minutes_cache: Arc<OnceLock<(i64, i64, f64)>>,
}
impl ComplianceInterval {
    pub fn to_json(&self) -> Value {
        json!({"shift":self.shift.as_ref(),"start":self.start.to_string(),"end":self.end.to_string(),"grossMinutes":self.gross_minutes,"netMinutes":self.net_minutes})
    }
}

pub(crate) fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, ComplianceError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or(ComplianceError::InvalidInput)
}
pub(crate) fn number(value: &Value, key: &str) -> Result<f64, ComplianceError> {
    value
        .get(key)
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
        .ok_or(ComplianceError::InvalidInput)
}
pub(crate) fn integer(value: &Value, key: &str) -> Result<i64, ComplianceError> {
    let number = number(value, key)?;
    if number.fract() != 0.0 || number.abs() > 9_007_199_254_740_991.0 {
        return Err(ComplianceError::InvalidInput);
    }
    Ok(number as i64)
}
pub(crate) fn optional_integer(value: &Value, key: &str) -> Result<i64, ComplianceError> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(0),
        Some(_) => integer(value, key),
    }
}
pub(crate) fn array<'a>(value: &'a Value, key: &str) -> Result<&'a [Value], ComplianceError> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .ok_or(ComplianceError::InvalidInput)
}
pub(crate) fn js_round(value: f64) -> Result<f64, ComplianceError> {
    if !value.is_finite() {
        return Err(ComplianceError::InvalidInput);
    }
    let floor = value.floor();
    Ok(if value - floor >= 0.5 {
        floor + 1.0
    } else {
        floor
    })
}
pub(crate) fn number_label(value: f64) -> Result<String, ComplianceError> {
    if !value.is_finite() {
        return Err(ComplianceError::InvalidInput);
    }
    Ok(if value == 0.0 {
        "0".to_owned()
    } else {
        value.to_string()
    })
}
pub(crate) fn minutes_between(start: &Zoned, end: &Zoned) -> Result<f64, ComplianceError> {
    let delta = end
        .timestamp()
        .as_millisecond()
        .checked_sub(start.timestamp().as_millisecond())
        .ok_or(EngineError::Overflow)?;
    js_round(delta as f64 / 60_000.0)
}
pub(crate) fn zoned_minute(
    date: jiff::civil::Date,
    minute: i64,
    tz: &jiff::tz::TimeZone,
    disambiguation: jiff::tz::Disambiguation,
) -> Result<Zoned, ComplianceError> {
    if !(0..1440).contains(&minute) {
        return Err(ComplianceError::InvalidInput);
    }
    let clock = jiff::civil::Time::new((minute / 60) as i8, (minute % 60) as i8, 0, 0)
        .map_err(|_| ComplianceError::InvalidInput)?;
    tz.to_ambiguous_zoned(date.to_datetime(clock))
        .disambiguate(disambiguation)
        .map_err(|_| EngineError::InvalidTime.into())
}

pub fn night_work_minutes(
    interval: &ComplianceInterval,
    rules: &Value,
) -> Result<f64, ComplianceError> {
    use jiff::{ToSpan, tz::Disambiguation};
    let night = &rules["nightWork"];
    let start_minute = integer(night, "startMinute")?;
    let end_minute = integer(night, "endMinute")?;
    if let Some(&(start, end, total)) = interval.night_minutes_cache.get()
        && start == start_minute
        && end == end_minute
    {
        return Ok(total);
    }
    let zone = interval.start.time_zone();
    let mut date = interval
        .start
        .date()
        .checked_sub(1.days())
        .map_err(|_| EngineError::InvalidDate)?;
    let last = interval.end.date();
    let mut total = 0.0;
    while date <= last {
        let night_start = zoned_minute(
            date,
            start_minute,
            zone,
            if start_minute / 60 < 12 {
                Disambiguation::Later
            } else {
                Disambiguation::Earlier
            },
        )?;
        let end_date = if end_minute <= start_minute {
            date.checked_add(1.days())
                .map_err(|_| EngineError::InvalidDate)?
        } else {
            date
        };
        let night_end = zoned_minute(
            end_date,
            end_minute,
            zone,
            if end_minute / 60 < 12 {
                Disambiguation::Later
            } else {
                Disambiguation::Earlier
            },
        )?;
        let start = if interval.start.timestamp() > night_start.timestamp() {
            &interval.start
        } else {
            &night_start
        };
        let end = if interval.end.timestamp() < night_end.timestamp() {
            &interval.end
        } else {
            &night_end
        };
        if end.timestamp() > start.timestamp() {
            total += minutes_between(start, end)?;
        }
        date = date
            .checked_add(1.days())
            .map_err(|_| EngineError::InvalidDate)?;
    }
    let _ = interval
        .night_minutes_cache
        .set((start_minute, end_minute, total));
    Ok(total)
}
pub fn is_night_work(
    interval: &ComplianceInterval,
    rules: &Value,
) -> Result<bool, ComplianceError> {
    let minutes = night_work_minutes(interval, rules)?;
    let qualification = &rules["nightWork"]["qualification"];
    let threshold = number(qualification, "thresholdMinutes")?;
    match text(qualification, "comparator")? {
        "GT" => Ok(minutes > threshold),
        "GTE" => Ok(minutes >= threshold),
        "EQ" => Ok(minutes == threshold),
        _ => Err(ComplianceError::InvalidInput),
    }
}

pub fn qualify_as_night_worker(
    intervals: &[ComplianceInterval],
    rules: &Value,
    version: u32,
    calendar_year: i16,
    options: &Value,
) -> Result<bool, ComplianceError> {
    if version >= 3 && options["regularRotatingNightWork"] == true {
        return Ok(true);
    }
    let qualification = rules["nightWork"].get("workerQualification");
    if version >= 3 && qualification.is_none() {
        return Ok(false);
    }
    let threshold = if version < 3 {
        1
    } else {
        integer(
            qualification.ok_or(ComplianceError::InvalidInput)?,
            "annualNightWorkDaysThreshold",
        )?
    };
    let prefix = format!("{calendar_year}-");
    let mut dates = std::collections::BTreeSet::new();
    for interval in intervals {
        let date = text(&interval.shift, "date")?;
        if date.starts_with(&prefix) && is_night_work(interval, rules)? {
            dates.insert(date);
            if dates.len() as i64 >= threshold {
                return Ok(true);
            }
        }
    }
    Ok(false)
}
