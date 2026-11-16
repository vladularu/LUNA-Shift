//! Annual legacy financial fields, independent of time/legal coverage.
use super::{FinancialError, source::FinancialContext};
use crate::net::{annual_payment::AnnualSalaryPayment, settings::collect_annual_salary_payments};
use crate::pay::legacy::round_money;
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinancialGrossMonth {
    month: String,
    time_premium_amount: Option<f64>,
    estimated_gross_amount: Option<f64>,
    premium_amount: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    annual_payment_amount: Option<f64>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinancialGrossReport {
    year: i32,
    salary_source: &'static str,
    available_pay_month_count: usize,
    estimated_gross_amount: f64,
    premium_amount: f64,
    overtime_amount: f64,
    allowance_amount: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    annual_payment_amount: Option<f64>,
    months: Vec<FinancialGrossMonth>,
}
fn number(pay: &Value, field: &str) -> Result<f64, FinancialError> {
    pay[field]
        .as_f64()
        .filter(|amount| amount.is_finite())
        .ok_or_else(|| FinancialError::invalid("Ungültige Gehaltssumme."))
}
fn tariff(profile: &Value) -> bool {
    // The existing profile contract requires a nullable tariff field. Match
    // its explicit-null test and the six separate optional family fields.
    profile.get("tariff") != Some(&Value::Null)
        || [
            "nursingTrainingTariff",
            "vkaETariff",
            "tvlKrTariff",
            "tvUkNursingTariff",
            "tvhKrTariff",
            "tvalPflegeTariff",
        ]
        .iter()
        .any(|key| !profile[*key].is_null())
}

pub fn annual_legacy_financial_report(
    year: i32,
    context: &mut FinancialContext<'_>,
) -> Result<FinancialGrossReport, FinancialError> {
    if !(1900..=4099).contains(&year) {
        return Err(FinancialError::invalid("Ungültiges Berichtsjahr."));
    }
    let has_tariff = tariff(context.profile());
    let mut report = FinancialGrossReport {
        year,
        salary_source: if has_tariff {
            "TARIFF"
        } else if !context.profile()["manualMonthlyGrossCents"].is_null() {
            "MANUAL"
        } else {
            "UNSET"
        },
        available_pay_month_count: 0,
        estimated_gross_amount: 0.0,
        premium_amount: 0.0,
        overtime_amount: 0.0,
        allowance_amount: 0.0,
        annual_payment_amount: None,
        months: Vec::with_capacity(12),
    };
    for index in 1..=12 {
        let month = format!("{year}-{index:02}");
        let source = match context.annual_salary_month(&month) {
            Ok(source) => Some(source),
            Err(error) if error.rule_failure => None,
            Err(error) => return Err(error),
        };
        let pay = source.as_ref().map(|source| source.pay());
        let available = pay
            .is_some_and(|pay| pay["available"] == true && !pay["estimatedGrossAmount"].is_null());
        let mut row = FinancialGrossMonth {
            month,
            time_premium_amount: None,
            estimated_gross_amount: None,
            premium_amount: 0.0,
            annual_payment_amount: None,
        };
        if available {
            let pay = pay.expect("available pay");
            let gross = number(pay, "estimatedGrossAmount")?;
            let premium = number(pay, "timePremiumAmount")?;
            let overtime = number(pay, "overtimeAmount")?;
            let allowance = number(pay, "allowanceAmount")?;
            let tvoed = number(pay, "tvoedAllowanceAmount")?;
            let care = number(pay, "careAllowanceAmount")?;
            row.estimated_gross_amount = Some(gross);
            row.time_premium_amount = has_tariff.then_some(premium);
            // Preserve the source's left-associated floating-point ordering;
            // the row sum is not the same field as annual time premiums.
            row.premium_amount = premium + overtime + allowance + tvoed + care;
            report.available_pay_month_count += 1;
            report.estimated_gross_amount += gross;
            report.premium_amount += premium;
            report.overtime_amount += overtime;
            report.allowance_amount += allowance + tvoed + care;
        }
        report.months.push(row);
    }
    report.estimated_gross_amount = round_money(report.estimated_gross_amount);
    report.premium_amount = round_money(report.premium_amount);
    report.overtime_amount = round_money(report.overtime_amount);
    report.allowance_amount = round_money(report.allowance_amount);
    Ok(report)
}

/// The report is Rust-created and has no Deserialize implementation. Confirmed
/// cash-month one-offs are ordinary validated input, never computed gross.
pub fn with_annual_salary_payments(
    report: &FinancialGrossReport,
    timeline: &[Value],
    payments: Option<&[AnnualSalaryPayment]>,
) -> Result<FinancialGrossReport, FinancialError> {
    let collected;
    let payments = match payments {
        Some(payments) => payments,
        None => {
            let value = collect_annual_salary_payments(timeline)
                .map_err(|error| FinancialError::invalid(error.to_string()))?;
            collected = crate::net::annual_payment::validate_annual_salary_payments(&value)
                .map_err(|error| FinancialError::invalid(error.to_string()))?;
            &collected
        }
    };
    let mut result = report.clone();
    let mut added_cents = 0_i64;
    let mut total_cents = 0_i64;
    for row in &mut result.months {
        let Some(gross) = row.estimated_gross_amount else {
            continue;
        };
        let amount = payments
            .iter()
            .find(|payment| payment.payout_month == row.month)
            .map_or(0, |payment| payment.gross_cents);
        let previous = (row.annual_payment_amount.unwrap_or(0.0) * 100.0 + 0.5).floor() as i64;
        added_cents += amount - previous;
        total_cents += amount;
        if amount != previous {
            row.annual_payment_amount = Some(amount as f64 / 100.0);
            row.estimated_gross_amount =
                Some((gross * 100.0 + amount as f64 - previous as f64 + 0.5).floor() / 100.0);
        }
    }
    if added_cents == 0 {
        return Ok(report.clone());
    }
    result.annual_payment_amount = Some(total_cents as f64 / 100.0);
    result.estimated_gross_amount =
        (report.estimated_gross_amount * 100.0 + added_cents as f64 + 0.5).floor() / 100.0;
    Ok(result)
}
