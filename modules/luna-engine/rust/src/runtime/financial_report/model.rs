use crate::{
    contract::{SalaryPerspective, SourceKind},
    net::payment_schedule::{self, PaymentPreferences},
    report::financial::FinancialError,
    runtime::{facts::SnapshotFacts, financial_source::FinancialSourceError, report::ReportIssue},
};
use serde::Serialize;
use serde_json::Value;
pub(super) fn source_error(error: FinancialSourceError) -> ReportIssue {
    match error {
        FinancialSourceError::Facts(e) => e.into(),
        FinancialSourceError::Catalog(e) => e.into(),
        FinancialSourceError::MissingProfile => ReportIssue::new("PROFILE_MISSING"),
        FinancialSourceError::InvalidNativeInput => ReportIssue::new("FINANCIAL_INPUT_INVALID"),
    }
}
pub(super) fn calculation_error(error: FinancialError) -> ReportIssue {
    ReportIssue::new(if error.rule_failure {
        "FINANCIAL_RULES_UNAVAILABLE"
    } else {
        "FINANCIAL_CALCULATION_FAILED"
    })
}
pub(super) fn output(value: &impl Serialize) -> Result<Value, ReportIssue> {
    serde_json::to_value(value).map_err(|_| ReportIssue::new("FINANCIAL_OUTPUT_INVALID"))
}
pub(super) fn perspective(value: SalaryPerspective) -> payment_schedule::SalaryPerspective {
    match value {
        SalaryPerspective::Earned => payment_schedule::SalaryPerspective::Earned,
        SalaryPerspective::Payout => payment_schedule::SalaryPerspective::Payout,
    }
}
pub(super) fn preferences(
    facts: &SnapshotFacts,
    perspective: SalaryPerspective,
) -> Result<PaymentPreferences, ReportIssue> {
    let value = if perspective == SalaryPerspective::Payout {
        facts.salary_preferences()?.preferences().as_ref().clone()
    } else {
        // This unused pure parameter is required by the original earned-year API.
        // It is not a fabricated successful read of the cash-preference source.
        serde_json::json!({"version":1,"periods":[],"reviewedEmptyMonths":[],"socialInsuranceAttribution":"UNKNOWN"})
    };
    payment_schedule::validate_salary_payment_preferences(&value).map_err(|_| ReportIssue {
        source: Some(SourceKind::SalaryPaymentPreferences),
        ..ReportIssue::new("SALARY_PREFERENCES_INVALID")
    })
}
