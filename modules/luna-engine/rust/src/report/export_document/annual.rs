use crate::{
    calendar::recurrence::CollationRanks,
    compliance::annual::{AnnualComplianceError, AnnualComplianceSource},
    report::{
        financial::{FinancialError, source::FinancialContext},
        time::{TimeReportContext, TimeReportError},
    },
};
use serde_json::{Value, json};
#[derive(Debug)]
pub enum AnnualCompositionError {
    Time(TimeReportError),
    Financial(FinancialError),
    Checks(AnnualComplianceError),
    InvalidOutput,
}
impl std::fmt::Display for AnnualCompositionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Time(e) => e.fmt(f),
            Self::Financial(e) => e.fmt(f),
            Self::Checks(e) => e.fmt(f),
            Self::InvalidOutput => f.write_str("Ungültige Jahresauswertung."),
        }
    }
}
impl std::error::Error for AnnualCompositionError {}
/// Full legacy AnnualAvailable result, before the source caller applies its
/// check-visibility and annual salary-payment adapters. All parts are produced
/// natively; none can be provided as a host-ready calculation result.
pub fn calculate(
    year: i32,
    time: &mut TimeReportContext,
    financial: &mut FinancialContext<'_>,
    checks: &AnnualComplianceSource,
    collation: &CollationRanks,
) -> Result<Value, AnnualCompositionError> {
    calculate_with_gross(year, time, financial, checks, collation).map(|(value, _)| value)
}
pub(crate) fn calculate_with_gross(
    year: i32,
    time: &mut TimeReportContext,
    financial: &mut FinancialContext<'_>,
    checks: &AnnualComplianceSource,
    collation: &CollationRanks,
) -> Result<(Value, crate::report::financial::gross::FinancialGrossReport), AnnualCompositionError>
{
    let mut report = time.annual(year).map_err(AnnualCompositionError::Time)?;
    let typed_gross =
        crate::report::financial::gross::annual_legacy_financial_report(year, financial)
            .map_err(AnnualCompositionError::Financial)?;
    let gross =
        serde_json::to_value(&typed_gross).map_err(|_| AnnualCompositionError::InvalidOutput)?;
    let legal =
        crate::compliance::annual::calculate_annual_compliance(year, checks, None, collation)
            .map_err(AnnualCompositionError::Checks)?
            .into_json();
    let months = report["months"]
        .as_array_mut()
        .ok_or(AnnualCompositionError::InvalidOutput)?;
    let gross_months = gross["months"]
        .as_array()
        .ok_or(AnnualCompositionError::InvalidOutput)?;
    let check_months = legal["months"]
        .as_array()
        .ok_or(AnnualCompositionError::InvalidOutput)?;
    if months.len() != 12 || gross_months.len() != 12 || check_months.len() != 12 {
        return Err(AnnualCompositionError::InvalidOutput);
    }
    for ((month, gross), checks) in months.iter_mut().zip(gross_months).zip(check_months) {
        if month["month"] != gross["month"] || month["month"] != checks["month"] {
            return Err(AnnualCompositionError::InvalidOutput);
        }
        let row = month
            .as_object_mut()
            .ok_or(AnnualCompositionError::InvalidOutput)?;
        for key in ["timePremiumAmount", "estimatedGrossAmount", "premiumAmount"] {
            row.insert(key.into(), required(gross, key)?.clone());
        }
        for (key, value) in checks
            .as_object()
            .ok_or(AnnualCompositionError::InvalidOutput)?
        {
            if key != "month" {
                row.insert(key.clone(), value.clone());
            }
        }
    }
    let output = report
        .as_object_mut()
        .ok_or(AnnualCompositionError::InvalidOutput)?;
    for key in [
        "salarySource",
        "availablePayMonthCount",
        "estimatedGrossAmount",
        "premiumAmount",
        "overtimeAmount",
        "allowanceAmount",
    ] {
        output.insert(key.into(), required(&gross, key)?.clone());
    }
    for key in [
        "criticalCount",
        "warningCount",
        "complianceCoverageComplete",
    ] {
        output.insert(key.into(), required(&legal, key)?.clone());
    }
    output.insert("year".into(), json!(year));
    Ok((report, typed_gross))
}
fn required<'a>(v: &'a Value, key: &str) -> Result<&'a Value, AnnualCompositionError> {
    v.get(key).ok_or(AnnualCompositionError::InvalidOutput)
}
