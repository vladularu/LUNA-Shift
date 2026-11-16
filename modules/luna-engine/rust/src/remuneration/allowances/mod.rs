//! Dated allowance calculation. Components land with frozen-source proofs;
//! no runtime or readiness registry is enabled by this module.
pub mod burn;
pub mod calculation;
pub mod care;
mod general;
pub mod model;
pub mod own;
pub mod shift;
use crate::{
    EngineError,
    employment::EmploymentError,
    remuneration::{base::BaseError, context::model::ContextError},
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AllowanceError {
    Context(ContextError),
    Base(BaseError),
    Time(EngineError),
    InvalidInput,
    InvalidEntitlement,
    OverlappingEntitlements,
    InvalidDay,
    Encoding,
}
impl From<ContextError> for AllowanceError {
    fn from(e: ContextError) -> Self {
        Self::Context(e)
    }
}
impl From<BaseError> for AllowanceError {
    fn from(e: BaseError) -> Self {
        Self::Base(e)
    }
}
impl From<EngineError> for AllowanceError {
    fn from(e: EngineError) -> Self {
        Self::Time(e)
    }
}
impl std::fmt::Display for AllowanceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Context(e) => e.fmt(f),
            Self::Base(e) => e.fmt(f),
            Self::Time(e) => e.fmt(f),
            Self::InvalidInput => f.write_str("Ungültige Berechnungsgrundlage."),
            Self::InvalidEntitlement => f.write_str("Ungültige zeitliche Zulagenentscheidung."),
            Self::OverlappingEntitlements => {
                f.write_str("Zulagenentscheidungen dürfen sich nicht überschneiden.")
            }
            Self::InvalidDay => f.write_str("Ungültiger oder doppelter TVA-L-Zulagentag."),
            Self::Encoding => f.write_str("Allowance evidence encoding failed"),
        }
    }
}
impl std::error::Error for AllowanceError {}
impl AllowanceError {
    pub fn class_name(&self) -> &'static str {
        match self {
            Self::Context(ContextError::Employment(
                EmploymentError::InvalidDate | EmploymentError::AmbiguousHistory,
            )) => "RemunerationProfileError",
            Self::Time(EngineError::InvalidTimeZone)
            | Self::Base(BaseError::Engine(EngineError::InvalidTimeZone)) => "RangeError",
            _ => "Error",
        }
    }
}
pub(super) fn key(value: impl serde::Serialize) -> Result<String, AllowanceError> {
    serde_json::to_string(&value).map_err(|_| AllowanceError::Encoding)
}
