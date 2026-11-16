//! Explicit billing transfer policy over native editor facts. No standalone DB write admission.
use super::{InputError, javascript_json};
use crate::{
    employment::{self, profile_view::EmploymentProfileRef},
    net::js_truthy,
    pay::special,
    rules::RuleResolver,
};
use serde_json::{Value, json};
use std::collections::BTreeSet;
fn invalid() -> InputError {
    InputError::source(
        "Die Abrechnung des Sonderdienstes ist unvollständig.",
        "Error",
    )
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, InputError> {
    value[key].as_str().ok_or_else(invalid)
}
fn shared_billing(duty: &Value) -> Result<String, InputError> {
    if duty["kind"] != "STANDBY" {
        return Ok(String::new());
    }
    let mut agreement = duty["standbyAgreement"].clone();
    if js_truthy(&agreement) {
        if !agreement.is_object() {
            return Err(invalid());
        }
        agreement["sequence"] = Value::Null;
    } else {
        agreement = Value::Null;
    }
    let mut fields = serde_json::Map::new();
    for (key, source) in [("level", "standbyLevel"), ("settlement", "settlement")] {
        if let Some(value) = duty.get(source) {
            fields.insert(key.to_owned(), value.clone());
        }
    }
    fields.insert("agreement".into(), agreement);
    javascript_json::stringify(&Value::Object(fields)).map_err(|_| invalid())
}
fn period_key(profile: &Value, date: &str) -> Result<String, InputError> {
    let history = profile
        .get("employmentTimeline")
        .filter(|v| !v.is_null())
        .map(|v| v.as_array().ok_or_else(invalid))
        .transpose()?;
    let start = if let Some(history) = history.filter(|h| !h.is_empty()) {
        employment::resolve_remuneration_profile_ref(history, date)
            .map_err(super::employment::employment_error)?
            .profile
            .and_then(|v| v.get("effectiveFrom"))
            .cloned()
            .unwrap_or(Value::Null)
    } else {
        Value::Null
    };
    let effective =
        EmploymentProfileRef::at(profile, date).map_err(super::employment::employment_error)?;
    let mut captured = serde_json::Map::new();
    for key in employment::EMPLOYMENT_FIELDS
        .iter()
        .copied()
        .chain(std::iter::once("workPattern"))
    {
        captured.insert(
            key.to_owned(),
            effective.get(key).cloned().unwrap_or(Value::Null),
        );
    }
    javascript_json::stringify(&json!([start, Value::Object(captured)])).map_err(|_| invalid())
}
fn lines(
    entry: &Value,
    profile: &Value,
    resolver: &RuleResolver,
) -> Result<Vec<Value>, InputError> {
    let month = text(entry, "date")?.get(..7).ok_or_else(invalid)?;
    special::calculate_special_duty_pay(month, std::slice::from_ref(entry), profile, resolver)
        .map_err(|e| InputError::source(e.to_string(), "Error"))
}
pub fn candidates<'a>(
    original: &Value,
    next: &Value,
    entries: &'a [Value],
    profile: &Value,
    resolver: &RuleResolver,
) -> Result<Vec<&'a Value>, InputError> {
    if original.is_null()
        || profile.is_null()
        || js_truthy(&profile["salaryBasisConflict"])
        || original["specialDuty"]["kind"] != "STANDBY"
        || next["kind"] != "STANDBY"
        || shared_billing(&original["specialDuty"])? == shared_billing(next)?
    {
        return Ok(vec![]);
    }
    let mut changed = original.clone();
    changed["specialDuty"] = next.clone();
    let source = lines(&changed, profile, resolver)?;
    if source.is_empty() || source.iter().any(|line| line["complete"] != true) {
        return Ok(vec![]);
    }
    let key = period_key(profile, text(original, "date")?)?;
    let billing = shared_billing(&original["specialDuty"])?;
    let mut result = vec![];
    for entry in entries {
        if entry["kind"] != "SHIFT"
            || entry.get("deletedAt") != Some(&Value::Null)
            || entry["id"] == original["id"]
            || entry["specialDuty"]["kind"] != "STANDBY"
            || shared_billing(&entry["specialDuty"])? != billing
            || period_key(profile, text(entry, "date")?)? != key
        {
            continue;
        }
        if lines(entry, profile, resolver)?
            .iter()
            .any(|line| line["complete"] != true)
        {
            result.push(entry);
        }
    }
    // Persisted entry dates are checked ISO dates, whose locale order is lexical.
    result.sort_by(|a, b| a["date"].as_str().cmp(&b["date"].as_str()));
    Ok(result)
}
pub fn transfer_inputs(
    original: &Value,
    next: &Value,
    selected: &[Value],
    candidates: &[Value],
) -> Result<Vec<Value>, InputError> {
    transfer_inputs_borrowed(
        original,
        next,
        &selected.iter().collect::<Vec<_>>(),
        &candidates.iter().collect::<Vec<_>>(),
    )
}
/// The source-bound editor borrows candidate/selected rows rather than copying the roster.
pub fn transfer_inputs_borrowed(
    original: &Value,
    next: &Value,
    selected: &[&Value],
    candidates: &[&Value],
) -> Result<Vec<Value>, InputError> {
    let mut ids = BTreeSet::new();
    if next["kind"] != "STANDBY"
        || !js_truthy(&next["standbyAgreement"])
        || selected
            .iter()
            .any(|v| !ids.insert(v.get("id").cloned().unwrap_or(Value::Null).to_string()))
    {
        return Err(InputError::validation(
            "Prüfe die ausgewählten Bereitschaftsdienste erneut.",
        ));
    }
    selected
        .iter()
        .map(|entry| {
            let entry = *entry;
            if entry["id"] == original["id"]
                || entry["specialDuty"]["kind"] != "STANDBY"
                || !candidates.iter().any(|candidate| {
                    candidate["id"] == entry["id"] && candidate["revision"] == entry["revision"]
                })
            {
                return Err(InputError::validation(
                    "Ein ausgewählter Dienst wurde geändert. Wähle die Dienste erneut aus.",
                ));
            }
            let mut result = entry.clone();
            result["expectedRevision"] = entry["revision"].clone();
            let mut duty = entry["specialDuty"].clone();
            duty["version"] = json!(if duty["version"] == 3 { 3 } else { 2 });
            duty["standbyLevel"] = next["standbyLevel"].clone();
            duty["settlement"] = next["settlement"].clone();
            let mut agreement = next["standbyAgreement"].clone();
            if !agreement.is_object() {
                return Err(invalid());
            }
            agreement["sequence"] = entry["specialDuty"]["standbyAgreement"]
                .get("sequence")
                .cloned()
                .unwrap_or(Value::Null);
            duty["standbyAgreement"] = agreement;
            result["specialDuty"] = duty;
            Ok(result)
        })
        .collect()
}
pub fn billing_message(
    original: &Value,
    next: &Value,
    profile: &Value,
    resolver: &RuleResolver,
) -> Result<Value, InputError> {
    if original.is_null() || profile.is_null() {
        return Ok(Value::Null);
    }
    let mut changed = original.clone();
    changed["specialDuty"] = next.clone();
    Ok(lines(&changed, profile, resolver)?
        .iter()
        .find(|line| line["complete"] != true)
        .and_then(|line| line["notes"].as_array())
        .and_then(|notes| notes.first())
        .cloned()
        .unwrap_or(Value::Null))
}
