//! Existing form-domain normalization plus the stricter raw stored-profile
//! boundary. Invalid salary drafts never select a winner or hide the calendar.
use super::{InputError, require_instant, trim_javascript};
use crate::pay::families::profile as family;
use serde::Serialize;
use serde_json::{Value, json};
use std::sync::Arc;

const STATES: &[&str] = &[
    "BW", "BY", "BE", "BB", "HB", "HH", "HE", "MV", "NI", "NW", "RP", "SL", "SN", "ST", "SH", "TH",
];
const INDUSTRIES: &[&str] = &[
    "HEALTHCARE",
    "EMERGENCY_SERVICES",
    "SOCIAL_SERVICES",
    "OTHER_SHIFT_WORK",
];
pub(super) const GROUPS: &[&str] = &[
    "P5", "P6", "P7", "P8", "P9", "P10", "P11", "P12", "P13", "P14", "P15", "P16",
];
pub const SALARY_FIELDS: &[&str] = &[
    "nursingTrainingTariff",
    "vkaETariff",
    "tvlKrTariff",
    "tvalPflegeTariff",
    "tvhKrTariff",
    "tvUkNursingTariff",
    "tariff",
    "manualMonthlyGrossCents",
];
const EVIDENCE: &[&str] = &[
    "regularRotatingNightWork",
    "sundayHolidayWorkEligible",
    "allEmploymentWorkRecorded",
];
const STORED_FIELDS: &[&str] = &[
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
    "tariff",
    "manualMonthlyGrossCents",
    "nursingTrainingTariff",
    "vkaETariff",
    "tvlKrTariff",
    "tvUkNursingTariff",
    "tvhKrTariff",
    "tvalPflegeTariff",
    "createdAt",
    "updatedAt",
];

