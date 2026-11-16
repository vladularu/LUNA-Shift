//! Closed SQL-plan bodies produced only from checked native editor sources.
//! The common resource binds these bodies to its private stamp/single-use permit.
use crate::input::{
    InputError,
    finance_rows::{RawNetPayTimeline, RawSalaryPaymentPreferences},
    javascript_date, javascript_json,
    net_form::InitialNetSettings,
    payroll_form, precise_instant_nanoseconds,
};
use crate::net::payment_schedule::{PaymentPreferences, validate_salary_payment_preferences};
use serde_json::{Value, json};
use std::sync::Arc;

const MAX_SAFE: u64 = 9_007_199_254_740_991;
fn error(message: &'static str) -> InputError {
    InputError::source(message, "Error")
}
fn conflict() -> InputError {
    InputError::source(
        "Das Netto-Profil wurde zwischenzeitlich geändert. Lade den Monat erneut.",
        "NetPayProfileConflictError",
    )
}
fn version(row: &Value) -> Value {
    json!({"revision":row["revision"],"created_at":row["createdAt"],"updated_at":row["updatedAt"]})
}
pub struct NativePayrollWritePlan(Value);
impl NativePayrollWritePlan {
    pub fn value(&self) -> &Value {
        &self.0
    }
}
impl std::fmt::Debug for NativePayrollWritePlan {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NativePayrollWritePlan")
            .finish_non_exhaustive()
    }
}
pub struct NetPlanSource {
    timeline: Arc<RawNetPayTimeline>,
    raw_epoch: f64,
}
impl NetPlanSource {
    pub fn new(timeline: Arc<RawNetPayTimeline>, raw_epoch: f64) -> Self {
        Self {
            timeline,
            raw_epoch,
        }
    }
    fn write(&self, settings: &Value, previous: Option<&Value>) -> Result<Value, InputError> {
        let now = javascript_date::iso_from_epoch_milliseconds(self.raw_epoch)?;
        let now_ns =
            precise_instant_nanoseconds(&now).ok_or_else(|| error("Invalid time value"))?;
        let previous_updated = previous
            .map(|row| row["updatedAt"].as_str().ok_or_else(conflict))
            .transpose()?;
        let updated = match previous_updated {
            Some(old) if precise_instant_nanoseconds(old).ok_or_else(conflict)? > now_ns => old,
            _ => &now,
        };
        let revision = previous
            .map_or(Some(1), |row| {
                row["revision"]
                    .as_u64()
                    .and_then(|revision| revision.checked_add(1))
            })
            .filter(|revision| *revision <= MAX_SAFE)
            .ok_or_else(conflict)?;
        let created = previous
            .map(|row| row["createdAt"].as_str().ok_or_else(conflict))
            .transpose()?
            .unwrap_or(updated);
        let settings_json = javascript_json::stringify(settings).map_err(|_| conflict())?;
        Ok(
            json!({"kind":"UPSERT_NET_PAY_PROFILE","row":{"month":settings["month"],"settings_json":settings_json,"revision":revision,"created_at":created,"updated_at":updated},"expected":previous.map(version)}),
        )
    }
    pub fn continuous_save(
        &self,
        draft: &InitialNetSettings,
    ) -> Result<NativePayrollWritePlan, InputError> {
        if draft.settings()["version"] != 2 {
            return Err(error("Das fortgeltende Netto-Profil fehlt."));
        }
        let january = if self.timeline.timeline().is_empty() {
            let mut value = draft.settings().clone();
            let month = value["month"].as_str().ok_or_else(conflict)?;
            value["month"] = json!(format!("{}-01", &month[..4]));
            Some(InitialNetSettings::try_from_raw(&value)?)
        } else {
            None
        };
        let settings = january.as_ref().unwrap_or(draft).settings();
        let previous = self
            .timeline
            .timeline()
            .iter()
            .find(|row| row["settings"]["month"] == settings["month"]);
        let mutation = self.write(settings, previous)?;
        Ok(NativePayrollWritePlan(
            json!({"schemaVersion":1,"guards":[{"kind":"NO_TEST_MONTHS_FROM","month":settings["month"]},{"kind":"PROFILE_PRESENT"}],"mutations":[mutation]}),
        ))
    }
    pub fn reset_annual(&self, year: i32) -> Result<NativePayrollWritePlan, InputError> {
        if !(1900..=4099).contains(&year) {
            return Err(error("Ungültiges Auszahlungsjahr."));
        }
        let mut mutations = Vec::new();
        for row in self.timeline.timeline().iter() {
            let settings = InitialNetSettings::try_from_raw(&row["settings"])?;
            for next in payroll_form::reset_annual_settings(year, std::slice::from_ref(&settings))?
            {
                mutations.push(self.write(&next, Some(row))?);
            }
        }
        Ok(NativePayrollWritePlan(
            json!({"schemaVersion":1,"guards":[{"kind":"NO_TEST_MONTHS"},{"kind":"PROFILE_PRESENT"}],"mutations":mutations}),
        ))
    }
}
pub struct TimingPlanSource {
    previous: Option<Value>,
    preferences: PaymentPreferences,
    raw_epoch: f64,
}
impl TimingPlanSource {
    /// The private capture queries the fixed salary_payment_v1 key. This raw
    /// metadata row is separate from the original value-only report snapshot.
    pub fn from_raw_row(row: Option<&Value>, raw_epoch: f64) -> Result<Self, InputError> {
        if row.is_some_and(|row| {
            !row.as_object().is_some_and(|object| {
                object.len() == 2
                    && object.contains_key("value")
                    && object.contains_key("updated_at")
            }) || !row["value"].is_string()
                || !row["updated_at"].is_string()
        }) {
            return Err(error("Die gespeicherten Auszahlungsangaben sind ungültig."));
        }
        let source = RawSalaryPaymentPreferences::try_from_row(
            row.map(|value| Arc::new(json!({"value":value["value"]}))),
        )?;
        let preferences = validate_salary_payment_preferences(source.preferences())
            .map_err(|failure| InputError::source(failure.to_string(), "Error"))?;
        Ok(Self {
            previous: row.cloned(),
            preferences,
            raw_epoch,
        })
    }
    pub fn set_lag(&self, month: &str, choice: &str) -> Result<NativePayrollWritePlan, InputError> {
        let next = payroll_form::prepare_timing(&self.preferences, month, choice)?;
        let value = serde_json::to_value(next).map_err(|_| conflict())?;
        let value = javascript_json::stringify(&value).map_err(|_| conflict())?;
        let now = javascript_date::iso_from_epoch_milliseconds(self.raw_epoch)?;
        Ok(NativePayrollWritePlan(
            json!({"schemaVersion":1,"guards":[],"mutations":[{"kind":"UPSERT_PREFERENCE","key":"salary_payment_v1","row":{"value":value,"updated_at":now},"expected":self.previous}]}),
        ))
    }
}
