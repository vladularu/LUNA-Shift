//! Strict persisted facts for Annex-A and SuE. These are confirmations, never computed money.
mod common;
pub mod model;
pub mod month;
pub mod premium;
pub mod prepared;
pub mod resolve;
use crate::{
    employment::EmploymentError, input::InputError, remuneration::context::model::ContextError,
};
#[derive(Debug)]
pub enum DraftFactsError {
    Message(&'static str),
    Input(InputError),
    Employment(EmploymentError),
    Context(ContextError),
    InvalidProfile,
}
impl From<InputError> for DraftFactsError {
    fn from(e: InputError) -> Self {
        Self::Input(e)
    }
}
impl From<EmploymentError> for DraftFactsError {
    fn from(e: EmploymentError) -> Self {
        Self::Employment(e)
    }
}
impl From<ContextError> for DraftFactsError {
    fn from(e: ContextError) -> Self {
        Self::Context(e)
    }
}
impl std::fmt::Display for DraftFactsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Message(m) => f.write_str(m),
            Self::Input(e) => e.fmt(f),
            Self::Employment(e) => e.fmt(f),
            Self::Context(e) => e.fmt(f),
            Self::InvalidProfile => f.write_str("Ungültige Vergütungsprofilreferenz."),
        }
    }
}
impl std::error::Error for DraftFactsError {}
impl DraftFactsError {
    pub fn class_name(&self) -> &str {
        match self {
            Self::Input(e) => e.name(),
            Self::Employment(_) => "RemunerationProfileError",
            _ => "Error",
        }
    }
}
