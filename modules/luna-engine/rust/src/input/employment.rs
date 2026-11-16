//! Validated stored employment payloads and read-only DB-row mapping. No
//! repository, clock, active salary winner or external Ready flag is involved.
use super::{
    InputError, profile::validate_profile, raw_json, require_instant,
    simple_profile::js_milliseconds,
};
use crate::{employment as facts, remuneration};
use serde_json::{Value, json};
use std::{collections::BTreeSet, sync::Arc};

fn invalid_profile() -> InputError {
    remuneration::RemunerationError::Profile.into()
}
impl From<remuneration::RemunerationError> for InputError {
    fn from(error: remuneration::RemunerationError) -> Self {
        Self::user_facing_source(error.to_string(), error.class_name())
    }
}
pub(super) fn employment_error(error: facts::EmploymentError) -> InputError {
    let name = if matches!(
        error,
        facts::EmploymentError::InvalidDate | facts::EmploymentError::AmbiguousHistory
    ) {
        "RemunerationProfileError"
    } else {
        "ValidationError"
    };
    InputError::user_facing_source(error.to_string(), name)
}
fn exact(value: &Value, keys: &[&str]) -> bool {
    value.as_object().is_some_and(|record| {
        record.len() == keys.len() && keys.iter().all(|key| record.contains_key(*key))
    })
}
fn remuneration_data(value: &Value) -> Result<Value, InputError> {
    let mut value = value.clone();
    raw_json::normalize_integral_numbers(&mut value);
    remuneration::profile::validate_profile(&value)
        .map_err(Into::into)
        .and_then(|profile| serde_json::to_value(profile).map_err(|_| invalid_profile()))
}

