use luna_engine::{
    contract::{self, ImmutableSnapshot, SourceKind, ValidatedRequest},
    runtime::{
        facts::{FactError, SnapshotFacts},
        profile_editor_receipt::ProfileEditorReceipt,
    },
};
use serde_json::{Value, json};
use std::sync::Arc;
#[path = "support/snapshot.rs"]
mod snapshot;
#[path = "support/value_pool.rs"]
mod value_pool;
fn state(raw: &mut Value, kind: SourceKind, value: Value) {
    let kind = serde_json::to_value(kind).unwrap();
    raw["sources"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|s| s["kind"] == kind)
        .unwrap()["source"] = value;
}
fn ready(value: Value) -> Value {
    json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":if value.is_null(){json!({"kind":"NULL"})}else{json!({"kind":"VALUE","value":value})}}})
}
fn raw(i: &Value, index: u64) -> Value {
    let mut raw = snapshot::raw_snapshot(index, "receipt-owner", 1);
    raw["referenceDate"] = i["referenceDate"].clone();
    raw["clockContext"] = json!({"observedEpochMilliseconds":i["observedEpochMilliseconds"]});
    for (kind, value) in [
        (SourceKind::WorkProfile, i["profile"].clone()),
        (SourceKind::RemunerationProfiles, i["historyRows"].clone()),
    ] {
        state(&mut raw, kind, ready(value));
    }
    raw
}
fn facts(mut raw: Value) -> Arc<SnapshotFacts> {
    snapshot::seal(&mut raw);
    let envelope = json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"REGISTER_SNAPSHOT","snapshot":raw}});
    let s: ImmutableSnapshot =
        match contract::parse_request(&serde_json::to_vec(&envelope).unwrap()).unwrap() {
            ValidatedRequest::RegisterSnapshot(s) => s,
            _ => panic!("snapshot"),
        };
    Arc::new(SnapshotFacts::new(s))
}
#[test]
fn actual_original_save_wrapper_projection_and_first_errors_match() {
    let data = value_pool::decode(include_str!(
        "../../reference/profile-editor-receipt-golden.json"
    ));
    assert_eq!(data["cases"].as_array().unwrap().len(), 277);
    for (index, c) in data["cases"].as_array().unwrap().iter().enumerate() {
        let f = facts(raw(&c["input"], index as u64 + 1));
        let actual = match ProfileEditorReceipt::from_facts(f.clone()) {
            Ok(None) => json!({"ok":true,"value":null}),
            Ok(Some(receipt)) => {
                assert_eq!(receipt.identity(), f.snapshot().identity());
                json!({"ok":true,"value":receipt.profile().as_ref()})
            }
            Err(FactError::Profile(e) | FactError::Remuneration(e)) => {
                json!({"ok":false,"name":e.name(),"message":e.message()})
            }
            Err(e) => panic!("unexpected {e:?}"),
        };
        assert_eq!(actual, c["expected"], "{}", c["id"]);
    }
}
#[test]
fn receipt_is_projected_base_without_rendered_provider_fallback_or_second_zone() {
    use luna_engine::runtime::profile_editor_source::ProfileEditorContext;
    let data = value_pool::decode(include_str!(
        "../../reference/profile-editor-receipt-golden.json"
    ));
    let resolver_cases = data["cases"].as_array().unwrap();
    for c in [
        &resolver_cases[0],
        resolver_cases
            .iter()
            .find(|c| c["id"] == "three-zone-2026-11-12T23:30:00Z")
            .unwrap(),
    ] {
        let i = &c["input"];
        let mut r = raw(i, 1);
        state(
            &mut r,
            SourceKind::WorkPatternSettings,
            ready(i["patternRows"].clone()),
        );
        let f = facts(r);
        let receipt = ProfileEditorReceipt::from_facts(f.clone())
            .unwrap()
            .unwrap();
        let provider = ProfileEditorContext::from_facts(f).unwrap().unwrap();
        assert_eq!(receipt.profile().as_ref(), &c["expected"]["value"]);
        assert!(receipt.profile().get("workingTimeTarget").is_none());
        if c["id"] == resolver_cases[0]["id"] {
            assert!(receipt.profile().get("workPattern").is_none());
            assert!(provider.profile().get("workPattern").is_some());
        } else {
            assert_ne!(
                receipt.profile()["timeZone"],
                provider.profile()["timeZone"]
            );
        }
    }
}
#[test]
fn receipt_ignores_global_pattern_io_but_preserves_raw_dependency_states() {
    use luna_engine::runtime::sources::SourceReadError;
    let data = value_pool::decode(include_str!(
        "../../reference/profile-editor-receipt-golden.json"
    ));
    let i = &data["cases"][0]["input"];
    for pattern in [
        json!({"state":"NOT_REQUESTED"}),
        json!({"state":"LOADING"}),
        json!({"state":"FAILED","code":"READ_FAILED"}),
    ] {
        let mut r = raw(i, 1);
        state(&mut r, SourceKind::WorkPatternSettings, pattern);
        let receipt = ProfileEditorReceipt::from_facts(facts(r)).unwrap().unwrap();
        assert_eq!(
            receipt.profile().as_ref(),
            &data["cases"][0]["expected"]["value"]
        );
    }
    for kind in [SourceKind::WorkProfile, SourceKind::RemunerationProfiles] {
        let mut r = raw(i, 1);
        state(&mut r, kind, json!({"state":"FAILED","code":"READ_FAILED"}));
        assert!(
            matches!(ProfileEditorReceipt::from_facts(facts(r)),Err(FactError::Source{kind:k,error:SourceReadError::Failed(contract::SourceFailure::ReadFailed)}) if k==kind)
        );
    }
    let mut r = raw(i, 1);
    state(&mut r, SourceKind::WorkProfile, ready(Value::Null));
    state(
        &mut r,
        SourceKind::RemunerationProfiles,
        json!({"state":"FAILED","code":"READ_FAILED"}),
    );
    assert!(
        ProfileEditorReceipt::from_facts(facts(r))
            .unwrap()
            .is_none()
    );
    let mut r = raw(i, 1);
    r.as_object_mut().unwrap().remove("clockContext");
    assert!(matches!(
        ProfileEditorReceipt::from_facts(facts(r)),
        Err(FactError::Clock("PROFILE_CLOCK_REQUIRED"))
    ));
}
