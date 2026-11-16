use super::{ProfileFormError, ProfileSaveInput};
use crate::{
    employment::EMPLOYMENT_FIELDS,
    input::{
        javascript_json,
        profile_form::{self, FormClock},
    },
};
use serde_json::{Map, Value};
/// Native borrowed source/draft field access, never a host Ready-profile DTO.
pub trait ProfileFields {
    fn field(&self, key: &str) -> Option<&Value>;
}
impl ProfileFields for Value {
    fn field(&self, key: &str) -> Option<&Value> {
        self.get(key)
    }
}
impl ProfileFields for ProfileSaveInput<'_> {
    fn field(&self, key: &str) -> Option<&Value> {
        self.field(key)
    }
}
pub(super) fn capture(profile: &impl ProfileFields) -> Value {
    let mut result = Map::new();
    for key in EMPLOYMENT_FIELDS
        .iter()
        .copied()
        .chain(std::iter::once("workPattern"))
    {
        result.insert(
            key.into(),
            profile.field(key).cloned().unwrap_or(Value::Null),
        );
    }
    Value::Object(result)
}
fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len() && a.iter().all(|(k, a)| b.get(k).is_some_and(|b| same(a, b)))
        }
        _ => a == b,
    }
}
pub fn changed_fields(
    before: &impl ProfileFields,
    after: &impl ProfileFields,
) -> Result<Vec<String>, ProfileFormError> {
    // Checked employment/tariff fields have fixed distinct schema keys. The
    // source's locale-sorted JSON equality is independent of their insertion order.
    Ok(EMPLOYMENT_FIELDS
        .iter()
        .copied()
        .chain(std::iter::once("workPattern"))
        .filter(|key| {
            !same(
                before.field(key).unwrap_or(&Value::Null),
                after.field(key).unwrap_or(&Value::Null),
            )
        })
        .map(str::to_owned)
        .collect())
}
pub(super) struct Merged<'a, B, A> {
    pub before: &'a B,
    pub after: &'a A,
}
impl<B: ProfileFields, A: ProfileFields> ProfileFields for Merged<'_, B, A> {
    fn field(&self, key: &str) -> Option<&Value> {
        self.after.field(key).or_else(|| self.before.field(key))
    }
}
pub(super) fn string(value: Option<&Value>) -> String {
    match value {
        None => "undefined".into(),
        Some(Value::Null) => "null".into(),
        Some(Value::String(v)) => v.clone(),
        Some(Value::Bool(v)) => v.to_string(),
        Some(Value::Number(v)) => javascript_json::number_text(v.as_f64().unwrap_or(f64::NAN)),
        Some(Value::Array(v)) => v
            .iter()
            .map(|v| {
                if v.is_null() {
                    String::new()
                } else {
                    string(Some(v))
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Some(Value::Object(_)) => "[object Object]".into(),
    }
}
fn workplace(profile: &impl ProfileFields, clock: &FormClock) -> Result<String, ProfileFormError> {
    profile_form::tval_workplace_from_values(
        profile.field("tvalPflegeTariff"),
        profile.field("employmentTimeline"),
        profile.field("timeZone"),
        None,
        clock,
    )
}
fn workplace_label(choice: &str) -> Result<&'static str, ProfileFormError> {
    match choice {
        "GENERAL" => Ok("Anderer Arbeitsbereich"),
        "SECTION_43" => Ok("Krankenhaus / ärztliche Behandlung"),
        "UNKNOWN" => Ok("Noch nicht geklärt"),
        _ => Err(profile_form::shape_error().into()),
    }
}
fn format(profile: &impl ProfileFields, key: &str) -> Result<String, ProfileFormError> {
    let value = profile.field(key).unwrap_or(&Value::Null);
    Ok(match key {
        "weeklyMinutes" => format!(
            "{} Std.",
            javascript_json::number_text(value.as_f64().unwrap_or(0.0) / 60.0)
                .replacen('.', ",", 1)
        ),
        "federalState" => super::labels::state(value.as_str()).into(),
        "holidayRegion" => super::labels::holiday(value.as_str()).into(),
        "industry" => {
            if crate::net::js_truthy(value) {
                super::labels::industry(value.as_str()).into()
            } else {
                "Noch offen".into()
            }
        }
        "workPattern" => {
            if crate::net::js_truthy(value) {
                format!(
                    "{} · {}",
                    match value["workplaceCoverage"].as_str() {
                        Some("AROUND_THE_CLOCK") => "24/7",
                        Some("NOT_AROUND_THE_CLOCK") => "Nicht 24/7",
                        _ => "Ungeklärt",
                    },
                    match value["assignment"].as_str() {
                        Some("PERMANENT") => "Dauerhaft",
                        Some("TEMPORARY") => "Gelegentlich",
                        _ => "Ungeklärt",
                    }
                )
            } else {
                "Noch offen".into()
            }
        }
        _ => {
            if value == true {
                "Ja".into()
            } else if value == false {
                "Nein".into()
            } else if value.is_null() {
                "Noch offen".into()
            } else {
                string(Some(value))
            }
        }
    })
}
fn field_label(key: &str) -> &'static str {
    match key {
        "timeZone" => "Zeitzone",
        "weeklyMinutes" => "Wochenstunden",
        "federalState" => "Bundesland",
        "holidayRegion" => "Regionale Feiertage",
        "industry" => "Arbeitsbereich",
        "regularRotatingNightWork" => "Regelmäßige Nachtarbeit",
        "sundayHolidayWorkEligible" => "Sonn- und Feiertagsarbeit",
        "allEmploymentWorkRecorded" => "Alle Arbeitszeiten erfasst",
        "workPattern" => "Schichtmodell",
        _ => "undefined",
    }
}
pub fn change_lines(
    before: &impl ProfileFields,
    after: &impl ProfileFields,
    clock: &FormClock,
) -> Result<Vec<String>, ProfileFormError> {
    let fields = changed_fields(before, after)?;
    let merged = Merged { before, after };
    let tval_before = before.field("tvalPflegeTariff").unwrap_or(&Value::Null);
    let tval_after = after.field("tvalPflegeTariff").unwrap_or(&Value::Null);
    let workplace_changed = crate::net::js_truthy(tval_before)
        && crate::net::js_truthy(tval_after)
        && workplace(before, clock)? != workplace(&merged, clock)?;
    let only_workplace = workplace_changed
        && same(&tval_before["trainingYear"], &tval_after["trainingYear"])
        && same(
            &tval_before["universityRegion"],
            &tval_after["universityRegion"],
        );
    let salary_fields = crate::input::profile::SALARY_FIELDS;
    let mut result = Vec::new();
    if fields.iter().any(|key| {
        salary_fields.contains(&key.as_str()) && !(only_workplace && key == "tvalPflegeTariff")
    }) {
        result.push(format!(
            "Tarif & Gehalt: {} → {}",
            super::salary_label(before)?,
            super::salary_label(&merged)?
        ));
    }
    if workplace_changed {
        result.push(format!(
            "Arbeitsbereich: {} → {}",
            workplace_label(&workplace(before, clock)?)?,
            workplace_label(&workplace(&merged, clock)?)?
        ));
    }
    for key in fields
        .iter()
        .filter(|key| !salary_fields.contains(&key.as_str()))
    {
        result.push(format!(
            "{}: {} → {}",
            field_label(key),
            format(before, key)?,
            format(after, key)?
        ));
    }
    Ok(result)
}
