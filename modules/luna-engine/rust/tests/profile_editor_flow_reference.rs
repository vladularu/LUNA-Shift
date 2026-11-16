use luna_engine::{
    contract::{self, ImmutableSnapshot, SourceKind, ValidatedRequest},
    input::profile_editor::{EditorIntent, EditorSection, SaveScope},
    rules::RuleResolver,
    runtime::{
        facts::SnapshotFacts,
        profile_editor_flow::{ProfileEditorFlow, ProfileEditorWrite, ProfileFlowIoFailure},
        profile_editor_receipt::ProfileEditorReceipt,
        profile_editor_source::ProfileEditorContext,
    },
};
use serde_json::{Value, json};
use std::sync::Arc;
#[path = "support/snapshot.rs"]
mod snapshot;
#[path = "support/value_pool.rs"]
mod value_pool;
fn facts(i: &Value, index: u64) -> Arc<SnapshotFacts> {
    facts_owner(i, index, "native-editor-flow", 1)
}
fn facts_owner(i: &Value, index: u64, owner: &str, epoch: u64) -> Arc<SnapshotFacts> {
    let mut raw = snapshot::raw_snapshot(index, owner, epoch);
    raw["referenceDate"] = i["referenceDate"].clone();
    raw["clockContext"] = json!({"observedEpochMilliseconds":i["observedEpochMilliseconds"]});
    for (kind, value) in [
        (SourceKind::WorkProfile, i["profile"].clone()),
        (SourceKind::RemunerationProfiles, i["historyRows"].clone()),
        (SourceKind::WorkPatternSettings, i["patternRows"].clone()),
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
fn source_bound_writes_are_single_use_and_foreign_receipts_never_change_flow_state() {
    use luna_engine::runtime::profile_editor_flow::ProfileFlowError;
    let data = value_pool::decode(include_str!(
        "../../reference/profile-editor-flow-golden.json"
    ));
    let i = &data["cases"][0]["input"]["initial"];
    let epoch = i["observedEpochMilliseconds"].as_i64().unwrap();
    let source = ProfileEditorContext::from_facts(facts(i, 1))
        .unwrap()
        .unwrap();
    let resolver = RuleResolver::bundled().unwrap();
    let mut flow = ProfileEditorFlow::new(source, EditorSection::Work, true);
    let mut draft = flow.open_editor(epoch, &resolver).unwrap();
    let id = draft.identity().clone();
    let intent: EditorIntent =
        serde_json::from_value(json!({"kind":"FIELD","field":"weeklyHours","value":"40"})).unwrap();
    draft.apply(&id, 0, epoch, &intent, &resolver).unwrap();
    let captured = draft.capture(&id, 1, epoch, &resolver).unwrap();
    assert!(flow.request(captured, epoch, &resolver).unwrap().is_none());
    flow.set_scope(Some(SaveScope::All));
    let plan = flow.confirm(epoch, &resolver).unwrap().unwrap();
    let before = flow.ui_state(epoch).unwrap();
    assert_eq!(before["saving"], true);
    let foreign = ProfileEditorReceipt::from_facts(facts_owner(i, 2, "other-owner", 1))
        .unwrap()
        .unwrap();
    assert!(matches!(
        flow.complete(plan.id(), foreign),
        Err(ProfileFlowError::StaleSource)
    ));
    let changed_epoch =
        ProfileEditorReceipt::from_facts(facts_owner(i, 2, "native-editor-flow", 2))
            .unwrap()
            .unwrap();
    assert!(matches!(
        flow.complete(plan.id(), changed_epoch),
        Err(ProfileFlowError::StaleSource)
    ));
    let receipt = ProfileEditorReceipt::from_facts(facts(i, 2))
        .unwrap()
        .unwrap();
    assert!(matches!(
        flow.complete(plan.id() + 1, receipt.clone()),
        Err(ProfileFlowError::StaleWrite)
    ));
    assert!(matches!(
        flow.fail(plan.id() + 1, ProfileFlowIoFailure::Generic),
        Err(ProfileFlowError::StaleWrite)
    ));
    assert_eq!(flow.ui_state(epoch).unwrap(), before);
    flow.fail(plan.id(), ProfileFlowIoFailure::Generic).unwrap();
    let failed = flow.ui_state(epoch).unwrap();
    assert_eq!(failed["saving"], false);
    assert!(failed["pending"].is_object());
    assert_eq!(
        failed["error"],
        "Die Angaben konnten nicht gespeichert werden."
    );
    let retry = flow.confirm(epoch, &resolver).unwrap().unwrap();
    assert!(retry.id() > plan.id());
    flow.complete(retry.id(), receipt.clone()).unwrap();
    let completed = flow.ui_state(epoch).unwrap();
    assert!(matches!(
        flow.complete(retry.id(), receipt),
        Err(ProfileFlowError::StaleWrite)
    ));
    assert!(matches!(
        flow.fail(
            plan.id(),
            ProfileFlowIoFailure::UserFacing("untrusted old failure".into())
        ),
        Err(ProfileFlowError::StaleWrite)
    ));
    assert_eq!(flow.ui_state(epoch).unwrap(), completed);
}
#[test]
fn foreign_native_captures_and_invalid_raw_clock_cannot_mutate_the_local_draft() {
    use luna_engine::runtime::profile_editor_flow::ProfileFlowError;
    let data = value_pool::decode(include_str!(
        "../../reference/profile-editor-flow-golden.json"
    ));
    let i = &data["cases"][0]["input"]["initial"];
    let epoch = i["observedEpochMilliseconds"].as_i64().unwrap();
    let source = ProfileEditorContext::from_facts(facts(i, 1))
        .unwrap()
        .unwrap();
    let mut flow = ProfileEditorFlow::new(source, EditorSection::Work, true);
    let before = flow.ui_state(epoch).unwrap();
    let resolver = RuleResolver::bundled().unwrap();
    let foreign = ProfileEditorContext::from_facts(facts_owner(i, 1, "other-owner", 1))
        .unwrap()
        .unwrap();
    let draft = luna_engine::runtime::profile_editor_draft::ProfileEditorDraft::open(
        foreign,
        EditorSection::Work,
        true,
        &resolver,
    )
    .unwrap();
    let captured = draft
        .capture(draft.identity(), 0, epoch, &resolver)
        .unwrap();
    assert!(matches!(
        flow.request(captured, epoch, &resolver),
        Err(ProfileFlowError::StaleSource)
    ));
    assert!(flow.ui_state(i64::MAX).is_err());
    assert!(flow.open_editor(i64::MAX, &resolver).is_err());
    assert_eq!(flow.ui_state(epoch).unwrap(), before);
}
fn frame(flow: &ProfileEditorFlow, epoch: i64, writes: &[Value]) -> Value {
    let mut state = flow.ui_state(epoch).unwrap();
    state["base"] = flow.base().as_ref().clone();
    state["current"] = flow.current().as_ref().clone();
    state["receipt"] = flow
        .receipt_profiles()
        .map(|(before, saved)| json!({"before":before.as_ref(),"saved":saved.as_ref()}))
        .unwrap_or(Value::Null);
    json!({"flow":state,"writes":writes})
}
fn write(
    value: Option<Arc<ProfileEditorWrite>>,
    writes: &mut Vec<Value>,
    active: &mut Option<u64>,
) {
    if let Some(value) = value {
        assert!(active.is_none());
        *active = Some(value.id());
        writes.push(serde_json::to_value(value.input()).unwrap());
    }
}
#[test]
fn actual_original_hook_states_and_write_payloads_match_from_native_raw_sources() {
    replay_original_flows(|_, _, _, _| {});
}
fn replay_original_flows(mut observe: impl FnMut(usize, usize, &ProfileEditorFlow, i64)) {
    let data = value_pool::decode(include_str!(
        "../../reference/profile-editor-flow-golden.json"
    ));
    assert_eq!(data["cases"].as_array().unwrap().len(), 163);
    let resolver = RuleResolver::bundled().unwrap();
    for (index, c) in data["cases"].as_array().unwrap().iter().enumerate() {
        let input = &c["input"];
        let initial = &input["initial"];
        let source = ProfileEditorContext::from_facts(facts(initial, index as u64 * 100 + 1))
            .unwrap()
            .unwrap();
        let section: EditorSection = serde_json::from_value(input["section"].clone()).unwrap();
        let mut flow = ProfileEditorFlow::new(source, section, true);
        let mut epoch = initial["observedEpochMilliseconds"].as_i64().unwrap();
        let mut writes = Vec::new();
        let mut active = None;
        let mut frames = vec![frame(&flow, epoch, &writes)];
        observe(index, 0, &flow, epoch);
        for (n, step) in input["steps"].as_array().unwrap().iter().enumerate() {
            let mut feedback = None;
            match step["kind"].as_str().unwrap() {
                "REQUEST" => {
                    let mut draft = flow.open_editor(epoch, &resolver).unwrap();
                    let id = draft.identity().clone();
                    let mut rev = 0;
                    for raw in step["actions"].as_array().unwrap() {
                        let intent: EditorIntent = serde_json::from_value(raw.clone()).unwrap();
                        rev = draft
                            .apply(&id, rev, epoch, &intent, &resolver)
                            .unwrap()
                            .draft_revision;
                    }
                    let captured = draft.capture(&id, rev, epoch, &resolver).unwrap();
                    let form = captured.feedback();
                    if form["kind"] == "REQUEST" {
                        write(
                            flow.request(captured, epoch, &resolver).unwrap(),
                            &mut writes,
                            &mut active,
                        )
                    }
                    feedback = Some(form);
                }
                "SCOPE" => flow.set_scope(if step["value"].is_null() {
                    None
                } else {
                    Some(serde_json::from_value::<SaveScope>(step["value"].clone()).unwrap())
                }),
                "DATE" => flow.set_date(step["value"].as_str().unwrap().to_owned()),
                "CONFIRM" => write(
                    flow.confirm(epoch, &resolver).unwrap(),
                    &mut writes,
                    &mut active,
                ),
                "UNDO" => write(flow.undo().unwrap(), &mut writes, &mut active),
                "CLOSE" => flow.close(),
                "DISCARD" => flow.discard().unwrap(),
                "END_HISTORY" => flow.end_history().unwrap(),
                "EDIT_PERIOD" => flow.edit_period(step["value"].as_str().unwrap()).unwrap(),
                "ACK" => {
                    let receipt = ProfileEditorReceipt::from_facts(facts(
                        &step["raw"],
                        index as u64 * 100 + n as u64 + 2,
                    ))
                    .unwrap()
                    .unwrap();
                    flow.complete(active.take().expect("native pending IO"), receipt)
                        .unwrap();
                }
                "FAIL" => {
                    let failure = match step["errorKind"].as_str().unwrap() {
                        "USER_FACING" => ProfileFlowIoFailure::UserFacing(
                            step["message"].as_str().unwrap().to_owned(),
                        ),
                        "CONCURRENCY" => ProfileFlowIoFailure::Concurrency,
                        _ => ProfileFlowIoFailure::Generic,
                    };
                    flow.fail(active.take().expect("native pending IO"), failure)
                        .unwrap();
                }
                "CLOCK" => epoch = step["epoch"].as_i64().unwrap(),
                _ => panic!("unknown step"),
            };
            let mut f = frame(&flow, epoch, &writes);
            if let Some(value) = feedback {
                f["form"] = value
            }
            frames.push(f);
            observe(index, n + 1, &flow, epoch);
        }
        assert_eq!(json!(frames), c["expected"], "{}", c["id"]);
    }
}
#[test]
fn original_dialog_history_and_labels_come_from_genuine_native_flow_sources() {
    use luna_engine::runtime::profile_editor_presentation::ProfilePresentationCache;
    let data = value_pool::decode(include_str!(
        "../../reference/profile-presentation-golden.json"
    ));
    let mut index = 0;
    let mut cache = ProfilePresentationCache::default();
    replay_original_flows(|flow_index, frame_index, flow, epoch| {
        if frame_index == 0 {
            cache = ProfilePresentationCache::default();
        }
        for dirty in [false, true] {
            let case = &data["cases"][index];
            assert_eq!(
                case["input"],
                json!({"flowCaseIndex":flow_index,"frameIndex":frame_index,"dirty":dirty})
            );
            assert_eq!(
                cache.present(flow, epoch, dirty).unwrap(),
                case["expected"],
                "{}",
                case["id"]
            );
            index += 1;
        }
    });
    assert_eq!(index, 1612);
}
#[test]
fn original_work_labels_keep_german_rounding_and_all_federal_states() {
    let data = value_pool::decode(include_str!(
        "../../reference/profile-presentation-golden.json"
    ));
    for case in data["workCases"].as_array().unwrap() {
        assert_eq!(
            luna_engine::input::profile_editor::work_label(&case["input"]).unwrap(),
            case["expected"],
            "{}",
            case["id"]
        );
    }
    assert_eq!(data["workCases"].as_array().unwrap().len(), 416);
}
