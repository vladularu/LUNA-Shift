//! A source-bound merged save-input view. Serializing the view reads original
//! metadata by reference; constructing it never clones target/history trees.
use super::{EditorSection, ProfileFormError, model, preview};
use crate::{
    input::{InputError, form_number, javascript_json, profile_form},
    rules::RuleResolver,
};
use serde::{Serialize, Serializer, ser::SerializeMap};
use serde_json::{Map, Value, json};
pub struct ProfileSaveInput<'a> {
    base: &'a Value,
    changes: Map<String, Value>,
}
impl<'a> ProfileSaveInput<'a> {
    pub(super) fn new(base: &'a Value, changes: Map<String, Value>) -> Self {
        Self { base, changes }
    }
    pub fn field(&self, key: &str) -> Option<&Value> {
        self.changes.get(key).or_else(|| self.base.get(key))
    }
    pub fn changes(&self) -> &Map<String, Value> {
        &self.changes
    }
    pub(crate) fn into_native_changes(self) -> Map<String, Value> {
        self.changes
    }
}
impl Serialize for ProfileSaveInput<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let base = self
            .base
            .as_object()
            .ok_or_else(|| serde::ser::Error::custom("Invalid native profile source"))?;
        let mut output = serializer.serialize_map(None)?;
        for (key, value) in base {
            output.serialize_entry(key, self.changes.get(key).unwrap_or(value))?;
        }
        for (key, value) in &self.changes {
            if !base.contains_key(key) {
                output.serialize_entry(key, value)?;
            }
        }
        output.end()
    }
}
fn number(value: f64) -> Result<Value, ProfileFormError> {
    if !value.is_finite() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&javascript_json::number_text(value))
        .map_err(|_| profile_form::shape_error().into())
}
pub(super) fn employment_model(profile: &Value, model: &Value) -> Map<String, Value> {
    let fallback = |key: &str| {
        profile["workPattern"]
            .get(key)
            .filter(|value| !value.is_null())
            .cloned()
            .unwrap_or(json!("UNKNOWN"))
    };
    let work_pattern = if model["coverage"] == fallback("workplaceCoverage")
        && model["assignment"] == fallback("assignment")
    {
        profile
            .get("workPattern")
            .filter(|value| !value.is_null())
            .cloned()
            .unwrap_or(Value::Null)
    } else {
        json!({"workplaceCoverage":model["coverage"],"assignment":model["assignment"]})
    };
    [
        ("regularRotatingNightWork".into(), model["night"].clone()),
        ("sundayHolidayWorkEligible".into(), model["sunday"].clone()),
        (
            "allEmploymentWorkRecorded".into(),
            model["recorded"].clone(),
        ),
        ("workPattern".into(), work_pattern),
    ]
    .into_iter()
    .collect()
}
pub(super) struct SaveDraft<'a> {
    pub profile: &'a Value,
    pub draft: &'a Value,
    pub initial: &'a Value,
    pub section: EditorSection,
    pub touched: bool,
}
pub(super) fn build<'a>(
    facts: SaveDraft<'a>,
    date: &str,
    final_stage: bool,
    resolver: &RuleResolver,
) -> Result<ProfileSaveInput<'a>, ProfileFormError> {
    let SaveDraft {
        profile,
        draft,
        initial,
        section,
        touched,
    } = facts;
    let mode = model::text(draft, "salaryMode");
    let full_time = preview::full_time(draft, date, resolver)?;
    let weekly = form_number::parse_weekly_hours(model::text(draft, "weeklyHours"))?;
    if final_stage
        && (touched
            || (model::edit_work(section)
                && weekly
                    != profile["weeklyMinutes"]
                        .as_f64()
                        .ok_or_else(profile_form::shape_error)?))
        && [
            "TVAOED_PFLEGE",
            "TVAL_PFLEGE",
            "TVL_KR",
            "TVUK_NURSING",
            "TVH_KR",
        ]
        .contains(&mode)
        && weekly > full_time
    {
        return Err(InputError::validation(
            "Deine Wochenstunden liegen über der tariflichen Vollzeit. Bitte deine Angaben prüfen.",
        )
        .into());
    }
    let manual = profile_form::parse_manual_monthly_gross(model::text(draft, "manualMonthlyGross"));
    let p_tariff = json!({"payGroup":draft["payGroup"],"payLevel":if draft["payLevel"]=="UNSET"{initial["payLevel"].clone()}else{draft["payLevel"].clone()},"sector":draft["sector"],"tariffRegion":draft["tariffRegion"],"fullTimeWeeklyMinutes":number(full_time)?});
    let (tariff, manual) = if !touched || mode == "UNSET" {
        (
            profile["tariff"].clone(),
            profile
                .get("manualMonthlyGrossCents")
                .cloned()
                .unwrap_or(Value::Null),
        )
    } else if mode == "MANUAL" {
        (Value::Null, json!(manual))
    } else if [
        "TVAOED_PFLEGE",
        "TVOED_E",
        "TVL_KR",
        "TVUK_NURSING",
        "TVH_KR",
        "TVAL_PFLEGE",
    ]
    .contains(&mode)
    {
        (Value::Null, Value::Null)
    } else {
        (p_tariff, Value::Null)
    };
    let mut changes = Map::new();
    for key in ["federalState", "holidayRegion"] {
        changes.insert(key.into(), draft[key].clone());
    }
    changes.insert("weeklyMinutes".into(), number(weekly)?);
    changes.insert("timeZone".into(), profile["timeZone"].clone());
    changes.insert(
        "industry".into(),
        if draft["industry"] == "UNKNOWN" {
            Value::Null
        } else {
            draft["industry"].clone()
        },
    );
    changes.insert("manualMonthlyGrossCents".into(), manual);
    if model::edit_model(section) {
        changes.extend(employment_model(profile, &draft["model"]));
    }
    changes.insert("tariff".into(), tariff);
    let family = |field: &str, selected: bool, value: Value| {
        if !touched {
            profile.get(field).cloned().unwrap_or(Value::Null)
        } else if selected {
            value
        } else {
            Value::Null
        }
    };
    changes.insert("vkaETariff".into(),family("vkaETariff",mode=="TVOED_E"&&draft["payLevel"]!="UNSET",json!({"payGroup":draft["ePayGroup"],"payLevel":draft["payLevel"],"sector":draft["sector"],"tariffRegion":draft["tariffRegion"]})));
    changes.insert("tvhKrTariff".into(),family("tvhKrTariff",mode=="TVH_KR"&&draft["tvhPayLevel"]!="UNSET",json!({"payGroup":draft["tvhPayGroup"],"payLevel":draft["tvhPayLevel"],"fullTimeWeeklyMinutes":draft["tvhFullTimeWeeklyMinutes"]})));
    changes.insert(
        "tvUkNursingTariff".into(),
        family(
            "tvUkNursingTariff",
            mode == "TVUK_NURSING" && draft["tvUkPayLevel"] != "UNSET",
            json!({"payGroup":draft["tvUkPayGroup"],"payLevel":draft["tvUkPayLevel"]}),
        ),
    );
    changes.insert("tvlKrTariff".into(),family("tvlKrTariff",mode=="TVL_KR"&&draft["payLevel"]!="UNSET",json!({"payGroup":draft["krPayGroup"],"payLevel":draft["payLevel"],"universityRegion":draft["tvlUniversityRegion"]})));
    let mut tval = json!({"trainingYear":draft["trainingYear"],"universityRegion":draft["tvlUniversityRegion"]});
    let scope = profile_form::tval_workplace_fields(
        model::text(draft, "tvalWorkplace"),
        profile.get("tvalPflegeTariff"),
        draft["tvalWorkplace"] != initial["tvalWorkplace"],
    );
    tval.as_object_mut()
        .ok_or_else(profile_form::shape_error)?
        .extend(
            scope
                .as_object()
                .ok_or_else(profile_form::shape_error)?
                .clone(),
        );
    changes.insert(
        "tvalPflegeTariff".into(),
        family(
            "tvalPflegeTariff",
            mode == "TVAL_PFLEGE" && draft["trainingYear"] != "UNSET",
            tval,
        ),
    );
    changes.insert("nursingTrainingTariff".into(),family("nursingTrainingTariff",mode=="TVAOED_PFLEGE"&&draft["trainingYear"]!="UNSET",json!({"trainingYear":draft["trainingYear"],"sector":draft["sector"],"tariffRegion":draft["tariffRegion"]})));
    Ok(ProfileSaveInput::new(profile, changes))
}
