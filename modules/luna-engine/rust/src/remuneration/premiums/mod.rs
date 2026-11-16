//! Dated time-premium calculations. Monetary policy is separate from paychecks
//! and compliance; raw shift/history inputs will be resolved natively here.
pub mod calculation;
mod common;
pub mod model;
mod own;
mod tdl;
mod training;
use super::{base::BaseError, context::model::ContextError};
use crate::{
    EngineError,
    employment::EmploymentError,
    pay::{legacy_interval::IntervalError, premium_minutes::PremiumError as MinuteError},
    rules::holidays::HolidayError,
};

#[derive(Debug)]
pub enum PremiumError {
    Base(BaseError),
    Context(ContextError),
    Employment(EmploymentError),
    Time(EngineError),
    Holiday(HolidayError),
    Interval(Box<IntervalError>),
    Classification(Box<MinuteError>),
    MissingRate,
    OwnTimeMissing,
    InvalidInput,
    InvalidInstant,
}
impl From<BaseError> for PremiumError {
    fn from(e: BaseError) -> Self {
        Self::Base(e)
    }
}
impl From<ContextError> for PremiumError {
    fn from(e: ContextError) -> Self {
        Self::Context(e)
    }
}
impl From<EmploymentError> for PremiumError {
    fn from(e: EmploymentError) -> Self {
        Self::Employment(e)
    }
}
impl From<EngineError> for PremiumError {
    fn from(e: EngineError) -> Self {
        Self::Time(e)
    }
}
impl From<HolidayError> for PremiumError {
    fn from(e: HolidayError) -> Self {
        Self::Holiday(e)
    }
}
impl From<IntervalError> for PremiumError {
    fn from(e: IntervalError) -> Self {
        Self::Interval(Box::new(e))
    }
}
impl From<MinuteError> for PremiumError {
    fn from(e: MinuteError) -> Self {
        Self::Classification(Box::new(e))
    }
}
impl std::fmt::Display for PremiumError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Base(e) => e.fmt(f),
            Self::Context(e) => e.fmt(f),
            Self::Employment(e) => e.fmt(f),
            Self::Time(e) => e.fmt(f),
            Self::Holiday(e) => e.fmt(f),
            Self::Interval(e) => e.fmt(f),
            Self::Classification(e) => e.fmt(f),
            Self::MissingRate => {
                f.write_str("Die Stundenbasis für den Zeitzuschlag ist nicht verfügbar.")
            }
            Self::OwnTimeMissing => f.write_str("Dienstzeit fehlt für eigene Zuschläge."),
            Self::InvalidInput => f.write_str("Invalid dated premium inputs"),
            Self::InvalidInstant => f.write_str("epoch milliseconds must be an integer"),
        }
    }
}
impl std::error::Error for PremiumError {}
