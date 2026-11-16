use crate::input::{InputError, employment, form_number, profile, profile_editor::ProfileFields};
use serde_json::{Map, Value, json};
fn present(value: Option<&Value>) -> bool {
    value.is_some_and(|value| !value.is_null())
}
pub fn normalize_profile_input(
    raw: &impl ProfileFields,
    current: Option<&Value>,
) -> Result<Value, InputError> {
    normalize(raw, current, true)
}
pub(super) fn normalize_profile_input_without_identity(
    raw: &impl ProfileFields,
    current: Option<&Value>,
) -> Result<Value, InputError> {
    normalize(raw, current, false)
}
fn normalize(
    raw: &impl ProfileFields,
    current: Option<&Value>,
    identity: bool,
) -> Result<Value, InputError> {
    if identity
        && current.is_some_and(|current| crate::net::js_truthy(&current["salaryBasisConflict"]))
        && super::SALARY_KEYS
            .iter()
            .filter(|key| present(raw.field(key)))
            .count()
            != 1
    {
        return Err(InputError::validation(
            "Bitte zuerst eine Gehaltsgrundlage wählen.",
        ));
    }
    // Only storage/profile fields are read. Unrelated source target/history trees
    // remain borrowed, rather than being cloned by the original input spread.
    let mut input = Map::new();
    for key in [
        "federalState",
        "holidayRegion",
        "weeklyMinutes",
        "timeZone",
        "industry",
        "displayName",
        "employerName",
        "regularRotatingNightWork",
        "sundayHolidayWorkEligible",
        "allEmploymentWorkRecorded",
    ]
    .into_iter()
    .chain(super::SALARY_KEYS.iter().copied())
    {
        if let Some(value) = raw.field(key) {
            input.insert(key.into(), value.clone());
        }
    }
    let other = present(raw.field("tariff")) || present(raw.field("manualMonthlyGrossCents"));
    for key in &super::SALARY_KEYS[2..] {
        let value = raw.field(key).cloned().unwrap_or_else(|| {
            if other
                || super::SALARY_KEYS[2..]
                    .iter()
                    .any(|other| other != key && present(raw.field(other)))
            {
                Value::Null
            } else {
                current
                    .and_then(|current| current.get(*key))
                    .cloned()
                    .unwrap_or(Value::Null)
            }
        });
        input.insert((*key).into(), value);
    }
    if raw.field("manualMonthlyGrossCents").is_none() {
        let has_other = super::SALARY_KEYS
            .iter()
            .filter(|key| **key != "manualMonthlyGrossCents")
            .any(|key| raw.field(key).is_some_and(crate::net::js_truthy));
        input.insert(
            "manualMonthlyGrossCents".into(),
            if has_other {
                Value::Null
            } else {
                current
                    .and_then(|current| current.get("manualMonthlyGrossCents"))
                    .cloned()
                    .unwrap_or(Value::Null)
            },
        );
    }
    for key in ["displayName", "employerName", "industry"]
        .into_iter()
        .filter(|_| identity)
    {
        if raw.field(key).is_none() {
            input.insert(
                key.into(),
                current
                    .and_then(|current| current.get(key))
                    .cloned()
                    .unwrap_or(Value::Null),
            );
        }
    }
    profile::validate_profile(&Value::Object(input))
}
pub fn employment_with_remuneration(base: &Value, data: &Value) -> Result<Value, InputError> {
    let mut value = base.as_object().ok_or_else(super::invalid)?.clone();
    value.insert("weeklyMinutes".into(), data["weeklyMinutes"].clone());
    let selection = &data["selection"];
    let tariff = selection["kind"] == "tariff"
        && selection["packageId"] == "tvoed-vka-bt-k"
        && selection["variant"]
            .as_str()
            .is_some_and(|v| ["BT_K", "BT_B"].contains(&v));
    if tariff || selection["kind"] == "own-monthly" {
        for key in super::SALARY_KEYS {
            value.insert((*key).into(), Value::Null);
        }
        if tariff {
            let level = selection["level"]
                .as_str()
                .map(form_number::number)
                .unwrap_or(f64::NAN);
            let mut level = json!(level);
            crate::input::raw_json::normalize_integral_numbers(&mut level);
            value.insert("tariff".into(),json!({"payGroup":selection["group"],"payLevel":level,"sector":selection["variant"],"tariffRegion":selection["region"],"fullTimeWeeklyMinutes":selection["fullTimeWeeklyMinutes"]}));
        } else {
            value.insert(
                "manualMonthlyGrossCents".into(),
                selection["monthlyGrossCents"].clone(),
            );
        }
    }
    employment_data(&Value::Object(value))
}
pub(crate) fn employment_data(profile: &Value) -> Result<Value, InputError> {
    let captured =
        crate::employment::capture_employment_profile(profile).map_err(|_| super::invalid())?;
    employment::validate_employment_data(&captured)
}
fn string(value: &Value) -> Result<String, InputError> {
    match value {
        Value::String(value) => Ok(value.clone()),
        _ => crate::input::javascript_json::stringify(value).map_err(|_| super::invalid()),
    }
}
pub fn financial_data(before: Option<&Value>, profile: &Value) -> Result<Value, InputError> {
    let converted = serde_json::to_value(crate::remuneration::profile::remuneration_from_legacy(
        profile,
    )?)
    .map_err(|_| super::invalid())?;
    let Some(before) = before else {
        return Ok(converted);
    };
    let employment = before
        .get("employment")
        .filter(|value| crate::net::js_truthy(value));
    let mut unchanged = employment.is_some();
    if let Some(before) = employment {
        for key in super::SALARY_KEYS {
            if !super::patch::same(
                before.get(*key),
                Some(profile.get(*key).unwrap_or(&Value::Null)),
            )? {
                unchanged = false;
                break;
            }
        }
    }
    let mut data = before["data"]
        .as_object()
        .ok_or_else(super::invalid)?
        .clone();
    if unchanged {
        data.insert("weeklyMinutes".into(), profile["weeklyMinutes"].clone());
        return Ok(Value::Object(data));
    }
    let old = &before["data"]["selection"];
    if old["kind"] == "tariff"
        && converted["selection"]["kind"] == "tariff"
        && old["packageId"] == converted["selection"]["packageId"]
    {
        data.insert("weeklyMinutes".into(), profile["weeklyMinutes"].clone());
        let mut selection = old.as_object().ok_or_else(super::invalid)?.clone();
        selection.extend(
            converted["selection"]
                .as_object()
                .ok_or_else(super::invalid)?
                .clone(),
        );
        data.insert("selection".into(), Value::Object(selection));
        return Ok(Value::Object(data));
    }
    if old["kind"] == "tariff"
        && let Some(employment) = employment
    {
        let previous = super::SALARY_KEYS
            .iter()
            .find(|key| present(employment.get(**key)));
        let next = super::SALARY_KEYS
            .iter()
            .find(|key| present(profile.get(**key)));
        if previous.is_some() && previous == next && previous != Some(&"manualMonthlyGrossCents") {
            let salary = &profile[*next.ok_or_else(super::invalid)?];
            let mut selection = old.as_object().ok_or_else(super::invalid)?.clone();
            for (target, source) in [
                ("group", "payGroup"),
                ("variant", "sector"),
                ("region", "tariffRegion"),
            ] {
                if salary[source].is_string() {
                    selection.insert(target.into(), salary[source].clone());
                }
            }
            if let Some(value) = salary
                .get("payLevel")
                .or_else(|| salary.get("trainingYear"))
            {
                selection.insert("level".into(), json!(string(value)?));
            }
            if salary["fullTimeWeeklyMinutes"].is_number() {
                selection.insert(
                    "fullTimeWeeklyMinutes".into(),
                    salary["fullTimeWeeklyMinutes"].clone(),
                );
            }
            data.insert("weeklyMinutes".into(), profile["weeklyMinutes"].clone());
            data.insert("selection".into(), Value::Object(selection));
            return Ok(Value::Object(data));
        }
    }
    Ok(converted)
}