fn integer(value: &Value, min: i64, max: i64) -> Option<i64> {
    let value = value.as_f64()?;
    (value.is_finite() && value.fract() == 0.0 && value >= min as f64 && value <= max as f64)
        .then_some(value as i64)
}
pub fn require_weekly_minutes(value: &Value) -> Result<i64, InputError> {
    integer(value, 60, 4800).ok_or_else(|| {
        InputError::validation("Die Wochenarbeitszeit muss zwischen 1 und 80 Stunden liegen.")
    })
}
fn manual(value: &Value) -> Result<Option<i64>, InputError> {
    if value.is_null() {
        Ok(None)
    } else {
        integer(value, 1, 10_000_000)
            .map(Some)
            .ok_or_else(|| InputError::validation("Bitte ein gültiges monatliches Brutto angeben."))
    }
}
pub fn require_profile_text(
    value: &Value,
    label: &str,
    max_length: usize,
) -> Result<Option<String>, InputError> {
    if value.is_null() {
        return Ok(None);
    }
    let text = value
        .as_str()
        .map(trim_javascript)
        .filter(|text| text.encode_utf16().count() <= max_length)
        .ok_or_else(|| {
            InputError::validation(format!(
                "{label} darf höchstens {max_length} Zeichen enthalten."
            ))
        })?;
    Ok((!text.is_empty()).then(|| text.to_owned()))
}
pub fn require_time_zone(value: &Value) -> Result<String, InputError> {
    let fail = || InputError::validation("Bitte eine gültige Zeitzone wählen.");
    let name = value.as_str().map(trim_javascript).ok_or_else(fail)?;
    if name.eq_ignore_ascii_case("Factory") {
        return Err(fail());
    }
    // Frozen Intl/ICU 78.3 accepts legacy three-letter aliases and U+2212
    // offsets which Temporal arithmetic deliberately rejects. Validate them
    // without changing the stored identifier or interpreting them as a zone.
    const INTL_ALIASES: &[&str] = &[
        "ACT", "AET", "AGT", "ART", "AST", "BET", "BST", "CAT", "CET", "CNT", "CST", "CTT", "EAT",
        "ECT", "EET", "EST", "GMT", "HST", "IET", "IST", "JST", "MET", "MIT", "MST", "NET", "NST",
        "PLT", "PNT", "PRC", "PRT", "PST", "ROC", "ROK", "SST", "UCT", "UTC", "VST", "WET",
    ];
    let offset = name.strip_prefix('−').map(|value| format!("-{value}"));
    let checked = offset.as_deref().unwrap_or(name);
    // Intl accepts identifiers/offsets, not Temporal's annotated ISO references.
    if !INTL_ALIASES.contains(&name.to_ascii_uppercase().as_str())
        && !crate::time_zone::identifier(checked).is_ok_and(|identifier| identifier == checked)
    {
        return Err(fail());
    }
    Ok(name.into())
}
fn legacy_tariff(value: &Value) -> Result<Option<Value>, InputError> {
    if value.is_null() {
        return Ok(None);
    }
    let group = value["payGroup"]
        .as_str()
        .filter(|group| GROUPS.contains(group))
        .ok_or_else(|| InputError::validation("Bitte eine gültige TVöD-P-Gruppe wählen."))?;
    let min = if ["P5", "P6"].contains(&group) { 1 } else { 2 };
    if integer(&value["payLevel"], min, 6).is_none() {
        return Err(InputError::validation(
            "Bitte eine gültige TVöD-P-Stufe für die gewählte Gruppe wählen.",
        ));
    }
    let sector = value["sector"]
        .as_str()
        .filter(|sector| ["BT_K", "BT_B"].contains(sector))
        .ok_or_else(|| InputError::validation("Bitte einen gültigen TVöD-Bereich wählen."))?;
    let expected = family::tariff_full_time_weekly_minutes(
        sector,
        value["tariffRegion"].as_str().unwrap_or(""),
    );
    if integer(&value["fullTimeWeeklyMinutes"], expected, expected).is_none() {
        return Err(InputError::validation(
            "Die tarifliche Vollzeit passt nicht zum gewählten Tarifbereich und Tarifgebiet.",
        ));
    }
    Ok(Some(value.clone()))
}
pub(super) fn holiday_regions_for_state(state: &str) -> &'static [&'static str] {
    match state {
        "BY" => &["UNKNOWN", "NONE", "BY_MARIA_HIMMELFAHRT", "BY_AUGSBURG"],
        "SN" => &["UNKNOWN", "NONE", "SN_FRONLEICHNAM"],
        "TH" => &["UNKNOWN", "NONE", "TH_FRONLEICHNAM"],
        _ => &["NONE"],
    }
}
fn compatible(state: &str, region: &Value) -> bool {
    region
        .as_str()
        .is_some_and(|region| holiday_regions_for_state(state).contains(&region))
}
pub(super) fn salary(
    field: &str,
    value: &Value,
    weekly: &Value,
    strict: bool,
) -> Result<Option<Value>, InputError> {
    match field {
        "nursingTrainingTariff" => {
            family::require_nursing_training_tariff(value).map_err(Into::into)
        }
        "vkaETariff" => family::require_vka_e_tariff(value).map_err(Into::into),
        "tvlKrTariff" => family::require_tvl_kr_salary_tariff(value).map_err(Into::into),
        "tvalPflegeTariff" => family::require_tval_pflege_tariff(value).map_err(Into::into),
        "tvUkNursingTariff" => family::require_tvuk_nursing_tariff(value).map_err(Into::into),
        "tvhKrTariff" => {
            let result = family::require_tvh_kr_tariff(value)?;
            if strict
                && result.as_ref().is_some_and(|tariff| {
                    weekly.as_f64().is_some_and(|weekly| {
                        weekly > tariff["fullTimeWeeklyMinutes"].as_f64().unwrap_or(0.0)
                    })
                })
            {
                return Err(InputError::validation(
                    "Deine Wochenstunden liegen über der tariflichen Vollzeit.",
                ));
            }
            Ok(result)
        }
        "tariff" => {
            let result = legacy_tariff(value)?;
            if strict
                && result.as_ref().is_some_and(|value| {
                    value["tariffRegion"]
                        .as_str()
                        .is_none_or(|region| !["KAV_BW", "OTHER"].contains(&region))
                        || value.as_object().is_none_or(|record| {
                            record.len() != 5
                                || [
                                    "payGroup",
                                    "payLevel",
                                    "sector",
                                    "tariffRegion",
                                    "fullTimeWeeklyMinutes",
                                ]
                                .iter()
                                .any(|key| !record.contains_key(*key))
                        })
                })
            {
                return Err(InputError::validation(
                    "Die gespeicherte TVöD-P-Auswahl ist ungültig.",
                ));
            }
            Ok(result)
        }
        "manualMonthlyGrossCents" => manual(value).map(|value| value.map(|value| json!(value))),
        _ => Err(InputError::validation("Unbekannte Gehaltsgrundlage.")),
    }
}

