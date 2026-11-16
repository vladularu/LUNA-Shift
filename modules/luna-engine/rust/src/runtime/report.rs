//! Calculation availability is distinct from an admitted transport snapshot.
//! Raw database errors never become empty sources or successful zero values.
use super::{catalog_source::CatalogSourceError, facts::FactError, sources::SourceReadError};
use crate::{contract::SourceKind, rules::RuleKind};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ReportIssue {
    pub code: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<SourceKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog: Option<RuleKind>,
}
impl ReportIssue {
    pub fn new(code: &'static str) -> Self {
        Self {
            code,
            source: None,
            catalog: None,
        }
    }
    fn read(error: SourceReadError) -> Self {
        Self::new(match error {
            SourceReadError::NotRequested => "SOURCE_NOT_REQUESTED",
            SourceReadError::Loading => "SOURCE_LOADING",
            SourceReadError::Failed(_) => "SOURCE_READ_FAILED",
            SourceReadError::MissingRecord => "SOURCE_MISSING",
            SourceReadError::NullRecord => "SOURCE_NULL",
            SourceReadError::InsufficientCoverage => "SOURCE_INCOMPLETE",
            SourceReadError::InvalidCoverage => "SOURCE_INVALID_COVERAGE",
        })
    }
}
impl From<FactError> for ReportIssue {
    fn from(error: FactError) -> Self {
        match error {
            FactError::Clock(code) => Self::new(code),
            FactError::Source { kind, error } => Self {
                source: Some(kind),
                ..Self::read(error)
            },
            FactError::InvalidShape(kind) => Self {
                source: Some(kind),
                ..Self::new("SOURCE_INVALID")
            },
            FactError::Profile(_) => Self::new("PROFILE_INVALID"),
            FactError::Calendar(_) => Self::new("CALENDAR_INVALID"),
            FactError::Finance(_) => Self::new("FINANCE_INPUT_INVALID"),
            FactError::Annual(_) => Self::new("ANNUAL_INPUT_INVALID"),
            FactError::Training(_) => Self::new("TRAINING_INPUT_INVALID"),
            FactError::Remuneration(_) => Self::new("REMUNERATION_INPUT_INVALID"),
            FactError::Draft(_) => Self::new("CONFIRMATION_INPUT_INVALID"),
            FactError::Personal(_) => Self::new("PERSONAL_CONTEXT_INVALID"),
            FactError::Target(_) => Self::new("WORKING_TIME_INPUT_INVALID"),
        }
    }
}
impl From<CatalogSourceError> for ReportIssue {
    fn from(error: CatalogSourceError) -> Self {
        match error {
            CatalogSourceError::Source { kind, error } => Self {
                catalog: Some(kind),
                ..Self::read(error)
            },
            _ => Self::new("CATALOG_INVALID"),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "state", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SectionOutput {
    NotRequested {},
    Unavailable { reason: ReportIssue },
    Ready { value: Value },
}
impl SectionOutput {
    pub fn from_result(result: Result<Value, ReportIssue>) -> Self {
        match result {
            Ok(value) => Self::Ready { value },
            Err(reason) => Self::Unavailable { reason },
        }
    }
}
