//! Raw SQL profile/salary rows to native flat facts. Database I/O, clocks and
//! derived sender flags are deliberately outside this boundary.
use super::{
    InputError,
    profile::{self, RawUserProfile},
    raw_json,
};
use serde::Serialize;
use serde_json::{Value, json};
use std::{collections::BTreeSet, sync::Arc};

pub const PROFILE_ROW_FIELDS: &[&str] = &[
    "display_name",
    "employer_name",
    "federal_state",
    "holiday_region",
    "weekly_minutes",
    "time_zone",
    "industry",
    "manual_monthly_gross_cents",
    "pay_group",
    "pay_level",
    "tariff_sector",
    "tariff_region",
    "full_time_weekly_minutes",
    "regular_rotating_night_work",
    "sunday_holiday_work_eligible",
    "all_employment_work_recorded",
    "created_at",
    "updated_at",
];
const BASES: &[&str] = &[
    "tariff",
    "manualMonthlyGrossCents",
    "nursingTrainingTariff",
    "vkaETariff",
    "tvlKrTariff",
    "tvUkNursingTariff",
    "tvhKrTariff",
    "tvalPflegeTariff",
];
// Preserve the original parse order (different from output property order).
const PREFERENCES: &[(&str, &str)] = &[
    ("salary_tval_pflege", "tvalPflegeTariff"),
    ("simpleSalary.tvhKr", "tvhKrTariff"),
    ("salary_tvuk_nursing", "tvUkNursingTariff"),
    ("salary_nursing_training", "nursingTrainingTariff"),
    ("salary_vka_e", "vkaETariff"),
    ("salary_tvl_kr", "tvlKrTariff"),
];
const OUTPUT_FAMILIES: &[&str] = &[
    "nursingTrainingTariff",
    "vkaETariff",
    "tvlKrTariff",
    "tvUkNursingTariff",
    "tvhKrTariff",
    "tvalPflegeTariff",
];
const LOAD_MESSAGE: &str = "Lokale Daten konnten nicht geladen werden. Bitte versuche es erneut.";

#[derive(Debug, Clone, Copy)]
pub struct ProfileSalaryLoadError;
impl ProfileSalaryLoadError {
    pub fn code(&self) -> &str {
        "PROFILE_SALARY_INVALID"
    }
    pub fn name(&self) -> &str {
        "DataLoadFailure"
    }
}
impl std::fmt::Display for ProfileSalaryLoadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(LOAD_MESSAGE)
    }
}
impl std::error::Error for ProfileSalaryLoadError {}
#[derive(Debug, Clone, Serialize)]
pub struct StoredSalaryIssue {
    field: String,
    code: &'static str,
    message: String,
}
impl StoredSalaryIssue {
    pub fn field(&self) -> &str {
        &self.field
    }
    pub fn code(&self) -> &str {
        self.code
    }
    pub fn message(&self) -> &str {
        &self.message
    }
}
fn issue(field: &str, code: &'static str, message: impl Into<String>) -> StoredSalaryIssue {
    StoredSalaryIssue {
        field: field.into(),
        code,
        message: message.into(),
    }
}
fn nullable_binary(row: &Value, key: &str) -> Value {
    if row.get(key) == Some(&Value::Null) {
        Value::Null
    } else {
        json!(row[key].as_f64() == Some(1.0))
    }
}
fn legacy_tariff(row: &Value) -> Value {
    json!({"payGroup":row["pay_group"],"payLevel":row["pay_level"],"sector":row["tariff_sector"],"tariffRegion":row["tariff_region"],"fullTimeWeeklyMinutes":row["full_time_weekly_minutes"]})
}
fn assign(record: &mut serde_json::Map<String, Value>, key: &str, value: Option<&Value>) {
    if let Some(value) = value {
        record.insert(key.into(), value.clone());
    } else {
        record.remove(key);
    }
}

