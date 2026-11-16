//! Test-only native assembly from original SQL source groups. Expected profiles
//! and calculated report values never enter the native boundary.
#[path = "snapshot.rs"]
mod snapshot;
use luna_engine::{
    contract::{self, SourceKind, ValidatedRequest},
    input::{
        employment::RawEmploymentHistory, profile_clock::prepare_profile_clock,
        stored_profile::checked_stored_work_profile,
    },
    runtime::facts::SnapshotFacts,
};
use serde_json::{Value, json};
use std::sync::Arc;
fn ready(value: Value) -> Value {
    let data = if value.is_null() {
        json!({"kind":"NULL"})
    } else {
        json!({"kind":"VALUE","value":value})
    };
    json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":data}})
}
fn set(raw: &mut Value, kind: SourceKind, state: Value) {
    let kind = serde_json::to_value(kind).unwrap();
    raw["sources"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|v| v["kind"] == kind)
        .unwrap()["source"] = state;
}
pub fn raw_facts(source: &Value, ranks: &Value) -> SnapshotFacts {
    let mut raw = snapshot::raw_snapshot(1, "export-time", 1);
    let epoch = source["epoch"].as_i64().unwrap();
    raw["clockContext"] = json!({"observedEpochMilliseconds":epoch});
    let work = &source["profile"];
    let stored = if work.is_null() {
        None
    } else {
        Some(
            checked_stored_work_profile(
                Arc::new(work["profileRow"].clone()),
                Arc::new(work["salaryRows"].as_array().unwrap().clone()),
            )
            .unwrap(),
        )
    };
    let history = RawEmploymentHistory::try_from_rows(Arc::new(
        source["historyRows"].as_array().unwrap().clone(),
    ))
    .unwrap();
    let clock = prepare_profile_clock(stored.as_ref(), Some(&history), epoch).unwrap();
    if let Some(date) = clock.clock_metadata()["referenceDate"].as_str() {
        raw["referenceDate"] = json!(date);
    }
    let mut calendar = source["calendar"].clone();
    calendar["platformCollationRanks"] = ranks.clone();
    for (kind, value) in [
        (SourceKind::WorkProfile, work.clone()),
        (
            SourceKind::RemunerationProfiles,
            source["historyRows"].clone(),
        ),
        (
            SourceKind::WorkPatternSettings,
            source["patternRows"].clone(),
        ),
        (SourceKind::CalendarEntries, calendar),
        (
            SourceKind::YouthPreference,
            source["youthPreference"].clone(),
        ),
    ] {
        set(&mut raw, kind, ready(value));
    }
    let target = match source["targetState"].as_str().unwrap_or("READY") {
        "LOADING" => json!({"state":"LOADING"}),
        "FAILED" => json!({"state":"FAILED","code":"READ_FAILED"}),
        _ => {
            let row = &source["targetRow"];
            if row.is_null() {
                ready(Value::Null)
            } else {
                ready(
                    json!({"id":row["id"],"settings_json_chunks":[row["settings_json"]],"revision":row["revision"],"created_at":row["created_at"],"updated_at":row["updated_at"]}),
                )
            }
        }
    };
    set(&mut raw, SourceKind::WorkingTimeTarget, target);
    for kind in [
        SourceKind::NetPaySettingsTimeline,
        SourceKind::SalaryPaymentPreferences,
        SourceKind::LegacyTariffDecisions,
        SourceKind::TrainingProfiles,
        SourceKind::TrainingShiftDetails,
        SourceKind::TestMonths,
    ] {
        set(
            &mut raw,
            kind,
            json!({"state":"FAILED","code":"READ_FAILED"}),
        );
    }
    raw["catalogs"]["current"]["selectedPackageIds"] =
        json!({"tariff":["tvoed-vka-bt-k"],"legal":["de-arbzg-care"],"holiday":["de-holidays"]});
    for key in ["tariff", "legal", "holiday"] {
        raw["catalogs"]["current"][key] = ready(json!({"mode":"COMPILED_PREVIEW"}));
    }
    snapshot::seal(&mut raw);
    let envelope = json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"REGISTER_SNAPSHOT","snapshot":raw}});
    match contract::parse_request(&serde_json::to_vec(&envelope).unwrap()).unwrap() {
        ValidatedRequest::RegisterSnapshot(value) => SnapshotFacts::new(value),
        _ => panic!("native snapshot"),
    }
}
