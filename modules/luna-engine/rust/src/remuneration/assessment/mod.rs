//! Native dated allowance assessment. Calendar evidence remains separate from confirmed claims.
pub mod calculation;
pub mod decisions;
pub mod model;
mod window;
use crate::{
    employment::EmploymentError, input::InputError, pay::pattern::PatternError,
    remuneration::context::model::ContextError,
};
#[derive(Debug)]
pub enum AssessmentError {
    Context(ContextError),
    Employment(EmploymentError),
    Input(InputError),
    Pattern(PatternError),
    InvalidInput,
    Message(&'static str),
}
impl From<ContextError> for AssessmentError {
    fn from(e: ContextError) -> Self {
        Self::Context(e)
    }
}
impl From<EmploymentError> for AssessmentError {
    fn from(e: EmploymentError) -> Self {
        Self::Employment(e)
    }
}
impl From<InputError> for AssessmentError {
    fn from(e: InputError) -> Self {
        Self::Input(e)
    }
}
impl From<PatternError> for AssessmentError {
    fn from(e: PatternError) -> Self {
        Self::Pattern(e)
    }
}
impl std::fmt::Display for AssessmentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Context(e) => e.fmt(f),
            Self::Employment(e) => e.fmt(f),
            Self::Input(e) => e.fmt(f),
            Self::Pattern(e) => e.fmt(f),
            Self::InvalidInput => f.write_str("Invalid allowance assessment input"),
            Self::Message(m) => f.write_str(m),
        }
    }
}
impl std::error::Error for AssessmentError {}
impl AssessmentError {
    pub fn class_name(&self) -> &str {
        match self {
            Self::Input(e) => e.name(),
            Self::Employment(_) => "RemunerationProfileError",
            _ => "Error",
        }
    }
}
