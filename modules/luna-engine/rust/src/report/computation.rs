//! Source-compatible computation availability; no message-based error guessing.
use crate::{
    credit::{context::DailyCreditError, summary::MetricsError},
    pay::special::SpecialDutyError,
    rules::{RuleResolutionFailure, holidays::HolidayError},
    target::TargetError,
};
use serde::{Serialize, Serializer, ser::SerializeMap};

#[derive(Debug, Clone, Serialize)]
pub struct ComputationError {
    name: &'static str,
    message: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum ComputationFailure {
    Rule(RuleResolutionFailure),
    WorkingTime {
        code: &'static str,
        kind: &'static str,
        message: String,
    },
}
#[derive(Debug, Clone)]
pub enum Computation<T> {
    Ready(T),
    Unavailable {
        error: ComputationError,
        failure: ComputationFailure,
    },
}
impl<T> Computation<T> {
    pub fn value(&self) -> Option<&T> {
        match self {
            Self::Ready(value) => Some(value),
            Self::Unavailable { .. } => None,
        }
    }
    pub(crate) fn rule(failure: &RuleResolutionFailure) -> Self {
        Self::Unavailable {
            error: ComputationError {
                name: "RuleResolutionError",
                message: failure.message.clone(),
            },
            failure: ComputationFailure::Rule(failure.clone()),
        }
    }
    fn working_time(error: &TargetError) -> Self {
        Self::Unavailable {
            error: ComputationError {
                name: "WorkingTimeTargetError",
                message: error.to_string(),
            },
            failure: ComputationFailure::WorkingTime {
                code: "WORKING_TIME_TARGET_UNAVAILABLE",
                kind: "WORKING_TIME",
                message: error.to_string(),
            },
        }
    }
}
impl<T: Serialize> Serialize for Computation<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Ready(value) => {
                let mut map = serializer.serialize_map(Some(2))?;
                map.serialize_entry("ok", &true)?;
                map.serialize_entry("value", value)?;
                map.end()
            }
            Self::Unavailable { error, failure } => {
                let mut map = serializer.serialize_map(Some(3))?;
                map.serialize_entry("ok", &false)?;
                map.serialize_entry("error", error)?;
                map.serialize_entry("failure", failure)?;
                map.end()
            }
        }
    }
}
fn rule_failure(error: &MetricsError) -> Option<&RuleResolutionFailure> {
    match error {
        MetricsError::Target(TargetError::Holiday(HolidayError::Resolution(f)))
        | MetricsError::Daily(DailyCreditError::Target(TargetError::Holiday(
            HolidayError::Resolution(f),
        )))
        | MetricsError::Special(SpecialDutyError::Holiday(HolidayError::Resolution(f))) => Some(f),
        MetricsError::Special(SpecialDutyError::Family(error)) => error.rule_failure(),
        _ => None,
    }
}
pub(crate) fn capture_metrics<T>(
    result: Result<T, MetricsError>,
) -> Result<Computation<T>, MetricsError> {
    match result {
        Ok(value) => Ok(Computation::Ready(value)),
        Err(error) => {
            if let Some(failure) = rule_failure(&error) {
                return Ok(Computation::rule(failure));
            }
            match &error {
                MetricsError::Target(target)
                | MetricsError::Daily(DailyCreditError::Target(target))
                    if !matches!(target, TargetError::Holiday(_)) =>
                {
                    Ok(Computation::working_time(target))
                }
                _ => Err(error),
            }
        }
    }
}
