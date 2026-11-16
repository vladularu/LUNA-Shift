//! Work-credit allocation and metadata-preserving duty projections.
pub mod analysis;
pub mod context;
pub mod daily;
pub mod duty;
pub mod interval;
pub mod metrics;
pub mod prepared;
pub mod summary;

use crate::EngineError;
use bigdecimal::BigDecimal;
use serde_json::{Number, Value};
use std::str::FromStr;

pub(crate) fn string<'a>(value: &'a Value, field: &str) -> Result<&'a str, EngineError> {
    value
        .get(field)
        .and_then(Value::as_str)
        .ok_or(EngineError::InvalidCalendarEntry)
}

pub(crate) fn decimal(value: &Value) -> Result<BigDecimal, EngineError> {
    let number = value.as_number().ok_or(EngineError::InvalidDuration)?;
    BigDecimal::from_str(&number.to_string()).map_err(|_| EngineError::InvalidDuration)
}

pub(crate) fn number(value: &BigDecimal) -> Result<Value, EngineError> {
    Number::from_str(&value.normalized().to_plain_string())
        .map(Value::Number)
        .map_err(|_| EngineError::Overflow)
}

pub(crate) fn zero() -> BigDecimal {
    BigDecimal::from(0)
}

pub(crate) fn zone(name: &str) -> Result<jiff::tz::TimeZone, EngineError> {
    crate::time::zone(name)
}
