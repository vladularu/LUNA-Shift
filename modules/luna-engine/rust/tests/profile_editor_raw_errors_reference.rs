use luna_engine::{
    contract::{self, ImmutableSnapshot, SourceKind, ValidatedRequest},
    runtime::{
        facts::{FactError, SnapshotFacts},
        profile_editor_flow::ProfileFlowIoFailure,
        profile_editor_receipt::ProfileEditorReceipt,
    },
};
use serde_json::{Value, json};
use std::sync::Arc;
#[path = "support/snapshot.rs"]
mod snapshot;
#[path = "support/value_pool.rs"]
mod value_pool;
fn facts(i: &Value, index: u64) -> Arc<SnapshotFacts> {
    let mut raw = snapshot::raw_snapshot(index, "native-editor-raw-error", 1);
    raw["referenceDate"] = i["referenceDate"].clone();
    raw["clockContext"] = json!({"observedEpochMilliseconds":i["observedEpochMilliseconds"]});
    for (kind, value) in [
        (SourceKind::WorkProfile, i["profile"].clone()),
        (SourceKind::RemunerationProfiles, i["historyRows"].clone()),
    ] {
        let kind = serde_json::to_value(kind).unwrap();
        raw["sources"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|s| s["kind"] == kind)
            .unwrap()["source"] = json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":if value.is_null(){json!({"kind":"NULL"})}else{json!({"kind":"VALUE","value":value})}}});
    }
    snapshot::seal(&mut raw);
    let envelope = json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"REGISTER_SNAPSHOT","snapshot":raw}});
    let snap: ImmutableSnapshot =
        match contract::parse_request(&serde_json::to_vec(&envelope).unwrap()).unwrap() {
            ValidatedRequest::RegisterSnapshot(s) => s,
            _ => panic!("snapshot"),
        };
    Arc::new(SnapshotFacts::new(snap))
}
#[test]
fn actual_original_raw_receipt_error_ancestry_and_safe_messages_match() {
    let d = value_pool::decode(include_str!(
        "../../reference/profile-editor-raw-errors-golden.json"
    ));
    assert_eq!(d["cases"].as_array().unwrap().len(), 295);
    let (mut safe, mut generic) = (0, 0);
    for (index, c) in d["cases"].as_array().unwrap().iter().enumerate() {
        let mut actual = match ProfileEditorReceipt::from_facts(facts(
            &c["input"],
            index as u64 + 1,
        )) {
            Ok(_) => json!({"ok":true}),
            Err(e) => {
                let name = match &e {
                    FactError::Profile(e) | FactError::Remuneration(e) => e.name(),
                    _ => panic!("unexpected {e:?}"),
                };
                match ProfileFlowIoFailure::from_fact_error(&e) {
                    ProfileFlowIoFailure::UserFacing(message) => {
                        safe += 1;
                        json!({"ok":false,"name":name,"userFacing":true,"message":message})
                    }
                    ProfileFlowIoFailure::Generic => {
                        generic += 1;
                        json!({"ok":false,"name":name,"userFacing":false,"message":"Speichern fehlgeschlagen."})
                    }
                    _ => panic!("not a source concurrency error"),
                }
            }
        };
        if c["operation"] == "ERROR_PROJECTION"
            && let Some(record) = actual.as_object_mut()
        {
            record.remove("name");
        }
        assert_eq!(actual, c["expected"], "{}", c["id"]);
    }
    assert!(safe > 0);
    assert!(generic > 0);
}
