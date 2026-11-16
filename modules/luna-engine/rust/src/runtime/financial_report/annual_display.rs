//! Annual display facts over retained native year outputs. These values cannot
//! mint source evidence, a cached financial proof or a Ready calculation.
use crate::{report::financial::presentation::js_round, runtime::report::ReportIssue};
use serde_json::{Value, json};

fn invalid() -> ReportIssue {
    ReportIssue::new("ANNUAL_FINANCIAL_DISPLAY_INVALID")
}
fn number(value: &Value) -> Result<f64, ReportIssue> {
    value.as_f64().filter(|v| v.is_finite()).ok_or_else(invalid)
}
fn year(report: &Value) -> Result<i64, ReportIssue> {
    report["year"]
        .as_i64()
        .filter(|v| (1..=9999).contains(v))
        .ok_or_else(invalid)
}
pub(super) fn display(euros: f64) -> Result<Value, ReportIssue> {
    if !euros.is_finite() {
        return Err(invalid());
    }
    Ok(
        json!({"euros":euros,"fractionDigits":2,"negativeZero":euros==0.0&&euros.is_sign_negative()}),
    )
}
/// Exact PAY props from the original settled AnnualOverview. Pending/error
/// interaction stays local; all monetary composition and count copy is native.
pub fn gross_overview(report: &Value) -> Result<Value, ReportIssue> {
    let year = year(report)?;
    let count = report["availablePayMonthCount"]
        .as_u64()
        .filter(|v| *v <= 12)
        .ok_or_else(invalid)?;
    let source = report["salarySource"].as_str().ok_or_else(invalid)?;
    if !matches!(source, "TARIFF" | "MANUAL" | "UNSET") {
        return Err(invalid());
    }
    let gross = number(&report["estimatedGrossAmount"])?;
    let annual = report.get("annualPaymentAmount");
    let annual_number = match annual {
        Some(v) if !v.is_null() => number(v)?,
        _ => 0.0,
    };
    let mut pay = json!({"gross":gross,"manual":source=="MANUAL","caption":if count>0 {format!("{} · {count} von 12 Monaten",if count<12 {"Brutto-Teilsumme"} else {"Brutto-Schätzung"})}else{"Keine unterstützte Monatsschätzung verfügbar".into()}});
    if count == 0 {
        pay["status"] = json!("Nicht verfügbar");
    }
    if source == "TARIFF" {
        let premiums = number(&report["premiumAmount"])?;
        let overtime = number(&report["overtimeAmount"])?;
        let allowances = number(&report["allowanceAmount"])?;
        // Preserve the source subtraction and multiplication order. Integer
        // cents or a reordered fold would change accepted display boundaries.
        let base =
            js_round((gross - premiums - overtime - allowances - annual_number) * 100.0) / 100.0;
        if !base.is_finite() {
            return Err(invalid());
        }
        pay["base"] = json!(base);
        pay["premiums"] = json!(premiums);
        pay["overtime"] = json!(overtime);
        pay["allowances"] = json!(allowances);
    }
    if let Some(annual) = annual {
        pay["annualPayments"] = annual.clone();
    }
    let mut amounts = json!({});
    for field in [
        "base",
        "premiums",
        "overtime",
        "allowances",
        "gross",
        "annualPayments",
    ] {
        amounts[field] = match pay.get(field).filter(|v| !v.is_null()) {
            Some(value) => display(number(value)?)?,
            None => Value::Null,
        };
    }
    Ok(json!({"year":year,"pay":pay,"amounts":amounts}))
}
/// Annual amount() differs from the monthly forecast formatter: it multiplies
/// by 1000 BEFORE dividing cents by 100, and keeps two decimal places.
pub fn net_amount(cents: f64, preliminary: bool) -> Result<Value, ReportIssue> {
    if !cents.is_finite() {
        return Err(invalid());
    }
    let adjusted = if preliminary {
        js_round(cents / 1000.0) * 1000.0
    } else {
        cents
    };
    display(adjusted / 100.0)
}
fn optional_amount(value: &Value, preliminary: &Value) -> Result<Value, ReportIssue> {
    let preliminary = preliminary.as_bool().ok_or_else(invalid)?;
    if value.is_null() {
        Ok(Value::Null)
    } else {
        net_amount(number(value)?, preliminary)
    }
}
pub fn net_amounts(report: &Value) -> Result<Value, ReportIssue> {
    let year = year(report)?;
    let months = report["months"]
        .as_array()
        .filter(|v| v.len() == 12)
        .ok_or_else(invalid)?;
    let total = optional_amount(&report["netCents"], &report["preliminary"])?;
    let months=months.iter().enumerate().map(|(index,month)| {
        let key=format!("{year:04}-{:02}",index+1);
        if month["month"]!=key{return Err(invalid());}
        Ok(json!({"month":key,"amount":optional_amount(&month["netCents"],&month["preliminary"])?}))
    }).collect::<Result<Vec<_>,ReportIssue>>()?;
    Ok(json!({"year":year,"total":total,"months":months}))
}
