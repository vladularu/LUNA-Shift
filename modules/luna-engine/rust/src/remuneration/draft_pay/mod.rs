//! Isolated draft cash components. Every successful result remains partial gross.
pub mod annex;
pub mod from_work;
pub mod overtime;
pub mod saved;
pub mod sue;
use crate::{EngineError, remuneration::base::BaseError};
use serde_json::Value;
#[derive(Debug)]
pub enum DraftPayError {
    Base(BaseError),
    Time(EngineError),
    InvalidInput,
    Facts(crate::remuneration::draft_facts::DraftFactsError),
}
impl From<BaseError> for DraftPayError {
    fn from(e: BaseError) -> Self {
        Self::Base(e)
    }
}
impl From<EngineError> for DraftPayError {
    fn from(e: EngineError) -> Self {
        Self::Time(e)
    }
}
impl From<crate::remuneration::draft_facts::DraftFactsError> for DraftPayError {
    fn from(e: crate::remuneration::draft_facts::DraftFactsError) -> Self {
        Self::Facts(e)
    }
}
impl std::fmt::Display for DraftPayError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Base(e) => e.fmt(f),
            Self::Time(e) => e.fmt(f),
            Self::InvalidInput => f.write_str("Invalid draft remuneration input"),
            Self::Facts(e) => e.fmt(f),
        }
    }
}
impl std::error::Error for DraftPayError {}
pub(super) fn rows<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value[key].as_array().map(Vec::as_slice).unwrap_or(&[])
}
pub(super) fn safe(n: f64) -> bool {
    n.is_finite() && n.fract() == 0.0 && n.abs() <= crate::money::MAX_SAFE_INTEGER as f64
}
pub(crate) fn day_bounds(date: &str, zone: &str) -> Result<(i64, i64), DraftPayError> {
    let date = date
        .parse::<jiff::civil::Date>()
        .map_err(|_| DraftPayError::InvalidInput)?;
    let zone = crate::time_zone::zone(zone)?;
    let start = zone
        .to_ambiguous_zoned(date.at(0, 0, 0, 0))
        .disambiguate(jiff::tz::Disambiguation::Compatible)
        .map_err(|_| DraftPayError::InvalidInput)?;
    let end = start
        .checked_add(jiff::Span::new().days(1))
        .map_err(|_| DraftPayError::InvalidInput)?;
    Ok((
        start.timestamp().as_millisecond(),
        end.timestamp().as_millisecond(),
    ))
}
