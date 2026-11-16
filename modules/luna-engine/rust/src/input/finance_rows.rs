//! Checked original finance SQL facts. Read state and coverage stay outside the
//! opaque factories; no client financial result or Ready flag is accepted.
use super::{InputError, calendar, precise_instant_nanoseconds, raw_json};
use crate::net::{payment_schedule, settings};
use serde_json::{Value, json};
use std::{collections::BTreeSet, sync::Arc};
pub const NET_PAY_ROW_FIELDS: &[&str] = &[
    "month",
    "settings_json",
    "revision",
    "created_at",
    "updated_at",
];
fn error(message: &str) -> InputError {
    InputError::source(message, "Error")
}
fn exact(row: &Value, keys: &[&str]) -> bool {
    row.as_object()
        .is_some_and(|row| row.len() == keys.len() && keys.iter().all(|key| row.contains_key(*key)))
}
fn json_text(raw: &str, message: &str) -> Result<Value, InputError> {
    raw_json::parse(raw).map_err(|_| InputError::source(message, "SyntaxError"))
}
fn settings_error(error: settings::SettingsError) -> InputError {
    let name = if matches!(error, settings::SettingsError::Profile) {
        "NetPayProfileValidationError"
    } else {
        "Error"
    };
    InputError::source(error.to_string(), name)
}
pub fn normalize_net_pay_profile(value: &Value) -> Result<Value, InputError> {
    settings::validate_monthly_net_pay_settings(value).map_err(settings_error)
}
pub fn map_net_pay_profile_row(row: &Value) -> Result<Value, InputError> {
    if !exact(row, NET_PAY_ROW_FIELDS)
        || !row["settings_json"].is_string()
        || !row["revision"]
            .as_f64()
            .is_some_and(|n| n.fract() == 0.0 && (1.0..=9007199254740991.0).contains(&n))
        || !row["created_at"].is_string()
        || !row["updated_at"].is_string()
    {
        return Err(error("Ungültiges gespeichertes Netto-Profil."));
    }
    let parsed = json_text(
        row["settings_json"].as_str().expect("checked JSON"),
        "Das gespeicherte Netto-Profil konnte nicht gelesen werden.",
    )?;
    let settings = settings::validate_monthly_net_pay_settings(&parsed).map_err(settings_error)?;
    if settings["month"] != row["month"] {
        return Err(error("Monatsbindung des Netto-Profils ist ungültig."));
    }
    let timestamp_error = || {
        InputError::source(
            "Ein Zeitstempel des Netto-Profils ist ungültig.",
            "RangeError",
        )
    };
    let created =
        precise_instant_nanoseconds(row["created_at"].as_str().expect("checked timestamp"))
            .ok_or_else(timestamp_error)?;
    let updated =
        precise_instant_nanoseconds(row["updated_at"].as_str().expect("checked timestamp"))
            .ok_or_else(timestamp_error)?;
    if created > updated {
        return Err(error("Zeitfolge des Netto-Profils ist ungültig."));
    }
    Ok(
        json!({"settings":settings,"revision":row["revision"].as_f64().expect("safe revision") as u64,"createdAt":row["created_at"],"updatedAt":row["updated_at"]}),
    )
}
pub struct RawNetPayTimeline {
    raw: Arc<Vec<Value>>,
    timeline: Arc<Vec<Value>>,
}
impl RawNetPayTimeline {
    pub fn try_from_rows(raw: Arc<Vec<Value>>) -> Result<Self, InputError> {
        if raw.len() > 50000 {
            return Err(InputError::validation(
                "Die gespeicherten Netto-Profile sind zu groß.",
            ));
        }
        let mut months = BTreeSet::new();
        let mut timeline = Vec::with_capacity(raw.len());
        for row in raw.iter() {
            let value = map_net_pay_profile_row(row)?;
            if !months.insert(
                value["settings"]["month"]
                    .as_str()
                    .expect("mapped month")
                    .to_owned(),
            ) {
                return Err(InputError::validation(
                    "Für einen Monat liegen mehrere Netto-Profile vor.",
                ));
            }
            timeline.push(value);
        }
        timeline.sort_by(|a, b| {
            a["settings"]["month"]
                .as_str()
                .cmp(&b["settings"]["month"].as_str())
        });
        Ok(Self {
            raw,
            timeline: Arc::new(timeline),
        })
    }
    pub fn raw_rows(&self) -> &Arc<Vec<Value>> {
        &self.raw
    }
    pub fn timeline(&self) -> &Arc<Vec<Value>> {
        &self.timeline
    }
    pub fn resolve(&self, month: &str) -> Result<Value, InputError> {
        settings::resolve_net_pay_settings(month, &self.timeline).map_err(settings_error)
    }
}
pub struct RawSalaryPaymentPreferences {
    raw: Option<Arc<Value>>,
    preferences: Arc<Value>,
}
impl RawSalaryPaymentPreferences {
    /// None means a successful query with no stored preference row. A failed or
    /// unread source must never call this constructor as a substitute default.
    pub fn try_from_row(raw: Option<Arc<Value>>) -> Result<Self, InputError> {
        let value = if let Some(row) = &raw {
            if !exact(row, &["value"]) || !row["value"].is_string() {
                return Err(error("Die gespeicherten Auszahlungsangaben sind ungültig."));
            }
            json_text(
                row["value"].as_str().expect("checked preference"),
                "Die gespeicherten Auszahlungsangaben konnten nicht gelesen werden.",
            )?
        } else {
            json!({"version":1,"periods":[],"reviewedEmptyMonths":[],"socialInsuranceAttribution":"UNKNOWN"})
        };
        let preferences = payment_schedule::validate_salary_payment_preferences(&value)
            .map_err(|e| InputError::source(e.to_string(), "SalaryPaymentValidationError"))?;
        let preferences = serde_json::to_value(preferences)
            .map_err(|_| error("Die gespeicherten Auszahlungsangaben sind ungültig."))?;
        Ok(Self {
            raw,
            preferences: Arc::new(preferences),
        })
    }
    pub fn raw_row(&self) -> Option<&Arc<Value>> {
        self.raw.as_ref()
    }
    pub fn preferences(&self) -> &Arc<Value> {
        &self.preferences
    }
}
pub struct RawTestMonths {
    raw: Arc<Vec<Value>>,
    ordered: Vec<String>,
    months: BTreeSet<String>,
}
impl RawTestMonths {
    pub fn try_from_rows(raw: Arc<Vec<Value>>) -> Result<Self, InputError> {
        if raw.len() > 50000 {
            return Err(InputError::validation(
                "Die gespeicherten Testmonate sind zu groß.",
            ));
        }
        let mut months = BTreeSet::new();
        for row in raw.iter() {
            if !exact(row, &["month"]) {
                return Err(InputError::validation(
                    "Die gespeicherten Testmonatszeilen sind ungültig.",
                ));
            }
            let month = calendar::require_local_month(&row["month"])?;
            if !months.insert(month) {
                return Err(InputError::validation(
                    "Ein gespeicherter Testmonat ist mehrfach vorhanden.",
                ));
            }
        }
        let ordered = months.iter().cloned().collect();
        Ok(Self {
            raw,
            ordered,
            months,
        })
    }
    pub fn raw_rows(&self) -> &Arc<Vec<Value>> {
        &self.raw
    }
    pub fn months(&self) -> &BTreeSet<String> {
        &self.months
    }
    pub fn ordered_months(&self) -> &[String] {
        &self.ordered
    }
}
