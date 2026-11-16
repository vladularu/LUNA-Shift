//! Original training SQL records. Public constructors accept raw rows only.
use super::{InputError, raw_json, require_instant};
use crate::training::{self, PreparedTrainingProfiles, TrainingError};
use serde_json::{Value, json};
use std::sync::{Arc, OnceLock};
const PROFILE_FIELDS: &[&str] = &["effective_from", "data_json", "revision", "updated_at"];
const DETAIL_FIELDS: &[&str] = &[
    "shift_id",
    "shift_revision",
    "shift_date",
    "shift_updated_at",
    "time_zone",
    "data_json",
    "revision",
    "updated_at",
];
fn error(message: &str) -> InputError {
    InputError::source(message, "Error")
}
pub(super) fn training_error(error: TrainingError) -> InputError {
    let class = match error.name() {
        "ValidationError" => "ValidationError",
        "RemunerationProfileError" => "RemunerationProfileError",
        "RangeError" => "RangeError",
        "TypeError" => "TypeError",
        _ => "Error",
    };
    // These private producer tags represent actual original subclasses of
    // UserFacingError; ordinary Error/Temporal/JSON errors retain their ancestry.
    if matches!(class, "ValidationError" | "RemunerationProfileError") {
        InputError::user_facing_source(error.to_string(), class)
    } else {
        InputError::source(error.to_string(), class)
    }
}
fn exact(value: &Value, fields: &[&str]) -> Result<(), InputError> {
    let Some(_) = value.as_object() else {
        return Err(error("Ungültige Ausbildungsdaten."));
    };
    if !raw_json::exact_sql_columns(value, fields, &["data_json"]) {
        return Err(error("Unbekanntes Format der Ausbildungsdaten."));
    }
    Ok(())
}
fn json_field(row: &Value, message: &str) -> Result<Value, InputError> {
    if !raw_json::sql_json_is_text(row, "data_json") {
        return Err(error(message));
    }
    let parsed = raw_json::parse_sql_json(row, "data_json");
    parsed.map_err(|_| {
        InputError::source(
            "Die gespeicherten Ausbildungsdaten enthalten ungültiges JSON.",
            "SyntaxError",
        )
    })
}
pub fn map_training_profile_row(row: &Value) -> Result<Value, InputError> {
    exact(row, PROFILE_FIELDS)?;
    let data =
        training::validate_training_profile(&json_field(row, "Ungültiges Ausbildungsprofil.")?)
            .map_err(training_error)?;
    if row["effective_from"] != data["effectiveFrom"] {
        return Err(error("Ungültige Profilgültigkeit."));
    }
    let revision = training::training_revision(&row["revision"]).map_err(training_error)?;
    let updated = require_instant(&row["updated_at"], "Profilaktualisierung")?;
    Ok(json!({"data":data,"revision":revision,"updatedAt":updated}))
}
pub fn map_shift_training_row(row: &Value) -> Result<Value, InputError> {
    exact(row, DETAIL_FIELDS)?;
    let data = json_field(row, "Ungültige Schul-/Pausendaten.")?;
    training::validate_saved_shift_training(&json!({
        "shiftId":row["shift_id"],"shiftRevision":row["shift_revision"],"shiftDate":row["shift_date"],
        "shiftUpdatedAt":row["shift_updated_at"],"timeZone":row["time_zone"],"data":data,"revision":row["revision"],"updatedAt":row["updated_at"]
    })).map_err(training_error)
}
pub struct RawTrainingProfiles {
    raw: Arc<Vec<Value>>,
    saved: Arc<Vec<Value>>,
    prepared: OnceLock<Result<Arc<PreparedTrainingProfiles>, InputError>>,
}
impl RawTrainingProfiles {
    pub fn try_from_rows(raw: Arc<Vec<Value>>) -> Result<Self, InputError> {
        if raw.len() > crate::contract::MAX_SOURCE_ITEMS as usize {
            return Err(error("Zu viele Ausbildungsprofile."));
        }
        // SQL BINARY ordering is independent of locale sorting used by screens.
        let mut order = (0..raw.len()).collect::<Vec<_>>();
        order.sort_by(|a, b| {
            raw[*a]["effective_from"]
                .as_str()
                .cmp(&raw[*b]["effective_from"].as_str())
        });
        let saved = order
            .into_iter()
            .map(|i| map_training_profile_row(&raw[i]))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            raw,
            saved: Arc::new(saved),
            prepared: OnceLock::new(),
        })
    }
    pub fn raw_rows(&self) -> &Arc<Vec<Value>> {
        &self.raw
    }
    pub fn saved(&self) -> &Arc<Vec<Value>> {
        &self.saved
    }
    pub fn prepared(&self) -> Result<&Arc<PreparedTrainingProfiles>, InputError> {
        self.prepared
            .get_or_init(|| {
                PreparedTrainingProfiles::try_from_raw(self.saved.as_ref())
                    .map(Arc::new)
                    .map_err(training_error)
            })
            .as_ref()
            .map_err(Clone::clone)
    }
}
pub struct RawShiftTraining {
    raw: Arc<Vec<Value>>,
    saved: Arc<Vec<Value>>,
}
impl RawShiftTraining {
    pub fn try_from_rows(raw: Arc<Vec<Value>>) -> Result<Self, InputError> {
        if raw.len() > crate::contract::MAX_SOURCE_ITEMS as usize {
            return Err(error("Zu viele Schul-/Pausendaten."));
        }
        let mut order = (0..raw.len()).collect::<Vec<_>>();
        order.sort_by(|a, b| {
            raw[*a]["shift_id"]
                .as_str()
                .cmp(&raw[*b]["shift_id"].as_str())
        });
        let saved = order
            .into_iter()
            .map(|i| map_shift_training_row(&raw[i]))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            raw,
            saved: Arc::new(saved),
        })
    }
    pub fn raw_rows(&self) -> &Arc<Vec<Value>> {
        &self.raw
    }
    pub fn saved(&self) -> &Arc<Vec<Value>> {
        &self.saved
    }
}
