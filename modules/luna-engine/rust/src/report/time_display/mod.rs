//! Native display policy over privately computed native time outputs.
mod card;
mod credit;
pub(crate) mod format;
mod rows;
mod year;
use serde_json::{Value, json};
#[derive(Debug, Clone, Copy)]
pub struct TimeDisplayError;
impl std::fmt::Display for TimeDisplayError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("TIME_DISPLAY_UNAVAILABLE")
    }
}
impl std::error::Error for TimeDisplayError {}
pub(super) fn number(value: &Value, key: &str) -> Result<f64, TimeDisplayError> {
    value
        .get(key)
        .and_then(Value::as_f64)
        .filter(|n| n.is_finite())
        .ok_or(TimeDisplayError)
}
pub(super) fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, TimeDisplayError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or(TimeDisplayError)
}
pub(super) fn array(value: Option<&Value>) -> Result<&[Value], TimeDisplayError> {
    match value {
        None | Some(Value::Null) => Ok(&[]),
        Some(Value::Array(values)) => Ok(values),
        _ => Err(TimeDisplayError),
    }
}
/// Internal presentation only. No wire constructor accepts host-computed summaries.
pub fn present(summary: &Value, analysis: &Value) -> Result<Value, TimeDisplayError> {
    let available = summary
        .get("ok")
        .and_then(Value::as_bool)
        .ok_or(TimeDisplayError)?;
    let value = summary.get("value");
    let credits = if available {
        array(value.and_then(|v| v.get("specialDutyTimeCredits")))?
    } else {
        &[]
    };
    let mut result = json!({"card":card::present(summary,analysis)?,"shiftRows":rows::present(analysis,available,credits)?,"empty":number(analysis,"totalCount")?==0.0,"coverageNotes":[]});
    if !available {
        result["shiftCaption"] =
            json!("Ohne Feiertagsdaten fehlen die Zeitgutschriften für Urlaub und Krankheit.");
        result["coverageNotes"] =
            json!(["Für Soll, Saldo und Abwesenheitsgutschriften fehlen Berechnungsgrundlagen."]);
    } else {
        let notes = array(value.and_then(|v| v.get("specialDutyNotes")))?;
        if !notes.is_empty() {
            let notes = notes
                .iter()
                .map(|v| v.as_str().ok_or(TimeDisplayError))
                .collect::<Result<Vec<_>, _>>()?;
            result["coverageNotes"] = json!([notes.join(" ")]);
        }
    }
    Ok(result)
}

/// Native monthly dashboard presentation; never accepts a host calculation on wire.
pub fn present_dashboard(summary: &Value, analysis: &Value) -> Result<Value, TimeDisplayError> {
    card::dashboard(summary, analysis)
}

/// Presentation over a private native full-year or provisional core report.
pub fn present_year(report: &Value, pending: bool) -> Result<Value, TimeDisplayError> {
    year::present(report, pending)
}
