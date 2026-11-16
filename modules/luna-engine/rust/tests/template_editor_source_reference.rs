mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    contract::{OwnerIdentity, assembly::SnapshotAssembly},
    input::template_editor::TemplateSubmitStart,
    runtime::{
        SnapshotRegistry,
        profile_editor_source::LightProfileContext,
        template_editor_source::{
            NativeTemplateCollection, NativeTemplateEditorSource, TemplateEditorOpenRequest,
            TemplateEditorSourceError, TemplateRowsRead,
        },
        write_resource::WriteContextStamp,
    },
};
use serde_json::{Value, json};
use std::sync::Arc;

fn stamp() -> WriteContextStamp {
    WriteContextStamp::from_raw(&json!({"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":"11111111111111111111111111111111","databaseSchemaVersion":35})).unwrap()
}
fn registry() -> SnapshotRegistry {
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("template-source", 1).unwrap())
        .unwrap();
    registry
}
fn light(registry: &SnapshotRegistry, input: &Value, index: usize) -> LightProfileContext {
    let mut assembly=SnapshotAssembly::begin(&serde_json::to_vec(&json!({"ownerScope":"template-source","ownerEpoch":1,"snapshotId":format!("template-{index}"),"snapshotRevision":1,"selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}})).unwrap()).unwrap();
    for (kind, value) in [
        ("WORK_PROFILE", &input["rawProfile"]["profile"]),
        ("REMUNERATION_PROFILES", &input["rawProfile"]["historyRows"]),
        ("WORK_PATTERN_SETTINGS", &input["rawProfile"]["patternRows"]),
    ] {
        let header = json!({"kind":kind,"source":{"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":if value.is_null(){"NULL"}else{"VALUE"}}}}});
        assembly
            .source(
                &serde_json::to_vec(&header).unwrap(),
                &if value.is_null() {
                    vec![]
                } else {
                    serde_json::to_vec(value).unwrap()
                },
            )
            .unwrap();
    }
    LightProfileContext::prepare(
        registry.utility_owner_marker().unwrap(),
        stamp(),
        assembly,
        input["observedEpochMilliseconds"].as_i64().unwrap(),
    )
    .unwrap()
}
fn collection(input: &Value) -> NativeTemplateCollection {
    NativeTemplateCollection::from_raw(TemplateRowsRead::Value(
        &serde_json::to_vec(&input["templates"]).unwrap(),
    ))
    .unwrap()
}
fn open_source(
    registry: &SnapshotRegistry,
    input: &Value,
    index: usize,
    templates: &NativeTemplateCollection,
) -> NativeTemplateEditorSource {
    NativeTemplateEditorSource::from_light(
        light(registry, input, index),
        &stamp(),
        TemplateEditorOpenRequest {
            template_id: input["existingId"].as_str().map(str::to_owned),
            quick_entry_date: input["quickEntryDate"].as_str().map(str::to_owned),
        },
        templates,
    )
    .unwrap()
}
#[test]
fn genuine_raw3_and_sql_templates_match_all_original_form_prefixes() {
    let data = value_pool::decode(include_str!("../../reference/template-editor-golden.json"));
    let registry = registry();
    assert_eq!(data["cases"].as_array().unwrap().len(), 129);
    let mut frames = 0;
    for (index, case) in data["cases"].as_array().unwrap().iter().enumerate() {
        let input = &case["input"];
        let templates = collection(input);
        let preparation = registry.preparation_marker().unwrap();
        let source = open_source(&registry, input, index, &templates);
        let mut draft = source.new_draft(&data["appearance"]).unwrap();
        let ios = input["platform"] == "ios";
        let mut effects = Vec::<Value>::new();
        let mut writes = Vec::<Value>::new();
        let steps = input["steps"].as_array().unwrap();
        for frame in 0..=steps.len() {
            if frame > 0 {
                let step = &steps[frame - 1];
                match step["kind"].as_str().unwrap(){
                    "COMMIT"|"FAIL"|"CONFIRM_ARCHIVE"=>break,
                    "FIELD"=>draft.set_field(step["field"].as_str().unwrap(),&step["value"]).unwrap(),
                    "TYPE"=>draft.choose_type(step["value"].as_str().unwrap()).unwrap(),
                    "OPEN_TYPE"=>{if let Some(effect)=draft.open_type_picker(ios,input["dark"]==true){effects.push(effect);}},
                    "CHOOSE_TYPE"=>{if let Some(kind)=["CUSTOM","TRAINING","VACATION","SICK","FREE"].get(step["value"].as_u64().unwrap()as usize){draft.choose_type(kind).unwrap();}},
                    "SET_EXISTING"=>{},
                    "ARCHIVE"=>{if let Some(effect)=draft.delete_confirmation(){effects.push(effect);}},
                    "SUBMIT"=>match source.prepare_submit(&mut draft,&templates).unwrap(){
                        TemplateSubmitStart::Ignored=>{},
                        TemplateSubmitStart::Blocked{field,message}=>effects.push(json!({"kind":"FOCUS","field":field,"message":message})),
                        TemplateSubmitStart::Prepared(submission)=>writes.push(json!({"kind":"TEMPLATE","input":submission.input(),"inputJson":submission.input_json().unwrap()})),
                    },
                    other=>panic!("unhandled original prefix {other}"),
                }
            }
            let expected = &case["expected"]["frames"][frame];
            common::assert_json_eq(
                &source.render(&draft, ios).unwrap(),
                &json!({"fields":expected["fields"],"flags":expected["flags"],"controls":expected["controls"]}),
                &format!("{} frame{frame}", case["id"]),
            );
            common::assert_json_eq(
                &json!(effects),
                &expected["effects"],
                case["id"].as_str().unwrap(),
            );
            common::assert_json_eq(
                &json!(writes),
                &expected["writes"],
                case["id"].as_str().unwrap(),
            );
            assert!(
                preparation.is_current().unwrap(),
                "source construction must not enter global report preparation"
            );
            frames += 1;
        }
    }
    assert_eq!(frames, 509);
}

#[test]
fn template_io_states_and_malformed_sources_never_become_empty_ready_templates() {
    use TemplateEditorSourceError as E;
    assert!(matches!(
        NativeTemplateCollection::from_raw(TemplateRowsRead::NotRequested),
        Err(E::TemplatesNotRequested)
    ));
    assert!(matches!(
        NativeTemplateCollection::from_raw(TemplateRowsRead::Loading),
        Err(E::TemplatesLoading)
    ));
    assert!(matches!(
        NativeTemplateCollection::from_raw(TemplateRowsRead::Failed),
        Err(E::TemplatesFailed)
    ));
    assert!(matches!(
        NativeTemplateCollection::from_raw(TemplateRowsRead::Null),
        Err(E::InvalidSource)
    ));
    for bytes in [
        b"null".as_slice(),
        b"{}",
        b"[false]",
        b"{\"a\":1,\"a\":2}",
        &[0xff],
    ] {
        assert!(NativeTemplateCollection::from_raw(TemplateRowsRead::Value(bytes)).is_err());
    }
    assert!(
        NativeTemplateCollection::from_raw(TemplateRowsRead::Value(b"[]"))
            .unwrap()
            .templates()
            .is_empty()
    );
    let bytes = vec![b' '; 16_515_073];
    assert!(matches!(
        NativeTemplateCollection::from_raw(TemplateRowsRead::Value(&bytes)),
        Err(E::InvalidSource)
    ));
    let data = value_pool::decode(include_str!("../../reference/template-editor-golden.json"));
    let input = &data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| !c["input"]["templates"].as_array().unwrap().is_empty())
        .unwrap()["input"];
    let row = input["templates"][0].clone();
    assert!(NativeTemplateCollection::from_raw_rows(Arc::from(vec![row.clone(), row])).is_err());
}

#[test]
fn initial_selection_is_immutable_while_submit_borrows_the_current_template_list() {
    let data = value_pool::decode(include_str!("../../reference/template-editor-golden.json"));
    let registry = registry();
    let input = &data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "type/CUSTOM/true")
        .unwrap()["input"];
    let initial = collection(input);
    let source = open_source(&registry, input, 1, &initial);
    let mut changed = input.clone();
    changed["templates"][0]["name"] = json!("Changed later");
    changed["templates"][0]["sort_order"] = json!(90);
    changed["templates"][0]["revision"] = json!(2);
    let current = collection(&changed);
    assert_ne!(current.templates()[0], *source.initial().unwrap());
    let mut draft = source.new_draft(&data["appearance"]).unwrap();
    assert_eq!(draft.fields()["name"], source.initial().unwrap()["name"]);
    let TemplateSubmitStart::Prepared(submission) =
        source.prepare_submit(&mut draft, &current).unwrap()
    else {
        panic!("prepared")
    };
    assert_eq!(
        submission.input()["expectedRevision"],
        source.initial().unwrap()["revision"]
    );
    assert_eq!(
        submission.input()["sortOrder"],
        source.initial().unwrap()["sortOrder"]
    );
    changed["existingId"] = Value::Null;
    let create = open_source(&registry, &changed, 2, &current);
    let mut draft = create.new_draft(&data["appearance"]).unwrap();
    let TemplateSubmitStart::Prepared(submission) =
        create.prepare_submit(&mut draft, &current).unwrap()
    else {
        panic!("prepared")
    };
    assert_eq!(submission.input()["sortOrder"], 100);
    assert!(submission.input().get("id").is_none());
    // Opening after a reload that no longer contains the target is different
    // from retaining this editor's immutable initial value.
    let empty = NativeTemplateCollection::from_raw_rows(Arc::from(vec![])).unwrap();
    assert!(matches!(
        NativeTemplateEditorSource::from_light(
            light(&registry, input, 3),
            &stamp(),
            TemplateEditorOpenRequest {
                template_id: input["existingId"].as_str().map(str::to_owned),
                quick_entry_date: None
            },
            &empty
        ),
        Err(TemplateEditorSourceError::MissingTemplate)
    ));
    let mut different = serde_json::to_value(stamp()).unwrap();
    different["dataSpaceId"] = json!("22222222222222222222222222222222");
    let different = WriteContextStamp::from_raw(&different).unwrap();
    assert!(matches!(
        NativeTemplateEditorSource::from_light(
            light(&registry, input, 4),
            &different,
            TemplateEditorOpenRequest {
                template_id: None,
                quick_entry_date: None
            },
            &initial
        ),
        Err(TemplateEditorSourceError::StampChanged)
    ));
}