pub fn validate_employment_data(value: &Value) -> Result<Value, InputError> {
    let record = value
        .as_object()
        .filter(|record| {
            record
                .keys()
                .all(|key| facts::EMPLOYMENT_FIELDS.contains(&key.as_str()) || key == "workPattern")
                && facts::EMPLOYMENT_FIELDS
                    .iter()
                    .all(|key| record.contains_key(*key))
        })
        .ok_or_else(|| {
            InputError::validation("Die gespeicherten Beschäftigungsangaben sind ungültig.")
        })?;
    let profile = validate_profile(value)?;
    let pattern =
        facts::validate_work_pattern(record.get("workPattern")).map_err(employment_error)?;
    let mut captured = facts::capture_employment_profile(&profile).map_err(employment_error)?;
    captured["workPattern"] = pattern;
    Ok(captured)
}
pub fn decode_employment_payload(value: &Value) -> Result<Value, InputError> {
    if value
        .as_object()
        .is_some_and(|record| record.contains_key("profileVersion"))
    {
        let version = value["profileVersion"]
            .as_f64()
            .filter(|version| [1.0, 2.0, 3.0].contains(version))
            .map(|version| version as i64);
        let keys: &[&str] = if version == Some(3) {
            &[
                "data",
                "employment",
                "employmentOverrides",
                "profileVersion",
            ]
        } else {
            &["data", "employment", "profileVersion"]
        };
        if version.is_none() || !exact(value, keys) {
            return Err(InputError::validation(
                "Diese Profilversion wird noch nicht unterstützt.",
            ));
        }
        if version != Some(1)
            && !value["employment"]
                .as_object()
                .is_some_and(|employment| employment.contains_key("workPattern"))
        {
            return Err(InputError::validation(
                "Im gespeicherten Beschäftigungsverlauf fehlt das Schichtmodell.",
            ));
        }
        let data = remuneration_data(&value["data"])?;
        let employment = validate_employment_data(&value["employment"])?;
        if data["weeklyMinutes"].as_f64() != employment["weeklyMinutes"].as_f64() {
            return Err(InputError::validation(
                "Die Wochenstunden der gespeicherten Profile widersprechen sich.",
            ));
        }
        let mut output = json!({"data":data,"employment":employment});
        if version == Some(3) {
            output["employmentOverrides"] =
                facts::validate_employment_overrides(&value["employmentOverrides"])
                    .map_err(employment_error)?;
        }
        Ok(output)
    } else {
        Ok(json!({"data":remuneration_data(value)?}))
    }
}
pub fn encode_employment_payload(
    data: &Value,
    employment: Option<&Value>,
    overrides: Option<&Value>,
) -> Result<String, InputError> {
    let employment = employment.filter(|value| crate::net::js_truthy(value));
    let overrides = overrides.filter(|value| crate::net::js_truthy(value));
    if overrides.is_some() && employment.is_none() {
        return Err(InputError::validation(
            "Der Zeitraumkorrektur fehlt das Beschäftigungsprofil.",
        ));
    }
    let mut payload = if let Some(employment) = employment {
        if let Some(overrides) = overrides {
            json!({"profileVersion":3,"data":data,"employment":employment,"employmentOverrides":overrides})
        } else {
            json!({"profileVersion":2,"data":data,"employment":employment})
        }
    } else {
        data.clone()
    };
    decode_employment_payload(&payload)?;
    // The source validates, then stringifies the ORIGINAL payload, preserving
    // its property order and unnormalized-but-valid source strings.
    raw_json::normalize_integral_numbers(&mut payload);
    serde_json::to_string(&payload).map_err(|_| invalid_profile())
}
pub fn map_remuneration_profile_row(row: &Value) -> Result<Value, InputError> {
    let revision = row["revision"]
        .as_f64()
        .filter(|revision| {
            revision.is_finite()
                && revision.fract() == 0.0
                && revision.abs() <= crate::money::MAX_SAFE_INTEGER as f64
        })
        .ok_or_else(invalid_profile)?;
    let effective = if row.get("effective_from") == Some(&Value::Null) {
        None
    } else {
        let date = row["effective_from"]
            .as_str()
            .ok_or_else(|| employment_error(facts::EmploymentError::InvalidDate))?;
        facts::require_remuneration_date(date).map_err(employment_error)?;
        Some(date)
    };
    let id = effective.map_or_else(|| "legacy".into(), |date| format!("from:{date}"));
    if row["id"] != id {
        return Err(invalid_profile());
    }
    require_instant(&row["created_at"], "Erstellt")?;
    require_instant(&row["updated_at"], "Geändert")?;
    if js_milliseconds(&row["updated_at"])
        .zip(js_milliseconds(&row["created_at"]))
        .is_some_and(|(updated, created)| updated < created)
    {
        return Err(invalid_profile());
    }
    if !raw_json::sql_json_is_text(row, "data_json") {
        return Err(InputError::validation(
            "Die gespeicherten Vergütungsdaten sind ungültig.",
        ));
    }
    let value: Value = raw_json::parse_sql_json(row, "data_json").map_err(|_| {
        // The existing raw-input contract normalizes malformed JSON to this
        // fixed diagnostic. The original JSON.parse exception is still a plain
        // Error, so it must never gain UserFacingError ancestry in a save flow.
        InputError::source(
            "Die gespeicherten Vergütungsdaten sind ungültig.",
            "ValidationError",
        )
    })?;
    let decoded = decode_employment_payload(&value)?;
    if revision < 1.0 {
        return Err(InputError::validation("Ungültige Datensatzrevision."));
    }
    let mut result = json!({"effectiveFrom":effective});
    result
        .as_object_mut()
        .expect("row output")
        .extend(decoded.as_object().expect("decoded payload").clone());
    result["revision"] = json!(revision as i64);
    result["createdAt"] = row["created_at"].clone();
    result["updatedAt"] = row["updated_at"].clone();
    Ok(result)
}

/// Opaque checked source group. Raw rows and mapped facts stay separate from
/// Rust-composed work/target context and financial calculation evidence.
pub struct RawEmploymentHistory {
    raw: Arc<Vec<Value>>,
    profiles: Arc<Vec<Value>>,
}
impl RawEmploymentHistory {
    pub fn try_from_rows(raw: Arc<Vec<Value>>) -> Result<Self, InputError> {
        if raw.len() > 50_000 {
            return Err(InputError::validation(
                "Der gespeicherte Beschäftigungsverlauf ist zu groß.",
            ));
        }
        let mut dates = BTreeSet::new();
        let mut profiles = Vec::with_capacity(raw.len());
        for row in raw.iter() {
            if !exact(
                row,
                &[
                    "id",
                    "effective_from",
                    "data_json",
                    "revision",
                    "created_at",
                    "updated_at",
                ],
            ) {
                return Err(InputError::validation(
                    "Die gespeicherten Verlaufszeilen sind ungültig.",
                ));
            }
            let profile = map_remuneration_profile_row(row)?;
            if !dates.insert(profile["effectiveFrom"].to_string()) {
                return Err(employment_error(facts::EmploymentError::AmbiguousHistory));
            }
            profiles.push(profile);
        }
        Ok(Self {
            raw,
            profiles: Arc::new(profiles),
        })
    }
    pub fn raw_rows(&self) -> &Arc<Vec<Value>> {
        &self.raw
    }
    pub fn profiles(&self) -> &Arc<Vec<Value>> {
        &self.profiles
    }
}
