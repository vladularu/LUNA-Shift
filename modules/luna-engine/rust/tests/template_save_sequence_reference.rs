mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    contract::OwnerIdentity,
    input::{
        template_editor::{TemplateEditorDraft, TemplateSubmission, TemplateSubmitStart},
        template_write::NativeTemplateWriteSource,
    },
    runtime::{
        SnapshotRegistry,
        template_save_sequence::{
            NativeTemplateSaveSequence, TemplateSaveRequest, TemplateSequenceError,
        },
        write_resource::{
            NativeWriteContext, WriteContextKind, WriteContextStamp, WriteResourceError,
        },
    },
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc};
fn stamp(number: u64) -> WriteContextStamp {
    WriteContextStamp::from_raw(&json!({"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":format!("{number:032x}"),"databaseSchemaVersion":35})).unwrap()
}
fn templates(rows: &BTreeMap<String, Value>) -> Vec<Value> {
    NativeTemplateWriteSource::from_raw_rows(Arc::from(rows.values().cloned().collect::<Vec<_>>()))
        .unwrap()
        .active_templates()
        .unwrap()
}
fn submission(
    input: &Value,
    appearance: &Value,
    step: usize,
    current: &[Value],
) -> TemplateSubmission {
    let initial = NativeTemplateWriteSource::from_raw_rows(Arc::from(
        input["templates"].as_array().unwrap().clone(),
    ))
    .unwrap()
    .active_templates()
    .unwrap();
    let existing = initial
        .iter()
        .find(|v| v["id"] == input["existingId"])
        .unwrap_or(&Value::Null);
    let mut draft = TemplateEditorDraft::new_raw(existing, appearance).unwrap();
    for event in &input["steps"].as_array().unwrap()[..step] {
        match event["kind"].as_str().unwrap() {
            "FIELD" => draft
                .set_field(event["field"].as_str().unwrap(), &event["value"])
                .unwrap(),
            "TYPE" => draft.choose_type(event["value"].as_str().unwrap()).unwrap(),
            "CHOOSE_TYPE" => {
                if let Some(kind) = ["CUSTOM", "TRAINING", "VACATION", "SICK", "FREE"]
                    .get(event["value"].as_u64().unwrap() as usize)
                {
                    draft.choose_type(kind).unwrap();
                }
            }
            _ => {}
        }
    }
    let TemplateSubmitStart::Prepared(submission) = draft.prepare_submit(current).unwrap() else {
        panic!("original helper capture must prepare")
    };
    submission
}
fn progress(sequence: &NativeTemplateSaveSequence<Arc<Vec<Value>>>) -> Value {
    sequence.progress().map_or(
        Value::Null,
        |(input, template)| json!({"input":input,"template":template}),
    )
}
#[test]
fn original_helper_progress_and_distinct_native_commits_use_only_raw_io_facts() {
    let data = value_pool::decode(include_str!(
        "../../reference/template-controller-golden.json"
    ));
    assert_eq!(data["cases"].as_array().unwrap().len(), 129);
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("template-sequence", 1).unwrap())
        .unwrap();
    let mut helper_count = 0;
    let mut io_count = 0;
    let mut frames = 0;
    for case in data["cases"].as_array().unwrap() {
        let input = &case["input"];
        let mut sequence = NativeTemplateSaveSequence::<Arc<Vec<Value>>>::default();
        let mut rows = input["openingRows"]["templateRows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| (row["id"].as_str().unwrap().to_owned(), row.clone()))
            .collect::<BTreeMap<_, _>>();
        let mut token = 1;
        common::assert_json_eq(
            &progress(&sequence),
            &case["expected"]["frames"][0]["progress"],
            case["id"].as_str().unwrap(),
        );
        frames += 1;
        for (index, event) in input["steps"].as_array().unwrap().iter().enumerate() {
            let step = index + 1;
            if let Some(capture) = case["observations"]["helperCaptures"]
                .as_array()
                .unwrap()
                .iter()
                .find(|v| v["step"] == step)
            {
                common::assert_json_eq(
                    &progress(&sequence),
                    &capture["previousSave"],
                    case["id"].as_str().unwrap(),
                );
                let submission = submission(input, &data["appearance"], step, &templates(&rows));
                assert_eq!(submission.input_json().unwrap(), capture["inputJson"]);
                sequence
                    .begin(
                        submission,
                        input["quickEntryDate"].as_str(),
                        Arc::new(input["entries"].as_array().unwrap().clone()),
                    )
                    .unwrap();
                helper_count += 1;
            }
            if let Some(raw) = input["rawWriteContexts"]
                .as_array()
                .unwrap()
                .iter()
                .find(|v| v["step"] == step && v["kind"] != "DELETE")
            {
                let observed = case["observations"]["repositoryCalls"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|v| v["step"] == step)
                    .unwrap();
                let (kind, body, request) = match sequence.request().unwrap() {
                    TemplateSaveRequest::Template(value) => {
                        assert_eq!(raw["kind"], "TEMPLATE");
                        (
                            WriteContextKind::Template,
                            json!({"templateRows":raw["before"]["templateRows"]}),
                            value,
                        )
                    }
                    TemplateSaveRequest::Shift(value) => {
                        assert_eq!(raw["kind"], "SHIFT");
                        (
                            WriteContextKind::Day,
                            json!({"shiftRows":raw["before"]["shiftRows"],"appointmentRows":raw["before"]["appointmentRows"]}),
                            value,
                        )
                    }
                    TemplateSaveRequest::Complete(_) => panic!("unexpected completion"),
                };
                common::assert_json_eq(request, &observed["input"], case["id"].as_str().unwrap());
                let context = NativeWriteContext::from_raw(
                    registry.utility_owner_marker().unwrap(),
                    stamp(token),
                    kind,
                    &serde_json::to_vec(&body).unwrap(),
                )
                .unwrap();
                let epochs = raw["epochs"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_f64().unwrap())
                    .collect::<Vec<_>>();
                match sequence.prepare_write(&context, &epochs, raw["allocatedId"].as_str()) {
                    Err(TemplateSequenceError::Write(WriteResourceError::Input(error))) => {
                        let original = case["expected"]["completions"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .find(|v| {
                                v["kind"] == raw["kind"]
                                    && v["input"] == observed["input"]
                                    && v.get("error").is_some()
                            })
                            .unwrap();
                        assert_eq!(error.name(), original["error"]["name"].as_str().unwrap());
                        assert_eq!(
                            error.message(),
                            original["error"]["message"].as_str().unwrap()
                        );
                        sequence.abort();
                    }
                    Err(error) => panic!("{} wrong native sequence error {error:?}", case["id"]),
                    Ok(permit) => {
                        let taken = context.take(&permit).unwrap();
                        let plan: Value = serde_json::from_str(&taken.body).unwrap();
                        let mutations = plan["mutations"].as_array().unwrap();
                        for mutation in mutations {
                            if mutation["kind"] == "UPSERT_SHIFT_TEMPLATE" {
                                let row = &mutation["row"];
                                rows.insert(row["id"].as_str().unwrap().to_owned(), row.clone());
                            }
                        }
                        if !mutations.is_empty() {
                            token += 1;
                        }
                        let committed = context.acknowledge(&permit, stamp(token)).unwrap();
                        if raw["kind"] == "TEMPLATE" {
                            sequence.template_committed(&context, committed).unwrap();
                        } else {
                            sequence.shift_committed(&context, committed).unwrap();
                        }
                    }
                }
                io_count += 1;
            }
            if event["kind"] == "FAIL" {
                sequence.abort();
            }
            common::assert_json_eq(
                &progress(&sequence),
                &case["expected"]["frames"][step]["progress"],
                &format!("{} step{step} progress", case["id"]),
            );
            if matches!(sequence.request(), Some(TemplateSaveRequest::Complete(_))) {
                assert!(sequence.take_completed().is_some());
            }
            frames += 1;
        }
    }
    assert_eq!((helper_count, io_count, frames), (90, 93, 647));
}

fn baseline_submission() -> TemplateSubmission {
    let data = value_pool::decode(include_str!(
        "../../reference/template-controller-golden.json"
    ));
    submission(&data["cases"][0]["input"], &data["appearance"], 4, &[])
}
fn owner_registry() -> SnapshotRegistry {
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("sequence-fences", 1).unwrap())
        .unwrap();
    registry
}
fn empty_context(registry: &SnapshotRegistry) -> NativeWriteContext {
    NativeWriteContext::from_raw(
        registry.utility_owner_marker().unwrap(),
        stamp(1),
        WriteContextKind::Template,
        br#"{"templateRows":[]}"#,
    )
    .unwrap()
}
const EPOCH: f64 = 1_794_495_599_000.0;

