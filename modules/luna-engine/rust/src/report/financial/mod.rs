//! Financial orchestration over a shared raw snapshot. UI/native transport and
//! the independent legal/time reports consume these results separately.
pub mod annual_salary;
pub mod assessed;
pub mod assessed_source;
pub mod dashboard;
pub mod fingerprint;
pub mod gross;
pub mod net;
pub mod presentation;
pub mod source;

use crate::pay::pattern::WorkPatternSettings;
use serde_json::Value;
use std::collections::BTreeSet;
use std::sync::Arc;

/// Borrowed raw inputs only: no computed gross, payroll trace or proof fields.
pub struct FinancialSnapshotInput<'a> {
    pub profile: &'a Arc<Value>,
    pub entries: &'a Arc<Vec<Value>>,
    pub tariff_decisions: &'a [Value],
    pub work_pattern_settings: &'a WorkPatternSettings,
    pub test_months: &'a BTreeSet<String>,
}

#[derive(Debug, Clone)]
pub struct FinancialError {
    pub(crate) message: String,
    pub(crate) rule_failure: bool,
    pub(crate) rule_failure_details: Option<Box<crate::rules::RuleResolutionFailure>>,
}
impl FinancialError {
    pub fn rule_failure_details(&self) -> Option<&crate::rules::RuleResolutionFailure> {
        self.rule_failure_details.as_deref()
    }
    pub(crate) fn invalid(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            rule_failure: false,
            rule_failure_details: None,
        }
    }
}
impl std::fmt::Display for FinancialError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}
impl std::error::Error for FinancialError {}
