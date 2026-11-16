use super::AssessmentError;
use crate::{
    employment::require_remuneration_date,
    input::{calendar::validate_monthly_tariff_decision, javascript_instant_milliseconds},
};
use serde_json::{Map, Value, json};
fn exact<'a>(value: &'a Value, keys: &[&str]) -> Result<&'a Map<String, Value>, AssessmentError> {
    let map = value
        .as_object()
        .ok_or(AssessmentError::Message("Ungültige Zulagenentscheidung."))?;
    if map.len() != keys.len() || keys.iter().any(|k| !map.contains_key(*k)) {
        return Err(AssessmentError::Message(
            "Unbekanntes Format der Zulagenentscheidung.",
        ));
    }
    Ok(map)
}
fn identifier(value: &Value) -> Result<&str, AssessmentError> {
    value
        .as_str()
        .filter(|s| {
            !s.is_empty()
                && s.len() <= 120
                && s.as_bytes()[0].is_ascii_alphanumeric()
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
        })
        .ok_or(AssessmentError::Message(
            "Die Tarifzuordnung der Zulagenentscheidung fehlt.",
        ))
}
/// Native detached normalized facts, preserving the source validator's error order.
pub fn validate_scoped_allowance_decisions(value: &Value) -> Result<Vec<Value>, AssessmentError> {
    let rows = value
        .as_array()
        .ok_or(AssessmentError::Message("Ungültige Zulagenentscheidungen."))?;
    validate_scoped_rows(rows)
}
pub(crate) fn validate_scoped_rows(rows: &[Value]) -> Result<Vec<Value>, AssessmentError> {
    let mut result = Vec::with_capacity(rows.len().min(50_000));
    if rows.len() > 50_000 {
        return Err(AssessmentError::InvalidInput);
    }
    for row in rows {
        let raw = exact(
            row,
            &[
                "from",
                "through",
                "tariff",
                "allowanceStatus",
                "revision",
                "confirmedAt",
                "updatedAt",
            ],
        )?;
        let date = |key: &str| -> Result<&str, AssessmentError> {
            let value = raw[key]
                .as_str()
                .ok_or(crate::employment::EmploymentError::InvalidDate)?;
            require_remuneration_date(value)?;
            Ok(value)
        };
        let from = date("from")?;
        let through = date("through")?;
        let tariff = exact(&raw["tariff"], &["packageId", "variant", "region"])?;
        if !raw["revision"]
            .as_f64()
            .is_some_and(|n| n.fract() == 0.0 && n.abs() <= crate::money::MAX_SAFE_INTEGER as f64)
        {
            return Err(AssessmentError::Message("Ungültige Revision."));
        }
        let validated = validate_monthly_tariff_decision(
            &json!({"month":&from[..7],"allowanceStatus":raw["allowanceStatus"],"revision":raw["revision"],"confirmedAt":raw["confirmedAt"],"updatedAt":raw["updatedAt"]}),
        )?;
        let before = javascript_instant_milliseconds(
            validated["updatedAt"]
                .as_str()
                .ok_or(AssessmentError::InvalidInput)?,
        )
        .zip(javascript_instant_milliseconds(
            validated["confirmedAt"]
                .as_str()
                .ok_or(AssessmentError::InvalidInput)?,
        ))
        .is_some_and(|(updated, confirmed)| updated < confirmed);
        if from > through || before {
            return Err(AssessmentError::Message(
                "Ungültiger Zeitraum der Zulagenentscheidung.",
            ));
        }
        result.push(json!({"from":from,"through":through,"tariff":{"packageId":identifier(&tariff["packageId"] )?,"variant":identifier(&tariff["variant"] )?,"region":identifier(&tariff["region"] )?},"allowanceStatus":validated["allowanceStatus"],"revision":validated["revision"],"confirmedAt":validated["confirmedAt"],"updatedAt":validated["updatedAt"]}));
    }
    result.sort_by(|a, b| a["from"].as_str().cmp(&b["from"].as_str()));
    for pair in result.windows(2) {
        if pair[0]["through"].as_str() >= pair[1]["from"].as_str() {
            return Err(AssessmentError::Message(
                "Tarifgebundene Zulagenentscheidungen dürfen sich nicht überschneiden.",
            ));
        }
    }
    Ok(result)
}
