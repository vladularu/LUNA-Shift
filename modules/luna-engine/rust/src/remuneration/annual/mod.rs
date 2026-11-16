//! Native annual payment facts and calculations. Own confirmations and tariff
//! claims remain distinct domains; an actual payment is a bounded user fact.
pub mod actual;
pub mod coverage;
pub mod model;
pub mod own;
pub mod tariff;
use crate::{
    employment::EmploymentError,
    remuneration::{base::BaseError, context::model::ContextError},
};
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AnnualError {
    ActualOwn,
    Context(ContextError),
    Employment(EmploymentError),
    Base(BaseError),
    InvalidInput,
    Encoding,
}
impl From<ContextError> for AnnualError {
    fn from(e: ContextError) -> Self {
        Self::Context(e)
    }
}
impl From<EmploymentError> for AnnualError {
    fn from(e: EmploymentError) -> Self {
        Self::Employment(e)
    }
}
impl From<BaseError> for AnnualError {
    fn from(e: BaseError) -> Self {
        Self::Base(e)
    }
}
impl std::fmt::Display for AnnualError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ActualOwn => f.write_str(
                "Die bestätigten Jahressonderzahlungen sind ungültig oder mehrfach vorhanden.",
            ),
            Self::Context(e) => e.fmt(f),
            Self::Employment(e) => e.fmt(f),
            Self::Base(e) => e.fmt(f),
            Self::InvalidInput => f.write_str("Ungültige Berechnungsgrundlage."),
            Self::Encoding => f.write_str("Annual evidence encoding failed"),
        }
    }
}
impl std::error::Error for AnnualError {}
impl AnnualError {
    pub fn class_name(&self) -> &'static str {
        match self {
            Self::ActualOwn => "UserFacingError",
            Self::Employment(EmploymentError::InvalidDate | EmploymentError::AmbiguousHistory)
            | Self::Context(ContextError::Employment(
                EmploymentError::InvalidDate | EmploymentError::AmbiguousHistory,
            )) => "RemunerationProfileError",
            _ => "Error",
        }
    }
}
pub(super) fn integer(value: &serde_json::Value) -> Option<i64> {
    let n = value.as_f64()?;
    (n.is_finite() && n.fract() == 0.0 && n.abs() <= crate::money::MAX_SAFE_INTEGER as f64)
        .then_some(n as i64)
}