pub fn map_profile_row(row: &Value) -> Result<Value, InputError> {
    let state = &row["federal_state"];
    let region = if row["holiday_region"] == "UNKNOWN"
        && !state
            .as_str()
            .is_some_and(|state| ["BY", "SN", "TH"].contains(&state))
    {
        json!("NONE")
    } else {
        row["holiday_region"].clone()
    };
    let tariff = if [
        "pay_group",
        "pay_level",
        "tariff_sector",
        "full_time_weekly_minutes",
    ]
    .iter()
    .all(|key| row.get(*key) != Some(&Value::Null))
    {
        legacy_tariff(row)
    } else {
        Value::Null
    };
    let input = json!({"displayName":row["display_name"],"employerName":row["employer_name"],"federalState":state,"holidayRegion":region,"weeklyMinutes":row["weekly_minutes"],"timeZone":row["time_zone"],"industry":row["industry"],"manualMonthlyGrossCents":row["manual_monthly_gross_cents"],"regularRotatingNightWork":nullable_binary(row,"regular_rotating_night_work"),"sundayHolidayWorkEligible":nullable_binary(row,"sunday_holiday_work_eligible"),"allEmploymentWorkRecorded":nullable_binary(row,"all_employment_work_recorded"),"tariff":tariff});
    let validated = profile::validate_profile(&input)?;
    let mut output = json!({"displayName":validated["displayName"],"employerName":validated["employerName"],"federalState":validated["federalState"],"holidayRegion":validated["holidayRegion"],"weeklyMinutes":validated["weeklyMinutes"],"timeZone":validated["timeZone"],"industry":validated["industry"],"manualMonthlyGrossCents":validated["manualMonthlyGrossCents"],"regularRotatingNightWork":validated["regularRotatingNightWork"],"sundayHolidayWorkEligible":validated["sundayHolidayWorkEligible"],"allEmploymentWorkRecorded":validated["allEmploymentWorkRecorded"],"tariff":validated["tariff"]});
    let record = output.as_object_mut().expect("mapped profile");
    assign(record, "createdAt", row.get("created_at"));
    assign(record, "updatedAt", row.get("updated_at"));
    Ok(output)
}
pub fn salary_basis_count(profile: &Value) -> usize {
    BASES.iter().filter(|key| !profile[**key].is_null()).count()
}
pub fn unresolved_salary_profile(profile: &Value) -> Result<Value, InputError> {
    let mut result = profile.clone();
    let record = result
        .as_object_mut()
        .ok_or_else(|| InputError::validation("Die gespeicherten Profilangaben sind ungültig."))?;
    let drafts = profile
        .get("salaryBasisConflict")
        .filter(|value| !value.is_null())
        .cloned()
        .unwrap_or_else(|| {
            Value::Object(
                BASES
                    .iter()
                    .map(|key| ((*key).into(), profile[*key].clone()))
                    .collect(),
            )
        });
    for field in BASES {
        record.insert((*field).into(), Value::Null);
    }
    record.insert("salaryBasisConflict".into(), drafts);
    Ok(result)
}
struct SalaryRead {
    loaded: Value,
    drafts: Value,
    issues: Vec<StoredSalaryIssue>,
}
fn salary_read(
    profile: &Value,
    rows: &[Value],
    stop_on_error: bool,
) -> Result<SalaryRead, ProfileSalaryLoadError> {
    let mut normalized = serde_json::Map::new();
    let mut drafts = serde_json::Map::new();
    let mut issues = vec![];
    for (key, field) in PREFERENCES {
        let Some(row) = rows.iter().find(|row| row["key"] == *key) else {
            continue;
        };
        let parsed = row["value"]
            .as_str()
            .ok_or(ProfileSalaryLoadError)
            .and_then(|text| raw_json::parse(text).map_err(|_| ProfileSalaryLoadError));
        let value = match parsed {
            Ok(value) => value,
            Err(error) => {
                if stop_on_error {
                    return Err(error);
                }
                drafts.insert((*field).into(), row["value"].clone());
                issues.push(issue(field, "PROFILE_SALARY_INVALID", LOAD_MESSAGE));
                continue;
            }
        };
        drafts.insert((*field).into(), value.clone());
        match profile::salary(field, &value, &profile["weeklyMinutes"], false) {
            Ok(Some(value)) => {
                normalized.insert((*field).into(), value);
            }
            Ok(None) => {}
            Err(_) => {
                if stop_on_error {
                    return Err(ProfileSalaryLoadError);
                }
                issues.push(issue(field, "PROFILE_SALARY_INVALID", LOAD_MESSAGE));
            }
        }
    }
    let mut loaded = profile.clone();
    let record = loaded.as_object_mut().ok_or(ProfileSalaryLoadError)?;
    for field in OUTPUT_FAMILIES {
        if let Some(value) = normalized.get(*field) {
            record.insert((*field).into(), value.clone());
        }
    }
    Ok(SalaryRead {
        loaded,
        drafts: Value::Object(drafts),
        issues,
    })
}
pub fn load_simple_salary_for_profile(
    profile: &Value,
    rows: &[Value],
) -> Result<Value, ProfileSalaryLoadError> {
    let loaded = salary_read(profile, rows, true)?.loaded;
    if salary_basis_count(&loaded) > 1 {
        unresolved_salary_profile(&loaded).map_err(|_| ProfileSalaryLoadError)
    } else {
        Ok(loaded)
    }
}