fn empty_loaded(
    registry: SnapshotRegistry,
) -> (
    luna_engine::runtime::calendar_loaded::CalendarLoadedPool,
    luna_engine::runtime::calendar_loaded::LoadedReadSource,
) {
    use luna_engine::{
        calendar::loaded_scope::RawScopeRows,
        runtime::calendar_loaded::{CalendarLoadedPool, LoadedStart},
    };
    let pool = CalendarLoadedPool::new(registry);
    pool.bind_locale("empty-original-no-comparator").unwrap();
    let LoadedStart::Read(ticket) = pool
        .active_month("2026-11", 1_794_495_599_000, "rows-1")
        .unwrap()
    else {
        panic!("read")
    };
    let intake = pool.reserve_source(&ticket).unwrap();
    let raw = RawScopeRows::new(Arc::from(vec![]), Arc::from(vec![]), Arc::from(vec![])).unwrap();
    let draft = pool.prepare_query(intake, raw).unwrap();
    assert!(draft.candidates().is_empty());
    let draft = pool.finish_query(draft, b"{}").unwrap();
    let source = pool.finalize_cached(draft).unwrap().source.unwrap();
    (pool, source)
}

#[test]
fn submission_pin_proves_only_core_owner_and_keeps_captured_rows_after_live_scope_changes() {
    let data = value_pool::decode(include_str!("../../reference/template-editor-golden.json"));
    let input = &data["cases"][0]["input"];
    let registry = registry();
    let templates = collection(input);
    let source = open_source(&registry, input, 1, &templates);
    let (pool, read) = empty_loaded(registry.clone());
    let capture = source.pin_entries_for_submission(&read, 17).unwrap();
    assert_eq!(capture.entries_for_write(17).unwrap().entries().len(), 0);
    assert!(capture.entries_for_write(18).is_err());
    let foreign = SnapshotRegistry::default();
    foreign
        .reset_for_owner(&OwnerIdentity::new("template-source", 1).unwrap())
        .unwrap();
    let (_other, other_read) = empty_loaded(foreign);
    assert!(matches!(
        source.pin_entries_for_submission(&other_read, 17),
        Err(TemplateEditorSourceError::ForeignLoadedSource)
    ));
    pool.unmount().unwrap();
    assert!(!read.is_current().unwrap());
    assert!(source.pin_entries_for_submission(&read, 18).is_err());
    assert!(capture.is_current_for_write(17).unwrap());
    let draft = source.new_draft(&data["appearance"]).unwrap();
    registry
        .reset_for_owner(&OwnerIdentity::new("template-source", 1).unwrap())
        .unwrap();
    assert!(!capture.is_current_for_write(17).unwrap());
    assert!(matches!(
        source.render(&draft, true),
        Err(TemplateEditorSourceError::OwnerChanged)
    ));
}