#[test]
fn large_capture_is_shared_and_released_on_completion_abort_and_sequence_drop() {
    let registry = owner_registry();
    for finish in ["complete", "abort", "drop"] {
        let rows = Arc::new((0..50_000).map(|index| json!({"kind":"SHIFT","date":"2026-01-01","id":format!("entry{index}"),"templateId":null,"deletedAt":null})).collect::<Vec<_>>());
        let weak = Arc::downgrade(&rows);
        let mut sequence = NativeTemplateSaveSequence::default();
        sequence
            .begin(baseline_submission(), None, Arc::clone(&rows))
            .unwrap();
        assert_eq!(
            Arc::strong_count(&rows),
            2,
            "capture shares one original owner"
        );
        drop(rows);
        assert_eq!(weak.strong_count(), 1);
        assert!(matches!(
            sequence.begin(baseline_submission(), None, Arc::new(Vec::new())),
            Err(TemplateSequenceError::InvalidStage)
        ));
        assert!(!sequence.template_saved_for_active());
        assert!(sequence.take_completed().is_none());
        if finish == "drop" {
            drop(sequence);
        } else if finish == "abort" {
            sequence.abort();
            assert!(sequence.progress().is_none());
        } else {
            let context = empty_context(&registry);
            let permit = sequence
                .prepare_write(&context, &[EPOCH], Some("saved-template"))
                .unwrap();
            context.take(&permit).unwrap();
            let committed = context.acknowledge(&permit, stamp(2)).unwrap();
            sequence.template_committed(&context, committed).unwrap();
            assert!(sequence.template_saved_for_active());
            assert_eq!(
                weak.strong_count(),
                1,
                "capture stays pinned through IO completion"
            );
            assert_eq!(sequence.take_completed().unwrap()["id"], "saved-template");
            assert!(
                sequence.progress().is_some(),
                "small genuine native progress survives"
            );
            assert!(sequence.take_completed().is_none());
        }
        assert!(
            weak.upgrade().is_none(),
            "{finish} must release the large capture"
        );
    }
}

