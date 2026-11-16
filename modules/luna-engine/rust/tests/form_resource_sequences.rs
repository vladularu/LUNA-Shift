use luna_engine::{
    contract::{self, OwnerIdentity},
    runtime::{SnapshotRegistry, form_resource::FormResourcePool},
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
#[path = "support/value_pool.rs"]
mod value_pool;
struct Driver {
    pool: FormResourcePool,
    registry: SnapshotRegistry,
    revision: u64,
    request: String,
    id: u64,
    last: Value,
    epoch: i64,
    token: u64,
}
impl Driver {
    fn stamp(&self) -> Value {
        json!({"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":format!("{:032x}",self.token),"databaseSchemaVersion":35})
    }
    fn call(&mut self, mut command: Value, body: &[u8]) -> Value {
        if command.get("resourceId").is_some() {
            command["resourceId"] = json!(self.id);
        }
        if command.get("resourceRevision").is_some() {
            command["resourceRevision"] = json!(self.revision);
        }
        let header = json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"form-sequence","ownerEpoch":1,"requestId":self.request,"draftRevision":self.revision},"command":command});
        let prepared = self
            .pool
            .prepare(
                &self.registry,
                &self.registry.utility_owner_marker().unwrap(),
                &serde_json::to_vec(&header).unwrap(),
                body,
            )
            .unwrap_or_else(|e| panic!("{}: {} {e:?}", self.request, command));
        let reply: Value = serde_json::from_slice(&prepared.complete().unwrap()).unwrap();
        if let Some(r) = reply["resourceRevision"].as_u64() {
            self.revision = r;
        }
        self.last = reply.clone();
        reply
    }
    fn event(&mut self, event: Value) {
        self.call(json!({"kind":"PROFILE_EVENT","resourceId":0,"resourceRevision":0,"observedEpochMilliseconds":self.epoch,"event":event}),b"");
    }
    fn open(case: &Value, index: usize) -> Self {
        let registry = SnapshotRegistry::default();
        registry
            .reset_for_owner(&OwnerIdentity::new("form-sequence", 1).unwrap())
            .unwrap();
        let mut d = Self {
            pool: FormResourcePool::new(),
            registry,
            revision: 0,
            request: format!("compound-{index}"),
            id: 0,
            last: Value::Null,
            epoch: case["input"]["initial"]["observedEpochMilliseconds"]
                .as_i64()
                .unwrap(),
            token: 1,
        };
        let i = &case["input"];
        let opened=d.call(json!({"kind":"BEGIN_PROFILE","stamp":d.stamp(),"observedEpochMilliseconds":d.epoch,"section":i["section"],"fromMore":i["fromMore"]}),b"");
        let builder = opened["builderId"].as_u64().unwrap();
        for (kind, key) in [
            ("WORK_PROFILE", "profile"),
            ("REMUNERATION_PROFILES", "historyRows"),
            ("WORK_PATTERN_SETTINGS", "patternRows"),
        ] {
            let value = &i["initial"][key];
            let null = value.is_null();
            let body = if null {
                vec![]
            } else {
                serde_json::to_vec(value).unwrap()
            };
            d.call(json!({"kind":"SOURCE","builderId":builder,"group":{"kind":kind,"source":{"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":if null{"NULL"}else{"VALUE"}}}}}}),&body);
        }
        let open = d.call(json!({"kind":"OPEN_PROFILE","builderId":builder}), b"");
        assert_eq!(open["state"], "PROFILE_READY", "{}", case["id"]);
        d.id = open["resourceId"].as_u64().unwrap();
        d
    }
}
fn expected_view(frame: &Value) -> Value {
    let mut flow = frame["flow"].clone();
    let has = !flow["receipt"].is_null();
    let object = flow.as_object_mut().unwrap();
    for key in ["base", "current", "receipt"] {
        object.remove(key);
    }
    flow["hasReceipt"] = json!(has);
    json!({"flow":flow,"editor":frame["editor"],"feedback":frame["feedback"],"direct":frame["direct"]})
}
fn assert_presentation(
    actual: &Value,
    data: &Value,
    editor: &Value,
    case: usize,
    frame: usize,
    index: usize,
) {
    let expected = &data["cases"][index];
    assert_eq!(
        expected["input"],
        json!({"caseIndex":case,"frameIndex":frame})
    );
    assert_eq!(
        json!({"dialog":actual["presentation"]["dialog"],"feedback":actual["presentation"]["feedback"]}),
        expected["expected"],
        "{} native presentation",
        expected["id"]
    );
    let editor_expected = &editor["cases"][index];
    assert_eq!(editor_expected["input"], expected["input"]);
    assert_eq!(
        actual["presentation"]["editor"], editor_expected["expected"],
        "{} native editor props",
        expected["id"]
    );
}
#[test]
fn actual_private_pool_matches_original_ui_save_hook_and_original_sql_receipt_sequences() {
    let data = value_pool::decode(include_str!(
        "../../reference/profile-editor-resource-golden.json"
    ));
    let presentation = value_pool::decode(include_str!(
        "../../reference/profile-presentation-resource-golden.json"
    ));
    let editor = value_pool::decode(include_str!(
        "../../reference/profile-editor-view-resource-golden.json"
    ));
    assert_eq!(editor["cases"].as_array().unwrap().len(), 1480);
    assert_eq!(presentation["cases"].as_array().unwrap().len(), 1480);
    assert_eq!(data["cases"].as_array().unwrap().len(), 280);
    let mut frames = 0;
    let mut commits = 0;
    let mut errors = 0;
    let dump = std::env::var("LUNA_PROFILE_EDITOR_UI_DUMP").ok();
    let mut actual_frames = Vec::new();
    for (index, case) in data["cases"].as_array().unwrap().iter().enumerate() {
        let mut driver = Driver::open(case, index);
        assert_eq!(
            driver.last["view"],
            expected_view(&case["expected"]["frames"][0]),
            "{} initial",
            case["id"]
        );
        assert_presentation(&driver.last, &presentation, &editor, index, 0, frames);
        if dump.is_some() {
            actual_frames.push(json!({"id":case["id"],"caseIndex":index,"frameIndex":0,"actual":{"view":driver.last["view"],"presentation":driver.last["presentation"]}}));
        }
        frames += 1;
        let mut write = 0;
        for (n, step) in case["input"]["steps"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
        {
            let kind = step["kind"].as_str().unwrap();
            if kind == "COMMIT" {
                if driver.last["writeId"].is_u64() {
                    let id = driver.last["writeId"].as_u64().unwrap();
                    let raw = &case["expected"]["rawWrites"][write];
                    assert!(raw.is_object(), "{} unexpected native write", case["id"]);
                    let prepared=driver.call(json!({"kind":"WRITE_CONTEXT","resourceId":0,"resourceRevision":0,"writeId":id,"stamp":driver.stamp(),"observedEpochMilliseconds":driver.epoch}),&serde_json::to_vec(&raw["before"]).unwrap());
                    if raw["result"]["ok"] == true {
                        assert_eq!(prepared["state"], "WRITE_PERMIT_READY", "{}", case["id"]);
                        let taken=driver.call(json!({"kind":"TAKE_WRITE","resourceId":0,"resourceRevision":0,"writeId":id}),b"");
                        let body: Value =
                            serde_json::from_str(taken["planBody"].as_str().unwrap()).unwrap();
                        assert_eq!(body["schemaVersion"], 1);
                        if !body["mutations"].as_array().unwrap().is_empty() {
                            driver.token += 1;
                        }
                        driver.call(json!({"kind":"ACK_WRITE","resourceId":0,"resourceRevision":0,"writeId":id,"stamp":driver.stamp(),"observedEpochMilliseconds":driver.epoch}),b"");
                        commits += 1;
                    } else {
                        assert_eq!(
                            prepared["state"], "PROFILE_READY",
                            "{} original error",
                            case["id"]
                        );
                        errors += 1;
                    }
                    write += 1;
                }
            } else if ["FIELD", "GROUP", "MODE", "LEVEL", "BASIS"].contains(&kind) {
                driver.event(json!({"kind":"INTENT","intent":step}));
            } else {
                driver.event(step.clone());
            }
            assert_eq!(
                driver.last["view"],
                expected_view(&case["expected"]["frames"][n + 1]),
                "{} step{n} {}",
                case["id"],
                step
            );
            assert_presentation(&driver.last, &presentation, &editor, index, n + 1, frames);
            if dump.is_some() {
                actual_frames.push(json!({"id":case["id"],"caseIndex":index,"frameIndex":n+1,"actual":{"view":driver.last["view"],"presentation":driver.last["presentation"]}}));
            }
            frames += 1;
        }
        assert_eq!(
            write,
            case["expected"]["rawWrites"].as_array().unwrap().len(),
            "{} missing actual write",
            case["id"]
        );
    }
    assert_eq!((frames, commits, errors), (1480, 185, 12));
    if let Some(file) = dump {
        let bytes=serde_json::to_vec(&json!({"schemaVersion":1,"producer":"ACTUAL_RUST_PRIVATE_RESOURCE_AFTER_ORIGINAL_ASSERTIONS","engineVersion":luna_engine::ENGINE_VERSION,"sourceFixtureSha256":format!("{:x}",Sha256::digest(include_bytes!("../../reference/profile-editor-resource-golden.json"))),"editorFixtureSha256":format!("{:x}",Sha256::digest(include_bytes!("../../reference/profile-editor-view-resource-golden.json"))),"frames":actual_frames})).unwrap();
        assert!(bytes.len() <= 16 * 1024 * 1024);
        std::fs::write(file, bytes).unwrap();
    }
}

fn write_driver() -> (Driver, Value) {
    let data = value_pool::decode(include_str!(
        "../../reference/profile-editor-resource-golden.json"
    ));
    let case = data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["id"] == "APP_PORT-family-0-empty-direct-name-correction-undo")
        .unwrap();
    let mut driver = Driver::open(case, 10_000);
    for step in case["input"]["steps"].as_array().unwrap() {
        if step["kind"] == "COMMIT" {
            break;
        }
        if step["kind"] == "FIELD" {
            driver.event(json!({"kind":"INTENT","intent":step}));
        } else {
            driver.event(step.clone());
        }
    }
    assert_eq!(driver.last["state"], "WRITE_CONTEXT_REQUIRED");
    (driver, case["expected"]["rawWrites"][0]["before"].clone())
}

