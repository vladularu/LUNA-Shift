use luna_engine::{
    contract::{self, ImmutableSnapshot, SourceKind, ValidatedRequest},
    input::profile_editor::{EditorIntent, EditorSection},
    rules::RuleResolver,
    runtime::{
        facts::SnapshotFacts, profile_editor_draft::ProfileEditorDraft,
        profile_editor_source::ProfileEditorContext,
    },
};
use serde_json::{Value, json};
use std::sync::Arc;
#[path = "support/snapshot.rs"]
mod snapshot;
#[path = "support/value_pool.rs"]
mod value_pool;
fn state(raw: &mut Value, kind: SourceKind, data: Value) {
    let kind = serde_json::to_value(kind).unwrap();
    raw["sources"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|s| s["kind"] == kind)
        .unwrap()["source"] = json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":if data.is_null(){json!({"kind":"NULL"})}else{json!({"kind":"VALUE","value":data})}}});
}
fn context(i: &Value, index: u64) -> Arc<ProfileEditorContext> {
    context_owner(i, index, "owned-editor-owner", 1)
}
fn context_owner(i: &Value, index: u64, owner: &str, epoch: u64) -> Arc<ProfileEditorContext> {
    let mut raw = snapshot::raw_snapshot(index, owner, epoch);
    raw["referenceDate"] = i["referenceDate"].clone();
    raw["clockContext"] = json!({"observedEpochMilliseconds":i["observedEpochMilliseconds"]});
    for (kind, value) in [
        (SourceKind::WorkProfile, i["profile"].clone()),
        (SourceKind::RemunerationProfiles, i["historyRows"].clone()),
        (SourceKind::WorkPatternSettings, i["patternRows"].clone()),
    ] {
        state(&mut raw, kind, value)
    }
    snapshot::seal(&mut raw);
    let envelope = json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"REGISTER_SNAPSHOT","snapshot":raw}});
    let snapshot: ImmutableSnapshot =
        match contract::parse_request(&serde_json::to_vec(&envelope).unwrap()).unwrap() {
            ValidatedRequest::RegisterSnapshot(s) => s,
            _ => panic!("snapshot"),
        };
    ProfileEditorContext::from_facts(Arc::new(SnapshotFacts::new(snapshot)))
        .unwrap()
        .unwrap()
}
#[test]
fn owner_source_revision_and_raw_intent_guards_preserve_the_private_draft() {
    use luna_engine::runtime::profile_editor_draft::EditorDraftError;
    let d = value_pool::decode(include_str!(
        "../../reference/profile-editor-draft-golden.json"
    ));
    let i = &d["cases"][0]["input"];
    let source = context(i, 1);
    let id = source.identity().clone();
    let epoch = i["observedEpochMilliseconds"].as_i64().unwrap();
    let resolver = RuleResolver::bundled().unwrap();
    let mut draft = ProfileEditorDraft::open(source, EditorSection::Work, true, &resolver).unwrap();
    let before = draft.view(&id, 0, epoch, &resolver).unwrap().state;
    let intent: EditorIntent =
        serde_json::from_value(json!({"kind":"FIELD","field":"weeklyHours","value":"40"})).unwrap();
    for other in [
        context(i, 2),
        context_owner(i, 1, "other-owner", 1),
        context_owner(i, 1, "owned-editor-owner", 2),
    ] {
        assert!(matches!(
            draft.apply(other.identity(), 0, epoch, &intent, &resolver),
            Err(EditorDraftError::StaleSource)
        ));
    }
    assert!(matches!(
        draft.apply(&id, 1, epoch, &intent, &resolver),
        Err(EditorDraftError::StaleRevision)
    ));
    assert!(matches!(
        draft.apply(&id, 0, i64::MAX, &intent, &resolver),
        Err(EditorDraftError::InvalidInstant)
    ));
    let invalid: EditorIntent =
        serde_json::from_value(json!({"kind":"FIELD","field":"weeklyHours","value":17})).unwrap();
    assert!(matches!(
        draft.apply(&id, 0, epoch, &invalid, &resolver),
        Err(EditorDraftError::Form(_))
    ));
    assert_eq!(draft.view(&id, 0, epoch, &resolver).unwrap().state, before);
    for raw in [
        json!({"kind":"FIELD","field":"confirmedGroups","value":["TVOED_P"]}),
        json!({"kind":"MODE","value":"TVOED_P","nativeCache":{}}),
        json!({"kind":"RESTORE","state":before}),
    ] {
        assert!(serde_json::from_value::<EditorIntent>(raw).is_err())
    }
    assert!(
        serde_json::to_vec(&draft.view(&id, 0, epoch, &resolver).unwrap())
            .unwrap()
            .len()
            < 32 * 1024
    );
}
#[test]
fn captured_builder_retains_request_time_native_state_after_subsequent_edits() {
    let d = value_pool::decode(include_str!(
        "../../reference/profile-editor-draft-golden.json"
    ));
    let c = d["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| {
            c["input"]["section"] == "WORK"
                && c["input"]["actions"]
                    == json!([{"kind":"FIELD","field":"weeklyHours","value":"40"}])
        })
        .unwrap();
    let i = &c["input"];
    let source = context(i, 1);
    let id = source.identity().clone();
    let epoch = i["observedEpochMilliseconds"].as_i64().unwrap();
    let resolver = RuleResolver::bundled().unwrap();
    let mut draft =
        ProfileEditorDraft::open(source.clone(), EditorSection::Work, true, &resolver).unwrap();
    let intent: EditorIntent = serde_json::from_value(i["actions"][0].clone()).unwrap();
    draft.apply(&id, 0, epoch, &intent, &resolver).unwrap();
    let captured = draft.capture(&id, 1, epoch, &resolver).unwrap();
    let changed: EditorIntent =
        serde_json::from_value(json!({"kind":"FIELD","field":"weeklyHours","value":"42"})).unwrap();
    draft.apply(&id, 1, epoch, &changed, &resolver).unwrap();
    assert!(Arc::ptr_eq(captured.source_profile(), source.profile()));
    let mut expected = c["expected"]["submission"].clone();
    let mut actual = captured.feedback();
    let built = captured
        .build(i["buildDate"].as_str().unwrap(), true, &resolver)
        .unwrap()
        .unwrap();
    actual["built"] = json!({"ok":true,"value":serde_json::to_value(built).unwrap()});
    assert_eq!(actual, expected);
    expected = draft.view(&id, 2, epoch, &resolver).unwrap().state;
    assert_eq!(expected["draft"]["weeklyHours"], "42");
}
#[test]
fn source_bound_native_draft_and_captured_original_submit_match() {
    let data = value_pool::decode(include_str!(
        "../../reference/profile-editor-draft-golden.json"
    ));
    assert_eq!(data["cases"].as_array().unwrap().len(), 810);
    let resolver = RuleResolver::bundled().unwrap();
    for (index, c) in data["cases"].as_array().unwrap().iter().enumerate() {
        let i = &c["input"];
        let source = context(i, index as u64 + 1);
        let identity = source.identity().clone();
        let section: EditorSection = serde_json::from_value(i["section"].clone()).unwrap();
        let mut draft = ProfileEditorDraft::open(
            source.clone(),
            section,
            i["fromMore"].as_bool().unwrap(),
            &resolver,
        )
        .unwrap();
        let epoch = i["observedEpochMilliseconds"].as_i64().unwrap();
        let mut revision = 0;
        for raw in i["actions"].as_array().unwrap() {
            let intent: EditorIntent = serde_json::from_value(raw.clone()).unwrap();
            revision = draft
                .apply(&identity, revision, epoch, &intent, &resolver)
                .unwrap()
                .draft_revision;
        }
        let actual = draft.view(&identity, revision, epoch, &resolver).unwrap();
        assert_eq!(actual.state, c["expected"]["state"], "state {}", c["id"]);
        let captured = draft
            .capture(&identity, revision, epoch, &resolver)
            .unwrap();
        assert!(Arc::ptr_eq(captured.source_profile(), source.profile()));
        let mut submission = captured.feedback();
        match captured.build(i["buildDate"].as_str().unwrap(), true, &resolver) {
            Ok(Some(value)) => {
                submission["built"] =
                    json!({"ok":true,"value":serde_json::to_value(value).unwrap()})
            }
            Ok(None) => {}
            Err(e) => {
                let mut value = json!({"ok":false,"name":e.name(),"message":e.to_string()});
                if let Some(failure) = e.rule_failure() {
                    value["failure"] = serde_json::to_value(failure).unwrap()
                }
                submission["built"] = value;
            }
        }
        assert_eq!(
            submission, c["expected"]["submission"],
            "submission {}",
            c["id"]
        );
    }
}