/// Original SQL sources plus native flat/core views. There is no Deserialize
/// and no client-supplied derived conflict or calculation readiness field.
pub struct OpaqueStoredWorkProfile {
    raw: Arc<Value>,
    salary_rows: Arc<Vec<Value>>,
    flat: Arc<Value>,
    core: Arc<Value>,
    issues: Vec<StoredSalaryIssue>,
}
impl OpaqueStoredWorkProfile {
    pub fn raw_profile(&self) -> &Arc<Value> {
        &self.raw
    }
    pub fn raw_salary_rows(&self) -> &Arc<Vec<Value>> {
        &self.salary_rows
    }
    pub fn flat_profile(&self) -> &Arc<Value> {
        &self.flat
    }
    pub fn core_profile(&self) -> &Arc<Value> {
        &self.core
    }
    pub fn salary_issues(&self) -> &[StoredSalaryIssue] {
        &self.issues
    }
}
pub fn checked_stored_work_profile(
    raw: Arc<Value>,
    salary_rows: Arc<Vec<Value>>,
) -> Result<OpaqueStoredWorkProfile, InputError> {
    if !raw.as_object().is_some_and(|row| {
        row.len() == PROFILE_ROW_FIELDS.len()
            && PROFILE_ROW_FIELDS.iter().all(|key| row.contains_key(*key))
    }) {
        return Err(InputError::validation(
            "Die gespeicherte Profilzeile ist ungültig.",
        ));
    }
    for key in [
        "regular_rotating_night_work",
        "sunday_holiday_work_eligible",
        "all_employment_work_recorded",
    ] {
        if !raw[key].is_null()
            && !raw[key]
                .as_f64()
                .is_some_and(|value| [0.0, 1.0].contains(&value))
        {
            return Err(InputError::validation(
                "Die gespeicherten Angaben zur Arbeitszeitprüfung sind ungültig.",
            ));
        }
    }
    let mut core_row = raw.as_ref().clone();
    for key in [
        "pay_group",
        "pay_level",
        "tariff_sector",
        "full_time_weekly_minutes",
        "manual_monthly_gross_cents",
    ] {
        core_row[key] = Value::Null;
    }
    let base = map_profile_row(&core_row)?;
    let core_checked = RawUserProfile::try_from_raw(base.clone())?;
    let core = Arc::new(core_checked.core_profile().clone());
    let mut issues = vec![];
    let mut seen = BTreeSet::new();
    for row in salary_rows.iter() {
        let shape = row.as_object().is_some_and(|row| {
            row.len() == 2 && row.contains_key("key") && row.contains_key("value")
        });
        let key = row["key"].as_str();
        if !shape
            || key.is_none_or(|key| !PREFERENCES.iter().any(|(candidate, _)| *candidate == key))
            || !row["value"].is_string()
        {
            issues.push(issue(
                "salaryRows",
                "INVALID_SALARY_ROW",
                "Die gespeicherten Gehaltszeilen sind ungültig.",
            ));
        }
        if let Some(key) = key
            && !seen.insert(key)
        {
            issues.push(issue(
                key,
                "DUPLICATE_SALARY_ROW",
                "Eine Gehaltszeile ist mehrfach vorhanden.",
            ));
        }
    }
    let mapped = map_profile_row(&raw).unwrap_or(base);
    let parsed = salary_read(&mapped, &salary_rows, false)
        .map_err(|_| InputError::validation("Die gespeicherten Gehaltsangaben sind ungültig."))?;
    issues.extend(parsed.issues);
    let mut draft_input = core.as_ref().clone();
    if [
        "pay_group",
        "pay_level",
        "tariff_sector",
        "full_time_weekly_minutes",
    ]
    .iter()
    .any(|key| !raw[*key].is_null())
    {
        draft_input["tariff"] = legacy_tariff(&raw);
    }
    draft_input["manualMonthlyGrossCents"] = raw["manual_monthly_gross_cents"].clone();
    draft_input.as_object_mut().expect("core profile").extend(
        parsed
            .drafts
            .as_object()
            .expect("preference drafts")
            .clone(),
    );
    let checked = RawUserProfile::try_from_raw(draft_input.clone())?;
    for problem in checked.salary_issues() {
        issues.push(issue(
            problem.field(),
            if problem.code() == "CONFLICTING_SALARY_CHOICES" {
                "PROFILE_SALARY_CONFLICT"
            } else {
                "PROFILE_SALARY_INVALID"
            },
            problem.message(),
        ));
    }
    let mut flat = parsed.loaded;
    if salary_basis_count(&flat) > 1 || !issues.is_empty() {
        let mut drafts: serde_json::Map<String, Value> = BASES
            .iter()
            .map(|key| ((*key).into(), draft_input[*key].clone()))
            .collect();
        for choice in checked.salary_choices() {
            if let Some(value) = choice.normalized() {
                drafts.insert(choice.field().into(), value.clone());
            }
        }
        flat = unresolved_salary_profile(&flat)?;
        flat["salaryBasisConflict"] = Value::Object(drafts);
    }
    Ok(OpaqueStoredWorkProfile {
        raw,
        salary_rows,
        flat: Arc::new(flat),
        core,
        issues,
    })
}
