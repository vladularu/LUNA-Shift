//! Native finding presentation; these DTOs are calculated outputs, not source facts.
use serde_json::{Value, json};
use std::sync::OnceLock;
pub mod context;
pub mod dates;
pub mod duty;
mod facts;
pub mod groups;
pub mod identity;
mod legacy;
mod legal;
mod planning;
pub mod rule_groups;
mod summary;
mod tariff;
pub mod tariff_evidence;
pub mod timeline;
mod weekend_facts;
pub use facts::valid as valid_facts;
pub use weekend_facts::valid as valid_weekend;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PresentationError;
impl std::fmt::Display for PresentationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Invalid check presentation input")
    }
}
impl std::error::Error for PresentationError {}
fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or("")
}
fn number_text(value: f64) -> String {
    if value.is_nan() {
        "NaN".into()
    } else if value == f64::INFINITY {
        "Infinity".into()
    } else if value == f64::NEG_INFINITY {
        "-Infinity".into()
    } else if value == 0.0 {
        "0".into()
    } else {
        ryu_js::Buffer::new().format(value).to_owned()
    }
}
fn policy() -> &'static Value {
    static POLICY: OnceLock<Value> = OnceLock::new();
    // Compiled, source-hashed immutable table, validated by the reference gate.
    POLICY.get_or_init(|| {
        serde_json::from_str(include_str!("policy.json"))
            .expect("Compiled check presentation policy")
    })
}
pub fn category(issue: &Value) -> &'static str {
    if issue["kind"] == "PLANNING" {
        "planning"
    } else if crate::credit::summary::truthy(issue.get("tariff"))
        || text(issue, "rule").starts_with("TARIFF_")
    {
        "tariff"
    } else {
        "legal"
    }
}
pub fn category_label(issue: &Value) -> &'static str {
    match category(issue) {
        "planning" => "Hinweise & Empfehlungen",
        "tariff" => "Tarifliche Prüfung",
        _ => "Gesetzliche Prüfung",
    }
}
pub fn issue(input: &Value) -> Result<Value, PresentationError> {
    if !input.is_object()
        || ["rule", "title", "description", "kind"]
            .iter()
            .any(|key| !input[*key].is_string())
    {
        return Err(PresentationError);
    }
    let hint = planning::present(
        input,
        input
            .get("fallbackTitle")
            .and_then(Value::as_str)
            .unwrap_or(text(input, "title")),
    );
    let summary = summary::issue(input);
    let count = legacy::count(input)
        .filter(|number| number.is_finite())
        .and_then(|number| serde_json::from_str::<Value>(&number_text(number)).ok())
        .unwrap_or(Value::Null);
    Ok(
        json!({"facts":valid_facts(&input["facts"],text(input,"rule")),"summary":summary,"legacySummary":legacy::summary(input),"legacyCount":count,"legacyRest":legacy::rest(input,&summary),"legal":legal::present(input),"planning":hint,"cardSummary":planning::card_summary(input,&hint),"category":category(input),"categoryLabel":category_label(input)}),
    )
}
pub fn number(input: f64) -> Result<Value, PresentationError> {
    if !input.is_finite() {
        return Err(PresentationError);
    }
    Ok(
        json!({"hours":summary::hours(input),"limit":summary::limit(input),"duration":summary::duration(input)}),
    )
}
pub fn tariff(input: &Value) -> Result<Value, PresentationError> {
    let evidence = &input["evidence"];
    if !input["title"].is_string()
        || !input["description"].is_string()
        || !evidence.is_object()
        || !evidence["ruleId"].is_string()
        || !evidence["source"].is_object()
        || !evidence["requirements"]
            .as_array()
            .is_some_and(|values| values.iter().all(Value::is_string))
    {
        return Err(PresentationError);
    }
    Ok(tariff::present(input))
}