#[test]
fn large_raw_template_owner_is_not_retained_by_a_small_source_or_view() {
    use luna_engine::input::calendar_rows::TEMPLATE_ROW_FIELDS;
    let data = value_pool::decode(include_str!("../../reference/template-editor-golden.json"));
    let input = &data["cases"][0]["input"];
    let mut deleted = serde_json::Map::new();
    for field in TEMPLATE_ROW_FIELDS {
        deleted.insert((*field).into(), Value::Null);
    }
    for key in ["name", "created_at", "updated_at", "deleted_at"] {
        deleted.insert(key.into(), json!("x"));
    }
    deleted.insert("revision".into(), json!(1));
    let rows: Arc<[Value]> = (0..50_000)
        .map(|i| {
            let mut row = deleted.clone();
            row.insert("id".into(), json!(i.to_string()));
            Value::Object(row)
        })
        .collect::<Vec<_>>()
        .into();
    let weak = Arc::downgrade(&rows);
    let templates = NativeTemplateCollection::from_raw_rows(rows).unwrap();
    assert!(templates.templates().is_empty());
    assert!(
        weak.upgrade().is_none(),
        "the normalized source must release the physical row owner"
    );
    let registry = registry();
    let source = open_source(&registry, input, 1, &templates);
    let draft = source.new_draft(&data["appearance"]).unwrap();
    let view = source.render(&draft, true).unwrap();
    assert!(serde_json::to_vec(&view).unwrap().len() < 4096);
    assert!(view.get("profile").is_none());
    assert!(view.get("templates").is_none());
}

