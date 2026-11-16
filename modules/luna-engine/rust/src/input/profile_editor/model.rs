use super::{EditorSection, ProfileFormError};
use crate::input::profile_form::shape_error;
use serde_json::{Value, json};
pub(super) const FIELDS: &[&str] = &[
    "displayName",
    "employerName",
    "confirmedGroups",
    "lastTariffMode",
    "pFullTimeOverride",
    "federalState",
    "holidayRegion",
    "weeklyHours",
    "industry",
    "salaryMode",
    "trainingYear",
    "tvalWorkplace",
    "manualMonthlyGross",
    "tvhPayGroup",
    "tvhPayLevel",
    "tvhFullTimeWeeklyMinutes",
    "tvUkPayGroup",
    "tvUkPayLevel",
    "krPayGroup",
    "tvlUniversityRegion",
    "ePayGroup",
    "payGroup",
    "payLevel",
    "sector",
    "tariffRegion",
    "model",
];
pub(super) fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or("")
}
pub(super) fn validate_field(key: &str, value: &Value) -> Result<(), ProfileFormError> {
    let valid = if !FIELDS.contains(&key) {
        false
    } else {
        match key {
            "confirmedGroups" => value
                .as_array()
                .is_some_and(|rows| rows.iter().all(Value::is_string)),
            "pFullTimeOverride" => value.is_null() || value.is_number(),
            "tvhFullTimeWeeklyMinutes" => value.is_number(),
            "trainingYear" | "payLevel" | "tvhPayLevel" | "tvUkPayLevel" => {
                value.is_string() || value.is_number()
            }
            "model" => {
                value.is_object()
                    && ["night", "sunday", "recorded"].iter().all(|key| {
                        value
                            .get(*key)
                            .is_some_and(|v| v.is_null() || v.is_boolean())
                    })
                    && ["coverage", "assignment"]
                        .iter()
                        .all(|key| value[*key].is_string())
            }
            _ => value.is_string(),
        }
    };
    if valid {
        Ok(())
    } else {
        Err(shape_error().into())
    }
}
pub(super) fn initial(profile: &Value, values: &Value) -> Result<Value, ProfileFormError> {
    let mut draft = serde_json::Map::new();
    draft.insert(
        "displayName".into(),
        profile
            .get("displayName")
            .filter(|v| !v.is_null())
            .cloned()
            .unwrap_or(json!("")),
    );
    draft.insert(
        "employerName".into(),
        profile
            .get("employerName")
            .filter(|v| !v.is_null())
            .cloned()
            .unwrap_or(json!("")),
    );
    let bases = profile
        .get("salaryBasisConflict")
        .filter(|v| !v.is_null())
        .unwrap_or(profile);
    let groups = [
        ("TVOED_P", "tariff"),
        ("TVOED_E", "vkaETariff"),
        ("TVL_KR", "tvlKrTariff"),
        ("TVH_KR", "tvhKrTariff"),
        ("TVUK_NURSING", "tvUkNursingTariff"),
    ]
    .into_iter()
    .filter(|(_, field)| !bases[*field].is_null())
    .map(|(mode, _)| json!(mode))
    .collect::<Vec<_>>();
    draft.insert("confirmedGroups".into(), json!(groups));
    draft.insert(
        "lastTariffMode".into(),
        if values["salaryMode"] == "MANUAL" {
            json!("UNSET")
        } else {
            values["salaryMode"].clone()
        },
    );
    draft.insert(
        "pFullTimeOverride".into(),
        profile["tariff"]["fullTimeWeeklyMinutes"].clone(),
    );
    for key in &FIELDS[5..FIELDS.len() - 1] {
        draft.insert((*key).into(), values[*key].clone());
    }
    draft.insert("model".into(),json!({"night":profile["regularRotatingNightWork"],"sunday":profile["sundayHolidayWorkEligible"],"recorded":profile["allEmploymentWorkRecorded"],"coverage":profile["workPattern"].get("workplaceCoverage").filter(|v|!v.is_null()).cloned().unwrap_or(json!("UNKNOWN")),"assignment":profile["workPattern"].get("assignment").filter(|v|!v.is_null()).cloned().unwrap_or(json!("UNKNOWN"))}));
    for (key, value) in &draft {
        validate_field(key, value)?;
    }
    Ok(Value::Object(draft))
}
pub(super) fn edit_work(section: EditorSection) -> bool {
    matches!(section, EditorSection::Work | EditorSection::Employment)
}
pub(super) fn edit_tariff(section: EditorSection) -> bool {
    matches!(section, EditorSection::Tariff | EditorSection::Employment)
}
pub(super) fn edit_model(section: EditorSection) -> bool {
    matches!(
        section,
        EditorSection::Model | EditorSection::Work | EditorSection::Employment
    )
}
pub(super) fn tariff_draft(draft: &Value) -> Value {
    json!([
        draft["industry"],
        draft["salaryMode"],
        draft["trainingYear"],
        draft["manualMonthlyGross"],
        draft["tvhPayGroup"],
        draft["tvhPayLevel"],
        draft["tvhFullTimeWeeklyMinutes"],
        draft["tvUkPayGroup"],
        draft["tvUkPayLevel"],
        draft["krPayGroup"],
        draft["tvlUniversityRegion"],
        draft["tvalWorkplace"],
        draft["ePayGroup"],
        draft["payGroup"],
        draft["payLevel"],
        draft["sector"],
        draft["tariffRegion"],
        draft["pFullTimeOverride"],
        draft["confirmedGroups"]
    ])
}
pub(super) fn whole_draft(section: EditorSection, draft: &Value) -> Value {
    match section {
        EditorSection::Employer => json!([draft["employerName"]]),
        EditorSection::Personal => json!([draft["displayName"], draft["employerName"]]),
        _ => {
            let mut values = Vec::new();
            if edit_work(section) {
                values.extend([
                    draft["federalState"].clone(),
                    draft["holidayRegion"].clone(),
                    draft["weeklyHours"].clone(),
                ]);
            }
            if edit_tariff(section) {
                values.extend(tariff_draft(draft).as_array().cloned().unwrap_or_default());
            }
            if edit_model(section) {
                values.push(draft["model"].clone());
            }
            Value::Array(values)
        }
    }
}
