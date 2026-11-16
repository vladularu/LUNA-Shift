//! Compact requested panel observations. Locale encoding is the only host work.
mod basis;
mod components;
mod special;
mod tariff;
pub use crate::contract::PayrollPanel;
use crate::{net::payment_projection::SalaryPaymentProjection, runtime::report::ReportIssue};
use serde_json::{Value, json};
pub(super) use tariff::calculate;
pub(super) struct PanelInput<'a> {
    pub month: &'a str,
    pub profile: &'a Value,
    pub projection: &'a SalaryPaymentProjection,
    pub settings: Option<&'a Value>,
    pub annual: &'a Value,
    pub forecast: Option<&'a Value>,
}
pub(super) fn present(panel: PayrollPanel, input: PanelInput<'_>) -> Result<Value, ReportIssue> {
    let nodes = match panel {
        PayrollPanel::Components => components::present(&input)?,
        PayrollPanel::Basis => basis::present(&input)?,
        PayrollPanel::SpecialDuties => special::present(&input.projection.pay)?,
        PayrollPanel::TariffAssessment => return Err(failure()),
    };
    checked(nodes)
}
pub(super) fn present_special(pay: &Value) -> Result<Value, ReportIssue> {
    checked(special::present(pay)?)
}
fn checked(nodes: Vec<Value>) -> Result<Value, ReportIssue> {
    if node_count(&nodes) > 32_768 {
        return Err(ReportIssue::new("PAYROLL_PANEL_LIMIT"));
    }
    crate::report::cache_budget::serialized_bytes(&nodes, 16 * 1024 * 1024)
        .ok_or_else(|| ReportIssue::new("PAYROLL_PANEL_LIMIT"))?;
    Ok(Value::Array(nodes))
}
fn node_count(nodes: &[Value]) -> usize {
    nodes
        .iter()
        .map(|node| {
            1 + node
                .get("children")
                .and_then(Value::as_array)
                .map_or(0, |children| node_count(children))
        })
        .sum()
}
#[cfg(test)]
#[path = "../../../../../tests/support/payroll_panel_units.rs"]
mod tests;
fn failure() -> ReportIssue {
    ReportIssue::new("PAYROLL_PANEL_INVALID")
}
fn number(v: &Value) -> Result<f64, ReportIssue> {
    v.as_f64().filter(|n| n.is_finite()).ok_or_else(failure)
}
fn list(v: &Value) -> Result<&[Value], ReportIssue> {
    v.as_array().map(Vec::as_slice).ok_or_else(failure)
}
fn optional(v: &Value) -> Option<&Value> {
    (!v.is_null()).then_some(v)
}
fn txt(v: &Value) -> Result<&str, ReportIssue> {
    v.as_str().ok_or_else(failure)
}
fn js(v: &Value) -> Result<String, ReportIssue> {
    if let Some(s) = v.as_str() {
        Ok(s.into())
    } else {
        Ok(ryu_js::Buffer::new().format_finite(number(v)?).into())
    }
}
fn text(s: impl Into<String>) -> Value {
    parts(vec![Value::String(s.into())])
}
fn parts(parts: Vec<Value>) -> Value {
    let mut merged = vec![];
    for p in parts {
        if let (Some(Value::String(previous)), Value::String(next)) = (merged.last_mut(), &p) {
            previous.push_str(next)
        } else {
            merged.push(p)
        }
    }
    json!({"kind":"TEXT","role":"NOTE","parts":merged})
}
fn with_role(mut node: Value, role: &str) -> Value {
    node["role"] = json!(role);
    node
}
fn format(value: f64, currency: bool, min: u8, max: u8) -> Value {
    json!({"value":value,"minimumFractionDigits":min,"maximumFractionDigits":max,"currency":currency,"negativeZero":value==0.0&&value.is_sign_negative()})
}
fn euro(cents: f64) -> Value {
    format(cents / 100.0, true, 2, 2)
}
fn amount(label: &str, value: Vec<Value>, subtitle: Option<&str>, emphasize: bool) -> Value {
    json!({"kind":"AMOUNT","label":label,"value":value,"subtitle":subtitle,"emphasizeValue":emphasize})
}
fn money_row(label: &str, cents: f64) -> Value {
    amount(label, vec![euro(cents)], None, false)
}
fn card(title: Option<&str>, children: Vec<Value>) -> Value {
    json!({"kind":"CARD","title":title,"children":children})
}
fn nav(title: &str, subtitle: Option<&str>) -> Value {
    json!({"kind":"NAVIGATION","title":title,"subtitle":subtitle})
}
fn available<'a>(input: &PanelInput<'a>) -> Option<&'a Value> {
    input
        .forecast
        .filter(|f| f["result"]["status"] == "available")
        .map(|f| &f["result"]["pay"])
}
fn forecast_label(pay: &Value) -> Result<Option<String>, ReportIssue> {
    if pay["calculationBasis"]["status"] != "PREVIOUS_YEAR_ESTIMATE" {
        return Ok(None);
    }
    let b = &pay["calculationBasis"];
    Ok(Some(format!(
        "{} vorläufig · Abzüge nach Stand {}",
        js(&b["payrollYear"])?,
        js(&b["rulesYear"])?
    )))
}
fn night(minutes: f64) -> Value {
    parts(vec![
        json!("Zusätzlich "),
        format(minutes, false, 0, 1),
        json!(" Min. Freizeitausgleich für Nachtarbeit."),
    ])
}
