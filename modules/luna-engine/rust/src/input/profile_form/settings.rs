use super::{FormClock, InputError, ProfileFormError, shape_error, truthy};
use crate::{
    employment::resolve_remuneration_profile_ref,
    input::net_form::{DecimalScale, parse_decimal},
    pay::families::{Family, profile as family, tvl_tval},
    rules::RuleResolver,
};
use serde::Serialize;
use serde_json::{Value, json};
/// Borrowed raw UserProfile for form display. This checks field shapes without
/// normalizing away salary conflicts or selecting an unrequested winner.
pub struct ProfileFormSource<'a>(&'a Value);
impl<'a> ProfileFormSource<'a> {
    pub fn try_from_raw(raw: &'a Value) -> Result<Self, InputError> {
        if !raw.is_object()
            || !["federalState", "holidayRegion", "timeZone"]
                .iter()
                .all(|k| raw[*k].is_string())
            || raw["weeklyMinutes"].as_f64().is_none()
            || !raw.as_object().is_some_and(|v| v.contains_key("tariff"))
        {
            return Err(shape_error());
        }
        crate::time::zone(raw["timeZone"].as_str().ok_or_else(shape_error)?)
            .map_err(|_| shape_error())?;
        for key in crate::input::profile::SALARY_FIELDS {
            let value = &raw[*key];
            if !value.is_null()
                && if *key == "manualMonthlyGrossCents" {
                    !value.is_number()
                } else {
                    !value.is_object()
                }
            {
                return Err(shape_error());
            }
        }
        for key in [
            "regularRotatingNightWork",
            "sundayHolidayWorkEligible",
            "allEmploymentWorkRecorded",
        ] {
            if !raw[key].is_null() && !raw[key].is_boolean() {
                return Err(shape_error());
            }
        }
        if !raw["salaryBasisConflict"].is_null() && !raw["salaryBasisConflict"].is_object()
            || !raw["employmentTimeline"].is_null() && !raw["employmentTimeline"].is_array()
        {
            return Err(shape_error());
        }
        Ok(Self(raw))
    }
}
#[derive(Serialize)]
#[serde(transparent)]
pub struct SettingsFormState(Value);
static NULL: Value = Value::Null;
#[derive(Clone, Copy)]
struct SalaryView<'a> {
    profile: &'a Value,
    clear: bool,
    selected: Option<(&'static str, &'a Value)>,
}
impl<'a> SalaryView<'a> {
    fn get(&self, key: &str) -> Option<&'a Value> {
        if self.clear && crate::input::profile::SALARY_FIELDS.contains(&key) {
            return Some(
                self.selected
                    .filter(|(field, _)| *field == key)
                    .map(|(_, value)| value)
                    .unwrap_or(&NULL),
            );
        }
        self.profile.get(key)
    }
    fn nested(&self, key: &str, field: &str) -> Option<&'a Value> {
        self.get(key)?.get(field).filter(|v| !v.is_null())
    }
}
fn ordinary<'a>(profile: &ProfileFormSource<'a>) -> SalaryView<'a> {
    SalaryView {
        profile: profile.0,
        clear: false,
        selected: None,
    }
}
fn selected_view<'a>(profile: &ProfileFormSource<'a>, mode: &str) -> SalaryView<'a> {
    if !truthy(profile.0.get("salaryBasisConflict")) {
        return SalaryView {
            profile: profile.0,
            clear: false,
            selected: None,
        };
    }
    let field = match mode {
        "TVOED_P" => Some("tariff"),
        "TVOED_E" => Some("vkaETariff"),
        "TVL_KR" => Some("tvlKrTariff"),
        "TVUK_NURSING" => Some("tvUkNursingTariff"),
        "TVH_KR" => Some("tvhKrTariff"),
        "TVAOED_PFLEGE" => Some("nursingTrainingTariff"),
        "TVAL_PFLEGE" => Some("tvalPflegeTariff"),
        "MANUAL" => Some("manualMonthlyGrossCents"),
        _ => None,
    };
    SalaryView {
        profile: profile.0,
        clear: true,
        selected: field.map(|field| {
            (
                field,
                profile.0["salaryBasisConflict"].get(field).unwrap_or(&NULL),
            )
        }),
    }
}
fn fallback(value: Option<&Value>, default: Value) -> Value {
    value.filter(|v| !v.is_null()).cloned().unwrap_or(default)
}
fn string(value: Option<&Value>) -> Result<&str, InputError> {
    value.and_then(Value::as_str).ok_or_else(shape_error)
}
fn number(value: Option<&Value>) -> Result<f64, InputError> {
    value.and_then(Value::as_f64).ok_or_else(shape_error)
}
fn default_region(state: &str) -> &'static str {
    if state == "BW" { "KAV_BW" } else { "OTHER" }
}
fn format_hours(minutes: f64) -> String {
    (minutes / 60.0).to_string().replace('.', ",")
}
fn form_state(
    view: SalaryView<'_>,
    reference_date: Option<&str>,
    clock: &FormClock,
    resolver: &RuleResolver,
) -> Result<SettingsFormState, ProfileFormError> {
    let state = string(view.get("federalState"))?;
    let tval = truthy(view.get("tvalPflegeTariff"));
    let tvh = truthy(view.get("tvhKrTariff"));
    let tvuk = truthy(view.get("tvUkNursingTariff"));
    let tvl = truthy(view.get("tvlKrTariff"));
    let salary_mode = if tval {
        "TVAL_PFLEGE"
    } else if tvh {
        "TVH_KR"
    } else if tvuk {
        "TVUK_NURSING"
    } else if tvl {
        "TVL_KR"
    } else if truthy(view.get("vkaETariff")) {
        "TVOED_E"
    } else if truthy(view.get("nursingTrainingTariff")) {
        "TVAOED_PFLEGE"
    } else if view
        .get("manualMonthlyGrossCents")
        .is_some_and(|v| !v.is_null())
    {
        "MANUAL"
    } else if view.get("tariff").is_some_and(|v| !v.is_null()) {
        "TVOED_P"
    } else {
        "UNSET"
    };
    let workplace = tval_choice(view, reference_date, clock)?;
    let computed_full = if tval || tvl {
        let date = clock.date_in(string(view.get("timeZone"))?)?;
        tvl_tval::full_time_minutes(
            if tval { Family::Tval } else { Family::Tvl },
            &date,
            view.nested(
                if tval {
                    "tvalPflegeTariff"
                } else {
                    "tvlKrTariff"
                },
                "universityRegion",
            )
            .and_then(Value::as_str)
            .unwrap_or(""),
            resolver,
        )?
        .map(|n| n as f64)
    } else if tvh {
        view.nested("tvhKrTariff", "fullTimeWeeklyMinutes")
            .map(|v| number(Some(v)))
            .transpose()?
    } else if tvuk {
        Some(2310.0)
    } else {
        None
    };
    let full_time = match computed_full {
        Some(v) => v,
        None => match view.nested("tariff", "fullTimeWeeklyMinutes") {
            Some(v) => number(Some(v))?,
            None => family::tariff_full_time_weekly_minutes("BT_K", default_region(state)) as f64,
        },
    };
    let manual = match view.get("manualMonthlyGrossCents").filter(|v| !v.is_null()) {
        Some(v) => format!("{:.2}", number(Some(v))? / 100.0).replace('.', ","),
        None => String::new(),
    };
    Ok(SettingsFormState(json!({
        "federalState":view.get("federalState"),"holidayRegion":view.get("holidayRegion"),"weeklyHours":format_hours(number(view.get("weeklyMinutes"))?),
        "industry":fallback(view.get("industry"),json!("UNKNOWN")),"salaryMode":salary_mode,"manualMonthlyGross":manual,
        "regularRotatingNightWork":evidence_value(view.get("regularRotatingNightWork")),"sundayHolidayWorkEligible":evidence_value(view.get("sundayHolidayWorkEligible")),"allEmploymentWorkRecorded":evidence_value(view.get("allEmploymentWorkRecorded")),
        "trainingYear":fallback(view.nested("tvalPflegeTariff","trainingYear").or_else(||view.nested("nursingTrainingTariff","trainingYear")),json!("UNSET")),"tvalWorkplace":workplace,
        "payGroup":fallback(view.nested("tariff","payGroup"),json!("P8")),"tvhPayGroup":fallback(view.nested("tvhKrTariff","payGroup"),json!("KR8")),"tvhPayLevel":fallback(view.nested("tvhKrTariff","payLevel"),json!(4)),"tvhFullTimeWeeklyMinutes":fallback(view.nested("tvhKrTariff","fullTimeWeeklyMinutes"),json!(2400)),
        "tvUkPayGroup":fallback(view.nested("tvUkNursingTariff","payGroup"),json!("PUK8")),"tvUkPayLevel":fallback(view.nested("tvUkNursingTariff","payLevel"),json!(4)),
        "krPayGroup":fallback(view.nested("tvlKrTariff","payGroup"),json!("KR8")),"tvlUniversityRegion":fallback(view.nested("tvalPflegeTariff","universityRegion").or_else(||view.nested("tvlKrTariff","universityRegion")),json!(if ["BB","MV","SN","ST","TH"].contains(&state){"EAST"}else{"WEST"})),
        "ePayGroup":fallback(view.nested("vkaETariff","payGroup"),json!("E9b")),"payLevel":fallback(view.nested("tvlKrTariff","payLevel").or_else(||view.nested("vkaETariff","payLevel")).or_else(||view.nested("tariff","payLevel")),json!(4)),
        "sector":fallback(view.nested("vkaETariff","sector").or_else(||view.nested("nursingTrainingTariff","sector")).or_else(||view.nested("tariff","sector")),json!("BT_K")),"tariffRegion":fallback(view.nested("vkaETariff","tariffRegion").or_else(||view.nested("nursingTrainingTariff","tariffRegion")).or_else(||view.nested("tariff","tariffRegion")),json!(default_region(state))),"fullTimeHours":format_hours(full_time)
    })))
}
pub fn settings_values(
    profile: &ProfileFormSource<'_>,
    reference_date: Option<&str>,
    clock: &FormClock,
    resolver: &RuleResolver,
) -> Result<SettingsFormState, ProfileFormError> {
    if truthy(profile.0.get("salaryBasisConflict")) {
        return settings_values_for_mode(profile, "UNSET", reference_date, clock, resolver);
    }
    form_state(ordinary(profile), reference_date, clock, resolver)
}
pub fn settings_values_for_mode(
    profile: &ProfileFormSource<'_>,
    mode: &str,
    reference_date: Option<&str>,
    clock: &FormClock,
    resolver: &RuleResolver,
) -> Result<SettingsFormState, ProfileFormError> {
    let mut state = form_state(
        selected_view(profile, mode),
        reference_date,
        clock,
        resolver,
    )?;
    state.0["salaryMode"] = json!(mode);
    Ok(state)
}
pub fn tval_workplace_choice(
    profile: &ProfileFormSource<'_>,
    reference_date: Option<&str>,
    clock: &FormClock,
) -> Result<String, ProfileFormError> {
    tval_choice(ordinary(profile), reference_date, clock)
}
fn tval_choice(
    view: SalaryView<'_>,
    reference_date: Option<&str>,
    clock: &FormClock,
) -> Result<String, ProfileFormError> {
    tval_workplace_from_values(
        view.get("tvalPflegeTariff"),
        view.get("employmentTimeline"),
        view.get("timeZone"),
        reference_date,
        clock,
    )
}
/// Borrowed field seam for native save views, preserving the same date and
/// own-property policy without copying the employment history into a form DTO.
pub(crate) fn tval_workplace_from_values(
    selected: Option<&Value>,
    history: Option<&Value>,
    time_zone: Option<&Value>,
    reference_date: Option<&str>,
    clock: &FormClock,
) -> Result<String, ProfileFormError> {
    let day = if let Some(date) = reference_date {
        date.to_owned()
    } else {
        clock.date_in(string(time_zone)?)?
    };
    if !truthy(selected) {
        return Ok("UNKNOWN".to_owned());
    }
    let selected = selected.ok_or_else(shape_error)?;
    if let Some(scope) = selected.get("employerScope") {
        return Ok(scope.as_str().unwrap_or("UNKNOWN").to_owned());
    }
    let rows = match history.filter(|v| !v.is_null()) {
        Some(v) => v.as_array().ok_or_else(shape_error)?.as_slice(),
        None => &[],
    };
    let resolved = resolve_remuneration_profile_ref(rows, &day)?;
    let financial = resolved.profile.map(|p| &p["data"]["selection"]);
    Ok(if let Some(f) = financial.filter(|f| {
        f["kind"] == "tariff"
            && f["packageId"] == "tval-pflege-tdl"
            && f["variant"] == "CARE"
            && f["group"] == "regular"
            && f["level"]
                .as_str()
                .is_some_and(|s| ["1", "2", "3"].contains(&s))
            && f["region"]
                .as_str()
                .is_some_and(|s| ["WEST_38_5", "EAST", "EAST_UNIVERSITY_HOSPITAL"].contains(&s))
    }) {
        f["tvalEmployerScope"].as_str().unwrap_or("UNKNOWN")
    } else {
        "UNKNOWN"
    }
    .to_owned())
}
pub fn tval_workplace_fields(choice: &str, previous: Option<&Value>, changed: bool) -> Value {
    if choice != "UNKNOWN" {
        json!({"employerScope":choice})
    } else if changed || previous.is_some_and(|p| p.get("employerScope").is_some()) {
        json!({"employerScope":null})
    } else {
        json!({})
    }
}
pub fn parse_manual_monthly_gross(text: &str) -> Option<i64> {
    parse_decimal(text, DecimalScale::Cents, "das Monatsbrutto")
        .ok()
        .filter(|v| *v >= 1)
}
pub fn manual_monthly_gross_error(text: &str) -> Option<&'static str> {
    if parse_manual_monthly_gross(text).is_none() {
        Some("Bitte ein Monatsbrutto zwischen 0,01 € und 100.000 € angeben.")
    } else {
        None
    }
}
pub fn evidence_value(value: Option<&Value>) -> &'static str {
    if value.is_some_and(Value::is_null) {
        "UNKNOWN"
    } else if truthy(value) {
        "YES"
    } else {
        "NO"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn salary_form_borrows_one_large_profile_and_conflict_draft() {
        let profile = json!({"federalState":"NW","holidayRegion":"NONE","weeklyMinutes":2310,"timeZone":"Europe/Berlin","tariff":null,
            "salaryBasisConflict":{"tariff":{"payGroup":"P8","payLevel":4,"sector":"BT_K","tariffRegion":"OTHER","fullTimeWeeklyMinutes":2310}},
            "workingTimeTarget":{"days":vec![json!({"date":"2026-07-01","targetMinutes":462});50_000]}});
        let source = ProfileFormSource::try_from_raw(&profile).unwrap();
        assert!(std::ptr::eq(source.0, &profile));
        let view = selected_view(&source, "TVOED_P");
        assert!(std::ptr::eq(
            view.get("tariff").unwrap(),
            &profile["salaryBasisConflict"]["tariff"]
        ));
        assert!(std::ptr::eq(
            view.get("workingTimeTarget").unwrap(),
            &profile["workingTimeTarget"]
        ));
        let state = settings_values_for_mode(
            &source,
            "TVOED_P",
            None,
            &FormClock::from_instant("2026-07-15T12:00:00Z").unwrap(),
            &RuleResolver::bundled().unwrap(),
        )
        .unwrap();
        assert!(state.0.get("workingTimeTarget").is_none());
        assert_eq!(state.0["fullTimeHours"], "38,5");
    }
}