#[test]
fn foreign_context_and_owner_reset_cannot_publish_saved_progress() {
    for owner_reset in [false, true] {
        let registry = owner_registry();
        let context = empty_context(&registry);
        let foreign = empty_context(&registry);
        let mut sequence = NativeTemplateSaveSequence::default();
        sequence
            .begin(baseline_submission(), None, Arc::new(Vec::<Value>::new()))
            .unwrap();
        let permit = sequence
            .prepare_write(&context, &[EPOCH], Some("saved-template"))
            .unwrap();
        context.take(&permit).unwrap();
        let committed = context.acknowledge(&permit, stamp(2)).unwrap();
        let result = if owner_reset {
            registry
                .reset_for_owner(&OwnerIdentity::new("sequence-fences", 2).unwrap())
                .unwrap();
            sequence.template_committed(&context, committed)
        } else {
            sequence.template_committed(&foreign, committed)
        };
        assert!(matches!(
            result,
            Err(TemplateSequenceError::Write(
                WriteResourceError::OwnerChanged | WriteResourceError::ForeignPermit
            ))
        ));
        assert!(!sequence.template_saved_for_active());
        assert!(sequence.progress().is_none());
        assert!(matches!(
            sequence.request(),
            Some(TemplateSaveRequest::Template(_))
        ));
        sequence.abort();
    }
}

struct EffectiveEntry {
    base: Value,
    date: Value,
    template: Value,
}
impl luna_engine::calendar::window::CalendarRecordSource for EffectiveEntry {
    fn entries_len(&self) -> usize {
        1
    }
    fn base_value(&self, _index: usize) -> &Value {
        &self.base
    }
    fn field(&self, _index: usize, key: &str) -> Option<&Value> {
        match key {
            "date" => Some(&self.date),
            "templateId" => Some(&self.template),
            _ => self.base.get(key),
        }
    }
}
#[test]
fn quick_match_uses_effective_borrowed_fields_without_expanding_or_using_base_date() {
    let registry = owner_registry();
    let context = empty_context(&registry);
    let rows = EffectiveEntry {
        base: json!({"kind":"SHIFT","date":"1999-01-01","templateId":null,"deletedAt":null,"type":"CUSTOM"}),
        date: json!("2026-11-12"),
        template: json!("saved-template"),
    };
    let mut sequence = NativeTemplateSaveSequence::default();
    sequence
        .begin(baseline_submission(), Some("2026-11-12"), rows)
        .unwrap();
    let permit = sequence
        .prepare_write(&context, &[EPOCH], Some("saved-template"))
        .unwrap();
    context.take(&permit).unwrap();
    let committed = context.acknowledge(&permit, stamp(2)).unwrap();
    sequence.template_committed(&context, committed).unwrap();
    assert!(matches!(
        sequence.request(),
        Some(TemplateSaveRequest::Complete(_))
    ));
    assert!(sequence.prepare_write(&context, &[EPOCH], None).is_err());
    assert!(sequence.take_completed().is_some());
}