fn checked_header(driver: &Driver, command: Value, request: &str, revision: u64) -> Vec<u8> {
    serde_json::to_vec(&json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"form-sequence","ownerEpoch":1,"requestId":request,"draftRevision":revision},"command":command})).unwrap_or_else(|_| panic!("{} header", driver.request))
}

#[test]
fn opening_stamp_foreign_channel_and_old_revision_cannot_replace_a_captured_submission() {
    use luna_engine::runtime::form_resource::FormResourceError;
    let (mut driver, raw) = write_driver();
    let write_id = driver.last["writeId"].as_u64().unwrap();
    let old_revision = driver.revision;
    let mut wrong_stamp = driver.stamp();
    wrong_stamp["inputToken"] = json!("ffffffffffffffffffffffffffffffff");
    let command = json!({"kind":"WRITE_CONTEXT","resourceId":driver.id,"resourceRevision":driver.revision,"writeId":write_id,"stamp":wrong_stamp,"observedEpochMilliseconds":driver.epoch});
    assert!(matches!(
        driver.pool.prepare(
            &driver.registry,
            &driver.registry.utility_owner_marker().unwrap(),
            &checked_header(&driver, command, &driver.request, driver.revision),
            &serde_json::to_vec(&raw).unwrap()
        ),
        Err(FormResourceError::StaleResource)
    ));
    let foreign = json!({"kind":"PROFILE_EVENT","resourceId":driver.id,"resourceRevision":driver.revision,"observedEpochMilliseconds":driver.epoch,"event":{"kind":"VIEW"}});
    assert!(matches!(
        driver.pool.prepare(
            &driver.registry,
            &driver.registry.utility_owner_marker().unwrap(),
            &checked_header(&driver, foreign, "foreign-form", driver.revision),
            b""
        ),
        Err(FormResourceError::OwnerChanged)
    ));
    driver.event(
        json!({"kind":"INTENT","intent":{"kind":"FIELD","field":"weeklyHours","value":"12"}}),
    );
    assert_eq!(driver.last["writeId"], write_id);
    let stale = json!({"kind":"PROFILE_EVENT","resourceId":driver.id,"resourceRevision":old_revision,"observedEpochMilliseconds":driver.epoch,"event":{"kind":"DISCARD"}});
    assert!(matches!(
        driver.pool.prepare(
            &driver.registry,
            &driver.registry.utility_owner_marker().unwrap(),
            &checked_header(&driver, stale, &driver.request, driver.revision),
            b""
        ),
        Err(FormResourceError::StaleResource)
    ));
    driver.call(json!({"kind":"WRITE_CONTEXT","resourceId":0,"resourceRevision":0,"writeId":write_id,"stamp":driver.stamp(),"observedEpochMilliseconds":driver.epoch}),&serde_json::to_vec(&raw).unwrap());
    assert_eq!(driver.last["state"], "WRITE_PERMIT_READY");
    driver.event(json!({"kind":"VIEW"}));
    let taken = driver.call(
        json!({"kind":"TAKE_WRITE","resourceId":0,"resourceRevision":0,"writeId":write_id}),
        b"",
    );
    let plan: Value = serde_json::from_str(taken["planBody"].as_str().unwrap()).unwrap();
    // The source action captured 40h before the UI changed to 12h. The plan must
    // still write the captured 2,400-minute value, never the newer UI fields.
    let row = plan["mutations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|mutation| mutation["kind"] == "UPSERT_WORK_PROFILE")
        .unwrap();
    assert_eq!(row["row"]["weekly_minutes"], 2400);
    let command = json!({"kind":"TAKE_WRITE","resourceId":driver.id,"resourceRevision":driver.revision,"writeId":write_id});
    assert!(matches!(
        driver.pool.prepare(
            &driver.registry,
            &driver.registry.utility_owner_marker().unwrap(),
            &checked_header(&driver, command, &driver.request, driver.revision),
            b""
        ),
        Err(FormResourceError::StaleResource)
    ));
}

#[test]
fn abort_keeps_original_baseline_and_owner_reset_blocks_all_pending_writes() {
    use luna_engine::runtime::form_resource::FormResourceError;
    let (mut driver, raw) = write_driver();
    let write_id = driver.last["writeId"].as_u64().unwrap();
    let stamp = driver.stamp();
    driver.call(json!({"kind":"WRITE_CONTEXT","resourceId":0,"resourceRevision":0,"writeId":write_id,"stamp":stamp,"observedEpochMilliseconds":driver.epoch}),&serde_json::to_vec(&raw).unwrap());
    driver.call(
        json!({"kind":"TAKE_WRITE","resourceId":0,"resourceRevision":0,"writeId":write_id}),
        b"",
    );
    driver.call(json!({"kind":"ABORT_WRITE","resourceId":0,"resourceRevision":0,"writeId":write_id,"failure":"SOURCE_CHANGED","observedEpochMilliseconds":driver.epoch}),b"");
    assert_eq!(driver.last["state"], "PROFILE_READY");
    assert!(driver.last.get("writeId").is_none());
    assert_eq!(driver.stamp(), stamp);
    assert_eq!(driver.last["view"]["flow"]["hasReceipt"], false);
    driver.event(json!({"kind":"CONFIRM"}));
    let next_id = driver.last["writeId"].as_u64().unwrap();
    assert_ne!(write_id, next_id);
    driver
        .registry
        .reset_for_owner(&OwnerIdentity::new("form-sequence", 1).unwrap())
        .unwrap();
    let command = json!({"kind":"WRITE_CONTEXT","resourceId":driver.id,"resourceRevision":driver.revision,"writeId":next_id,"stamp":stamp,"observedEpochMilliseconds":driver.epoch});
    assert!(matches!(
        driver.pool.prepare(
            &driver.registry,
            &driver.registry.utility_owner_marker().unwrap(),
            &checked_header(&driver, command, &driver.request, driver.revision),
            &serde_json::to_vec(&raw).unwrap()
        ),
        Err(FormResourceError::UnknownResource)
    ));
    assert!(!driver.pool.collect_retired().unwrap());
}

#[test]
fn large_target_payload_is_not_a_profile_source_and_closed_resource_cannot_resurrect() {
    use luna_engine::runtime::form_resource::{FormResourceError, MAX_FORM_METADATA_BYTES};
    let (mut driver, _) = write_driver();
    assert!(serde_json::to_vec(&driver.last).unwrap().len() < MAX_FORM_METADATA_BYTES / 16);
    fn no_source_tree(value: &Value) {
        match value {
            Value::Object(map) => {
                for (key, value) in map {
                    assert!(
                        ![
                            "workingTimeTarget",
                            "employmentTimeline",
                            "profile",
                            "profileRow",
                            "salaryRows",
                            "rawWrites"
                        ]
                        .contains(&key.as_str()),
                        "leaked source {key}"
                    );
                    no_source_tree(value);
                }
            }
            Value::Array(values) => {
                for value in values {
                    no_source_tree(value);
                }
            }
            _ => {}
        }
    }
    no_source_tree(&driver.last["view"]);
    let payload=serde_json::to_vec(&json!({"days":(0..50_000).map(|i|json!({"date":format!("row-{i}"),"targetMinutes":480})).collect::<Vec<_>>()})).unwrap();
    let command = json!({"kind":"SOURCE","builderId":999,"group":{"kind":"WORKING_TIME_TARGET","source":{"state":"NOT_REQUESTED"}}});
    assert!(matches!(
        driver.pool.prepare(
            &driver.registry,
            &driver.registry.utility_owner_marker().unwrap(),
            &checked_header(&driver, command, &driver.request, driver.revision),
            &payload
        ),
        Err(FormResourceError::InvalidSource)
    ));
    driver.call(json!({"kind":"CLOSE_RESOURCE","resourceId":0}), b"");
    let command = json!({"kind":"PROFILE_EVENT","resourceId":driver.id,"resourceRevision":driver.revision,"observedEpochMilliseconds":driver.epoch,"event":{"kind":"VIEW"}});
    assert!(matches!(
        driver.pool.prepare(
            &driver.registry,
            &driver.registry.utility_owner_marker().unwrap(),
            &checked_header(&driver, command, &driver.request, driver.revision),
            b""
        ),
        Err(FormResourceError::UnknownResource)
    ));
}
#[test]
fn profile_raw_intent_body_keeps_large_paste_out_of_the_small_header() {
    let data = value_pool::decode(include_str!(
        "../../reference/profile-editor-resource-golden.json"
    ));
    let mut driver = Driver::open(&data["cases"][0], 8000);
    let text = format!("{}32", "0".repeat(12_000));
    let intent = json!({"kind":"FIELD","field":"weeklyHours","value":text});
    driver.call(json!({"kind":"PROFILE_EVENT","resourceId":0,"resourceRevision":0,"observedEpochMilliseconds":driver.epoch,"event":{"kind":"INTENT_BODY"}}), &serde_json::to_vec(&intent).unwrap());
    assert_eq!(driver.last["view"]["editor"]["draft"]["weeklyHours"], text);
    assert_eq!(driver.last["view"]["editor"]["preview"]["dirty"], true);
}
#[test]
fn original_tariff_employment_and_model_ui_follow_the_raw_source_resource() {
    const SOURCE: &str = include_str!("../../reference/profile-ui-extension-golden.json");
    let data = value_pool::decode(SOURCE);
    assert_eq!(data["cases"].as_array().unwrap().len(), 56);
    let mut actual = Vec::new();
    let mut count = 0;
    for (index, case) in data["cases"].as_array().unwrap().iter().enumerate() {
        let mut driver = Driver::open(case, 9000 + index);
        let steps = case["input"]["steps"].as_array().unwrap();
        for frame_index in 0..=steps.len() {
            if frame_index > 0 {
                let step = &steps[frame_index - 1];
                if ["FIELD", "GROUP", "MODE", "LEVEL", "BASIS"]
                    .contains(&step["kind"].as_str().unwrap())
                {
                    driver.call(json!({"kind":"PROFILE_EVENT","resourceId":0,"resourceRevision":0,"observedEpochMilliseconds":driver.epoch,"event":{"kind":"INTENT_BODY"}}), &serde_json::to_vec(step).unwrap());
                } else {
                    driver.event(step.clone());
                }
            }
            let expected = &case["expected"]["frames"][frame_index];
            assert_eq!(
                driver.last["view"],
                expected_view(expected),
                "{} frame{frame_index}",
                case["id"]
            );
            assert_eq!(
                driver.last["presentation"], expected["presentation"],
                "{} presentation{frame_index}",
                case["id"]
            );
            actual.push(json!({"id":case["id"],"caseIndex":index,"frameIndex":frame_index,"actual":{"view":driver.last["view"],"presentation":driver.last["presentation"]}}));
            count += 1;
        }
    }
    assert_eq!(count, 588);
    if let Ok(file) = std::env::var("LUNA_PROFILE_EDITOR_UI_EXTENSION_DUMP") {
        let bytes = serde_json::to_vec(&json!({"schemaVersion":1,"producer":"ACTUAL_RUST_PRIVATE_RESOURCE_AFTER_ORIGINAL_ASSERTIONS","engineVersion":luna_engine::ENGINE_VERSION,"sourceFixtureSha256":format!("{:x}",Sha256::digest(SOURCE.as_bytes())),"frames":actual})).unwrap();
        assert!(bytes.len() <= 16 * 1024 * 1024);
        std::fs::write(file, bytes).unwrap();
    }
}
#[test]
fn profile_body_rejects_foreign_cache_and_bad_or_oversize_json_without_mutation() {
    use luna_engine::runtime::form_resource::FormResourceError;
    let data = value_pool::decode(include_str!(
        "../../reference/profile-editor-resource-golden.json"
    ));
    let mut driver = Driver::open(&data["cases"][0], 8500);
    let before = driver.last["view"].clone();
    let command = json!({"kind":"PROFILE_EVENT","resourceId":driver.id,"resourceRevision":driver.revision,"observedEpochMilliseconds":driver.epoch,"event":{"kind":"INTENT_BODY"}});
    let header = checked_header(&driver, command, &driver.request, driver.revision);
    for raw in [
        b"".to_vec(),
        b"null".to_vec(),
        serde_json::to_vec(&json!({"kind":"FIELD","field":"confirmedGroups","value":["TVOED_P"]}))
            .unwrap(),
        serde_json::to_vec(
            &json!({"kind":"FIELD","field":"weeklyHours","value":"32","dirty":false}),
        )
        .unwrap(),
    ] {
        assert!(matches!(
            driver.pool.prepare(
                &driver.registry,
                &driver.registry.utility_owner_marker().unwrap(),
                &header,
                &raw
            ),
            Err(FormResourceError::InvalidHeader)
        ));
    }
    let too_large = serde_json::to_vec(
        &json!({"kind":"FIELD","field":"weeklyHours","value":"0".repeat(256*1024)}),
    )
    .unwrap();
    assert!(matches!(
        driver.pool.prepare(
            &driver.registry,
            &driver.registry.utility_owner_marker().unwrap(),
            &header,
            &too_large
        ),
        Err(FormResourceError::InputTooLarge)
    ));
    let unicode = serde_json::to_vec(
        &json!({"kind":"FIELD","field":"weeklyHours","value":"ü".repeat(131_072)}),
    )
    .unwrap();
    assert!(unicode.len() > 256 * 1024);
    assert!(matches!(
        driver.pool.prepare(
            &driver.registry,
            &driver.registry.utility_owner_marker().unwrap(),
            &header,
            &unicode
        ),
        Err(FormResourceError::InputTooLarge)
    ));
    driver.event(json!({"kind":"VIEW"}));
    assert_eq!(driver.last["view"], before);
    assert_eq!(driver.revision, 0);
}
