#[path = "snapshot.rs"]
pub mod snapshot;
use luna_engine::{
    contract::{self, ImmutableSnapshot, SourceKind, ValidatedRequest},
    runtime::facts::SnapshotFacts,
};
use serde_json::{Value, json};
fn ready(value: Value) -> Value {
    json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":value}}})
}
pub fn set(raw: &mut Value, kind: SourceKind, state: Value) {
    let kind = serde_json::to_value(kind).unwrap();
    raw["sources"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|v| v["kind"] == kind)
        .unwrap()["source"] = state;
}
pub fn raw(case: &Value) -> Value {
    let input = &case["input"];
    let mut raw = snapshot::raw_snapshot(1, "salary-presentation", 1);
    for kind in [
        SourceKind::RemunerationProfiles,
        SourceKind::WorkPatternSettings,
        SourceKind::LegacyTariffDecisions,
        SourceKind::TestMonths,
        SourceKind::ActualAnnualPayments,
        SourceKind::TariffAnnualClaims,
    ] {
        set(&mut raw, kind, ready(json!([])));
    }
    set(
        &mut raw,
        SourceKind::WorkProfile,
        ready(input["work"].clone()),
    );
    set(
        &mut raw,
        SourceKind::CalendarEntries,
        ready(
            json!({"shiftRows":input["shiftRows"],"appointmentRows":input["appointmentRows"],"platformCollationRanks":case["platformCollationRanks"]}),
        ),
    );
    let timeline=input["timeline"].as_array().unwrap().iter().map(|saved|json!({"month":saved["settings"]["month"],"settings_json":serde_json::to_string(&saved["settings"]).unwrap(),"revision":saved["revision"],"created_at":saved["createdAt"],"updated_at":saved["updatedAt"]})).collect::<Vec<_>>();
    set(
        &mut raw,
        SourceKind::NetPaySettingsTimeline,
        ready(json!(timeline)),
    );
    set(
        &mut raw,
        SourceKind::SalaryPaymentPreferences,
        ready(json!({"value":serde_json::to_string(&input["preferences"]).unwrap()})),
    );
    for kind in [SourceKind::WorkingTimeTarget, SourceKind::YouthPreference] {
        set(
            &mut raw,
            kind,
            json!({"state":"FAILED","code":"READ_FAILED"}),
        );
    }
    raw["catalogs"]["current"]["selectedPackageIds"] =
        json!({"tariff":["tvoed-vka-bt-k"],"legal":["de-arbzg-care"],"holiday":["de-holidays"]});
    for kind in ["tariff", "legal", "holiday"] {
        raw["catalogs"]["current"][kind] = ready(json!({"mode":"COMPILED_PREVIEW"}));
    }
    raw
}
pub fn facts(mut raw: Value) -> SnapshotFacts {
    snapshot::seal(&mut raw);
    let envelope = json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"REGISTER_SNAPSHOT","snapshot":raw}});
    let snapshot: ImmutableSnapshot =
        match contract::parse_request(&serde_json::to_vec(&envelope).unwrap()).unwrap() {
            ValidatedRequest::RegisterSnapshot(snapshot) => snapshot,
            _ => panic!("snapshot"),
        };
    SnapshotFacts::new(snapshot)
}
