//! Read-only stored-profile compatibility from preloaded native history. Invoke
//! before adding a large working-time target context; no DB or clock is read.
use super::{InputError, profile::GROUPS, trim_javascript};
use crate::employment::{employment_overlay_from_profiles, resolve_remuneration_profile_ref};
use serde_json::{Value, json};
use std::sync::Arc;

fn source_error(error: crate::employment::EmploymentError) -> InputError {
    InputError::user_facing_source(error.to_string(), "RemunerationProfileError")
}
pub(crate) fn js_milliseconds(value: &Value) -> Option<i128> {
    super::javascript_instant_milliseconds(value.as_str()?)
}
fn level(value: &Value) -> Option<i64> {
    let number = match value {
        Value::Number(number) => number.as_f64()?,
        Value::String(text) => {
            let text = trim_javascript(text);
            if text.is_empty() {
                0.0
            } else if let Some(text) = text.strip_prefix("0x").or_else(|| text.strip_prefix("0X")) {
                u64::from_str_radix(text, 16).ok()? as f64
            } else if let Some(text) = text.strip_prefix("0b").or_else(|| text.strip_prefix("0B")) {
                u64::from_str_radix(text, 2).ok()? as f64
            } else if let Some(text) = text.strip_prefix("0o").or_else(|| text.strip_prefix("0O")) {
                u64::from_str_radix(text, 8).ok()? as f64
            } else {
                text.parse::<f64>().ok()?
            }
        }
        _ => return None,
    };
    (number.is_finite() && number.fract() == 0.0 && (1.0..=6.0).contains(&number))
        .then_some(number as i64)
}
fn assign(object: &mut serde_json::Map<String, Value>, key: &str, value: Option<&Value>) {
    match value {
        Some(value) => {
            object.insert(key.into(), value.clone());
        }
        None => {
            object.remove(key);
        }
    }
}

pub fn project_stored_simple_profile(
    profile: Option<&Arc<Value>>,
    history: &[Value],
    reference_date: &str,
) -> Result<Option<Arc<Value>>, InputError> {
    project(profile, history, reference_date, true)
}
/// Identical selection policy for thin metadata; retain the original history
/// owner rather than materializing it merely to look up current profile fields.
pub(crate) fn project_stored_simple_profile_without_history(
    profile: Option<&Arc<Value>>,
    history: &[Value],
    reference_date: &str,
) -> Result<Option<Arc<Value>>, InputError> {
    project(profile, history, reference_date, false)
}
fn project(
    profile: Option<&Arc<Value>>,
    history: &[Value],
    reference_date: &str,
    include_history: bool,
) -> Result<Option<Arc<Value>>, InputError> {
    let Some(profile) = profile else {
        return Ok(None);
    };
    if crate::net::js_truthy(&profile["salaryBasisConflict"]) {
        return Ok(Some(Arc::clone(profile)));
    }
    if history
        .iter()
        .any(|row| crate::net::js_truthy(&row["employment"]))
    {
        let overlay = employment_overlay_from_profiles(
            profile.get("salaryBasisConflict"),
            history,
            reference_date,
        )
        .map_err(source_error)?;
        let mut with_history = profile.as_ref().clone();
        let record = with_history.as_object_mut().ok_or_else(|| {
            InputError::validation("Die gespeicherten Profilangaben sind ungültig.")
        })?;
        if include_history {
            record.insert("employmentTimeline".into(), json!(history));
        }
        if let Some(overlay) = overlay {
            for (key, value) in overlay.as_object().ok_or_else(|| {
                InputError::validation("Die gespeicherten Beschäftigungsangaben sind ungültig.")
            })? {
                record.insert(key.clone(), value.clone());
            }
        }
        return Ok(Some(Arc::new(with_history)));
    }
    if [
        "nursingTrainingTariff",
        "vkaETariff",
        "tvlKrTariff",
        "tvUkNursingTariff",
        "tvhKrTariff",
        "tvalPflegeTariff",
    ]
    .iter()
    .any(|key| crate::net::js_truthy(&profile[*key]))
    {
        return Ok(Some(Arc::clone(profile)));
    }
    let Some(selected) = resolve_remuneration_profile_ref(history, reference_date)
        .map_err(source_error)?
        .profile
    else {
        return Ok(Some(Arc::clone(profile)));
    };
    if js_milliseconds(&selected["updatedAt"])
        .zip(js_milliseconds(&profile["updatedAt"]))
        .is_some_and(|(selected, current)| selected <= current)
    {
        return Ok(Some(Arc::clone(profile)));
    }
    let selection = &selected["data"]["selection"];
    if selection["kind"] == "own-monthly" {
        let mut result = profile.as_ref().clone();
        let record = result.as_object_mut().ok_or_else(|| {
            InputError::validation("Die gespeicherten Profilangaben sind ungültig.")
        })?;
        record.insert("tariff".into(), Value::Null);
        assign(
            record,
            "manualMonthlyGrossCents",
            selection.get("monthlyGrossCents"),
        );
        assign(record, "updatedAt", selected.get("updatedAt"));
        return Ok(Some(Arc::new(result)));
    }
    if selection["kind"] != "tariff" || selection["packageId"] != "tvoed-vka-bt-k" {
        return Ok(Some(Arc::clone(profile)));
    }
    let valid = selection["variant"]
        .as_str()
        .is_some_and(|value| ["BT_K", "BT_B"].contains(&value))
        && selection["region"]
            .as_str()
            .is_some_and(|value| ["OTHER", "KAV_BW"].contains(&value));
    let Some(group) = selection["group"]
        .as_str()
        .filter(|group| GROUPS.contains(group))
    else {
        return Ok(Some(Arc::clone(profile)));
    };
    let Some(level) =
        level(&selection["level"]).filter(|level| ["P5", "P6"].contains(&group) || *level >= 2)
    else {
        return Ok(Some(Arc::clone(profile)));
    };
    if !valid {
        return Ok(Some(Arc::clone(profile)));
    }
    let mut result = profile.as_ref().clone();
    let record = result
        .as_object_mut()
        .ok_or_else(|| InputError::validation("Die gespeicherten Profilangaben sind ungültig."))?;
    let mut tariff = json!({"payGroup":group,"payLevel":level,"sector":selection["variant"],"tariffRegion":selection["region"]});
    assign(
        tariff.as_object_mut().expect("tariff record"),
        "fullTimeWeeklyMinutes",
        selection.get("fullTimeWeeklyMinutes"),
    );
    record.insert("tariff".into(), tariff);
    record.insert("manualMonthlyGrossCents".into(), Value::Null);
    assign(record, "updatedAt", selected.get("updatedAt"));
    Ok(Some(Arc::new(result)))
}