#[test]
fn malformed_route_or_stale_opening_cannot_create_an_editor_source() {
    let data = value_pool::decode(include_str!("../../reference/template-editor-golden.json"));
    let input = &data["cases"][0]["input"];
    let registry = registry();
    let templates = collection(input);
    for (index, request) in [
        TemplateEditorOpenRequest {
            template_id: Some(String::new()),
            quick_entry_date: None,
        },
        TemplateEditorOpenRequest {
            template_id: Some("x".repeat(257)),
            quick_entry_date: None,
        },
        TemplateEditorOpenRequest {
            template_id: None,
            quick_entry_date: Some("2026-02-30".into()),
        },
        TemplateEditorOpenRequest {
            template_id: None,
            quick_entry_date: Some("bad".into()),
        },
    ]
    .into_iter()
    .enumerate()
    {
        assert!(
            NativeTemplateEditorSource::from_light(
                light(&registry, input, index),
                &stamp(),
                request,
                &templates
            )
            .is_err()
        );
    }
    let captured = light(&registry, input, 10);
    registry
        .reset_for_owner(&OwnerIdentity::new("template-source", 1).unwrap())
        .unwrap();
    assert!(matches!(
        NativeTemplateEditorSource::from_light(
            captured,
            &stamp(),
            TemplateEditorOpenRequest {
                template_id: None,
                quick_entry_date: None
            },
            &templates
        ),
        Err(TemplateEditorSourceError::OwnerChanged)
    ));
}

