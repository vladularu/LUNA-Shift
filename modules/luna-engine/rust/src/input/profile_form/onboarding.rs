use super::{FormClock, InputError, ProfileFormError, shape_error};
use crate::{
    pay::families::{Family, profile as family, tvl_tval},
    rules::RuleResolver,
};
use serde::Serialize;
use serde_json::{Value, json};
/// Raw UI selection, not a checked saved salary/profile. Unknown strings remain
/// available to the source's own field-error policy instead of choosing defaults.
pub struct OnboardingSelection {
    mode: Option<String>,
    group: Option<String>,
    level: Value,
    sector: Option<String>,
    tariff_region: Option<String>,
    university_region: Option<String>,
    training_year: Option<f64>,
    full_time: Option<f64>,
    tval_employer_scope: Option<String>,
}
impl OnboardingSelection {
    pub fn try_from_raw(raw: &Value) -> Result<Self, InputError> {
        if !raw.as_object().is_some_and(|r| {
            [
                "mode",
                "group",
                "level",
                "sector",
                "tariffRegion",
                "universityRegion",
                "trainingYear",
                "fullTime",
            ]
            .iter()
            .all(|k| r.contains_key(*k))
        }) {
            return Err(shape_error());
        }
        let string = |key: &str| {
            if raw[key].is_null() {
                Ok(None)
            } else {
                raw[key]
                    .as_str()
                    .map(|v| Some(v.to_owned()))
                    .ok_or_else(shape_error)
            }
        };
        let number = |key: &str| {
            if raw[key].is_null() {
                Ok(None)
            } else {
                raw[key].as_f64().map(Some).ok_or_else(shape_error)
            }
        };
        if !matches!(
            raw["level"],
            Value::Null | Value::String(_) | Value::Number(_)
        ) {
            return Err(shape_error());
        }
        Ok(Self {
            mode: string("mode")?,
            group: string("group")?,
            level: raw["level"].clone(),
            sector: string("sector")?,
            tariff_region: string("tariffRegion")?,
            university_region: string("universityRegion")?,
            training_year: number("trainingYear")?,
            full_time: number("fullTime")?,
            tval_employer_scope: string("tvalEmployerScope")?,
        })
    }
}
#[derive(Serialize)]
#[serde(transparent)]
pub struct OnboardingSalaryDraft(Value);
pub fn groups(mode: Option<&str>) -> &'static [&'static str] {
    match mode {
        Some("TVOED_P") => super::super::profile::GROUPS,
        Some("TVOED_E") => family::VKA_E_GROUPS,
        Some("TVL_KR") => family::TVL_KR_GROUPS,
        Some("TVH_KR") => family::TVH_KR_GROUPS,
        Some("TVUK_NURSING") => family::TVUK_NURSING_GROUPS,
        _ => &[],
    }
}
pub fn levels(mode: Option<&str>, group: Option<&str>) -> Vec<Value> {
    let Some(group) = group.filter(|g| !g.is_empty() && groups(mode).contains(g)) else {
        return vec![];
    };
    match mode {
        Some("TVOED_P") => {
            if ["P5", "P6"].contains(&group) {
                (1..=6).map(|v| json!(v)).collect()
            } else {
                (2..=6).map(|v| json!(v)).collect()
            }
        }
        Some("TVOED_E") => family::e_pay_levels(group)
            .iter()
            .map(|v| json!(v))
            .collect(),
        Some("TVL_KR") => family::tvl_kr_levels_for_group(group)
            .iter()
            .map(|v| json!(v))
            .collect(),
        Some("TVH_KR") => family::tvh_kr_levels_for_group(group),
        Some("TVUK_NURSING") => family::tvuk_levels_for_group(group)
            .iter()
            .map(|v| json!(v))
            .collect(),
        _ => vec![],
    }
}
pub fn is_training(mode: Option<&str>) -> bool {
    matches!(mode, Some("TVAOED_PFLEGE" | "TVAL_PFLEGE"))
}
pub fn full_time(
    selection: &OnboardingSelection,
    clock: &FormClock,
    resolver: &RuleResolver,
) -> Result<Option<f64>, ProfileFormError> {
    // The original reads Berlin's current day even for selections whose result
    // does not use it. One immutable raw-instant seam preserves that behavior.
    let date = clock.date_in("Europe/Berlin")?;
    let s = selection;
    Ok(match s.mode.as_deref() {
        Some("TVL_KR" | "TVAL_PFLEGE") => {
            if let Some(region) = s.university_region.as_deref().filter(|v| !v.is_empty()) {
                tvl_tval::full_time_minutes(
                    if s.mode.as_deref() == Some("TVL_KR") {
                        Family::Tvl
                    } else {
                        Family::Tval
                    },
                    &date,
                    region,
                    resolver,
                )?
                .map(|v| v as f64)
            } else {
                None
            }
        }
        Some("TVH_KR") => s.full_time,
        Some("TVUK_NURSING") => Some(2310.0),
        Some("TVAOED_PFLEGE") => match s.sector.as_deref() {
            Some("BT_K") => Some(2310.0),
            Some("BT_B") => Some(2340.0),
            _ => None,
        },
        _ => match (s.sector.as_deref(), s.tariff_region.as_deref()) {
            (Some(sector), Some(region)) if !sector.is_empty() && !region.is_empty() => {
                Some(family::tariff_full_time_weekly_minutes(sector, region) as f64)
            }
            _ => None,
        },
    })
}
pub fn errors(
    selection: &OnboardingSelection,
    weekly_minutes: f64,
    clock: &FormClock,
    resolver: &RuleResolver,
) -> Result<Value, ProfileFormError> {
    if !weekly_minutes.is_finite() {
        return Err(shape_error().into());
    }
    let s = selection;
    let mode = s.mode.as_deref();
    if mode.is_none_or(str::is_empty) {
        return Ok(json!({"tariff":"Bitte wähle deinen Tarifvertrag."}));
    }
    let mut errors = json!({});
    if is_training(mode) {
        if !s
            .training_year
            .is_some_and(|v| [1.0, 2.0, 3.0].contains(&v))
        {
            errors["year"] = json!("Bitte wähle dein Ausbildungsjahr.");
        }
    } else {
        if s.group
            .as_deref()
            .is_none_or(|v| v.is_empty() || !groups(mode).contains(&v))
        {
            errors["group"] = json!("Bitte wähle deine Entgeltgruppe.");
        }
        if s.level.is_null()
            || !levels(mode, s.group.as_deref())
                .iter()
                .any(|level| match (level, &s.level) {
                    (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
                    _ => level == &s.level,
                })
        {
            errors["level"] = json!("Bitte wähle deine Stufe.");
        }
    }
    if matches!(mode, Some("TVOED_P" | "TVOED_E" | "TVAOED_PFLEGE")) {
        if s.sector.as_deref().is_none_or(str::is_empty) {
            errors["sector"] = json!("Bitte wähle deinen Tarifbereich.");
        }
        if s.tariff_region.as_deref().is_none_or(str::is_empty) {
            errors["tariffRegion"] = json!("Bitte wähle dein Tarifgebiet.");
        }
    }
    if matches!(mode, Some("TVL_KR" | "TVAL_PFLEGE"))
        && s.university_region.as_deref().is_none_or(str::is_empty)
    {
        errors["region"] = json!("Bitte wähle dein Tarifgebiet.");
    }
    if mode == Some("TVH_KR") && s.full_time.is_none_or(|v| v == 0.0) {
        errors["fulltime"] = json!("Bitte wähle die tarifliche Vollzeit.");
    }
    if errors.as_object().is_some_and(|e| e.is_empty())
        && !matches!(mode, Some("TVOED_P" | "TVOED_E"))
        && full_time(s, clock, resolver)?.is_none_or(|v| v == 0.0 || weekly_minutes > v)
    {
        errors["hours"] = json!(
            "Bitte prüfe deine Wochenstunden. Sie liegen über der tariflichen Vollzeit oder die Zeitgrundlage fehlt."
        );
    }
    Ok(errors)
}
pub fn salary_draft(
    selection: &OnboardingSelection,
    weekly_minutes: f64,
    clock: &FormClock,
    resolver: &RuleResolver,
) -> Result<OnboardingSalaryDraft, ProfileFormError> {
    let issues = errors(selection, weekly_minutes, clock, resolver)?;
    if let Some(first) = issues
        .as_object()
        .and_then(|v| v.values().find_map(Value::as_str))
    {
        return Err(InputError::user_facing_source(first, "UserFacingError").into());
    }
    let s = selection;
    let mut base = json!({"tariff":null,"manualMonthlyGrossCents":null,"nursingTrainingTariff":null,"vkaETariff":null,"tvlKrTariff":null,"tvUkNursingTariff":null,"tvhKrTariff":null,"tvalPflegeTariff":null});
    let (field, value) = match s.mode.as_deref() {
        Some("TVOED_P") => (
            "tariff",
            json!({"payGroup":s.group,"payLevel":s.level,"sector":s.sector,"tariffRegion":s.tariff_region,"fullTimeWeeklyMinutes":full_time(s,clock,resolver)?}),
        ),
        Some("TVOED_E") => (
            "vkaETariff",
            json!({"payGroup":s.group,"payLevel":s.level,"sector":s.sector,"tariffRegion":s.tariff_region}),
        ),
        Some("TVL_KR") => (
            "tvlKrTariff",
            json!({"payGroup":s.group,"payLevel":s.level,"universityRegion":s.university_region}),
        ),
        Some("TVH_KR") => (
            "tvhKrTariff",
            json!({"payGroup":s.group,"payLevel":s.level,"fullTimeWeeklyMinutes":s.full_time}),
        ),
        Some("TVUK_NURSING") => (
            "tvUkNursingTariff",
            json!({"payGroup":s.group,"payLevel":s.level}),
        ),
        Some("TVAOED_PFLEGE") => (
            "nursingTrainingTariff",
            json!({"trainingYear":s.training_year,"sector":s.sector,"tariffRegion":s.tariff_region}),
        ),
        Some("TVAL_PFLEGE") => {
            let mut value =
                json!({"trainingYear":s.training_year,"universityRegion":s.university_region});
            for (key, v) in super::settings::tval_workplace_fields(
                s.tval_employer_scope.as_deref().unwrap_or("UNKNOWN"),
                None,
                false,
            )
            .as_object()
            .expect("native object")
            {
                value[key] = v.clone();
            }
            ("tvalPflegeTariff", value)
        }
        _ => {
            return Err(InputError::user_facing_source(
                "Bitte wähle deinen Tarifvertrag.",
                "UserFacingError",
            )
            .into());
        }
    };
    base[field] = value;
    Ok(OnboardingSalaryDraft(base))
}
pub fn region_mismatch(mode: Option<&str>, state: Option<&str>) -> Option<&'static str> {
    let state = state.filter(|v| !v.is_empty())?;
    match mode {
        Some("TVH_KR") if state != "HE" => {
            Some("Dieser Tarif gehört zu Hessen. Bitte prüfe, ob er für dich gilt.")
        }
        Some("TVUK_NURSING") if state != "BW" => {
            Some("Dieser Tarif gehört zu Baden-Württemberg. Bitte prüfe, ob er für dich gilt.")
        }
        _ => None,
    }
}
