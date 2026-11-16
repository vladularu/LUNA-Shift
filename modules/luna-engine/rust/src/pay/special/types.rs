use crate::{
    EngineError,
    employment::EmploymentError,
    pay::{families::FamilyError, tariff::TariffError},
    rules::holidays::HolidayError,
};
use serde::Serialize;
use serde_json::{Value, json};
use std::{collections::BTreeSet, fmt};

#[derive(Debug)]
pub enum SpecialDutyError {
    InvalidInput,
    Calculation(EngineError),
    Employment(EmploymentError),
    Family(FamilyError),
    Tariff(TariffError),
    Holiday(HolidayError),
}
impl fmt::Display for SpecialDutyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidInput => {
                f.write_str("Die Abrechnung des Sonderdienstes ist unvollständig.")
            }
            Self::Calculation(e) => fmt::Display::fmt(e, f),
            Self::Employment(e) => fmt::Display::fmt(e, f),
            Self::Family(e) => fmt::Display::fmt(e, f),
            Self::Tariff(e) => fmt::Display::fmt(e, f),
            Self::Holiday(e) => fmt::Display::fmt(e, f),
        }
    }
}
impl std::error::Error for SpecialDutyError {}
impl From<EngineError> for SpecialDutyError {
    fn from(e: EngineError) -> Self {
        Self::Calculation(e)
    }
}
impl From<EmploymentError> for SpecialDutyError {
    fn from(e: EmploymentError) -> Self {
        Self::Employment(e)
    }
}
impl From<FamilyError> for SpecialDutyError {
    fn from(e: FamilyError) -> Self {
        Self::Family(e)
    }
}
impl From<TariffError> for SpecialDutyError {
    fn from(e: TariffError) -> Self {
        Self::Tariff(e)
    }
}
impl From<HolidayError> for SpecialDutyError {
    fn from(e: HolidayError) -> Self {
        Self::Holiday(e)
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DutyOvertimeRates {
    pub base_hourly_cents: i64,
    pub premium_hourly_cents: i64,
    pub premium_basis_points: i64,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StandbyHourlyRate {
    pub cents: i64,
    pub group: String,
    pub source: String,
}
#[derive(Debug, Clone)]
pub struct SpecialDutyTimeAccount {
    pub lines: Vec<Value>,
    pub notes: Vec<String>,
    pub ids: BTreeSet<String>,
    pub credited_minutes: Option<f64>,
}
impl SpecialDutyTimeAccount {
    pub fn to_json(&self) -> Value {
        json!({"lines":self.lines,"notes":self.notes,"ids":{"$type":"Set","values":self.ids},"creditedMinutes":self.credited_minutes})
    }
}

pub(super) fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, SpecialDutyError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or(SpecialDutyError::InvalidInput)
}
pub(super) fn numeric(value: &Value, key: &str) -> Result<f64, SpecialDutyError> {
    value
        .get(key)
        .and_then(Value::as_f64)
        .filter(|number| number.is_finite())
        .ok_or(SpecialDutyError::InvalidInput)
}
pub(super) fn integer(value: &Value, key: &str) -> Result<i64, SpecialDutyError> {
    value
        .get(key)
        .and_then(Value::as_i64)
        .ok_or(SpecialDutyError::InvalidInput)
}
pub(super) fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) | Some(Value::Bool(false)) => false,
        Some(Value::Number(number)) => number.as_f64().is_some_and(|value| value != 0.0),
        Some(Value::String(text)) => !text.is_empty(),
        _ => true,
    }
}
pub(super) fn duty(shift: &Value) -> Result<&Value, SpecialDutyError> {
    shift
        .get("specialDuty")
        .filter(|value| value.is_object())
        .ok_or(SpecialDutyError::InvalidInput)
}
pub(super) fn clock_minute(clock: &str) -> Result<i64, SpecialDutyError> {
    let time: jiff::civil::Time = clock.parse().map_err(|_| SpecialDutyError::InvalidInput)?;
    Ok(i64::from(time.hour()) * 60 + i64::from(time.minute()))
}
pub(super) fn instant(shift: &Value, minute: i64) -> Result<i64, SpecialDutyError> {
    let zone = crate::time::zone(text(duty(shift)?, "timeZone")?)?;
    Ok(crate::time::duty_instant(
        text(shift, "date")?,
        minute,
        &zone,
    )?)
}
pub(super) fn zoned(milliseconds: i64, zone: &str) -> Result<jiff::Zoned, SpecialDutyError> {
    Ok(jiff::Timestamp::from_millisecond(milliseconds)
        .map_err(|_| SpecialDutyError::Calculation(EngineError::Overflow))?
        .to_zoned(crate::time::zone(zone)?))
}
pub(super) fn duty_end_minute(shift: &Value) -> Result<i64, SpecialDutyError> {
    let end = clock_minute(text(shift, "endTime")?)?;
    integer(duty(shift)?, "endDay")?
        .checked_mul(1440)
        .and_then(|day| day.checked_add(end))
        .ok_or(SpecialDutyError::Calculation(EngineError::Overflow))
}
pub(super) fn bounds(shift: &Value) -> Result<(i64, i64), SpecialDutyError> {
    Ok((
        instant(shift, clock_minute(text(shift, "startTime")?)?)?,
        instant(shift, duty_end_minute(shift)?)?,
    ))
}
pub(super) fn actual_minutes(shift: &Value) -> Result<f64, SpecialDutyError> {
    use num_traits::ToPrimitive;
    let parts = crate::credit::duty::parts(shift)?;
    let mut total = 0.0;
    for part in parts {
        let elapsed = (instant(shift, part.end)? - instant(shift, part.start)?) as f64 / 60000.0;
        total += (elapsed
            - part
                .break_minutes
                .to_f64()
                .ok_or(SpecialDutyError::InvalidInput)?)
        .max(0.0);
    }
    Ok(total)
}
pub(super) fn round_integer(number: f64) -> Result<i64, SpecialDutyError> {
    if !number.is_finite() || !(0.0..=crate::money::MAX_SAFE_INTEGER as f64).contains(&number) {
        return Err(SpecialDutyError::InvalidInput);
    }
    Ok((number + 0.5).floor() as i64)
}
pub(super) fn amount_cents(
    rate: i64,
    minutes: f64,
    multiplier: f64,
) -> Result<i64, SpecialDutyError> {
    let minutes = round_integer(minutes * 10000.0)?;
    let multiplier = round_integer(multiplier * 10000.0)?;
    let numerator = i128::from(rate)
        .checked_mul(i128::from(minutes))
        .and_then(|n| n.checked_mul(i128::from(multiplier)))
        .ok_or(SpecialDutyError::Calculation(EngineError::Overflow))?;
    half_up(numerator, 6_000_000_000)
}
pub(super) fn half_up(numerator: i128, denominator: i128) -> Result<i64, SpecialDutyError> {
    if numerator < 0 || denominator <= 0 {
        return Err(SpecialDutyError::InvalidInput);
    }
    let value = numerator
        .checked_mul(2)
        .and_then(|n| n.checked_add(denominator))
        .ok_or(SpecialDutyError::Calculation(EngineError::Overflow))?
        / (2 * denominator);
    i64::try_from(value).map_err(|_| SpecialDutyError::Calculation(EngineError::Overflow))
}
pub(super) fn unique(values: Vec<String>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    values
        .into_iter()
        .filter(|value| seen.insert(value.clone()))
        .collect()
}
pub(super) fn label(kind: &str) -> Result<&'static str, SpecialDutyError> {
    match kind {
        "SPLIT" => Ok("Geteilter Dienst"),
        "ON_CALL" => Ok("Rufbereitschaft"),
        "STANDBY" => Ok("Bereitschaftsdienst"),
        _ => Err(SpecialDutyError::InvalidInput),
    }
}
