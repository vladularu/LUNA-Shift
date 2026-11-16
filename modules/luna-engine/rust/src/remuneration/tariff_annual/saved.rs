use super::{
    TariffAnnualError,
    claim::{month, validate_tariff_annual_claim},
    integer,
    model::ValidatedClaim,
};
use crate::input::{InputError, require_instant};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeSet;
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActualTariffAnnualPayment {
    pub gross_cents: i64,
    pub payout_month: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedTariffAnnualClaim {
    pub claim: ValidatedClaim,
    pub actual_payment: Option<ActualTariffAnnualPayment>,
    pub revoked: bool,
    pub revision: i64,
    pub updated_at: String,
}
/// Retained native facts can be reused for every cash month without JSON round trips.
#[derive(Debug, Clone, Serialize)]
#[serde(transparent)]
pub struct ValidatedSavedClaims(Vec<SavedTariffAnnualClaim>);
impl ValidatedSavedClaims {
    pub fn records(&self) -> &[SavedTariffAnnualClaim] {
        &self.0
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SavedAnnualError {
    ActualFormat,
    Amount,
    PayoutMonth,
    SavedFormat,
    Revoked,
    Revision,
    PositiveRevision,
    Claims,
    Duplicate,
    Core(TariffAnnualError),
    Input(InputError),
}
impl From<TariffAnnualError> for SavedAnnualError {
    fn from(e: TariffAnnualError) -> Self {
        Self::Core(e)
    }
}
impl From<InputError> for SavedAnnualError {
    fn from(e: InputError) -> Self {
        Self::Input(e)
    }
}
impl std::fmt::Display for SavedAnnualError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ActualFormat => f.write_str("Ungültige tarifliche Zahlungsbestätigung."),
            Self::Amount => f.write_str("Ungültiger Sonderzahlungsbetrag."),
            Self::PayoutMonth => f.write_str("Ungültiger Auszahlungsmonat."),
            Self::SavedFormat => f.write_str("Ungültiger gespeicherter Tarif-Jahresanspruch."),
            Self::Revoked => f.write_str("Ungültiger Widerrufsstatus."),
            Self::Revision => f.write_str("Ungültige Revision des Tarif-Jahresanspruchs."),
            Self::PositiveRevision => f.write_str("Ungültige Datensatzrevision."),
            Self::Claims => f.write_str("Ungültige Tarif-Jahresansprüche."),
            Self::Duplicate => f.write_str("Doppelte Tarif-Jahresansprüche."),
            Self::Core(e) => e.fmt(f),
            Self::Input(e) => e.fmt(f),
        }
    }
}
impl std::error::Error for SavedAnnualError {}
impl SavedAnnualError {
    pub fn class_name(&self) -> &str {
        match self {
            Self::Core(e) => e.class_name(),
            Self::Input(e) => e.name(),
            Self::PositiveRevision => "ValidationError",
            _ => "UserFacingError",
        }
    }
}
pub fn validate_actual_tariff_annual_payment(
    value: &Value,
) -> Result<Option<ActualTariffAnnualPayment>, SavedAnnualError> {
    if value.is_null() {
        return Ok(None);
    }
    let raw = value
        .as_object()
        .filter(|raw| {
            raw.len() == 2 && raw.contains_key("grossCents") && raw.contains_key("payoutMonth")
        })
        .ok_or(SavedAnnualError::ActualFormat)?;
    let gross =
        integer(&raw["grossCents"], 0, 1_000_000_000).map_err(|_| SavedAnnualError::Amount)?;
    let payout = match month(&raw["payoutMonth"]) {
        Ok(month) => month,
        Err(TariffAnnualError::Claim) => return Err(SavedAnnualError::PayoutMonth),
        Err(error) => return Err(error.into()),
    };
    Ok(Some(ActualTariffAnnualPayment {
        gross_cents: gross,
        payout_month: payout,
    }))
}
pub fn validate_saved_tariff_annual_claim(
    value: &Value,
) -> Result<SavedTariffAnnualClaim, SavedAnnualError> {
    let keys = ["claim", "actualPayment", "revoked", "revision", "updatedAt"];
    let raw = value
        .as_object()
        .filter(|raw| raw.len() == keys.len() && keys.iter().all(|key| raw.contains_key(*key)))
        .ok_or(SavedAnnualError::SavedFormat)?;
    let revoked = raw["revoked"].as_bool().ok_or(SavedAnnualError::Revoked)?;
    let revision = integer(
        &raw["revision"],
        -crate::money::MAX_SAFE_INTEGER,
        crate::money::MAX_SAFE_INTEGER,
    )
    .map_err(|_| SavedAnnualError::Revision)?;
    let claim = validate_tariff_annual_claim(&raw["claim"])?;
    let actual_payment = validate_actual_tariff_annual_payment(&raw["actualPayment"])?;
    if revision < 1 {
        return Err(SavedAnnualError::PositiveRevision);
    }
    let updated_at = require_instant(&raw["updatedAt"], "Tarif-Jahresanspruch")?.into();
    Ok(SavedTariffAnnualClaim {
        claim,
        actual_payment,
        revoked,
        revision,
        updated_at,
    })
}
pub fn validate_saved_tariff_annual_claims(
    value: &Value,
) -> Result<ValidatedSavedClaims, SavedAnnualError> {
    let rows = value
        .as_array()
        .filter(|rows| rows.len() <= 4096)
        .ok_or(SavedAnnualError::Claims)?;
    let mut seen = BTreeSet::new();
    let mut result = Vec::with_capacity(rows.len());
    for value in rows {
        let row = validate_saved_tariff_annual_claim(value)?;
        if !seen.insert((row.claim.data().year, row.claim.data().id.clone())) {
            return Err(SavedAnnualError::Duplicate);
        }
        result.push(row);
    }
    Ok(ValidatedSavedClaims(result))
}
