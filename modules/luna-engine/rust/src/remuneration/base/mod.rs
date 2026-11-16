//! Dated base remuneration and its time/paid-absence inputs. This is not complete gross pay.
pub mod absence;
pub mod calculation;
pub mod draft;
pub mod hourly;
pub mod model;
pub mod prepared;
pub mod shift_days;
use super::context::model::ContextError;
use crate::EngineError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimestampField {
    ShiftUpdate,
    Confirmation,
    Update,
}
impl TimestampField {
    fn label(self) -> &'static str {
        match self {
            Self::ShiftUpdate => "Eintragsaktualisierung",
            Self::Confirmation => "Bestätigung",
            Self::Update => "Aktualisierung",
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BaseError {
    Context(ContextError),
    Engine(EngineError),
    InvalidCalculation,
    AbsenceObject,
    AbsenceFormat,
    AbsenceId,
    AbsenceRevision,
    AbsenceMinutes,
    AbsenceZone,
    AbsenceInstant(TimestampField),
    AbsenceOrder,
    DuplicateAbsence,
    DuplicateShift,
    DuplicateMonthShift,
    OwnHourlyMissing,
    HourlyRouteRequired,
    InvalidShift,
}
impl From<ContextError> for BaseError {
    fn from(e: ContextError) -> Self {
        Self::Context(e)
    }
}
impl From<EngineError> for BaseError {
    fn from(e: EngineError) -> Self {
        Self::Engine(e)
    }
}
impl std::fmt::Display for BaseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Context(e) => e.fmt(f),
            Self::Engine(e) => e.fmt(f),
            Self::InvalidCalculation => f.write_str("Ungültige Berechnungsgrundlage."),
            Self::AbsenceObject => f.write_str("Ungültige Abwesenheitsbestätigung."),
            Self::AbsenceFormat => f.write_str("Unbekanntes Format der Abwesenheitsbestätigung."),
            Self::AbsenceId => f.write_str("Ungültige Eintragszuordnung."),
            Self::AbsenceRevision => f.write_str("Ungültige Abwesenheitsrevision."),
            Self::AbsenceMinutes => f.write_str("Ungültige bezahlte Abwesenheitszeit."),
            Self::AbsenceZone => f.write_str("Ungültige Zeitzone."),
            Self::AbsenceInstant(field) => {
                write!(f, "{} enthält keinen gültigen Zeitstempel.", field.label())
            }
            Self::AbsenceOrder => f.write_str("Ungültiger Bestätigungszeitpunkt."),
            Self::DuplicateAbsence => f.write_str("Abwesenheit mehrfach bestätigt."),
            Self::DuplicateShift => {
                f.write_str("Ein Eintrag wurde mehrfach zur Stundenvergütung übergeben.")
            }
            Self::DuplicateMonthShift => {
                f.write_str("Ein Dienst wurde mehrfach zur Vergütungsberechnung übergeben.")
            }
            Self::OwnHourlyMissing => f.write_str("Eigener Stundenlohn fehlt."),
            Self::HourlyRouteRequired => {
                f.write_str("Stundenlohn benötigt den zeitbezogenen Berechnungspfad.")
            }
            Self::InvalidShift => f.write_str("Invalid remuneration shift"),
        }
    }
}
impl std::error::Error for BaseError {}
pub fn round_remuneration_cents(numerator: f64, denominator: f64) -> Result<i64, BaseError> {
    let safe = |n: f64| {
        n.is_finite() && n.fract() == 0.0 && n.abs() <= crate::money::MAX_SAFE_INTEGER as f64
    };
    if !safe(numerator) || numerator < 0.0 || !safe(denominator) || denominator <= 0.0 {
        return Err(BaseError::InvalidCalculation);
    }
    crate::money::round_ratio(numerator as i64, denominator as i64)
        .map_err(|_| BaseError::InvalidCalculation)
}
pub(crate) fn scalar<S: serde::Serializer>(n: &f64, s: S) -> Result<S::Ok, S::Error> {
    if n.fract() == 0.0 && n.abs() <= crate::money::MAX_SAFE_INTEGER as f64 {
        s.serialize_i64(*n as i64)
    } else {
        s.serialize_f64(*n)
    }
}
pub(crate) fn optional_scalar<S: serde::Serializer>(
    n: &Option<f64>,
    s: S,
) -> Result<S::Ok, S::Error> {
    match n {
        Some(n) => scalar(n, s),
        None => s.serialize_none(),
    }
}

/// Temporal accepts an ISO reference carrying a timezone as a timezone identifier.
/// Retain the caller's original string in persisted evidence; only the arithmetic zone is parsed.
pub(super) fn temporal_zone(raw: &str) -> Result<jiff::tz::TimeZone, crate::EngineError> {
    crate::time_zone::zone(raw)
}
pub(super) fn temporal_zone_name(raw: &str) -> Result<&str, crate::EngineError> {
    crate::time_zone::identifier(raw)
}
