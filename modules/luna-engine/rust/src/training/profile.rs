use super::{
    TrainingError,
    helpers::{self, date, exact, integer},
};
use crate::{
    input::{self, personal_context::CheckedYouthContext},
    money::MAX_SAFE_INTEGER,
};
use serde_json::{Value, json};
use std::{collections::BTreeSet, sync::Arc};
pub fn training_revision(value: &Value) -> Result<i64, TrainingError> {
    integer(value, 1, MAX_SAFE_INTEGER)
}
pub fn validate_training_profile(value: &Value) -> Result<Value, TrainingError> {
    let version = helpers::version(value);
    let mut keys = vec![
        "version",
        "effectiveFrom",
        "birthDate",
        "fullTimeCompulsorySchooling",
        "status",
        "training",
    ];
    if version == Some(2) {
        keys.push("youth");
    }
    let raw = exact(value, &keys)?;
    if !matches!(version, Some(1 | 2))
        || !matches!(
            raw["status"].as_str(),
            Some("unknown" | "employment" | "training")
        )
    {
        return Err(TrainingError::invalid("Unbekanntes Ausbildungsprofil."));
    }
    if !raw["fullTimeCompulsorySchooling"].is_null()
        && !raw["fullTimeCompulsorySchooling"].is_boolean()
    {
        return Err(TrainingError::invalid(
            "Vollzeitschulpflicht bitte ausdrücklich angeben.",
        ));
    }
    let from = date(&raw["effectiveFrom"])?;
    let birth = if raw["birthDate"].is_null() {
        None
    } else {
        Some(date(&raw["birthDate"])?)
    };
    if birth.as_ref().is_some_and(|d| d > &from) {
        return Err(TrainingError::invalid(
            "Geburtsdatum liegt nach dem Profilbeginn.",
        ));
    }
    let training = if !raw["training"].is_null() {
        let t = exact(
            &raw["training"],
            &[
                "profession",
                "legalBasis",
                "startedOn",
                "expectedEndOn",
                "year",
                "yearConfirmedFrom",
                "shorteningMonths",
            ],
        )?;
        let profession = t["profession"].as_str();
        if raw["status"] != "training"
            || profession.is_none_or(|v| {
                input::trim_javascript(v).is_empty() || v.encode_utf16().count() > 200
            })
        {
            return Err(TrainingError::invalid(
                "Ausbildungsberuf fehlt oder passt nicht zum Status.",
            ));
        }
        if !matches!(
            t["legalBasis"].as_str(),
            Some("PFLBG" | "BBIG" | "OTHER" | "UNKNOWN")
        ) {
            return Err(TrainingError::invalid("Unbekannte Ausbildungsgrundlage."));
        }
        let start = date(&t["startedOn"])?;
        let end = if t["expectedEndOn"].is_null() {
            None
        } else {
            Some(date(&t["expectedEndOn"])?)
        };
        let year = helpers::nullable_integer(&t["year"], 1, 6)?;
        let confirmed = if t["yearConfirmedFrom"].is_null() {
            None
        } else {
            Some(date(&t["yearConfirmedFrom"])?)
        };
        if year.is_null() != confirmed.is_none() || confirmed.as_ref().is_some_and(|d| d < &start) {
            return Err(TrainingError::invalid(
                "Ausbildungsjahr benötigt einen gültigen Bestätigungsbeginn.",
            ));
        }
        if birth.as_ref().is_some_and(|b| &start < b) || end.as_ref().is_some_and(|e| e < &start) {
            return Err(TrainingError::invalid("Ungültiger Ausbildungszeitraum."));
        }
        if let (Some(end), Some(confirmed)) = (&end, &confirmed)
            && confirmed > end
        {
            return Err(TrainingError::invalid(
                "Bestätigtes Ausbildungsjahr liegt nach dem Ausbildungsende.",
            ));
        }
        json!({"profession":input::trim_javascript(profession.expect("checked profession")),"legalBasis":t["legalBasis"],"startedOn":start,"expectedEndOn":end,"year":year,"yearConfirmedFrom":confirmed,"shorteningMonths":helpers::nullable_integer(&t["shorteningMonths"],0,72)?})
    } else {
        if raw["status"] == "training" {
            return Err(TrainingError::invalid("Ausbildungsangaben fehlen."));
        }
        Value::Null
    };
    let mut out = serde_json::Map::new();
    out.insert("version".into(), json!(version));
    if version == Some(2) {
        let youth = if raw["youth"].is_null() {
            Value::Null
        } else {
            CheckedYouthContext::try_from_raw(&raw["youth"])
                .map_err(|e| {
                    TrainingError::source(
                        if e.name() == "RemunerationProfileError" {
                            "RemunerationProfileError"
                        } else {
                            "Error"
                        },
                        e.message(),
                    )
                })?
                .value()
                .clone()
        };
        out.insert("youth".into(), youth);
    }
    out.insert("effectiveFrom".into(), json!(from));
    out.insert("birthDate".into(), json!(birth));
    out.insert(
        "fullTimeCompulsorySchooling".into(),
        raw["fullTimeCompulsorySchooling"].clone(),
    );
    out.insert("status".into(), raw["status"].clone());
    out.insert("training".into(), training);
    Ok(Value::Object(out))
}
fn validate_saved_profile(value: &Value) -> Result<Value, TrainingError> {
    let raw = exact(value, &["data", "revision", "updatedAt"])?;
    Ok(
        json!({"data":validate_training_profile(&raw["data"])? ,"revision":training_revision(&raw["revision"])? ,"updatedAt":helpers::instant(&raw["updatedAt"],"Ausbildungsprofil")?}),
    )
}
/// One normalized native profile collection per immutable source. Queries borrow
/// checked values; no birthday, youth confirmation or school fact enters from a
/// host-computed projection. In particular, raw untrimmed fields are not returned.
pub struct PreparedTrainingProfiles {
    rows: Arc<[Value]>,
    order: Vec<usize>,
}
impl PreparedTrainingProfiles {
    pub fn try_from_raw(profiles: &[Value]) -> Result<Self, TrainingError> {
        let mut rows = Vec::with_capacity(profiles.len());
        let mut seen = BTreeSet::new();
        for profile in profiles {
            let row = validate_saved_profile(profile)?;
            if !seen.insert(
                row["data"]["effectiveFrom"]
                    .as_str()
                    .expect("validated date")
                    .to_owned(),
            ) {
                return Err(TrainingError::invalid(
                    "Ausbildungsprofile benötigen eindeutige Gültigkeitsbeginne.",
                ));
            }
            rows.push(row);
        }
        let mut order = (0..rows.len()).collect::<Vec<_>>();
        order.sort_by(|a, b| {
            rows[*a]["data"]["effectiveFrom"]
                .as_str()
                .cmp(&rows[*b]["data"]["effectiveFrom"].as_str())
        });
        Ok(Self {
            rows: rows.into(),
            order,
        })
    }
    pub fn for_date(&self, date: &str) -> Result<Option<&Value>, TrainingError> {
        helpers::query_date(date)?;
        let index = self.order.partition_point(|i| {
            self.rows[*i]["data"]["effectiveFrom"]
                .as_str()
                .expect("validated date")
                <= date
        });
        Ok(index.checked_sub(1).map(|n| &self.rows[self.order[n]]))
    }
    pub fn profiles(&self) -> &[Value] {
        &self.rows
    }
}
pub fn training_profile_for_date(
    profiles: &[Value],
    date: &str,
) -> Result<Option<Value>, TrainingError> {
    helpers::query_date(date)?;
    let prepared = PreparedTrainingProfiles::try_from_raw(profiles)?;
    Ok(prepared.for_date(date)?.cloned())
}
