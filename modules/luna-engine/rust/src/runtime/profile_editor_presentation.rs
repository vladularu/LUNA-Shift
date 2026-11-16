//! Original save-dialog/history presentation from a native source-bound flow.
//! Cached labels borrow fields; target-capable profiles are never copied here.
use super::profile_editor_flow::{ProfileEditorFlow, ProfileFlowError};
use crate::{
    employment::profile_view::EmploymentProfileRef,
    input::{
        InputError, form_number,
        profile_editor::{ProfileFields, salary_label, work_label},
        profile_form::ProfileFormError,
    },
};
use serde::Serialize;
use serde_json::{Value, json};
use std::sync::{Arc, Weak};
fn invalid() -> ProfileFlowError {
    ProfileFormError::Input(InputError::source(
        "Die Profilansicht konnte nicht erstellt werden.",
        "Error",
    ))
    .into()
}
fn history(profile: &Value) -> Result<&[Value], ProfileFlowError> {
    match profile.get("employmentTimeline") {
        None | Some(Value::Null) => Ok(&[]),
        Some(Value::Array(rows)) => Ok(rows),
        _ => Err(invalid()),
    }
}
fn german_date(value: &str) -> String {
    value.split('-').rev().collect::<Vec<_>>().join(".")
}
fn date(row: &Value) -> Option<&str> {
    row.get("effectiveFrom")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
}
struct Fields<'a>(EmploymentProfileRef<'a>);
impl ProfileFields for Fields<'_> {
    fn field(&self, key: &str) -> Option<&Value> {
        self.0.get(key)
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryRow {
    effective_from: String,
    title: String,
    subtitle: String,
    accessibility_label: String,
}
struct CurrentHistory {
    source: Weak<Value>,
    rows: Vec<HistoryRow>,
}
impl CurrentHistory {
    fn new(profile: &Arc<Value>) -> Result<Self, ProfileFlowError> {
        let mut rows = Vec::new();
        for row in history(profile)? {
            let Some(date) = date(row).filter(|_| crate::net::js_truthy(&row["employment"])) else {
                continue;
            };
            let fields =
                Fields(EmploymentProfileRef::at(profile, date).map_err(ProfileFormError::from)?);
            let display = german_date(date);
            rows.push(HistoryRow {
                effective_from: date.into(),
                title: format!("Ab {display}"),
                subtitle: format!("{} · {}", work_label(&fields)?, salary_label(&fields)?),
                accessibility_label: format!("Angaben ab {display} berichtigen"),
            });
        }
        crate::report::cache_budget::serialized_bytes(&rows, 1_048_576).ok_or_else(invalid)?;
        Ok(Self {
            source: Arc::downgrade(profile),
            rows,
        })
    }
}
struct FutureDates {
    source: Weak<Value>,
    dates: Vec<String>,
}
impl FutureDates {
    fn new(profile: &Arc<Value>) -> Result<Self, ProfileFlowError> {
        // Original future notices deliberately do not require employment.
        let dates = history(profile)?
            .iter()
            .filter_map(date)
            .map(str::to_owned)
            .collect::<Vec<_>>();
        crate::report::cache_budget::serialized_bytes(&dates, 1_048_576).ok_or_else(invalid)?;
        Ok(Self {
            source: Arc::downgrade(profile),
            dates,
        })
    }
}
#[derive(Default)]
pub struct ProfilePresentationCache {
    current: Option<CurrentHistory>,
    base: Option<FutureDates>,
}
impl ProfilePresentationCache {
    pub fn present(
        &mut self,
        flow: &ProfileEditorFlow,
        epoch: i64,
        dirty: bool,
    ) -> Result<Value, ProfileFlowError> {
        self.present_with_state(flow, &flow.ui_state(epoch)?, dirty)
    }
    /// Private caller supplies only state just derived from this exact flow.
    /// There is no deserializable Ready-profile or host-derived dirty input.
    pub(crate) fn present_with_state(
        &mut self,
        flow: &ProfileEditorFlow,
        state: &Value,
        dirty: bool,
    ) -> Result<Value, ProfileFlowError> {
        let current = flow.current();
        if !self
            .current
            .as_ref()
            .is_some_and(|cached| Weak::ptr_eq(&cached.source, &Arc::downgrade(current)))
        {
            self.current = Some(CurrentHistory::new(current)?);
        }
        let saving = state["saving"].as_bool().ok_or_else(invalid)?;
        let current = self.current.as_ref().expect("prepared current history");
        let rows=current.rows.iter().map(|row| json!({"effectiveFrom":row.effective_from,"title":row.title,"subtitle":row.subtitle,"accessibilityLabel":row.accessibility_label,"disabled":saving||dirty})).collect::<Vec<_>>();
        let pending = !state["pending"].is_null();
        let dialog = if pending {
            let scope = state["scope"].as_str();
            let date = state["date"].as_str().ok_or_else(invalid)?;
            let empty = form_number::trim(date).is_empty();
            let label = if scope == Some("all") {
                "Gesamten Zeitraum berichtigen".into()
            } else if scope == Some("date") && !empty {
                format!("Ab {date} speichern")
            } else {
                "Speichern".into()
            };
            let mut future = Vec::new();
            if scope == Some("all") {
                let base = flow.base();
                if !self
                    .base
                    .as_ref()
                    .is_some_and(|cached| Weak::ptr_eq(&cached.source, &Arc::downgrade(base)))
                {
                    self.base = Some(FutureDates::new(base)?);
                }
                let reference = state["referenceDate"].as_str().ok_or_else(invalid)?;
                future = self
                    .base
                    .as_ref()
                    .expect("prepared base dates")
                    .dates
                    .iter()
                    .filter(|date| date.as_str() > reference)
                    .map(|date| {
                        format!(
                            "Geplante Änderung ab {} bleibt erhalten.",
                            german_date(date)
                        )
                    })
                    .collect();
            }
            json!({"title":"Seit wann gelten diese Angaben?","cancelLabel":"Zurück zu deinen Angaben","disabled":saving,"confirm":{"label":label,"disabled":saving||scope.is_none()||(scope==Some("date")&&empty),"busy":saving},"futureNotices":future})
        } else {
            Value::Null
        };
        Ok(
            json!({"dialog":dialog,"feedback":{"message":state["message"],"error":if pending{Value::Null}else{state["error"].clone()},"undo":flow.receipt_profiles().map(|_|json!({"disabled":saving})),"endHistory":state["editingFrom"].as_str().filter(|value|!value.is_empty()).map(|_|json!({"disabled":saving})),"hasHistory":!rows.is_empty(),"history":rows}}),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn target_sized_ignored_metadata_is_never_retained_by_the_label_cache() {
        // This is a cache-only retention fixture, not a Ready-source admission.
        // The independent integration replay uses actual checked Raw3 sources.
        let mut value = json!({"weeklyMinutes":2310,"federalState":"NW","holidayRegion":"UNKNOWN","timeZone":"Europe/Berlin","industry":"HEALTHCARE","manualMonthlyGrossCents":380000,"nightWorkEligible":true,"sundayHolidayWorkEligible":true,"workPatternRecorded":true});
        let employment = crate::employment::capture_employment_profile(&value).unwrap();
        value["employmentTimeline"] =
            json!([{"effectiveFrom":"2026-01-01","employment":employment}]);
        value["workingTimeTarget"] = json!({"days":vec![json!({"date":"2026-01-01","ignoredMetadata":"target-sized benchmark"});50_000]});
        let value = Arc::new(value);
        assert!(serde_json::to_vec(value.as_ref()).unwrap().len() > 1_048_576);
        let weak = Arc::downgrade(&value);
        let current = CurrentHistory::new(&value).unwrap();
        let future = FutureDates::new(&value).unwrap();
        assert_eq!(Arc::strong_count(&value), 1);
        assert!(Weak::ptr_eq(&weak, &current.source));
        assert!(Weak::ptr_eq(&weak, &future.source));
        assert!(serde_json::to_vec(&current.rows).unwrap().len() < 1024);
        drop(value);
        assert!(weak.upgrade().is_none());
        assert_eq!(current.rows[0].effective_from, "2026-01-01");
        assert_eq!(future.dates, vec!["2026-01-01"]);
    }
    #[test]
    fn malformed_history_is_not_relabelled_as_an_empty_ready_history() {
        let profile = Arc::new(json!({"employmentTimeline":false}));
        assert!(CurrentHistory::new(&profile).is_err());
        assert!(FutureDates::new(&profile).is_err());
    }
}