fn sequence_request(
    sequence: &luna_engine::runtime::template_save_sequence::NativeTemplateSaveSequence<
        Arc<Vec<Value>>,
    >,
) -> Option<Value> {
    use luna_engine::runtime::template_save_sequence::TemplateSaveRequest;
    let (kind, input) = match sequence.request()? {
        TemplateSaveRequest::Template(input) => ("TEMPLATE", input),
        TemplateSaveRequest::Shift(input) => ("SHIFT", input),
        TemplateSaveRequest::Complete(_) => return None,
    };
    Some(
        json!({"kind":kind,"input":input,"inputJson":luna_engine::input::javascript_json::stringify(input).unwrap()}),
    )
}
fn advance_sequence(
    sequence: &mut luna_engine::runtime::template_save_sequence::NativeTemplateSaveSequence<
        Arc<Vec<Value>>,
    >,
    draft: &mut luna_engine::input::template_editor::TemplateEditorDraft,
    date: Option<&str>,
    writes: &mut Vec<Value>,
    pending: &mut std::collections::VecDeque<Value>,
    effects: &mut Vec<Value>,
) {
    if sequence.take_completed().is_some() {
        effects.extend(draft.submit_succeeded(date));
    } else if let Some(request) = sequence_request(sequence) {
        writes.push(request.clone());
        pending.push_back(request);
    }
}
fn control_stamp(number: u64) -> WriteContextStamp {
    WriteContextStamp::from_raw(&json!({"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":format!("{number:032x}"),"databaseSchemaVersion":35})).unwrap()
}
#[test]
fn all_original_full_ui_frames_and_completion_effects_follow_genuine_native_writes() {
    use luna_engine::{
        input::{entry_editor_save::EntrySaveFailure, template_write::TemplateWriteOperation},
        runtime::{
            template_save_sequence::{NativeTemplateSaveSequence, TemplateSequenceError},
            write_resource::{NativeWriteContext, WriteContextKind, WriteResourceError},
        },
    };
    use std::collections::VecDeque;
    let data = value_pool::decode(include_str!(
        "../../reference/template-controller-golden.json"
    ));
    let registry = registry();
    let mut frame_count = 0;
    let mut io_count = 0;
    for (index, case) in data["cases"].as_array().unwrap().iter().enumerate() {
        let input = &case["input"];
        let templates = collection(input);
        let source = open_source(&registry, input, index, &templates);
        let mut draft = source.new_draft(&data["appearance"]).unwrap();
        let mut current_templates = templates.templates().to_vec();
        let mut entries = Arc::new(input["entries"].as_array().unwrap().clone());
        let ios = input["platform"] == "ios";
        let date = input["quickEntryDate"].as_str();
        let mut sequence = NativeTemplateSaveSequence::default();
        let mut effects = Vec::<Value>::new();
        let mut writes = Vec::<Value>::new();
        let mut pending = VecDeque::<Value>::new();
        let mut token = 1;
        let steps = input["steps"].as_array().unwrap();
        for frame in 0..=steps.len() {
            if frame > 0 {
                let step = &steps[frame - 1];
                match step["kind"].as_str().unwrap() {
                    "FIELD" => draft
                        .set_field(step["field"].as_str().unwrap(), &step["value"])
                        .unwrap(),
                    "TYPE" => draft.choose_type(step["value"].as_str().unwrap()).unwrap(),
                    "OPEN_TYPE" => {
                        if let Some(effect) = draft.open_type_picker(ios, input["dark"] == true) {
                            effects.push(effect);
                        }
                    }
                    "CHOOSE_TYPE" => {
                        if let Some(kind) = ["CUSTOM", "TRAINING", "VACATION", "SICK", "FREE"]
                            .get(step["value"].as_u64().unwrap() as usize)
                        {
                            draft.choose_type(kind).unwrap();
                        }
                    }
                    "SET_EXISTING" => {}
                    // These are original controlled-provider props in this pure UI oracle,
                    // never a public host Ready-list admission.
                    "SET_TEMPLATES" => {
                        current_templates = step["value"].as_array().unwrap().clone()
                    }
                    "SET_ENTRIES" => entries = Arc::new(step["value"].as_array().unwrap().clone()),
                    "ARCHIVE" => {
                        if let Some(effect) = draft.delete_confirmation() {
                            effects.push(effect);
                        }
                    }
                    "CONFIRM_ARCHIVE" => {
                        let initial = source
                            .initial()
                            .expect("original archive has initial template");
                        let request = json!({"kind":"DELETE","input":initial,"inputJson":luna_engine::input::javascript_json::stringify(initial).unwrap()});
                        writes.push(request.clone());
                        pending.push_back(request);
                    }
                    "SUBMIT" => match draft.prepare_submit(&current_templates) {
                        Ok(TemplateSubmitStart::Ignored) => {}
                        Ok(TemplateSubmitStart::Blocked { field, message }) => {
                            effects.push(json!({"kind":"FOCUS","field":field,"message":message}))
                        }
                        Ok(TemplateSubmitStart::Prepared(submission)) => {
                            sequence
                                .begin(submission, date, Arc::clone(&entries))
                                .unwrap();
                            advance_sequence(
                                &mut sequence,
                                &mut draft,
                                date,
                                &mut writes,
                                &mut pending,
                                &mut effects,
                            );
                        }
                        Err(error) => {
                            effects.extend(draft.submit_failed(
                                &EntrySaveFailure::from_input_error(&error),
                                date,
                                false,
                            ));
                        }
                    },
                    "FAIL" => {
                        let request = pending.pop_front().unwrap();
                        // The original fixture explicitly constructs these exception classes.
                        // Production uses native InputError ancestry or opaque IO failure.
                        let failure = match step["name"].as_str().unwrap() {
                            "UserFacingError" => EntrySaveFailure::UserFacing(
                                step["message"].as_str().unwrap().to_owned(),
                            ),
                            "ConcurrencyError" => EntrySaveFailure::UserFacing(
                                "Der Eintrag wurde zwischenzeitlich geändert. Bitte neu laden."
                                    .into(),
                            ),
                            "Error" => EntrySaveFailure::Internal,
                            other => panic!("unhandled original injected exception {other}"),
                        };
                        if request["kind"] == "DELETE" {
                            effects.extend(draft.archive_finished(Some(&failure)));
                        } else {
                            effects.extend(draft.submit_failed(
                                &failure,
                                date,
                                sequence.template_saved_for_active(),
                            ));
                            sequence.abort();
                        }
                    }
                    "COMMIT" => {
                        let request = pending.pop_front().unwrap();
                        let raw = input["rawWriteContexts"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .find(|raw| raw["step"] == frame)
                            .unwrap();
                        assert_eq!(raw["kind"], request["kind"], "{} frame{frame}", case["id"]);
                        let archive = request["kind"] == "DELETE";
                        let kind = if request["kind"] == "SHIFT" {
                            WriteContextKind::Day
                        } else {
                            WriteContextKind::Template
                        };
                        let body = if kind == WriteContextKind::Day {
                            json!({"shiftRows":raw["before"]["shiftRows"],"appointmentRows":raw["before"]["appointmentRows"]})
                        } else {
                            json!({"templateRows":raw["before"]["templateRows"]})
                        };
                        let context = NativeWriteContext::from_raw(
                            registry.utility_owner_marker().unwrap(),
                            control_stamp(token),
                            kind,
                            &serde_json::to_vec(&body).unwrap(),
                        )
                        .unwrap();
                        let epochs = raw["epochs"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .map(|value| value.as_f64().unwrap())
                            .collect::<Vec<_>>();
                        let permit = if archive {
                            let initial = source
                                .initial()
                                .expect("original archive has initial template");
                            context
                                .prepare_template(
                                    TemplateWriteOperation::Delete,
                                    initial,
                                    &epochs,
                                    None,
                                )
                                .map_err(TemplateSequenceError::Write)
                        } else {
                            sequence.prepare_write(&context, &epochs, raw["allocatedId"].as_str())
                        };
                        match permit {
                            Err(TemplateSequenceError::Write(WriteResourceError::Input(error)))
                            | Err(TemplateSequenceError::Input(error)) => {
                                let failure = EntrySaveFailure::from_input_error(&error);
                                if archive {
                                    effects.extend(draft.archive_finished(Some(&failure)));
                                } else {
                                    effects.extend(draft.submit_failed(
                                        &failure,
                                        date,
                                        sequence.template_saved_for_active(),
                                    ));
                                    sequence.abort();
                                }
                            }
                            Err(other) => panic!(
                                "unexpected native failure {} frame{frame}: {other:?}",
                                case["id"]
                            ),
                            Ok(permit) => {
                                let taken = context.take(&permit).unwrap();
                                let plan: Value = serde_json::from_str(&taken.body).unwrap();
                                if !plan["mutations"].as_array().unwrap().is_empty() {
                                    token += 1;
                                }
                                let committed =
                                    context.acknowledge(&permit, control_stamp(token)).unwrap();
                                if archive {
                                    context.committed_template(committed).unwrap();
                                    current_templates.retain(|template| {
                                        template["id"] != source.initial().unwrap()["id"]
                                    });
                                    effects.extend(draft.archive_finished(None));
                                } else {
                                    let result = if request["kind"] == "TEMPLATE" {
                                        sequence.template_committed(&context, committed)
                                    } else {
                                        sequence.shift_committed(&context, committed)
                                    };
                                    match result {
                                        Ok(()) => {
                                            if request["kind"] == "TEMPLATE" {
                                                let saved = sequence.progress().unwrap().1;
                                                if let Some(at) =
                                                    current_templates.iter().position(|template| {
                                                        template["id"] == saved["id"]
                                                    })
                                                {
                                                    current_templates[at] = saved.clone();
                                                } else {
                                                    current_templates.push(saved.clone());
                                                }
                                            }
                                            advance_sequence(
                                                &mut sequence,
                                                &mut draft,
                                                date,
                                                &mut writes,
                                                &mut pending,
                                                &mut effects,
                                            );
                                        }
                                        Err(TemplateSequenceError::Write(
                                            WriteResourceError::Input(error),
                                        ))
                                        | Err(TemplateSequenceError::Input(error)) => {
                                            effects.extend(draft.submit_failed(
                                                &EntrySaveFailure::from_input_error(&error),
                                                date,
                                                sequence.template_saved_for_active(),
                                            ));
                                            sequence.abort();
                                        }
                                        Err(other) => {
                                            panic!("unexpected native ACK failure {other:?}")
                                        }
                                    }
                                }
                            }
                        }
                        io_count += 1;
                    }
                    other => panic!("unhandled original UI event {other}"),
                }
            }
            let expected = &case["expected"]["frames"][frame];
            let label = format!("{} frame{frame}", case["id"]);
            common::assert_json_eq(
                &source.render(&draft, ios).unwrap(),
                &json!({"fields":expected["fields"],"flags":expected["flags"],"controls":expected["controls"]}),
                &label,
            );
            assert_eq!(
                draft.save_state(),
                expected["saveState"].as_str().unwrap(),
                "{label}"
            );
            let progress = sequence.progress().map_or(
                Value::Null,
                |(input, template)| json!({"input":input,"template":template}),
            );
            common::assert_json_eq(&progress, &expected["progress"], &label);
            common::assert_json_eq(&json!(effects), &expected["effects"], &label);
            common::assert_json_eq(&json!(writes), &expected["writes"], &label);
            common::assert_json_eq(&json!(pending), &expected["pending"], &label);
            frame_count += 1;
        }
    }
    assert_eq!((frame_count, io_count), (647, 96));
}
