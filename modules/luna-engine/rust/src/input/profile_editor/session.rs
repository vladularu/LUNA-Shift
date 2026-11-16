//! Only raw field/choice intents enter; confirmations and cached mode drafts
//! are always derived and retained inside this native session.
use super::{ProfileEditorSource, ProfileFormError, model, preview};
use crate::{
    input::profile_form::{self, FormClock, ProfileFormSource, shape_error},
    rules::RuleResolver,
};
use serde::Deserialize;
use serde_json::{Map, Value, json};
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EditorField {
    DisplayName,
    EmployerName,
    WeeklyHours,
    Industry,
    TrainingYear,
    TvalWorkplace,
    ManualMonthlyGross,
    TvhFullTimeWeeklyMinutes,
    TvlUniversityRegion,
    HolidayRegion,
    Model,
    Sector,
    TariffRegion,
    FederalState,
}
impl EditorField {
    fn key(self) -> &'static str {
        match self {
            Self::DisplayName => "displayName",
            Self::EmployerName => "employerName",
            Self::WeeklyHours => "weeklyHours",
            Self::Industry => "industry",
            Self::TrainingYear => "trainingYear",
            Self::TvalWorkplace => "tvalWorkplace",
            Self::ManualMonthlyGross => "manualMonthlyGross",
            Self::TvhFullTimeWeeklyMinutes => "tvhFullTimeWeeklyMinutes",
            Self::TvlUniversityRegion => "tvlUniversityRegion",
            Self::HolidayRegion => "holidayRegion",
            Self::Model => "model",
            Self::Sector => "sector",
            Self::TariffRegion => "tariffRegion",
            Self::FederalState => "federalState",
        }
    }
}
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum EditorIntent {
    Field { field: EditorField, value: Value },
    Group { value: String },
    Mode { value: String },
    Level { value: Value },
    Basis { value: String },
}
const MODES: &[&str] = &[
    "UNSET",
    "TVOED_P",
    "TVOED_E",
    "TVL_KR",
    "TVH_KR",
    "TVUK_NURSING",
    "TVAL_PFLEGE",
    "TVAOED_PFLEGE",
    "MANUAL",
];
const SALARY_FIELDS: &[&str] = &[
    "trainingYear",
    "manualMonthlyGross",
    "payGroup",
    "payLevel",
    "sector",
    "tariffRegion",
    "ePayGroup",
    "krPayGroup",
    "tvlUniversityRegion",
    "tvalWorkplace",
    "tvhPayGroup",
    "tvhPayLevel",
    "tvhFullTimeWeeklyMinutes",
    "tvUkPayGroup",
    "tvUkPayLevel",
    "pFullTimeOverride",
];
/// No Deserialize or constructor accepting native caches/confirmations. The
/// eventual runtime resource additionally binds this object to its source owner.
pub struct EditorSession<'s, 'p> {
    pub(super) source: &'s ProfileEditorSource<'p>,
    pub(super) draft: Value,
    salary_drafts: Map<String, Value>,
}
/// No Deserialize; only an existing native session can produce these values.
#[derive(Clone)]
pub(crate) struct NativeEditorState {
    pub(super) draft: Value,
    salary_drafts: Map<String, Value>,
}
impl<'s, 'p> EditorSession<'s, 'p> {
    pub(crate) fn into_native(self) -> NativeEditorState {
        NativeEditorState {
            draft: self.draft,
            salary_drafts: self.salary_drafts,
        }
    }
    pub(crate) fn from_native(
        source: &'s ProfileEditorSource<'p>,
        state: NativeEditorState,
    ) -> Self {
        Self {
            source,
            draft: state.draft,
            salary_drafts: state.salary_drafts,
        }
    }
    pub fn new(source: &'s ProfileEditorSource<'p>) -> Self {
        Self {
            source,
            draft: source.initial.clone(),
            salary_drafts: Map::new(),
        }
    }
    pub fn apply(
        &mut self,
        intent: &EditorIntent,
        date: &str,
        clock: &FormClock,
        resolver: &RuleResolver,
    ) -> Result<(), ProfileFormError> {
        match intent {
            EditorIntent::Field { field, value } => {
                let key = field.key();
                model::validate_field(key, value)?;
                let previous = self.draft[key].clone();
                self.draft[key] = value.clone();
                if matches!(field, EditorField::Sector | EditorField::TariffRegion) {
                    self.draft["pFullTimeOverride"] = Value::Null;
                }
                if matches!(field, EditorField::FederalState) && previous != *value {
                    self.draft["holidayRegion"] = json!(if ["BY", "SN", "TH"]
                        .contains(&value.as_str().ok_or_else(shape_error)?)
                    {
                        "UNKNOWN"
                    } else {
                        "NONE"
                    });
                }
            }
            EditorIntent::Level { value } => {
                let mode = model::text(&self.draft, "salaryMode");
                let key = if mode == "TVH_KR" {
                    "tvhPayLevel"
                } else if mode == "TVUK_NURSING" {
                    "tvUkPayLevel"
                } else {
                    "payLevel"
                };
                model::validate_field(key, value)?;
                self.draft[key] = value.clone();
            }
            EditorIntent::Group { value } => self.select_group(value, date, resolver)?,
            EditorIntent::Mode { value } => self.change_mode(value, date, clock, resolver)?,
            EditorIntent::Basis { value } => {
                if !["MANUAL", "TARIFF"].contains(&value.as_str()) {
                    return Err(shape_error().into());
                }
                let mode = if value == "MANUAL" {
                    "MANUAL".to_owned()
                } else {
                    model::text(&self.draft, "lastTariffMode").to_owned()
                };
                self.change_mode(&mode, date, clock, resolver)?;
            }
        }
        Ok(())
    }
    fn select_group(
        &mut self,
        group: &str,
        date: &str,
        resolver: &RuleResolver,
    ) -> Result<(), ProfileFormError> {
        let view = preview::calculate(self.source, &self.draft, date, resolver)?;
        if !view["groupValues"]
            .as_array()
            .is_some_and(|values| values.iter().any(|value| value.as_str() == Some(group)))
        {
            return Ok(());
        }
        let mode = model::text(&self.draft, "salaryMode").to_owned();
        let confirmed = self.draft["confirmedGroups"]
            .as_array_mut()
            .ok_or_else(shape_error)?;
        if !confirmed.iter().any(|value| value.as_str() == Some(&mode)) {
            confirmed.push(json!(mode));
        }
        let (group_key, level_key) = match mode.as_str() {
            "TVH_KR" => ("tvhPayGroup", "tvhPayLevel"),
            "TVUK_NURSING" => ("tvUkPayGroup", "tvUkPayLevel"),
            "TVL_KR" => ("krPayGroup", "payLevel"),
            "TVOED_E" => ("ePayGroup", "payLevel"),
            _ => ("payGroup", "payLevel"),
        };
        self.draft[group_key] = json!(group);
        let changed = preview::calculate(self.source, &self.draft, date, resolver)?;
        if self.draft[level_key] != "UNSET"
            && !changed["activeLevels"]
                .as_array()
                .is_some_and(|values| values.contains(&self.draft[level_key]))
        {
            self.draft[level_key] = json!("UNSET");
        }
        Ok(())
    }
    fn change_mode(
        &mut self,
        mode: &str,
        date: &str,
        clock: &FormClock,
        resolver: &RuleResolver,
    ) -> Result<(), ProfileFormError> {
        if !MODES.contains(&mode) {
            return Err(shape_error().into());
        }
        let current = model::text(&self.draft, "salaryMode").to_owned();
        if current == mode {
            return Ok(());
        }
        let saved = SALARY_FIELDS
            .iter()
            .map(|key| ((*key).to_owned(), self.draft[*key].clone()))
            .collect::<Map<_, _>>();
        self.salary_drafts.insert(current, Value::Object(saved));
        let cached = self.salary_drafts.get(mode);
        let restored = if let Some(cached) = cached {
            cached.clone()
        } else {
            let form = ProfileFormSource::try_from_raw(self.source.profile)?;
            let mut restored = serde_json::to_value(profile_form::settings_values_for_mode(
                &form,
                mode,
                Some(date),
                clock,
                resolver,
            )?)
            .map_err(|_| shape_error())?;
            if !profile_form::truthy(self.source.profile.get("salaryBasisConflict")) {
                for key in ["sector", "tariffRegion", "tvlUniversityRegion"] {
                    restored[key] = self.draft[key].clone();
                }
            }
            restored
        };
        let had_cached = cached.is_some();
        let p_override = if let Some(cached) = cached {
            cached["pFullTimeOverride"].clone()
        } else {
            self.source
                .profile
                .get("salaryBasisConflict")
                .filter(|value| !value.is_null())
                .unwrap_or(self.source.profile)["tariff"]["fullTimeWeeklyMinutes"]
                .clone()
        };
        self.draft["salaryMode"] = json!(mode);
        if mode != "MANUAL" {
            self.draft["lastTariffMode"] = json!(mode);
        }
        for key in &SALARY_FIELDS[..SALARY_FIELDS.len() - 1] {
            self.draft[*key] = restored[*key].clone();
        }
        self.draft["pFullTimeOverride"] = p_override;
        let confirmed = self.draft["confirmedGroups"]
            .as_array()
            .ok_or_else(shape_error)?
            .iter()
            .any(|value| value.as_str() == Some(mode));
        if !had_cached && !confirmed && mode != "MANUAL" {
            let key = match mode {
                "TVH_KR" => "tvhPayLevel",
                "TVUK_NURSING" => "tvUkPayLevel",
                _ => "payLevel",
            };
            self.draft[key] = json!("UNSET");
        }
        let bases = self
            .source
            .profile
            .get("salaryBasisConflict")
            .filter(|value| !value.is_null())
            .unwrap_or(self.source.profile);
        if !had_cached
            && ((mode == "TVAOED_PFLEGE"
                && !profile_form::truthy(bases.get("nursingTrainingTariff")))
                || (mode == "TVAL_PFLEGE" && !profile_form::truthy(bases.get("tvalPflegeTariff"))))
        {
            self.draft["trainingYear"] = json!("UNSET");
        }
        Ok(())
    }
    pub fn state(&self, date: &str, resolver: &RuleResolver) -> Result<Value, ProfileFormError> {
        let view = preview::calculate(self.source, &self.draft, date, resolver)?;
        let mode = model::text(&self.draft, "salaryMode");
        let confirmed = self.draft["confirmedGroups"]
            .as_array()
            .ok_or_else(shape_error)?
            .iter()
            .any(|value| value.as_str() == Some(mode));
        let holiday_regions_visible = ["BY", "SN", "TH"]
            .contains(&model::text(&self.draft, "federalState"))
            || self.draft["holidayRegion"] == "UNKNOWN";
        let selection = json!({"groupValue":if confirmed{view["activeGroup"].clone()}else{json!("UNSET")},"levelDisabled":!confirmed,"showGroupHint":!confirmed||view["activeLevel"]=="UNSET","holidayRegionsVisible":holiday_regions_visible,"basisValue":if mode=="MANUAL"{"MANUAL"}else{"TARIFF"}});
        Ok(json!({"draft":self.draft,"preview":view,"selection":selection}))
    }
}
