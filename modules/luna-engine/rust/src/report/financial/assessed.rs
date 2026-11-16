//! Annual dated-remuneration summary. Monthly financial evidence can only be
//! constructed inside Rust; the native assessed-month engine must supply it.
use super::FinancialError;
use crate::money::MAX_SAFE_INTEGER;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AssessedReportStatus {
    Ready,
    Loading,
    Error,
}

#[derive(Debug, Clone)]
pub struct NativeAssessedMonth(Arc<Value>);
impl Serialize for NativeAssessedMonth {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.as_ref().serialize(serializer)
    }
}
impl NativeAssessedMonth {
    /// Only a native assessed-month producer may construct monetary evidence.
    /// Deliberately no Deserialize or public Value-to-evidence conversion.
    pub(crate) fn from_native(value: Value) -> Self {
        Self(Arc::new(value))
    }
    pub(crate) fn value(&self) -> &Value {
        self.0.as_ref()
    }
}
pub trait AssessedMonthProvider {
    /// None is the source's unavailable monthly result. A missing native
    /// implementation must return an error instead of a ready empty month.
    fn assessed_month(
        &mut self,
        month: &str,
    ) -> Result<Option<NativeAssessedMonth>, FinancialError>;
}

#[derive(Debug, Clone, Serialize)]
pub struct AssessedYearMonth {
    month: String,
    result: Option<NativeAssessedMonth>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssessedYearComponent {
    has_known_amounts: bool,
    complete_month_count: usize,
    known_subtotal_cents: i64,
    total_cents: Option<i64>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssessedFinancialYear {
    has_known_amounts: bool,
    status: AssessedReportStatus,
    months: Vec<AssessedYearMonth>,
    complete_month_count: usize,
    known_subtotal_cents: i64,
    estimated_gross_cents: Option<i64>,
    base: AssessedYearComponent,
    time_premiums: AssessedYearComponent,
    allowances: AssessedYearComponent,
    overtime: AssessedYearComponent,
    annual_payments: AssessedYearComponent,
}
fn invalid_sum() -> FinancialError {
    FinancialError::invalid("Ungültige Vergütungssumme.")
}
fn amount(value: Option<&Value>) -> Result<i64, FinancialError> {
    let Some(value) = value.filter(|value| !value.is_null()) else {
        return Ok(0);
    };
    let number = value
        .as_f64()
        .filter(|number| {
            number.is_finite() && number.fract() == 0.0 && number.abs() <= MAX_SAFE_INTEGER as f64
        })
        .ok_or_else(invalid_sum)?;
    Ok(number as i64)
}
fn sum<'a>(mut values: impl Iterator<Item = Option<&'a Value>>) -> Result<i64, FinancialError> {
    values.try_fold(0_i64, |total, value| {
        let total = total.checked_add(amount(value)?).ok_or_else(invalid_sum)?;
        if total.unsigned_abs() > MAX_SAFE_INTEGER as u64 {
            return Err(invalid_sum());
        }
        Ok(total)
    })
}
fn known(value: &Value) -> bool {
    crate::net::js_truthy(&value["complete"])
        || value["positions"].as_array().is_some_and(|positions| {
            positions
                .iter()
                .any(|position| position.get("amountCents") != Some(&Value::Null))
        })
}
fn component(
    months: &[AssessedYearMonth],
    key: &str,
) -> Result<AssessedYearComponent, FinancialError> {
    let values: Vec<_> = months
        .iter()
        .filter_map(|month| month.result.as_ref().map(|month| &month.0[key]))
        .collect();
    let complete_month_count = values
        .iter()
        .filter(|value| crate::net::js_truthy(&value["complete"]))
        .count();
    let known_subtotal_cents = sum(values.iter().map(|value| value.get("knownSubtotalCents")))?;
    Ok(AssessedYearComponent {
        has_known_amounts: values.iter().any(|value| known(value)),
        complete_month_count,
        known_subtotal_cents,
        total_cents: (complete_month_count == 12).then_some(known_subtotal_cents),
    })
}
fn summarize(
    year: i32,
    status: AssessedReportStatus,
    months: &[AssessedYearMonth],
) -> Result<AssessedFinancialYear, FinancialError> {
    if !(1900..=4099).contains(&year) {
        return Err(FinancialError::invalid("Ungültiges Berichtsjahr."));
    }
    let mut ordered = Vec::with_capacity(12);
    for index in 1..=12 {
        let month = format!("{year}-{index:02}");
        let matches: Vec<_> = months.iter().filter(|row| row.month == month).collect();
        if matches.len() > 1 {
            return Err(FinancialError::invalid("Doppelter Vergütungsmonat."));
        }
        let result = if status == AssessedReportStatus::Ready {
            matches.first().and_then(|row| row.result.clone())
        } else {
            None
        };
        if result
            .as_ref()
            .is_some_and(|result| result.0["month"] != month)
        {
            return Err(FinancialError::invalid("Abweichender Vergütungsmonat."));
        }
        ordered.push(AssessedYearMonth { month, result });
    }
    if months
        .iter()
        .any(|row| !ordered.iter().any(|expected| expected.month == row.month))
    {
        return Err(FinancialError::invalid(
            "Vergütungsmonat außerhalb des Berichtsjahres.",
        ));
    }
    let complete_month_count = ordered
        .iter()
        .filter(|row| {
            row.result
                .as_ref()
                .is_some_and(|value| crate::net::js_truthy(&value.0["complete"]))
        })
        .count();
    let known_subtotal_cents = sum(ordered.iter().map(|row| {
        row.result
            .as_ref()
            .and_then(|value| value.0.get("knownSubtotalCents"))
    }))?;
    Ok(AssessedFinancialYear {
        has_known_amounts: ordered
            .iter()
            .any(|row| row.result.as_ref().is_some_and(|value| known(&value.0))),
        status,
        complete_month_count,
        known_subtotal_cents,
        estimated_gross_cents: (complete_month_count == 12).then_some(known_subtotal_cents),
        base: component(&ordered, "base")?,
        time_premiums: component(&ordered, "timePremiums")?,
        allowances: component(&ordered, "allowances")?,
        overtime: component(&ordered, "overtime")?,
        annual_payments: component(&ordered, "annualPayments")?,
        months: ordered,
    })
}

/// No implementation is selected implicitly: dated raw input must be bound to
/// the full native assessed-month engine before a ready report can be produced.
pub fn annual_assessed_financial_report(
    year: i32,
    status: AssessedReportStatus,
    provider: &mut impl AssessedMonthProvider,
) -> Result<AssessedFinancialYear, FinancialError> {
    if !(1900..=4099).contains(&year) {
        return Err(FinancialError::invalid("Ungültiges Berichtsjahr."));
    }
    let mut months = Vec::with_capacity(12);
    for index in 1..=12 {
        let month = format!("{year}-{index:02}");
        let result = if status == AssessedReportStatus::Ready {
            provider.assessed_month(&month)?
        } else {
            None
        };
        months.push(AssessedYearMonth { month, result });
    }
    summarize(year, status, &months)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn all_summary_stage_cases_match_frozen_source_without_production_month_fallback() {
        let data: Value = serde_json::from_str(include_str!(
            "../../../../reference/financial-assessed-summary-golden.json"
        ))
        .unwrap();
        assert_eq!(data["cases"].as_array().unwrap().len(), 161);
        for case in data["cases"].as_array().unwrap() {
            let input = &case["input"];
            let rows: Vec<_> = input["months"]
                .as_array()
                .unwrap()
                .iter()
                .map(|row| AssessedYearMonth {
                    month: row["month"].as_str().unwrap().into(),
                    result: (!row["result"].is_null())
                        .then(|| NativeAssessedMonth::from_native(row["result"].clone())),
                })
                .collect();
            let status = serde_json::from_value(input["status"].clone()).unwrap();
            let actual = match summarize(input["year"].as_i64().unwrap() as i32, status, &rows) {
                Ok(value) => serde_json::to_value(value).unwrap(),
                Err(error) => json!({"$error":error.to_string()}),
            };
            assert_eq!(actual, case["expected"], "{}", case["id"]);
        }
    }
    #[test]
    fn unbound_native_provider_is_an_explicit_error_and_loading_never_calls_it() {
        struct Pending;
        impl AssessedMonthProvider for Pending {
            fn assessed_month(
                &mut self,
                _: &str,
            ) -> Result<Option<NativeAssessedMonth>, FinancialError> {
                Err(FinancialError::invalid(
                    "Native assessed-month engine is not implemented",
                ))
            }
        }
        assert!(
            annual_assessed_financial_report(2026, AssessedReportStatus::Ready, &mut Pending)
                .is_err()
        );
        for status in [AssessedReportStatus::Loading, AssessedReportStatus::Error] {
            let report = annual_assessed_financial_report(2026, status, &mut Pending).unwrap();
            assert_eq!(report.complete_month_count, 0);
            assert_eq!(report.estimated_gross_cents, None);
            assert!(!report.has_known_amounts);
        }
    }
}
