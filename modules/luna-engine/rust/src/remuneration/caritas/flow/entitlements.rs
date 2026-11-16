use super::*;
use crate::{
    input::javascript_instant_milliseconds,
    remuneration::assessment::decisions::validate_scoped_allowance_decisions,
};
use jiff::ToSpan;
pub fn derive_entitlements(
    month: &str,
    profiles: &[Value],
    saved_months: &[Value],
) -> Result<Value, FlowError> {
    let Some((first, last)) = bounds(month) else {
        return Ok(unavailable("INVALID_MONTH"));
    };
    let profile = match whole_profile(month, profiles)? {
        Ok(p) => p,
        Err(reason) => return Ok(unavailable(reason)),
    };
    let selection = &profile["data"]["selection"];
    if !selection["packageId"]
        .as_str()
        .is_some_and(|s| s.starts_with("avr-caritas-p-"))
    {
        return Ok(unavailable("PROFILE_MISSING_OR_SPLIT"));
    }
    let saved: Vec<_> = saved_months
        .iter()
        .filter(|s| s["month"] == month)
        .collect();
    if saved.is_empty() {
        return Ok(unavailable("DECISIONS_MISSING"));
    }
    let valid_revision = |v: &Value| {
        v.as_f64()
            .is_some_and(|n| n.fract() == 0.0 && (0.0..=9007199254740991.0).contains(&n))
    };
    if saved.len() != 1
        || !valid_revision(&saved[0]["revision"])
        || (!saved[0]["updatedAt"].is_null()
            && !saved[0]["updatedAt"]
                .as_str()
                .is_some_and(|s| javascript_instant_milliseconds(s).is_some()))
    {
        return Ok(unavailable("DECISIONS_INVALID"));
    }
    let saved = saved[0];
    if saved["revision"].as_f64() == Some(0.0) {
        return Ok(unavailable("DECISIONS_MISSING"));
    }
    if saved["updatedAt"].is_null() {
        return Ok(unavailable("DECISIONS_INVALID"));
    }
    let Ok(decisions) = validate_scoped_allowance_decisions(&saved["decisions"]) else {
        return Ok(unavailable("DECISIONS_INVALID"));
    };
    let mut next = first;
    let mut entitlements = Vec::new();
    for d in decisions {
        if d["revision"].as_f64() != saved["revision"].as_f64() {
            return Ok(unavailable("DECISIONS_STALE"));
        }
        if ["packageId", "variant", "region"]
            .iter()
            .any(|k| d["tariff"][*k] != selection[*k])
        {
            return Ok(unavailable("DECISIONS_TARIFF_MISMATCH"));
        }
        let from = d["from"].as_str().unwrap();
        let through = d["through"].as_str().unwrap();
        if &from[..7] != month || &through[..7] != month {
            return Ok(unavailable("DECISIONS_INVALID"));
        }
        if from != next {
            return Ok(unavailable("DECISIONS_INCOMPLETE"));
        }
        next = following(through)?;
        entitlements.push(json!({"from":from,"through":through,"status":d["allowanceStatus"],"origin":"confirmed","revision":d["revision"]}));
    }
    if next != following(&last)? {
        return Ok(unavailable("DECISIONS_INCOMPLETE"));
    }
    Ok(json!({"kind":"confirmed","entitlements":entitlements}))
}
fn following(date: &str) -> Result<String, FlowError> {
    if date == "9999-12-31" {
        return Ok("+010000-01-01".into());
    }
    crate::calendar::parse_date(date)
        .and_then(|d| {
            d.checked_add(1.days())
                .map_err(|_| crate::EngineError::InvalidDate)
        })
        .map(|d| d.to_string())
        .map_err(|e| BaseError::from(e).into())
}
