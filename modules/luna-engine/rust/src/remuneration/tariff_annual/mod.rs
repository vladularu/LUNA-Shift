//! Checked personal tariff annual claims and exact eligibility/basis arithmetic.
pub mod basis;
pub mod claim;
pub mod eligibility;
pub mod model;
pub mod payment;
pub mod saved;
pub mod selection;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TariffAnnualError {
    Claim,
    Date,
    Month,
    Rule,
    ValidationUnavailable,
    AmountOutsideSafeRange,
    InvalidCollation,
}
impl std::fmt::Display for TariffAnnualError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Claim => "Die Angaben zur tariflichen Sonderzahlung sind ungültig.",
            Self::Date => "Bitte ein gültiges Datum angeben.",
            Self::Month => "Bitte einen gültigen Auswertungsmonat angeben.",
            Self::Rule => "Invalid annual calculation rule",
            Self::ValidationUnavailable => "Native annual rule validation unavailable",
            Self::AmountOutsideSafeRange => "Annual amount outside safe range.",
            Self::InvalidCollation => "Missing native collation rank",
        })
    }
}
impl std::error::Error for TariffAnnualError {}
impl TariffAnnualError {
    pub fn class_name(self) -> &'static str {
        match self {
            Self::Claim | Self::Date | Self::Month => "ValidationError",
            _ => "Error",
        }
    }
}
pub(super) fn integer(
    value: &serde_json::Value,
    min: i64,
    max: i64,
) -> Result<i64, TariffAnnualError> {
    let n = value.as_f64().ok_or(TariffAnnualError::Claim)?;
    if !n.is_finite() || n.fract() != 0.0 || n < min as f64 || n > max as f64 {
        return Err(TariffAnnualError::Claim);
    }
    Ok(n as i64)
}
