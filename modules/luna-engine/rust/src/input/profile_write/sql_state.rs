use super::{PreferenceWrite, sql::ProfileWriteError};
use crate::input::{
    InputError, employment::RawEmploymentHistory, personal_context, stored_profile,
};
use serde_json::{Value, json};
use std::sync::{Arc, OnceLock};
#[derive(Clone)]
pub(super) struct State {
    profile: Option<Arc<Value>>,
    history: Vec<Arc<Value>>,
    preferences: Vec<Arc<Value>>,
    tests: Vec<Arc<Value>>,
    mapped: Arc<OnceLock<Result<Arc<RawEmploymentHistory>, InputError>>>,
    pub ops: Vec<Value>,
    pub guards: Vec<Value>,
}
fn array(
    raw: &mut serde_json::Map<String, Value>,
    key: &str,
) -> Result<Vec<Arc<Value>>, InputError> {
    let Value::Array(values) = raw.remove(key).ok_or_else(super::invalid)? else {
        return Err(super::invalid());
    };
    if values.len() > 50_000 {
        return Err(super::invalid());
    };
    Ok(values.into_iter().map(Arc::new).collect())
}
impl State {
    pub fn new(raw: Value) -> Result<Self, InputError> {
        let Value::Object(mut raw) = raw else {
            return Err(super::invalid());
        };
        if raw.len() != 4 {
            return Err(super::invalid());
        }
        let profiles = array(&mut raw, "userProfile")?;
        if profiles.len() > 1 {
            return Err(super::invalid());
        };
        let profile = profiles.into_iter().next();
        if profile
            .as_ref()
            .is_some_and(|p| p["id"] != "singleton" || !p.is_object())
        {
            return Err(super::invalid());
        };
        let history = array(&mut raw, "history")?;
        let preferences = array(&mut raw, "preferences")?;
        let tests = array(&mut raw, "testMonths")?;
        for row in &preferences {
            if !row.as_object().is_some_and(|r| {
                r.len() == 3
                    && ["key", "value", "updated_at"]
                        .iter()
                        .all(|key| r.get(*key).is_some_and(Value::is_string))
            }) {
                return Err(super::invalid());
            }
        }
        Ok(Self {
            profile,
            history,
            preferences,
            tests,
            mapped: Arc::new(OnceLock::new()),
            ops: vec![],
            guards: vec![],
        })
    }
    pub fn reference(&self) -> Value {
        let mut history = self
            .history
            .iter()
            .map(AsRef::as_ref)
            .collect::<Vec<&Value>>();
        history.sort_by(|a, b| {
            a["effective_from"]
                .as_str()
                .cmp(&b["effective_from"].as_str())
        });
        let mut preferences = self
            .preferences
            .iter()
            .map(AsRef::as_ref)
            .collect::<Vec<&Value>>();
        preferences.sort_by(|a, b| a["key"].as_str().cmp(&b["key"].as_str()));
        let mut tests = self
            .tests
            .iter()
            .map(AsRef::as_ref)
            .collect::<Vec<&Value>>();
        tests.sort_by(|a, b| a["month"].as_str().cmp(&b["month"].as_str()));
        json!({"userProfile":self.profile.iter().map(AsRef::as_ref).collect::<Vec<&Value>>(),"history":history,"preferences":preferences,"testMonths":tests})
    }
    pub fn load_profile(&self) -> Result<Option<Arc<Value>>, InputError> {
        let Some(row) = &self.profile else {
            return Ok(None);
        };
        let mapped = stored_profile::map_profile_row(row)?;
        let salary = self
            .preferences
            .iter()
            .filter(|row| {
                [
                    "salary_tval_pflege",
                    "simpleSalary.tvhKr",
                    "salary_tvuk_nursing",
                    "salary_nursing_training",
                    "salary_vka_e",
                    "salary_tvl_kr",
                ]
                .iter()
                .any(|key| row["key"] == *key)
            })
            .map(|row| json!({"key":row["key"],"value":row["value"]}))
            .collect::<Vec<_>>();
        stored_profile::load_simple_salary_for_profile(&mapped, &salary)
            .map(|p| Some(Arc::new(p)))
            .map_err(|e| InputError::source(e.to_string(), "DataLoadFailure"))
    }
    pub fn profiles(&self) -> Result<Arc<Vec<Value>>, InputError> {
        self.mapped
            .get_or_init(|| {
                let mut rows = self
                    .history
                    .iter()
                    .map(|v| v.as_ref().clone())
                    .collect::<Vec<_>>();
                rows.sort_by(|a, b| {
                    a["effective_from"]
                        .as_str()
                        .cmp(&b["effective_from"].as_str())
                });
                RawEmploymentHistory::try_from_rows(Arc::new(rows)).map(Arc::new)
            })
            .as_ref()
            .map(|v| Arc::clone(v.profiles()))
            .map_err(Clone::clone)
    }
    pub fn pattern(&self) -> Result<Value, InputError> {
        let rows = self
            .preferences
            .iter()
            .filter(|row| {
                row["key"] == "tvoed_workplace_coverage" || row["key"] == "tvoed_assignment"
            })
            .map(AsRef::as_ref)
            .collect::<Vec<&Value>>();
        let mut value = personal_context::load_work_pattern_settings(&json!(rows))
            .map_err(|e| InputError::validation(e.message()))?;
        value
            .as_object_mut()
            .ok_or_else(super::invalid)?
            .remove("updatedAt");
        Ok(value)
    }
    pub fn check_test(&mut self) -> Result<(), InputError> {
        if !self.tests.is_empty() {
            return Err(InputError::validation(
                "Bitte zuerst den offenen Testlauf beenden.",
            ));
        }
        if self.guards.is_empty() {
            self.guards.push(json!({"kind":"NO_TEST_MONTHS"}));
        }
        Ok(())
    }
    pub fn write_profile(
        &mut self,
        input: &impl crate::input::profile_editor::ProfileFields,
        epoch: f64,
    ) -> Result<Arc<Value>, ProfileWriteError> {
        let current = self.load_profile()?;
        let normalized = super::normalize_profile_input(input, current.as_deref())?;
        let now = crate::input::javascript_date::iso_from_epoch_milliseconds(epoch)?;
        let mut rows = super::profile_rows(&normalized, &now)?;
        let expected = self
            .profile
            .as_ref()
            .map(|row| json!({"created_at":row["created_at"],"updated_at":row["updated_at"]}))
            .unwrap_or(Value::Null);
        if let Some(old) = &self.profile {
            rows.work["created_at"] = old["created_at"].clone();
        }
        self.ops
            .push(json!({"kind":"UPSERT_WORK_PROFILE","row":rows.work,"expected":expected}));
        let mut row = self
            .profile
            .as_deref()
            .cloned()
            .unwrap_or_else(|| json!({"id":"singleton"}));
        row.as_object_mut()
            .ok_or_else(super::invalid)?
            .extend(rows.work.as_object().ok_or_else(super::invalid)?.clone());
        self.profile = Some(Arc::new(row));
        for pref in rows.preferences {
            match pref {
                PreferenceWrite::Upsert {
                    key,
                    value,
                    updated_at,
                } => {
                    self.write_preference(key, Some(json!({"value":value,"updated_at":updated_at})))
                }
                PreferenceWrite::Delete { key } => self.write_preference(key, None),
            }?;
        }
        self.load_profile()?.ok_or_else(|| {
            ProfileWriteError::Input(InputError::source(
                "Profil konnte nicht gespeichert werden.",
                "Error",
            ))
        })
    }
    fn write_preference(&mut self, key: &str, next: Option<Value>) -> Result<(), InputError> {
        let index = self.preferences.iter().position(|row| row["key"] == key);
        let expected=index.map(|i|json!({"value":self.preferences[i]["value"],"updated_at":self.preferences[i]["updated_at"]})).unwrap_or(Value::Null);
        match next {
            Some(row) => {
                self.ops.push(
                    json!({"kind":"UPSERT_PREFERENCE","key":key,"row":row,"expected":expected}),
                );
                let mut stored = json!({"key":key});
                stored
                    .as_object_mut()
                    .ok_or_else(super::invalid)?
                    .extend(row.as_object().ok_or_else(super::invalid)?.clone());
                if let Some(i) = index {
                    self.preferences[i] = Arc::new(stored)
                } else {
                    self.preferences.push(Arc::new(stored))
                }
            }
            None => {
                self.ops
                    .push(json!({"kind":"DELETE_PREFERENCE","key":key,"expected":expected}));
                if let Some(i) = index {
                    self.preferences.remove(i);
                }
            }
        }
        Ok(())
    }
    pub fn delete_history(&mut self) {
        self.ops.push(json!({"kind":"DELETE_REMUNERATION_PROFILES","expected":self.history.iter().map(AsRef::as_ref).collect::<Vec<&Value>>() }));
        self.history.clear();
        self.mapped = Arc::new(OnceLock::new());
    }
    pub fn write_history(&mut self, entry: &Value) -> Result<(), InputError> {
        let effective = &entry["effectiveFrom"];
        let id = effective
            .as_str()
            .map_or_else(|| "legacy".to_owned(), |date| format!("from:{date}"));
        let previous = self.history.iter().position(|row| row["id"] == id);
        let data = crate::input::employment::encode_employment_payload(
            &entry["data"],
            entry.get("employment"),
            entry.get("employmentOverrides"),
        )?;
        let mut row = json!({"id":id,"effective_from":effective,"data_json":data,"revision":entry["revision"],"created_at":entry["createdAt"],"updated_at":entry["updatedAt"]});
        let expected=previous.map(|i|{let old=&self.history[i];row["created_at"]=old["created_at"].clone();row["effective_from"]=old["effective_from"].clone();json!({"revision":old["revision"],"created_at":old["created_at"],"updated_at":old["updated_at"]})}).unwrap_or(Value::Null);
        self.ops
            .push(json!({"kind":"UPSERT_REMUNERATION_PROFILE","row":row,"expected":expected}));
        if let Some(i) = previous {
            self.history[i] = Arc::new(row)
        } else {
            self.history.push(Arc::new(row))
        };
        self.mapped = Arc::new(OnceLock::new());
        Ok(())
    }
}
pub(super) fn date_at(profile: &Value, epoch: f64) -> Result<String, InputError> {
    let fail = || InputError::source("Ungültiger Zeitpunkt für die Profilanzeige.", "RangeError");
    if !epoch.is_finite() || epoch.abs() > 8_640_000_000_000_000.0 {
        return Err(fail());
    }
    let zone = crate::time_zone::zone(profile["timeZone"].as_str().ok_or_else(fail)?)
        .map_err(|_| fail())?;
    Ok(jiff::Timestamp::from_millisecond(epoch.trunc() as i64)
        .map_err(|_| fail())?
        .to_zoned(zone)
        .date()
        .to_string())
}
pub(super) fn project(
    state: &State,
    profile: Arc<Value>,
    epoch: f64,
) -> Result<Arc<Value>, InputError> {
    if crate::net::js_truthy(&profile["salaryBasisConflict"]) {
        return Ok(profile);
    }
    let profiles = state.profiles()?;
    if !profiles
        .iter()
        .any(|item| crate::net::js_truthy(&item["employment"]))
        && super::SALARY_KEYS[2..]
            .iter()
            .any(|key| crate::net::js_truthy(&profile[*key]))
    {
        return Ok(profile);
    }
    let date = date_at(&profile, epoch)?;
    crate::input::simple_profile::project_stored_simple_profile(Some(&profile), &profiles, &date)?
        .ok_or_else(super::invalid)
}