pub fn validate_profile(input: &Value) -> Result<Value, InputError> {
    // Match the source's validation order before building any normalized output.
    let training = salary(
        "nursingTrainingTariff",
        &input["nursingTrainingTariff"],
        &input["weeklyMinutes"],
        false,
    )?;
    let vka = salary(
        "vkaETariff",
        &input["vkaETariff"],
        &input["weeklyMinutes"],
        false,
    )?;
    let tvl = salary(
        "tvlKrTariff",
        &input["tvlKrTariff"],
        &input["weeklyMinutes"],
        false,
    )?;
    let tval = salary(
        "tvalPflegeTariff",
        &input["tvalPflegeTariff"],
        &input["weeklyMinutes"],
        false,
    )?;
    let tvh = salary(
        "tvhKrTariff",
        &input["tvhKrTariff"],
        &input["weeklyMinutes"],
        false,
    )?;
    let tvuk = salary(
        "tvUkNursingTariff",
        &input["tvUkNursingTariff"],
        &input["weeklyMinutes"],
        false,
    )?;
    if tvh.as_ref().is_some_and(|tariff| {
        input["weeklyMinutes"]
            .as_f64()
            .is_some_and(|weekly| weekly > tariff["fullTimeWeeklyMinutes"].as_f64().unwrap_or(0.0))
    }) {
        return Err(InputError::validation(
            "Deine Wochenstunden liegen über der tariflichen Vollzeit.",
        ));
    }
    let state = input["federalState"]
        .as_str()
        .filter(|state| STATES.contains(state))
        .ok_or_else(|| InputError::validation("Bitte ein gültiges Bundesland wählen."))?;
    let industry = if input["industry"].is_null() {
        Value::Null
    } else {
        json!(
            input["industry"]
                .as_str()
                .filter(|industry| INDUSTRIES.contains(industry))
                .ok_or_else(|| InputError::validation(
                    "Bitte einen gültigen Berufsbereich wählen."
                ))?
        )
    };
    let manual = manual(&input["manualMonthlyGrossCents"])?;
    let region = if input["holidayRegion"].is_null() {
        json!(if ["BY", "SN", "TH"].contains(&state) {
            "UNKNOWN"
        } else {
            "NONE"
        })
    } else {
        input["holidayRegion"].clone()
    };
    if !compatible(state, &region) {
        return Err(InputError::validation(
            "Die regionale Feiertagsregel passt nicht zum Bundesland.",
        ));
    }
    for field in EVIDENCE {
        if !input[*field].is_null() && !input[*field].is_boolean() {
            return Err(InputError::validation(
                "Eine Angabe zur Arbeitszeitprüfung ist ungültig.",
            ));
        }
    }
    let tariff = legacy_tariff(&input["tariff"])?;
    if tariff.is_some() && manual.is_some() {
        return Err(InputError::validation(
            "Bitte entweder manuelles Gehalt oder TVöD-P wählen.",
        ));
    }
    if [&training, &vka, &tvl, &tval, &tvh, &tvuk, &tariff]
        .iter()
        .filter(|value| value.is_some())
        .count()
        + usize::from(manual.is_some())
        > 1
    {
        return Err(InputError::validation(
            "Bitte nur eine Gehaltsgrundlage wählen.",
        ));
    }
    let mut output = serde_json::Map::new();
    output.insert("federalState".into(), json!(state));
    for (field, label, limit) in [
        ("displayName", "Name", 80),
        ("employerName", "Arbeitgeber", 160),
    ] {
        if let Some(value) = input.get(field) {
            output.insert(
                field.into(),
                json!(require_profile_text(value, label, limit)?),
            );
        }
    }
    output.insert("holidayRegion".into(), region);
    output.insert(
        "weeklyMinutes".into(),
        json!(require_weekly_minutes(&input["weeklyMinutes"])?),
    );
    let zone = input["timeZone"]
        .as_str()
        .map(trim_javascript)
        .ok_or_else(|| InputError::validation("Bitte eine gültige Zeitzone wählen."))?;
    output.insert(
        "timeZone".into(),
        json!(require_time_zone(&json!(if zone.is_empty() {
            "Europe/Berlin"
        } else {
            zone
        }))?),
    );
    output.insert("industry".into(), industry);
    output.insert("manualMonthlyGrossCents".into(), json!(manual));
    for field in EVIDENCE {
        output.insert((*field).into(), input[*field].clone());
    }
    output.insert("tariff".into(), tariff.unwrap_or(Value::Null));
    for (field, value) in [
        ("nursingTrainingTariff", training),
        ("vkaETariff", vka),
        ("tvlKrTariff", tvl),
        ("tvUkNursingTariff", tvuk),
        ("tvhKrTariff", tvh),
        ("tvalPflegeTariff", tval),
    ] {
        if input.get(field).is_some() {
            output.insert(field.into(), value.unwrap_or(Value::Null));
        }
    }
    Ok(Value::Object(output))
}

