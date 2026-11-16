//! Presentation of retained native annual financial outputs. This does not
//! produce monetary evidence or invoke any source/finance calculator.
use crate::runtime::report::ReportIssue;
use serde_json::{Value, json};

fn invalid() -> ReportIssue {
    ReportIssue::new("ANNUAL_FINANCIAL_DETAILS_INVALID")
}
struct Report<'a> {
    year: i64,
    count: u64,
    source: &'a str,
    months: &'a [Value],
}
fn report(value: &Value) -> Result<Report<'_>, ReportIssue> {
    let year = value["year"]
        .as_i64()
        .filter(|v| (1..=9999).contains(v))
        .ok_or_else(invalid)?;
    let count = value["availablePayMonthCount"]
        .as_u64()
        .filter(|v| *v <= 12)
        .ok_or_else(invalid)?;
    let source = value["salarySource"]
        .as_str()
        .filter(|v| matches!(*v, "TARIFF" | "MANUAL" | "UNSET"))
        .ok_or_else(invalid)?;
    let months = value["months"]
        .as_array()
        .filter(|v| v.len() == 12)
        .ok_or_else(invalid)?;
    for (index, month) in months.iter().enumerate() {
        if month["month"] != format!("{year:04}-{:02}", index + 1) {
            return Err(invalid());
        }
    }
    Ok(Report {
        year,
        count,
        source,
        months,
    })
}
fn amount(value: &Value) -> Result<Value, ReportIssue> {
    let value = value
        .as_f64()
        .filter(|v| v.is_finite())
        .ok_or_else(invalid)?;
    super::annual_display::display(value)
}
fn optional_amount(value: &Value) -> Result<Value, ReportIssue> {
    if value.is_null() {
        Ok(Value::Null)
    } else {
        amount(value)
    }
}

/// Original AnnualSalaryDetails over the UI-supplemented native year report.
pub fn salary(value: &Value) -> Result<Value, ReportIssue> {
    let report = report(value)?;
    let available = report.count > 0;
    let components = if available && report.source != "MANUAL" {
        [
            ("Zeitzuschläge", "premiumAmount", true),
            ("Überstunden", "overtimeAmount", false),
            ("Zulagen", "allowanceAmount", false),
        ]
        .into_iter()
        .map(|(label, field, opens)| {
            Ok(json!({"label":label,"amount":amount(&value[field])?,"opensPremium":opens}))
        })
        .collect::<Result<Vec<Value>, ReportIssue>>()?
    } else {
        Vec::new()
    };
    let months = report
        .months
        .iter()
        .map(|month| {
            let raw = month.get("estimatedGrossAmount").ok_or_else(invalid)?;
            Ok(json!({"month":month["month"],"amount":optional_amount(raw)?}))
        })
        .collect::<Result<Vec<Value>, ReportIssue>>()?;
    Ok(json!({
        "year":report.year,
        "total":if available { amount(&value["estimatedGrossAmount"])? } else { Value::Null },
        "caption":if available { format!("{} · {} von 12 Monaten",if report.count<12 {"Brutto-Teilsumme"} else {"Brutto-Schätzung"},report.count) } else { "Keine unterstützte Monatsschätzung verfügbar".into() },
        "monthCount":format!("{} von 12",report.count),
        "footer":if available {if report.count<12 {"Nur verfügbare Monate enthalten · keine Hochrechnung."} else {"Unverbindliche Brutto-Schätzung."}} else {"Ohne eingerichtete Gehaltsgrundlage werden keine Beträge ausgewiesen."},
        "components":components,
        "months":months
    }))
}

/// Original AnnualPremiumReport uses the base report and never requires the
/// personal annual-payment supplement. Both settled and pending copy is native.
pub fn premium(value: &Value, pending: bool) -> Result<Value, ReportIssue> {
    let report = report(value)?;
    let available = !pending && report.source == "TARIFF" && report.count > 0;
    let visible_count = report
        .months
        .iter()
        .filter(|month| month.get("timePremiumAmount").is_some_and(|v| !v.is_null()))
        .count();
    let mut result = json!({"year":report.year,"caption":Value::Null,"totalLabel":if available {"Gesamt"} else {"Status"},"total":Value::Null,"totalStatus":Value::Null,"showMonths":available,"monthsCaption":Value::Null,"months":[]});
    if available {
        let total = amount(&value["premiumAmount"])?;
        result["caption"] = json!(format!("{visible_count} von 12 Monaten · Brutto-Schätzung"));
        if value["premiumAmount"].as_f64() == Some(0.0) {
            result["monthsCaption"] =
                json!("Für die berechneten Monate fallen keine Zeitzuschläge an.");
        }
        result["total"] = total;
        result["months"] = json!(report.months.iter().map(|month| {
            let raw = month.get("timePremiumAmount").unwrap_or(&Value::Null);
            Ok(json!({"month":month["month"],"amount":optional_amount(raw)?,"enabled":!raw.is_null()}))
        }).collect::<Result<Vec<Value>,ReportIssue>>()?);
    } else {
        result["totalStatus"] = json!(if pending {
            "Wird berechnet …"
        } else if matches!(report.source, "MANUAL" | "UNSET") {
            "Keine tarifliche Berechnung"
        } else {
            "Nicht verfügbar"
        });
    }
    Ok(result)
}
