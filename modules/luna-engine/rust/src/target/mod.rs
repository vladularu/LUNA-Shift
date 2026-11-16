//! Contractual target-time calculation; recorded work and absence credits remain separate.
mod calculation;
mod model;
mod policies;
mod prepared;
pub mod presentation;
pub mod profile;
pub mod repository;
mod rules;
mod validation;

pub use calculation::{calculate_monthly_working_time_target, require_target_minutes};
pub use model::*;
pub(crate) use prepared::TargetSource;
pub use prepared::{
    PreparedTargetContext, PreparedTargetProfile, PreparedTargetSource, TargetPreparationStats,
};
pub use validation::{validate_saved_target_context, validate_saved_target_settings};

use crate::rules::holidays::HolidayError;
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TargetError {
    InvalidInput,
    Loading,
    ReadError,
    TvUkAccountConflict,
    MissingTvUkDayRule,
    TargetUnavailable,
    UnsupportedSettingsVersion,
    Holiday(HolidayError),
}

impl fmt::Display for TargetError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidInput => f.write_str("Die Angaben zur Sollarbeitszeit sind unvollständig oder widersprüchlich."),
            Self::Loading => f.write_str("Die Arbeitszeitangaben werden geladen."),
            Self::ReadError => f.write_str("Die Arbeitszeitangaben konnten nicht geladen werden. Bitte erneut versuchen."),
            Self::TvUkAccountConflict => f.write_str("TV-UK: Bestätigte Schichtarbeit erfordert die Kontenregel nach § 13 Abs. 1."),
            Self::MissingTvUkDayRule => f.write_str("Die TV-UK-Tagesregel fehlt."),
            Self::TargetUnavailable => f.write_str("Die Sollarbeitszeit ist wegen fehlender oder widersprüchlicher historischer Angaben nicht verfügbar."),
            Self::UnsupportedSettingsVersion=>f.write_str("Diese Version der Sollzeitangaben wird noch nicht unterstützt."),
            Self::Holiday(error) => fmt::Display::fmt(error, f),
        }
    }
}
impl std::error::Error for TargetError {}

impl From<HolidayError> for TargetError {
    fn from(value: HolidayError) -> Self {
        Self::Holiday(value)
    }
}
