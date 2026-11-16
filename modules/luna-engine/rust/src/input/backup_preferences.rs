//! Backup business preferences: the existing family/payment validators and
//! original cross-profile rules. File/SQL/UI preference handling stays in IO.
use super::InputError;
use crate::pay::families::profile;
use serde::Deserialize;
use serde_json::{Value, json};

const FAMILIES: &[&str] = &[
    "salary_nursing_training",
    "salary_vka_e",
    "salary_tvl_kr",
    "salary_tvuk_nursing",
    "simpleSalary.tvhKr",
    "salary_tval_pflege",
];
fn invalid() -> InputError {
    InputError::source(
        "Die Datei ist kein gültiges LUNA-Shift-Backup.",
        "LocalBackupValidationError",
    )
}
pub fn validate(rows: &[Value], user_profile: &Value) -> Result<(), InputError> {
    let mut family_count = 0;
    let mut h_selection = None;
    for row in rows {
        let key = row["key"].as_str().ok_or_else(invalid)?;
        if !FAMILIES.contains(&key) && key != "salary_payment_v1" {
            continue;
        }
        let value = super::raw_json::parse_sql_json(row, "value").map_err(|_| invalid())?;
        if key == "salary_payment_v1" {
            crate::net::payment_schedule::validate_salary_payment_preferences(&value)
                .map_err(|_| invalid())?;
            continue;
        }
        let selected = match key {
            "salary_nursing_training" => profile::require_nursing_training_tariff(&value),
            "salary_vka_e" => profile::require_vka_e_tariff(&value),
            "salary_tvl_kr" => profile::require_tvl_kr_salary_tariff(&value),
            "salary_tvuk_nursing" => profile::require_tvuk_nursing_tariff(&value),
            "simpleSalary.tvhKr" => profile::require_tvh_kr_tariff(&value),
            "salary_tval_pflege" => profile::require_tval_pflege_tariff(&value),
            _ => return Err(invalid()),
        }
        .map_err(|_| invalid())?
        .ok_or_else(invalid)?;
        family_count += 1;
        if key == "simpleSalary.tvhKr" {
            h_selection = Some(selected);
        }
    }
    if let Some(h) = h_selection
        && !user_profile.is_null()
        && user_profile["weekly_minutes"].as_f64() > h["fullTimeWeeklyMinutes"].as_f64()
    {
        return Err(invalid());
    }
    if family_count > 0
        && (user_profile.is_null()
            || !user_profile["pay_group"].is_null()
            || !user_profile["manual_monthly_gross_cents"].is_null())
    {
        return Err(invalid());
    }
    if family_count > 1 {
        return Err(invalid());
    }
    Ok(())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Command {
    rows: Vec<Value>,
    profile: Value,
    #[serde(default, rename = "prepareLegacy")]
    prepare_legacy: bool,
}
fn prepare_legacy(raw_profile: &Value) -> Result<Value, &'static str> {
    if raw_profile.is_null() {
        return Ok(json!({"state":"VALUE","value":null}));
    }
    let mapped = match super::stored_profile::map_profile_row(raw_profile) {
        Ok(value) => value,
        Err(error) => {
            return Ok(
                json!({"state":"RECORD_ERROR","name":error.name(),"message":error.message(),"userFacing":error.user_facing_message().is_some()}),
            );
        }
    };
    // Original v1 restore has cleared preferences and has not inserted them yet.
    let profile = match super::stored_profile::load_simple_salary_for_profile(&mapped, &[]) {
        Ok(value) => value,
        Err(error) => {
            return Ok(
                json!({"state":"RECORD_ERROR","name":error.name(),"message":error.to_string(),"userFacing":false}),
            );
        }
    };
    match crate::remuneration::profile::remuneration_from_legacy(&profile) {
        Ok(value) => Ok(
            json!({"state":"VALUE","value":serde_json::to_value(value).map_err(|_| "INVALID_BACKUP_PREFERENCES")?}),
        ),
        Err(error) => Ok(
            json!({"state":"RECORD_ERROR","name":error.class_name(),"message":error.to_string(),"userFacing":true}),
        ),
    }
}
pub fn execute(raw: &[u8]) -> Result<Value, &'static str> {
    let input = crate::contract::bounded_json(raw).map_err(|_| "INVALID_BACKUP_PREFERENCES")?;
    let input: Command = serde_json::from_value(input).map_err(|_| "INVALID_BACKUP_PREFERENCES")?;
    if input.prepare_legacy {
        if !input.rows.is_empty() {
            return Err("INVALID_BACKUP_PREFERENCES");
        }
        return prepare_legacy(&input.profile);
    }
    if input.rows.len() > 50_000 {
        return Err("BACKUP_PREFERENCES_LIMIT");
    }
    Ok(match validate(&input.rows, &input.profile) {
        Ok(()) => json!({"state":"VALUE","value":null}),
        Err(error) => {
            json!({"state":"RECORD_ERROR","name":error.name(),"message":error.message(),"userFacing":false})
        }
    })
}

#[cfg(test)]
mod original_reference {
    use super::*;
    #[test]
    fn prepared_v1_legacy_matches_original_restore_rows() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../reference/backup-v1-legacy-golden.json"
        ))
        .unwrap();
        let mut count = 0;
        for case in fixture["cases"].as_array().unwrap() {
            let Some(expected) = case.get("expected").and_then(|v| v.get("value")) else {
                continue;
            };
            let body = json!({"rows":[],"profile":case["input"]["document"]["data"]["profile"],"prepareLegacy":true});
            let actual = execute(&serde_json::to_vec(&body).unwrap()).unwrap();
            assert_eq!(actual["state"], "VALUE", "{}: {actual}", case["id"]);
            let history = expected["history"].as_array().unwrap();
            let expected = history.first().map_or(Value::Null, |row| {
                serde_json::from_str(row["data_json"].as_str().unwrap()).unwrap()
            });
            assert_eq!(actual["value"], expected, "{}", case["id"]);
            if let Some(row) = history.first() {
                assert_eq!(
                    serde_json::to_string(&actual["value"]).unwrap(),
                    row["data_json"]
                );
            }
            count += 1;
        }
        assert_eq!(count, 15);
    }
    #[test]
    fn direct_import_business_preferences_and_cross_profile_rules_match() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../reference/backup-preferences-golden.json"
        ))
        .unwrap();
        assert_eq!(fixture["cases"].as_array().unwrap().len(), 1069);
        let large: Value = serde_json::from_str(include_str!(
            "../../../reference/backup-preferences-large-golden.json"
        ))
        .unwrap();
        assert_eq!(large["cases"].as_array().unwrap().len(), 7);
        for case in fixture["cases"]
            .as_array()
            .unwrap()
            .iter()
            .chain(large["cases"].as_array().unwrap())
        {
            let actual = match validate(
                case["input"]["rows"].as_array().unwrap(),
                &case["input"]["profile"],
            ) {
                Ok(()) => json!({"value":null}),
                Err(error) => {
                    json!({"error":{"name":error.name(),"message":error.message(),"userFacing":error.user_facing_message().is_some()}})
                }
            };
            assert_eq!(actual, case["expected"], "{}", case["id"]);
        }
    }
}
