use luna_engine::{
    contract::{self, ImmutableSnapshot, SourceKind, ValidatedRequest},
    input::profile_editor::EditorSection,
    rules::RuleResolver,
    runtime::{
        facts::{FactError, SnapshotFacts},
        profile_editor_source::ProfileEditorContext,
    },
};
use serde_json::{Value, json};
use std::sync::Arc;
#[path = "support/snapshot.rs"]
mod snapshot;
#[path = "support/value_pool.rs"]
mod value_pool;
fn set(raw: &mut Value, kind: SourceKind, state: Value) {
    let kind = serde_json::to_value(kind).unwrap();
    raw["sources"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|row| row["kind"] == kind)
        .unwrap()["source"] = state;
}
fn ready(value: Value) -> Value {
    json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":if value.is_null(){json!({"kind":"NULL"})}else{json!({"kind":"VALUE","value":value})}}})
}
fn parsed(mut raw: Value) -> ImmutableSnapshot {
    snapshot::seal(&mut raw);
    let envelope = json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"REGISTER_SNAPSHOT","snapshot":raw}});
    match contract::parse_request(&serde_json::to_vec(&envelope).unwrap()).unwrap() {
        ValidatedRequest::RegisterSnapshot(snapshot) => snapshot,
        _ => panic!("snapshot expected"),
    }
}
fn raw(input: &Value, index: u64) -> Value {
    let mut raw = snapshot::raw_snapshot(index, "profile-editor-owner", 1);
    raw["referenceDate"] = input["referenceDate"].clone();
    raw["clockContext"] = json!({"observedEpochMilliseconds":input["observedEpochMilliseconds"]});
    set(
        &mut raw,
        SourceKind::WorkProfile,
        ready(input["profile"].clone()),
    );
    set(
        &mut raw,
        SourceKind::RemunerationProfiles,
        ready(input["historyRows"].clone()),
    );
    set(
        &mut raw,
        SourceKind::WorkPatternSettings,
        ready(input["patternRows"].clone()),
    );
    raw
}
fn facts(input: &Value, index: u64) -> Arc<SnapshotFacts> {
    Arc::new(SnapshotFacts::new(parsed(raw(input, index))))
}

#[test]
fn editor_source_requires_only_actual_raw_profile_dependencies() {
    use luna_engine::runtime::sources::SourceReadError;
    let data = value_pool::decode(include_str!(
        "../../reference/profile-editor-source-golden.json"
    ));
    let cases = data["cases"].as_array().unwrap();
    let ordinary = &cases[0]["input"];
    for (state, expected) in [
        (
            json!({"state":"NOT_REQUESTED"}),
            SourceReadError::NotRequested,
        ),
        (json!({"state":"LOADING"}), SourceReadError::Loading),
        (
            json!({"state":"FAILED","code":"READ_FAILED"}),
            SourceReadError::Failed(contract::SourceFailure::ReadFailed),
        ),
    ] {
        for kind in [
            SourceKind::WorkProfile,
            SourceKind::RemunerationProfiles,
            SourceKind::WorkPatternSettings,
        ] {
            let mut r = raw(ordinary, 1);
            set(&mut r, kind, state.clone());
            assert!(
                matches!(ProfileEditorContext::from_facts(Arc::new(SnapshotFacts::new(parsed(r)))),Err(FactError::Source{kind:k,error}) if k==kind&&error==expected)
            );
        }
    }
    // A checked employment answer overrides the global preference. Its I/O is
    // then irrelevant, matching the original provider's nullish fallback.
    let saved = cases
        .iter()
        .find(|c| c["id"] == "zone-0-instant-0-history-1-WORK")
        .unwrap();
    let mut r = raw(&saved["input"], 2);
    set(
        &mut r,
        SourceKind::WorkPatternSettings,
        json!({"state":"FAILED","code":"READ_FAILED"}),
    );
    let source = ProfileEditorContext::from_facts(Arc::new(SnapshotFacts::new(parsed(r))))
        .unwrap()
        .unwrap();
    assert_eq!(
        source.profile().as_ref(),
        &saved["expected"]["value"]["profile"]
    );
    assert_eq!(
        source.profile()["employmentTimeline"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert!(source.profile().get("workingTimeTarget").is_none());
    let output = source
        .bootstrap(EditorSection::Work, true, &RuleResolver::bundled().unwrap())
        .unwrap();
    assert_eq!(output, saved["expected"]["value"]["bootstrap"]);
    assert!(serde_json::to_vec(&output).unwrap().len() < 16 * 1024);
}

#[test]
fn null_profile_needs_no_history_pattern_and_legacy_date_is_never_clock_evidence() {
    let data = value_pool::decode(include_str!(
        "../../reference/profile-editor-source-golden.json"
    ));
    let input = &data["cases"][0]["input"];
    let mut r = raw(input, 1);
    set(&mut r, SourceKind::WorkProfile, ready(Value::Null));
    for kind in [
        SourceKind::RemunerationProfiles,
        SourceKind::WorkPatternSettings,
    ] {
        set(&mut r, kind, json!({"state":"FAILED","code":"READ_FAILED"}));
    }
    assert!(
        ProfileEditorContext::from_facts(Arc::new(SnapshotFacts::new(parsed(r))))
            .unwrap()
            .is_none()
    );
    let mut r = raw(input, 2);
    r.as_object_mut().unwrap().remove("clockContext");
    assert!(matches!(
        ProfileEditorContext::from_facts(Arc::new(SnapshotFacts::new(parsed(r)))),
        Err(FactError::Clock("PROFILE_CLOCK_REQUIRED"))
    ));
}
#[test]
fn actual_raw_sql_profile_ports_provider_and_editor_chain_matches() {
    let data = value_pool::decode(include_str!(
        "../../reference/profile-editor-source-golden.json"
    ));
    assert_eq!(data["cases"].as_array().unwrap().len(), 1662);
    let resolver = RuleResolver::bundled().unwrap();
    for (index, case) in data["cases"].as_array().unwrap().iter().enumerate() {
        let input = &case["input"];
        let f = facts(input, index as u64 + 1);
        let result = ProfileEditorContext::from_facts(f.clone());
        let actual = match result {
            Ok(None) => json!({"ok":true,"value":null}),
            Ok(Some(source)) => {
                assert_eq!(source.identity(), f.snapshot().identity());
                let section: EditorSection =
                    serde_json::from_value(input["section"].clone()).unwrap();
                match source.bootstrap(section, input["fromMore"].as_bool().unwrap(), &resolver) {
                    Ok(bootstrap) => {
                        json!({"ok":true,"value":{"profile":source.profile().as_ref(),"referenceDate":source.reference_date(),"bootstrap":bootstrap}})
                    }
                    Err(error) => {
                        json!({"ok":false,"name":error.name(),"message":error.to_string()})
                    }
                }
            }
            Err(FactError::Profile(error) | FactError::Remuneration(error)) => {
                json!({"ok":false,"name":error.name(),"message":error.message()})
            }
            Err(error) => panic!("unexpected {error:?}"),
        };
        assert_eq!(actual, case["expected"], "{}", case["id"]);
    }
}
