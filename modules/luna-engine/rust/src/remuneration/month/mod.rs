//! Full dated monthly composition. All numeric components are produced by Rust.
pub mod calculation;
pub mod input;
pub mod model;
use super::{
    allowances::AllowanceError,
    annual::{AnnualError, tariff::TariffAnnualComposeError},
    assessment::AssessmentError,
    base::BaseError,
    draft_facts::DraftFactsError,
    draft_pay::DraftPayError,
    overtime::OvertimeError,
    premiums::PremiumError,
};
#[derive(Debug)]
pub enum MonthlyRemunerationError {
    Base(Box<BaseError>),
    Premium(Box<PremiumError>),
    Allowance(Box<AllowanceError>),
    Overtime(Box<OvertimeError>),
    Annual(Box<AnnualError>),
    TariffAnnual(Box<TariffAnnualComposeError>),
    Assessment(Box<AssessmentError>),
    Draft(Box<DraftPayError>),
    Facts(Box<DraftFactsError>),
    InvalidInput,
    UnsafeTotal,
}
macro_rules! wrap {
    ($source:ty,$variant:ident) => {
        impl From<$source> for MonthlyRemunerationError {
            fn from(e: $source) -> Self {
                Self::$variant(Box::new(e))
            }
        }
    };
}
wrap!(BaseError, Base);
wrap!(PremiumError, Premium);
wrap!(AllowanceError, Allowance);
wrap!(OvertimeError, Overtime);
wrap!(AnnualError, Annual);
wrap!(TariffAnnualComposeError, TariffAnnual);
wrap!(AssessmentError, Assessment);
wrap!(DraftPayError, Draft);
wrap!(DraftFactsError, Facts);
impl std::fmt::Display for MonthlyRemunerationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Base(e) => e.fmt(f),
            Self::Premium(e) => e.fmt(f),
            Self::Allowance(e) => e.fmt(f),
            Self::Overtime(e) => e.fmt(f),
            Self::Annual(e) => e.fmt(f),
            Self::TariffAnnual(e) => e.fmt(f),
            Self::Assessment(e) => e.fmt(f),
            Self::Draft(e) => e.fmt(f),
            Self::Facts(e) => e.fmt(f),
            Self::InvalidInput => f.write_str("Invalid monthly remuneration input"),
            Self::UnsafeTotal => f.write_str("Unsafe remuneration total."),
        }
    }
}
impl std::error::Error for MonthlyRemunerationError {}
impl MonthlyRemunerationError {
    pub fn class_name(&self) -> &str {
        use crate::{
            EngineError, employment::EmploymentError, remuneration::context::model::ContextError,
        };
        match self {
            Self::Allowance(e) => e.class_name(),
            Self::Overtime(e) => e.class_name(),
            Self::Annual(e) => e.class_name(),
            Self::TariffAnnual(e) => e.class_name(),
            Self::Assessment(e) => e.class_name(),
            Self::Facts(e) => e.class_name(),
            Self::Base(e) => match e.as_ref() {
                BaseError::Context(ContextError::Employment(
                    EmploymentError::InvalidDate | EmploymentError::AmbiguousHistory,
                )) => "RemunerationProfileError",
                BaseError::Engine(EngineError::InvalidTimeZone) => "RangeError",
                _ => "Error",
            },
            Self::Premium(e) => match e.as_ref() {
                PremiumError::Context(ContextError::Employment(
                    EmploymentError::InvalidDate | EmploymentError::AmbiguousHistory,
                ))
                | PremiumError::Employment(
                    EmploymentError::InvalidDate | EmploymentError::AmbiguousHistory,
                ) => "RemunerationProfileError",
                PremiumError::Time(EngineError::InvalidTimeZone)
                | PremiumError::Base(BaseError::Engine(EngineError::InvalidTimeZone)) => {
                    "RangeError"
                }
                _ => "Error",
            },
            Self::Draft(e) => match e.as_ref() {
                DraftPayError::Facts(e) => e.class_name(),
                _ => "Error",
            },
            _ => "Error",
        }
    }
}
pub(crate) fn checked_total(
    values: impl IntoIterator<Item = i64>,
) -> Result<i64, MonthlyRemunerationError> {
    let mut total = 0_i64;
    for value in values {
        total = total
            .checked_add(value)
            .ok_or(MonthlyRemunerationError::UnsafeTotal)?;
        if !(-crate::money::MAX_SAFE_INTEGER..=crate::money::MAX_SAFE_INTEGER).contains(&total) {
            return Err(MonthlyRemunerationError::UnsafeTotal);
        }
    }
    Ok(total)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn monthly_total_preserves_safe_integer_boundary_and_rejects_unsafe_outputs() {
        let max = crate::money::MAX_SAFE_INTEGER;
        assert_eq!(checked_total([300000, 5000, 0]).unwrap(), 305000);
        assert_eq!(checked_total([max, 0]).unwrap(), max);
        assert!(matches!(
            checked_total([max, 1]),
            Err(MonthlyRemunerationError::UnsafeTotal)
        ));
        assert!(matches!(
            checked_total([i64::MIN]),
            Err(MonthlyRemunerationError::UnsafeTotal)
        ));
    }
}
