//! Dated payable overtime and explicit saved day allocation. Eligibility and
//! work-time balances remain separate calculations.
pub mod calculation;
mod families;
mod legacy;
mod own;
pub mod prepared;
pub mod saved;
use crate::{
    EngineError,
    employment::EmploymentError,
    input::InputError,
    pay::tariff::TariffError,
    remuneration::{base::BaseError, context::model::ContextError},
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OvertimeError {
    Object,
    Format,
    Id,
    Revision,
    Zone,
    ConfirmationOrder,
    AllocationRequired,
    Minutes,
    AllocationAmbiguous,
    MixedAllocations,
    DuplicateSaved,
    InvalidAllocation,
    InvalidInput,
    Encoding,
    Input(InputError),
    Time(EngineError),
    Employment(EmploymentError),
    Base(BaseError),
    Context(ContextError),
    Tariff(TariffError),
}
impl std::fmt::Display for OvertimeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self{
Self::Object=>f.write_str("Ungültige Überstundenaufteilung."),Self::Format=>f.write_str("Unbekanntes Format der Überstundenaufteilung."),Self::Id=>f.write_str("Ungültige Dienstzuordnung."),Self::Revision=>f.write_str("Ungültige Überstundenrevision."),Self::Zone=>f.write_str("Ungültige Zeitzone."),Self::ConfirmationOrder=>f.write_str("Ungültiger Bestätigungszeitpunkt."),Self::AllocationRequired=>f.write_str("Überstunden benötigen eine eindeutige Tagesaufteilung."),Self::Minutes=>f.write_str("Ungültige Überstundenminuten."),Self::AllocationAmbiguous=>f.write_str("Überstunden müssen eindeutig zugeordnet sein."),Self::MixedAllocations=>f.write_str("Gespeicherte und unversionierte Überstunden-Aufteilungen dürfen nicht gemischt werden."),Self::DuplicateSaved=>f.write_str("Überstunden-Aufteilung für denselben Dienst mehrfach vorhanden."),Self::InvalidAllocation=>f.write_str("Die bestätigte Tagesaufteilung muss die Überstunden vollständig und eindeutig zuordnen."),Self::InvalidInput=>f.write_str("Ungültige Berechnungsgrundlage."),Self::Encoding=>f.write_str("Overtime evidence encoding failed"),Self::Input(e)=>e.fmt(f),Self::Time(e)=>e.fmt(f),Self::Employment(e)=>e.fmt(f),Self::Base(e)=>e.fmt(f),Self::Context(e)=>e.fmt(f),Self::Tariff(e)=>e.fmt(f)}
    }
}
impl std::error::Error for OvertimeError {}
impl From<InputError> for OvertimeError {
    fn from(e: InputError) -> Self {
        Self::Input(e)
    }
}
impl From<EngineError> for OvertimeError {
    fn from(e: EngineError) -> Self {
        Self::Time(e)
    }
}
impl From<EmploymentError> for OvertimeError {
    fn from(e: EmploymentError) -> Self {
        Self::Employment(e)
    }
}
impl From<BaseError> for OvertimeError {
    fn from(e: BaseError) -> Self {
        Self::Base(e)
    }
}
impl From<ContextError> for OvertimeError {
    fn from(e: ContextError) -> Self {
        Self::Context(e)
    }
}
impl From<TariffError> for OvertimeError {
    fn from(e: TariffError) -> Self {
        Self::Tariff(e)
    }
}
impl OvertimeError {
    pub fn class_name(&self) -> &str {
        match self {
            Self::Input(e) => e.name(),
            Self::Employment(EmploymentError::InvalidDate | EmploymentError::AmbiguousHistory)
            | Self::Context(ContextError::Employment(
                EmploymentError::InvalidDate | EmploymentError::AmbiguousHistory,
            )) => "RemunerationProfileError",
            Self::Time(EngineError::InvalidTimeZone)
            | Self::Base(BaseError::Engine(EngineError::InvalidTimeZone)) => "RangeError",
            _ => "Error",
        }
    }
}
pub(super) fn integer(v: &serde_json::Value) -> Option<i64> {
    let n = v.as_f64()?;
    (n.is_finite() && n.fract() == 0.0 && n.abs() <= crate::money::MAX_SAFE_INTEGER as f64)
        .then_some(n as i64)
}