#[derive(Debug, Clone, Serialize)]
pub struct SalaryInputIssue {
    field: String,
    code: &'static str,
    message: String,
}
impl SalaryInputIssue {
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
#[derive(Debug, Clone)]
pub struct CheckedSalaryChoice {
    field: String,
    normalized: Option<Value>,
}
impl CheckedSalaryChoice {
    pub fn field(&self) -> &str {
        &self.field
    }
    pub fn normalized(&self) -> Option<&Value> {
        self.normalized.as_ref()
    }
}
/// No Deserialize: only this checked constructor can create a stored profile.
pub struct RawUserProfile {
    stored: Arc<Value>,
    core: Value,
    choices: Vec<CheckedSalaryChoice>,
    issues: Vec<SalaryInputIssue>,
}
impl RawUserProfile {
    pub fn try_from_raw(value: Value) -> Result<Self, InputError> {
        let record = value.as_object().ok_or_else(|| {
            InputError::validation("Die gespeicherten Profilangaben sind ungültig.")
        })?;
        if [
            "workingTimeTarget",
            "employmentTimeline",
            "salaryBasisConflict",
            "workPattern",
        ]
        .iter()
        .any(|key| record.contains_key(*key))
        {
            return Err(InputError::validation(
                "Berechnete Profilangaben dürfen nicht als Rohdaten übergeben werden.",
            ));
        }
        if record
            .keys()
            .any(|key| !STORED_FIELDS.contains(&key.as_str()))
        {
            return Err(InputError::validation(
                "Die gespeicherten Profilangaben enthalten unbekannte Felder.",
            ));
        }
        require_instant(&value["createdAt"], "Erstellung")?;
        require_instant(&value["updatedAt"], "Aktualisierung")?;
        let core_input = Value::Object(
            record
                .iter()
                .filter(|(key, _)| !SALARY_FIELDS.contains(&key.as_str()))
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect(),
        );
        let mut core = validate_profile(&core_input)?;
        if crate::time_zone::identifier(core["timeZone"].as_str().expect("normalized timezone"))
            .is_err()
        {
            return Err(InputError::validation(
                "Die gespeicherte Zeitzone wird für Berechnungen nicht unterstützt.",
            ));
        }
        for field in SALARY_FIELDS {
            core[*field] = Value::Null;
        }
        core["createdAt"] = value["createdAt"].clone();
        core["updatedAt"] = value["updatedAt"].clone();
        let mut choices = vec![];
        let mut issues = vec![];
        for field in SALARY_FIELDS {
            let raw = &value[*field];
            if raw.is_null() {
                continue;
            }
            let normalized = match salary(field, raw, &core["weeklyMinutes"], true) {
                Ok(value) => value,
                Err(error) => {
                    issues.push(SalaryInputIssue {
                        field: (*field).into(),
                        code: "INVALID_SALARY_CHOICE",
                        message: error.to_string(),
                    });
                    None
                }
            };
            choices.push(CheckedSalaryChoice {
                field: (*field).into(),
                normalized,
            });
        }
        if choices.len() > 1 {
            issues.push(SalaryInputIssue {
                field: "salary".into(),
                code: "CONFLICTING_SALARY_CHOICES",
                message: if !value["tariff"].is_null()
                    && !value["manualMonthlyGrossCents"].is_null()
                {
                    "Bitte entweder manuelles Gehalt oder TVöD-P wählen."
                } else {
                    "Bitte nur eine Gehaltsgrundlage wählen."
                }
                .into(),
            });
        }
        Ok(Self {
            stored: Arc::new(value),
            core,
            choices,
            issues,
        })
    }
    pub fn stored(&self) -> &Value {
        &self.stored
    }
    pub fn stored_arc(&self) -> &Arc<Value> {
        &self.stored
    }
    pub fn core_profile(&self) -> &Value {
        &self.core
    }
    pub fn salary_choices(&self) -> &[CheckedSalaryChoice] {
        &self.choices
    }
    pub fn salary_issues(&self) -> &[SalaryInputIssue] {
        &self.issues
    }
}
