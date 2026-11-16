mod common;
use luna_engine::{
    contract::{self, OwnerIdentity},
    runtime::{SnapshotRegistry, form_resource::FormResourcePool},
};
use serde_json::{Value, json};
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
fn stamp() -> Value {
    json!({"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":"11111111111111111111111111111111","databaseSchemaVersion":35})
}
fn call(pool: &FormResourcePool, registry: &SnapshotRegistry, command: Value, raw: &[u8]) -> Value {
    let header = json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"day-resource","ownerEpoch":1,"requestId":"day-resource-1","draftRevision":0},"command":command});
    let result = pool
        .prepare(
            registry,
            &registry.utility_owner_marker().unwrap(),
            &serde_json::to_vec(&header).unwrap(),
            raw,
        )
        .expect("genuine private day command");
    serde_json::from_slice(&result.complete().unwrap()).unwrap()
}
#[test]
fn genuine_day_source_uses_shared_pool_without_replacing_report_preparation() {
    let sources = value_pool::decode(include_str!(
        "../../reference/day-editor-source-golden.json"
    ));
    let controller = value_pool::decode(include_str!(
        "../../reference/day-editor-controller-golden.json"
    ));
    let input = &sources["cases"][0]["input"];
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("day-resource", 1).unwrap())
        .unwrap();
    let marker = registry.preparation_marker().unwrap();
    let pool = FormResourcePool::new();
    let begin = call(
        &pool,
        &registry,
        json!({"kind":"BEGIN_DAY_EDITOR","stamp":stamp(),"observedEpochMilliseconds":input["observedEpochMilliseconds"],"request":input["request"],"appearance":controller["appearance"]}),
        b"",
    );
    assert_eq!(begin["state"], "DAY_SOURCE_OPEN");
    assert!(begin["builderId"].is_u64());
    assert!(marker.is_current().unwrap());
}

struct Driver {
    pool: FormResourcePool,
    registry: SnapshotRegistry,
    revision: u64,
    id: u64,
    request: usize,
    epoch: i64,
}
impl Driver {
    fn reject(
        &self,
        mut command: Value,
        raw: &[u8],
    ) -> luna_engine::runtime::form_resource::FormResourceError {
        command["resourceId"] = json!(self.id);
        command["resourceRevision"] = json!(self.revision);
        let header = json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"day-resource","ownerEpoch":1,"requestId":format!("day-resource-{}",self.request),"draftRevision":self.revision},"command":command});
        self.pool
            .prepare(
                &self.registry,
                &self.registry.utility_owner_marker().unwrap(),
                &serde_json::to_vec(&header).unwrap(),
                raw,
            )
            .err()
            .expect("must reject stale/one-shot operation")
    }
    fn call(&mut self, mut command: Value, raw: &[u8]) -> Value {
        if command.get("resourceId").is_some() {
            command["resourceId"] = json!(self.id);
        }
        if command.get("resourceRevision").is_some() {
            command["resourceRevision"] = json!(self.revision);
        }
        let header = json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"day-resource","ownerEpoch":1,"requestId":format!("day-resource-{}",self.request),"draftRevision":self.revision},"command":command});
        let result = self
            .pool
            .prepare(
                &self.registry,
                &self.registry.utility_owner_marker().unwrap(),
                &serde_json::to_vec(&header).unwrap(),
                raw,
            )
            .unwrap_or_else(|error| panic!("{command}: {error:?}"));
        let reply: Value = serde_json::from_slice(&result.complete().unwrap()).unwrap();
        if let Some(revision) = reply["resourceRevision"].as_u64() {
            self.revision = revision;
        }
        if let Some(id) = reply["resourceId"].as_u64() {
            self.id = id;
        }
        reply
    }
    fn new() -> Self {
        let registry = SnapshotRegistry::default();
        registry
            .reset_for_owner(&OwnerIdentity::new("day-resource", 1).unwrap())
            .unwrap();
        Self {
            pool: FormResourcePool::new(),
            registry,
            revision: 0,
            id: 0,
            request: 0,
            epoch: 0,
        }
    }
    fn open(&mut self, input: &Value, profile: Option<&Value>, appearance: &Value) -> Value {
        self.revision = 0;
        self.id = 0;
        self.request += 1;
        self.epoch = profile.unwrap_or(input)["observedEpochMilliseconds"]
            .as_i64()
            .unwrap();
        let begin=self.call(json!({"kind":"BEGIN_DAY_EDITOR","stamp":stamp(),"observedEpochMilliseconds":self.epoch,"request":input["request"],"appearance":appearance}),b"");
        let builder = begin["builderId"].as_u64().unwrap();
        if let Some(profile) = profile {
            for (kind, key) in [
                ("WORK_PROFILE", "profile"),
                ("REMUNERATION_PROFILES", "historyRows"),
                ("WORK_PATTERN_SETTINGS", "patternRows"),
            ] {
                let value = &profile[key];
                let bytes = if value.is_null() {
                    Vec::new()
                } else {
                    serde_json::to_vec(value).unwrap()
                };
                let reply=self.call(json!({"kind":"SOURCE","builderId":builder,"group":{"kind":kind,"source":{"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":if value.is_null(){"NULL"}else{"VALUE"}}}}}}),&bytes);
                assert_eq!(reply["state"], "DAY_SOURCE_OPEN");
            }
        } else {
            for group in input["profileSources"].as_array().unwrap() {
                let reply=self.call(json!({"kind":"SOURCE","builderId":builder,"group":{"kind":group["kind"],"source":{"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":group["presence"]}}}}}),group["body"].as_str().unwrap().as_bytes());
                assert_eq!(reply["state"], "DAY_SOURCE_OPEN");
            }
        }
        for group in input["entrySources"].as_array().unwrap() {
            self.call(json!({"kind":"DAY_SOURCE","builderId":builder,"group":{"kind":group["kind"],"state":if group["state"]=="FAILED"{"FAILED"}else{group["presence"].as_str().unwrap()}}}),group["body"].as_str().unwrap().as_bytes());
        }
        self.call(json!({"kind":"OPEN_DAY_EDITOR","builderId":builder}), b"")
    }
    fn event(&mut self, event: Value, raw: &[u8]) -> Value {
        self.call(json!({"kind":"DAY_EVENT","resourceId":0,"resourceRevision":0,"observedEpochMilliseconds":self.epoch,"event":event}),raw)
    }
}
fn assert_view(reply: &Value, case: &Value, index: usize) {
    assert_eq!(reply["state"], "DAY_READY", "{}", case["id"]);
    let mut expected = case["expected"]["frames"][index].clone();
    expected.as_object_mut().unwrap().remove("initialSignature");
    common::assert_json_eq(
        &reply["view"]["draft"],
        &expected,
        &format!("{}:frame{index}", case["id"]),
    );
    for key in ["display", "renderFailed", "tariff", "tariffError"] {
        common::assert_json_eq(
            &reply["view"]["presentation"][key],
            &case["expected"]["presentations"][index][key],
            &format!("{}:frame{index}:{key}", case["id"]),
        );
    }
    assert!(reply["view"]["context"].is_object());
    assert!(reply["view"].get("profile").is_none());
    assert!(reply["view"].get("templates").is_none());
}
#[test]
fn genuine_day_save_requests_private_selected_row_context_before_any_saved_effect() {
    let seeds = value_pool::decode(include_str!(
        "../../reference/day-editor-source-golden.json"
    ));
    let controller = value_pool::decode(include_str!(
        "../../reference/day-editor-controller-golden.json"
    ));
    let mut driver = Driver::new();
    driver.open(&seeds["cases"][0]["input"], None, &controller["appearance"]);
    driver.event(json!({"kind":"SET","field":"endTime","value":"15:00"}), b"");
    let requested = driver.event(json!({"kind":"SAVE","closeAfterSave":true}), b"");
    assert_eq!(requested["state"], "WRITE_CONTEXT_REQUIRED");
    assert!(requested["writeId"].is_u64());
    assert_eq!(
        requested["selection"],
        json!({"shiftIds":["entry-0"],"appointmentIds":[]})
    );
    assert!(requested.get("effects").is_none());
    assert!(requested.get("receipt").is_none());
}
fn day_write_setup() -> Driver {
    let seeds = value_pool::decode(include_str!(
        "../../reference/day-editor-source-golden.json"
    ));
    let controller = value_pool::decode(include_str!(
        "../../reference/day-editor-controller-golden.json"
    ));
    let mut driver = Driver::new();
    driver.open(&seeds["cases"][0]["input"], None, &controller["appearance"]);
    driver.event(json!({"kind":"SET","field":"endTime","value":"15:00"}), b"");
    driver
}
fn day_raw_context() -> Vec<u8> {
    let oracle = value_pool::decode(include_str!("../../reference/day-write-golden.json"));
    serde_json::to_vec(&json!({"shiftRows":[oracle["cases"][0]["input"]["before"]["shifts"][0]],"appointmentRows":[]})).unwrap()
}
fn review_ready(driver: &mut Driver, input: &Value, ranks: &Value) {
    let initial_revision = driver.revision;
    let begin = driver.event(json!({"kind":"REVIEW_BEGIN","stamp":stamp()}), b"");
    assert_eq!(begin["review"]["state"], "SOURCE_OPEN");
    let source = json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE"}}});
    driver.event(json!({"kind":"REVIEW_CALENDAR","source":source}), &serde_json::to_vec(&json!({"shiftRows":input["shiftRows"],"appointmentRows":[],"platformCollationRanks":{}})).unwrap());
    for kind in ["TARIFF", "LEGAL", "HOLIDAY"] {
        driver.event(
            json!({"kind":"REVIEW_CATALOG","catalogKind":kind,"source":source}),
            br#"{"mode":"COMPILED_LEGACY"}"#,
        );
    }
    let prep = driver.event(json!({"kind":"REVIEW_PREPARE"}), b"");
    assert_eq!(prep["review"]["state"], "CANDIDATES_READY");
    let mut offset = 0usize;
    loop {
        let page = driver.event(
            json!({"kind":"REVIEW_CANDIDATES","family":"CALENDAR","offset":offset}),
            b"",
        );
        let page = &page["review"];
        assert_eq!(page["offset"], offset);
        assert!(page["items"].as_array().unwrap().len() <= 128);
        for name in page["items"].as_array().unwrap() {
            assert!(
                ranks.get(name.as_str().unwrap()).is_some(),
                "missing {name}"
            );
        }
        let next = page["nextOffset"].as_u64().unwrap() as usize;
        let total = page["total"].as_u64().unwrap() as usize;
        if next == total {
            break;
        }
        assert!(next > offset);
        offset = next;
    }
    let done = driver.event(
        json!({"kind":"REVIEW_FINISH"}),
        &serde_json::to_vec(&json!({"calendarRanks":ranks,"catalogRanks":{}})).unwrap(),
    );
    assert_eq!(done["review"]["state"], "READY");
    assert_eq!(
        driver.revision, initial_revision,
        "source preparation is not a draft edit"
    );
}
fn review_driver(input: &Value, appearance: &Value) -> Driver {
    let row = input["shiftRows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == input["originalId"]);
    let mut entry_sources = vec![];
    if let Some(row) = row {
        for (kind, value) in [
            ("ENTRY_SHIFT", row.clone()),
            ("ENTRY_APPOINTMENT", Value::Null),
            ("ENTRY_TEMPLATE", Value::Null),
        ] {
            entry_sources.push(json!({"kind":kind,"state":"READY","presence":if value.is_null(){"NULL"}else{"VALUE"},"body":if value.is_null(){String::new()}else{serde_json::to_string(&value).unwrap()}}));
        }
    }
    entry_sources.push(json!({"kind":"TEMPLATES","state":"READY","presence":"VALUE","body":"[]"}));
    let opening = json!({"request":{"entryId":input["originalId"],"mode":"SHIFT","date":"2026-07-15"},"entrySources":entry_sources});
    let mut raw = input["raw"].clone();
    raw["observedEpochMilliseconds"] = input["epoch"].clone();
    let mut driver = Driver::new();
    assert_eq!(
        driver.open(&opening, Some(&raw), appearance)["state"],
        "DAY_READY"
    );
    driver
}
#[test]
fn private_review_is_bound_to_the_existing_day_resource_and_never_starts_a_global_report() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/day-review-source-golden.json"
    ));
    let platform: Value = serde_json::from_str(include_str!(
        "../../reference/day-review-platform-ranks.json"
    ))
    .unwrap();
    let controllers = value_pool::decode(include_str!(
        "../../reference/day-editor-controller-golden.json"
    ));
    for (index, case) in fixture["cases"].as_array().unwrap().iter().enumerate() {
        let mut driver = review_driver(&case["input"], &controllers["appearance"]);
        let marker = driver.registry.preparation_marker().unwrap();
        review_ready(
            &mut driver,
            &case["input"],
            &platform["cases"][index]["ranks"],
        );
        assert!(marker.is_current().unwrap());
        driver.call(json!({"kind":"CLOSE_RESOURCE","resourceId":0}), b"");
        assert!(matches!(driver.reject(json!({"kind":"DAY_EVENT","observedEpochMilliseconds":driver.epoch,"event":{"kind":"REVIEW_PREPARE"}}),b""), luna_engine::runtime::form_resource::FormResourceError::OwnerChanged | luna_engine::runtime::form_resource::FormResourceError::UnknownResource));
    }
}

#[test]
fn genuine_commit_completes_only_its_pinned_review_without_rebasing_the_editor() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/day-review-source-golden.json"
    ));
    let platform: Value = serde_json::from_str(include_str!(
        "../../reference/day-review-platform-ranks.json"
    ))
    .unwrap();
    let controllers = value_pool::decode(include_str!(
        "../../reference/day-editor-controller-golden.json"
    ));
    let (index, case) = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
        .find(|(_, c)| {
            c["input"]["saved"]["kind"] == "SHIFT"
                && c["input"]["saved"]["allDay"] == false
                && c["input"]["saved"]["specialDuty"].is_null()
        })
        .unwrap();
    let input = &case["input"];
    let mut driver = review_driver(input, &controllers["appearance"]);
    let title = format!("{} review", input["saved"]["title"].as_str().unwrap());
    driver.event(
        json!({"kind":"SET","field":"shiftTitle","value":title}),
        b"",
    );
    let needs_review = driver.event(
        json!({"kind":"SAVE","closeAfterSave":true,"requireReview":true}),
        b"",
    );
    assert_eq!(needs_review["feedback"]["state"], "REVIEW_REQUIRED");
    assert!(needs_review.get("writeId").is_none());
    assert!(needs_review.get("receipt").is_none());
    review_ready(&mut driver, input, &platform["cases"][index]["ranks"]);
    let pending = driver.event(
        json!({"kind":"SAVE","closeAfterSave":true,"requireReview":true}),
        b"",
    );
    let write = pending["writeId"].clone();
    assert_eq!(pending["state"], "WRITE_CONTEXT_REQUIRED");
    let rows = input["shiftRows"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["id"] == input["originalId"])
        .map(|row| {
            // Reports omit this physical-only marker. This protocol test uses
            // a normal record; actual SQLite capture has its own interop gate.
            let mut row = row.clone();
            row["test_run_id"] = Value::Null;
            row
        })
        .collect::<Vec<_>>();
    let raw = serde_json::to_vec(&json!({"shiftRows":rows,"appointmentRows":[]})).unwrap();
    driver.call(json!({"kind":"WRITE_CONTEXT","resourceId":0,"resourceRevision":0,"writeId":write,"stamp":stamp(),"observedEpochMilliseconds":driver.epoch}),&raw);
    driver.call(
        json!({"kind":"TAKE_WRITE","resourceId":0,"resourceRevision":0,"writeId":write}),
        b"",
    );
    let mut after = stamp();
    after["inputToken"] = json!("22222222222222222222222222222222");
    let ack=driver.call(json!({"kind":"ACK_WRITE","resourceId":0,"resourceRevision":0,"writeId":write,"stamp":after,"observedEpochMilliseconds":driver.epoch}),b"");
    assert_eq!(ack["reviewNotice"]["state"], "READY");
    common::assert_json_eq(
        &ack["reviewNotice"]["critical"],
        &case["expected"]["critical"]["value"],
        "original post-commit critical result",
    );
    assert_eq!(ack["receipt"]["title"], title);
    assert_eq!(ack["feedback"]["saved"], true);
    assert_eq!(ack["terminal"], true);
    assert_eq!(ack["view"]["draft"]["hasChanges"], true);
}
#[test]
fn billing_selection_uses_one_bulk_permit_and_returns_the_original_first_entry() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/day-review-source-golden.json"
    ));
    let platform: Value = serde_json::from_str(include_str!(
        "../../reference/day-review-platform-ranks.json"
    ))
    .unwrap();
    let controllers = value_pool::decode(include_str!(
        "../../reference/day-editor-controller-golden.json"
    ));
    let mut covered = 0;
    for (index, case) in fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
        .filter(|(_, c)| {
            c["expected"]["candidates"]["value"]
                .as_array()
                .is_some_and(|rows| !rows.is_empty())
        })
    {
        let input = &case["input"];
        let mut driver = review_driver(input, &controllers["appearance"]);
        driver.event(
            json!({"kind":"CHANGE_DUTY"}),
            &serde_json::to_vec(&input["next"]).unwrap(),
        );
        let required = driver.event(json!({"kind":"BILLING_VIEW","offset":0,"open":true}), b"");
        assert_eq!(required["feedback"]["state"], "REVIEW_REQUIRED");
        assert!(required.get("writeId").is_none());
        review_ready(&mut driver, input, &platform["cases"][index]["ranks"]);
        let page = driver.event(json!({"kind":"BILLING_VIEW","offset":0,"open":true}), b"");
        let expected = case["expected"]["candidates"]["value"].as_array().unwrap();
        assert_eq!(page["billing"]["total"], expected.len());
        assert_eq!(
            page["billing"]["rows"]
                .as_array()
                .unwrap()
                .iter()
                .map(|r| r["id"].clone())
                .collect::<Vec<_>>(),
            expected.iter().map(|r| r["id"].clone()).collect::<Vec<_>>()
        );
        for row in expected {
            let selected = driver.event(
                json!({"kind":"BILLING_TOGGLE_BODY","revision":row["revision"],"open":true}),
                &serde_json::to_vec(&row["id"]).unwrap(),
            );
            assert!(selected["billing"]["selectedCount"].as_u64().unwrap() > 0);
        }
        let pending = driver.event(
            json!({"kind":"SAVE","closeAfterSave":true,"requireReview":true}),
            b"",
        );
        assert_eq!(pending["state"], "WRITE_CONTEXT_REQUIRED");
        let write = pending["writeId"].clone();
        let mut ids = vec![input["originalId"].clone()];
        ids.extend(expected.iter().map(|r| r["id"].clone()));
        assert_eq!(pending["selection"]["shiftIds"], json!(ids));
        let rows = input["shiftRows"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|row| ids.contains(&row["id"]))
            .map(|row| {
                let mut row = row.clone();
                row["test_run_id"] = Value::Null;
                row
            })
            .collect::<Vec<_>>();
        driver.call(json!({"kind":"WRITE_CONTEXT","resourceId":0,"resourceRevision":0,"writeId":write,"stamp":stamp(),"observedEpochMilliseconds":driver.epoch}),&serde_json::to_vec(&json!({"shiftRows":rows,"appointmentRows":[]})).unwrap());
        let taken = driver.call(
            json!({"kind":"TAKE_WRITE","resourceId":0,"resourceRevision":0,"writeId":write}),
            b"",
        );
        let plan: Value = serde_json::from_str(taken["planBody"].as_str().unwrap()).unwrap();
        let mutations = plan["mutations"].as_array().unwrap();
        assert_eq!(mutations.len(), ids.len());
        for (mutation, transfer) in mutations
            .iter()
            .skip(1)
            .zip(case["expected"]["transfer"]["value"].as_array().unwrap())
        {
            let row = &mutation["row"];
            assert_eq!(row["id"], transfer["id"]);
            assert_eq!(row["start_time"], transfer["startTime"]);
            assert_eq!(row["end_time"], transfer["endTime"]);
            assert_eq!(row["break_minutes"], transfer["breakMinutes"]);
            assert_eq!(
                mutation["expected"]["revision"],
                transfer["expectedRevision"]
            );
            let duty: Value =
                serde_json::from_str(row["special_duty_json"].as_str().unwrap()).unwrap();
            common::assert_json_eq(
                &duty,
                &transfer["specialDuty"],
                "unchanged original billing transfer fields and individual sequence",
            );
        }
        let mut after = stamp();
        after["inputToken"] = json!("22222222222222222222222222222222");
        let ack=driver.call(json!({"kind":"ACK_WRITE","resourceId":0,"resourceRevision":0,"writeId":write,"stamp":after,"observedEpochMilliseconds":driver.epoch}),b"");
        assert_eq!(ack["receipt"]["id"], input["originalId"]);
        assert_eq!(ack["feedback"]["saved"], true);
        assert_eq!(ack["reviewNotice"]["state"], "READY");
        assert_eq!(ack["terminal"], true);
        covered += 1;
    }
    assert_eq!(covered, 10);
}

#[test]
fn billing_refuses_stale_checkbox_revisions_and_clear_does_not_modify_the_draft() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/day-review-source-golden.json"
    ));
    let platform: Value = serde_json::from_str(include_str!(
        "../../reference/day-review-platform-ranks.json"
    ))
    .unwrap();
    let controllers = value_pool::decode(include_str!(
        "../../reference/day-editor-controller-golden.json"
    ));
    let (index, case) = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
        .find(|(_, c)| {
            c["expected"]["candidates"]["value"]
                .as_array()
                .is_some_and(|r| !r.is_empty())
        })
        .unwrap();
    let input = &case["input"];
    let mut driver = review_driver(input, &controllers["appearance"]);
    driver.event(
        json!({"kind":"CHANGE_DUTY"}),
        &serde_json::to_vec(&input["next"]).unwrap(),
    );
    review_ready(&mut driver, input, &platform["cases"][index]["ranks"]);
    let row = &case["expected"]["candidates"]["value"][0];
    assert!(matches!(driver.reject(json!({"kind":"DAY_EVENT","observedEpochMilliseconds":driver.epoch,"event":{"kind":"BILLING_TOGGLE_BODY","revision":999,"open":true}}),&serde_json::to_vec(&row["id"]).unwrap()),luna_engine::runtime::form_resource::FormResourceError::StaleResource));
    let selected = driver.event(
        json!({"kind":"BILLING_TOGGLE_BODY","revision":row["revision"],"open":true}),
        &serde_json::to_vec(&row["id"]).unwrap(),
    );
    assert_eq!(selected["billing"]["selectedCount"], 1);
    let cleared = driver.event(json!({"kind":"BILLING_CLEAR","open":true}), b"");
    assert_eq!(cleared["billing"]["selectedCount"], 0);
    common::assert_json_eq(
        &cleared["view"]["draft"],
        &selected["view"]["draft"],
        "selection is not a draft change",
    );
    assert!(cleared.get("writeId").is_none());
}
#[test]
fn delete_begin_and_failed_completion_match_the_original_for_every_open_source() {
    let seeds = value_pool::decode(include_str!(
        "../../reference/day-editor-source-golden.json"
    ));
    let deleted = value_pool::decode(include_str!("../../reference/day-delete-golden.json"));
    let appearance = value_pool::decode(include_str!(
        "../../reference/day-editor-controller-golden.json"
    ))["appearance"]
        .clone();
    let mut driver = Driver::new();
    let mut checked = 0;
    for case in
        deleted["cases"].as_array().unwrap().iter().filter(|case| {
            case["input"]["busy"] == false && case["input"]["failureKind"] == "ERROR"
        })
    {
        let index = case["input"]["sourceIndex"].as_u64().unwrap() as usize;
        driver.open(&seeds["cases"][index]["input"], None, &appearance);
        let begun = driver.event(json!({"kind":"DELETE"}), b"");
        if case["expected"]["writes"].as_array().unwrap().is_empty() {
            assert_eq!(begun["state"], "DAY_READY");
            assert!(begun.get("writeId").is_none());
        } else {
            assert_eq!(begun["state"], "WRITE_CONTEXT_REQUIRED");
            assert!(begun.get("effects").is_none());
            common::assert_json_eq(
                &begun["feedback"]["events"],
                &case["expected"]["begin"]["events"],
                case["id"].as_str().unwrap(),
            );
            let write = begun["writeId"].clone();
            let duplicate = driver.event(json!({"kind":"DELETE"}), b"");
            assert_eq!(
                duplicate["writeId"], write,
                "busy delete cannot replace the captured source"
            );
            let done = driver.call(json!({"kind":"ABORT_WRITE","resourceId":0,"resourceRevision":0,"writeId":write,"failure":"IO_FAILED","observedEpochMilliseconds":driver.epoch}),b"");
            for key in ["events", "saving", "savingRef"] {
                common::assert_json_eq(
                    &done["feedback"][key],
                    &case["expected"]["completion"][key],
                    case["id"].as_str().unwrap(),
                );
            }
            assert!(done.get("effects").is_none());
            assert!(done.get("receipt").is_none());
        }
        driver.call(json!({"kind":"CLOSE_RESOURCE","resourceId":0}), b"");
        checked += 1;
    }
    assert_eq!(checked, 210);
}
#[test]
fn delete_commits_only_through_the_original_tombstone_and_keeps_the_exit_handshake() {
    let mut driver = day_write_setup();
    let begun = driver.event(json!({"kind":"DELETE"}), b"");
    let write = begun["writeId"].clone();
    assert_eq!(
        begun["selection"],
        json!({"shiftIds":["entry-0"],"appointmentIds":[]})
    );
    assert_eq!(
        begun["feedback"]["events"][2]["value"]["endTime"], "14:00",
        "delete captures immutable joined initial rather than edited draft"
    );
    assert!(matches!(driver.reject(json!({"kind":"ACK_WRITE","writeId":write,"stamp":stamp(),"observedEpochMilliseconds":driver.epoch}),b""),luna_engine::runtime::form_resource::FormResourceError::StaleResource));
    let ready=driver.call(json!({"kind":"WRITE_CONTEXT","resourceId":0,"resourceRevision":0,"writeId":write,"stamp":stamp(),"observedEpochMilliseconds":driver.epoch}),&day_raw_context());
    assert_eq!(ready["state"], "WRITE_PERMIT_READY");
    assert!(ready.get("effects").is_none());
    let taken = driver.call(
        json!({"kind":"TAKE_WRITE","resourceId":0,"resourceRevision":0,"writeId":write}),
        b"",
    );
    let plan: Value = serde_json::from_str(taken["planBody"].as_str().unwrap()).unwrap();
    assert_eq!(plan["mutations"].as_array().unwrap().len(), 1);
    assert_eq!(plan["mutations"][0]["kind"], "TOMBSTONE_CALENDAR_ENTRY");
    assert_eq!(plan["mutations"][0]["entryKind"], "SHIFT");
    assert_eq!(plan["mutations"][0]["row"]["id"], "entry-0");
    assert_eq!(plan["mutations"][0]["row"]["revision"], 2);
    assert_eq!(plan["mutations"][0]["expected"], json!({"revision":1}));
    assert!(matches!(
        driver.reject(json!({"kind":"TAKE_WRITE","writeId":write}), b""),
        luna_engine::runtime::form_resource::FormResourceError::StaleResource
    ));
    let mut post = stamp();
    post["inputToken"] = json!("22222222222222222222222222222222");
    let ack=driver.call(json!({"kind":"ACK_WRITE","resourceId":0,"resourceRevision":0,"writeId":write,"stamp":post,"observedEpochMilliseconds":driver.epoch}),b"");
    assert_eq!(ack["effects"], json!({"kind":"DELETED"}));
    assert_eq!(ack["terminal"], true);
    assert!(ack["receipt"].is_null());
    assert_eq!(ack["feedback"]["deleted"], true);
    assert_eq!(ack["feedback"]["saving"], true);
    assert_eq!(
        ack["feedback"]["events"],
        json!([{"kind":"DELETION_FEEDBACK"},{"kind":"EXIT","value":{}}])
    );
    assert_eq!(ack["view"]["draft"]["fields"]["endTime"], "15:00");
    for event in [
        json!({"kind":"DELETE"}),
        json!({"kind":"SAVE","closeAfterSave":false}),
        json!({"kind":"VIEW"}),
    ] {
        let duplicate = driver.event(event, b"");
        assert!(duplicate.get("writeId").is_none());
        assert!(duplicate.get("effects").is_none());
    }
}
#[test]
fn delete_concurrency_failure_releases_the_submission_for_a_genuine_retry() {
    let mut driver = day_write_setup();
    let begun = driver.event(json!({"kind":"DELETE"}), b"");
    let write = begun["writeId"].clone();
    let aborted=driver.call(json!({"kind":"ABORT_WRITE","resourceId":0,"resourceRevision":0,"writeId":write,"failure":"SOURCE_CHANGED","observedEpochMilliseconds":driver.epoch}),b"");
    assert_eq!(
        aborted["feedback"]["events"],
        json!([{"kind":"DELETION_CHANGE","value":null},{"kind":"WARNING_FEEDBACK"},{"kind":"ERROR","value":"Der Eintrag wurde zwischenzeitlich geändert. Bitte neu laden."},{"kind":"SAVING","value":false}])
    );
    assert_eq!(aborted["feedback"]["deleted"], false);
    assert_eq!(aborted["feedback"]["saving"], false);
    assert!(aborted.get("terminal").is_none());
    let retry = driver.event(json!({"kind":"DELETE"}), b"");
    assert!(retry["writeId"].as_u64().unwrap() > write.as_u64().unwrap());
}
#[test]
fn day_native_permit_pins_submission_and_ack_keeps_immutable_initial_until_dismiss() {
    let mut driver = day_write_setup();
    let request = driver.event(json!({"kind":"SAVE","closeAfterSave":true}), b"");
    let write = request["writeId"].clone();
    driver.event(json!({"kind":"SET","field":"endTime","value":"16:00"}), b"");
    let ready=driver.call(json!({"kind":"WRITE_CONTEXT","resourceId":0,"resourceRevision":0,"writeId":write,"stamp":stamp(),"observedEpochMilliseconds":driver.epoch}),&day_raw_context());
    assert_eq!(ready["state"], "WRITE_PERMIT_READY");
    assert_eq!(ready["view"]["draft"]["fields"]["endTime"], "16:00");
    assert!(matches!(driver.reject(json!({"kind":"ACK_WRITE","writeId":write,"stamp":stamp(),"observedEpochMilliseconds":driver.epoch}),b""),luna_engine::runtime::form_resource::FormResourceError::StaleResource));
    let taken = driver.call(
        json!({"kind":"TAKE_WRITE","resourceId":0,"resourceRevision":0,"writeId":write}),
        b"",
    );
    let plan: Value = serde_json::from_str(taken["planBody"].as_str().unwrap()).unwrap();
    assert_eq!(plan["mutations"][0]["row"]["end_time"], "15:00");
    assert_eq!(plan["mutations"][0]["expected"], json!({"revision":1}));
    assert_eq!(
        plan["mutations"][0]["row"]["created_at"],
        "2026-01-01T00:00:00.123456789Z"
    );
    assert!(matches!(
        driver.reject(json!({"kind":"TAKE_WRITE","writeId":write}), b""),
        luna_engine::runtime::form_resource::FormResourceError::StaleResource
    ));
    let mut committed = stamp();
    committed["inputToken"] = json!("22222222222222222222222222222222");
    let ack=driver.call(json!({"kind":"ACK_WRITE","resourceId":0,"resourceRevision":0,"writeId":write,"stamp":committed,"observedEpochMilliseconds":driver.epoch}),b"");
    assert_eq!(ack["state"], "DAY_READY");
    assert_eq!(ack["receipt"]["endTime"], "15:00");
    assert_eq!(ack["receipt"]["revision"], 2);
    assert_eq!(ack["view"]["draft"]["fields"]["endTime"], "16:00");
    assert_eq!(ack["view"]["draft"]["hasChanges"], true);
    assert_eq!(ack["feedback"]["saved"], true);
    assert_eq!(ack["feedback"]["closed"], true);
    assert_eq!(ack["effects"]["kind"], "SAVED");
    assert_eq!(ack["terminal"], true);
    let duplicate = driver.event(json!({"kind":"SAVE","closeAfterSave":true}), b"");
    assert!(duplicate.get("writeId").is_none());
    assert!(duplicate.get("effects").is_none());
}
#[test]
fn day_sql_abort_exposes_original_failure_without_saved_receipt_or_rebase() {
    let mut driver = day_write_setup();
    let request = driver.event(json!({"kind":"SAVE","closeAfterSave":false}), b"");
    let write = request["writeId"].clone();
    driver.call(json!({"kind":"WRITE_CONTEXT","resourceId":0,"resourceRevision":0,"writeId":write,"stamp":stamp(),"observedEpochMilliseconds":driver.epoch}),&day_raw_context());
    driver.call(
        json!({"kind":"TAKE_WRITE","resourceId":0,"resourceRevision":0,"writeId":write}),
        b"",
    );
    let aborted=driver.call(json!({"kind":"ABORT_WRITE","resourceId":0,"resourceRevision":0,"writeId":write,"failure":"IO_FAILED","observedEpochMilliseconds":driver.epoch}),b"");
    assert_eq!(aborted["feedback"]["saved"], false);
    assert!(aborted.get("receipt").is_none());
    assert!(aborted.get("effects").is_none());
    assert!(
        aborted["feedback"]["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|event| event["kind"] == "ERROR"
                && event["value"] == "Eintrag konnte nicht gespeichert werden.")
    );
    assert_eq!(aborted["view"]["draft"]["hasChanges"], true);
    assert!(matches!(
        driver.reject(json!({"kind":"TAKE_WRITE","writeId":write}), b""),
        luna_engine::runtime::form_resource::FormResourceError::StaleResource
    ));
}
#[test]
fn new_shift_and_appointment_require_real_allocated_io_id_and_keep_empty_selected_context() {
    let seeds = value_pool::decode(include_str!(
        "../../reference/day-editor-source-golden.json"
    ));
    let appearance = value_pool::decode(include_str!(
        "../../reference/day-editor-controller-golden.json"
    ))["appearance"]
        .clone();
    let mut driver = Driver::new();
    for name in ["new-shift", "new-appointment"] {
        let seed = seeds["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|case| case["id"] == name)
            .unwrap();
        driver.open(&seed["input"], None, &appearance);
        if name == "new-appointment" {
            driver.event(
                json!({"kind":"SET","field":"appointmentTitle","value":"Testtermin"}),
                b"",
            );
        }
        let requested = driver.event(json!({"kind":"SAVE","closeAfterSave":false}), b"");
        let write = requested["writeId"].clone();
        assert_eq!(requested["state"], "WRITE_CONTEXT_REQUIRED");
        assert_eq!(
            requested["selection"],
            json!({"shiftIds":[],"appointmentIds":[]})
        );
        let raw = br#"{"shiftRows":[],"appointmentRows":[]}"#;
        assert!(matches!(driver.reject(json!({"kind":"WRITE_CONTEXT","writeId":write,"stamp":stamp(),"observedEpochMilliseconds":driver.epoch}),raw),luna_engine::runtime::form_resource::FormResourceError::InvalidHeader));
        assert!(matches!(driver.reject(json!({"kind":"WRITE_CONTEXT","writeId":write,"stamp":stamp(),"observedEpochMilliseconds":driver.epoch,"allocatedId":null}),raw),luna_engine::runtime::form_resource::FormResourceError::InvalidHeader));
        let ready=driver.call(json!({"kind":"WRITE_CONTEXT","resourceId":0,"resourceRevision":0,"writeId":write,"stamp":stamp(),"observedEpochMilliseconds":driver.epoch,"allocatedId":"actual-raw-io-id"}),raw);
        assert_eq!(ready["state"], "WRITE_PERMIT_READY");
        let taken = driver.call(
            json!({"kind":"TAKE_WRITE","resourceId":0,"resourceRevision":0,"writeId":write}),
            b"",
        );
        let body: Value = serde_json::from_str(taken["planBody"].as_str().unwrap()).unwrap();
        assert_eq!(body["mutations"][0]["row"]["id"], "actual-raw-io-id");
        assert_eq!(body["mutations"][0]["expected"], Value::Null);
        let mut saved = stamp();
        saved["inputToken"] = json!("22222222222222222222222222222222");
        let ack=driver.call(json!({"kind":"ACK_WRITE","resourceId":0,"resourceRevision":0,"writeId":write,"stamp":saved,"observedEpochMilliseconds":driver.epoch}),b"");
        assert_eq!(ack["receipt"]["id"], "actual-raw-io-id");
        assert_eq!(ack["feedback"]["closed"], false);
        assert_eq!(ack["terminal"], true);
        driver.call(json!({"kind":"CLOSE_RESOURCE","resourceId":0}), b"");
    }
}
#[test]
fn shared_day_duty_events_keep_original_partial_invalid_clock_updates() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/day-duty-controller-golden.json"
    ));
    let seeds = value_pool::decode(include_str!(
        "../../reference/day-editor-source-golden.json"
    ));
    let profiles = value_pool::decode(include_str!(
        "../../reference/profile-editor-source-golden.json"
    ));
    let appearance = value_pool::decode(include_str!(
        "../../reference/day-editor-controller-golden.json"
    ))["appearance"]
        .clone();
    let mut driver = Driver::new();
    let mut frames = 0;
    for case in fixture["cases"].as_array().unwrap() {
        let input = &case["input"];
        let seed = &seeds["cases"][input["sourceIndex"].as_u64().unwrap() as usize]["input"];
        let profile = input["profileSourceIndex"]
            .as_u64()
            .map(|i| &profiles["cases"][i as usize]["input"]);
        let opening = driver.open(seed, profile, &appearance);
        let mut observations = vec![opening["view"]["draft"].clone()];
        for command in input["commands"].as_array().unwrap() {
            let reply=driver.event(json!({"kind":"DUTY_DRAFT","operation":command["operation"],"args":command["args"]}),b"");
            observations.push(reply["view"]["draft"].clone());
        }
        for (i, view) in observations.iter().enumerate() {
            common::assert_json_eq(
                &view["fields"],
                &case["expected"]["frames"][i]["fields"],
                case["id"].as_str().unwrap(),
            );
            assert_eq!(
                view["hasChanges"],
                case["expected"]["frames"][i]["hasChanges"]
            );
            frames += 1;
        }
        driver.call(json!({"kind":"CLOSE_RESOURCE","resourceId":0}), b"");
    }
    assert_eq!(frames, 240);
}
#[test]
fn shared_pool_retains_the_original_full_block_display_and_save_pipeline() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/day-block-pipeline-golden.json"
    ));
    let seeds = value_pool::decode(include_str!(
        "../../reference/day-editor-source-golden.json"
    ));
    let appearance = value_pool::decode(include_str!(
        "../../reference/day-editor-controller-golden.json"
    ))["appearance"]
        .clone();
    let mut driver = Driver::new();
    let mut frames = 0;
    for case in fixture["cases"].as_array().unwrap() {
        let mut reply = driver.open(&seeds["cases"][0]["input"], None, &appearance);
        for action in case["input"]["bootstrap"].as_array().unwrap() {
            reply = if action["kind"] == "DUTY" {
                driver.event(
                    json!({"kind":"CHANGE_DUTY"}),
                    &serde_json::to_vec(&action["value"]).unwrap(),
                )
            } else {
                driver.event(action.clone(), b"")
            };
        }
        for frame in 0..case["expected"]["frames"].as_array().unwrap().len() {
            if frame > 0 {
                let mut edit = case["input"]["commands"][frame - 1].clone();
                edit["structureRevision"] = reply["view"]["dutyStructureRevision"].clone();
                reply = driver.event(json!({"kind":"DUTY_BLOCK","edit":edit}), b"");
            }
            for field in ["display", "renderFailed", "tariff", "tariffError"] {
                common::assert_json_eq(
                    &reply["view"]["presentation"][field],
                    &case["expected"]["presentations"][frame][field],
                    case["id"].as_str().unwrap(),
                );
            }
            common::assert_json_eq(
                &reply["view"]["specialDutyView"],
                &case["expected"]["dutyViews"][frame],
                case["id"].as_str().unwrap(),
            );
            let preview = driver.event(json!({"kind":"PREPARE_SAVE","closeAfterSave":false}), b"");
            if case["expected"]["saves"][frame]["write"].is_null() {
                common::assert_json_eq(
                    &preview["feedback"],
                    &case["expected"]["saves"][frame],
                    case["id"].as_str().unwrap(),
                );
            } else {
                assert_eq!(
                    preview["feedback"],
                    json!({"state":"WRITE_INTENT_ONLY","stored":false})
                );
            }
            frames += 1;
        }
        driver.call(json!({"kind":"CLOSE_RESOURCE","resourceId":0}), b"");
    }
    assert_eq!(frames, 24);
}
#[test]
fn original_standby_forms_keep_partial_rate_text_across_the_shared_resource() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/day-standby-controller-golden.json"
    ));
    let seeds = value_pool::decode(include_str!(
        "../../reference/day-editor-source-golden.json"
    ));
    let mut driver = Driver::new();
    let mut frames = 0;
    for body_transport in [false, true] {
        for case in fixture["cases"].as_array().unwrap() {
            let input = &case["input"];
            let seed = &seeds["cases"][input["sourceIndex"].as_u64().unwrap() as usize]["input"];
            let mut reply=driver.open(seed,None,&json!({"defaultShiftColor":"#123456","appointmentColor":"#654321","presets":{},"billingFocus":input["appearance"]["billingFocus"]}));
            for action in input["bootstrap"].as_array().unwrap() {
                reply = if action["kind"] == "DUTY" {
                    driver.event(
                        json!({"kind":"CHANGE_DUTY"}),
                        &serde_json::to_vec(&action["value"]).unwrap(),
                    )
                } else {
                    driver.event(action.clone(), b"")
                };
            }
            for frame in 0..case["expected"]["frames"].as_array().unwrap().len() {
                if frame > 0 {
                    let command = &input["commands"][frame - 1];
                    reply = if command["kind"] == "DUTY" {
                        driver.event(
                            json!({"kind":"CHANGE_DUTY"}),
                            &serde_json::to_vec(&command["value"]).unwrap(),
                        )
                    } else {
                        if body_transport {
                            driver.event(json!({"kind":"DUTY_STANDBY_BODY","component":command["component"]}),&serde_json::to_vec(&command["action"]).unwrap())
                        } else {
                            driver.event(json!({"kind":"DUTY_STANDBY","component":command["component"],"action":command["action"]}),b"")
                        }
                    };
                }
                let expected = &case["expected"]["frames"][frame];
                common::assert_json_eq(
                    &reply["view"]["draft"]["fields"],
                    &expected["draft"]["fields"],
                    case["id"].as_str().unwrap(),
                );
                assert_eq!(
                    reply["view"]["draft"]["hasChanges"],
                    expected["draft"]["hasChanges"]
                );
                common::assert_json_eq(
                    &reply["view"]["standbyViews"],
                    &expected["standbyViews"],
                    case["id"].as_str().unwrap(),
                );
                frames += 1;
            }
            driver.call(json!({"kind":"CLOSE_RESOURCE","resourceId":0}), b"");
        }
    }
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 449);
    assert_eq!(frames, 1808);
}
#[test]
fn raw_large_field_values_use_the_bounded_body_without_weakening_headers() {
    let mut driver = day_write_setup();
    let note = "Grüße ".repeat(2000);
    let raw = serde_json::to_vec(&json!(note)).unwrap();
    assert!(raw.len() > 8192);
    let reply = driver.event(json!({"kind":"SET_BODY","field":"shiftNote"}), &raw);
    assert_eq!(reply["view"]["draft"]["fields"]["shiftNote"], note);
    let header = json!({"kind":"DAY_EVENT","event":{"kind":"SET_BODY","field":"shiftNote"},"observedEpochMilliseconds":driver.epoch});
    assert!(matches!(
        driver.reject(header, &vec![b'x'; 256 * 1024 + 1]),
        luna_engine::runtime::form_resource::FormResourceError::InputTooLarge
    ));
    assert!(matches!(driver.reject(json!({"kind":"DAY_EVENT","event":{"kind":"SET_BODY","field":"shiftNote"},"observedEpochMilliseconds":driver.epoch}),b"{"),luna_engine::runtime::form_resource::FormResourceError::InvalidHeader));
}
#[test]
fn a_large_invalid_standby_paste_keeps_the_original_no_change_behavior_through_the_body() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/day-standby-controller-golden.json"
    ));
    let seeds = value_pool::decode(include_str!(
        "../../reference/day-editor-source-golden.json"
    ));
    let case = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| {
            case["input"]["commands"]
                .as_array()
                .unwrap()
                .iter()
                .any(|command| command["action"]["label"] == "Stundenentgelt vor Bewertung (€)")
        })
        .unwrap();
    let input = &case["input"];
    let seed = &seeds["cases"][input["sourceIndex"].as_u64().unwrap() as usize]["input"];
    let mut driver = Driver::new();
    let mut reply=driver.open(seed,None,&json!({"defaultShiftColor":"#123456","appointmentColor":"#654321","presets":{},"billingFocus":input["appearance"]["billingFocus"]}));
    for action in input["bootstrap"].as_array().unwrap() {
        reply = if action["kind"] == "DUTY" {
            driver.event(
                json!({"kind":"CHANGE_DUTY"}),
                &serde_json::to_vec(&action["value"]).unwrap(),
            )
        } else {
            driver.event(action.clone(), b"")
        };
    }
    let before = reply["view"].clone();
    let action = json!({"type":"Field","label":"Stundenentgelt vor Bewertung (€)","callback":"onChangeText","value":"invalid".repeat(3000)});
    let body = serde_json::to_vec(&action).unwrap();
    assert!(body.len() > 8192);
    let after = driver.event(json!({"kind":"DUTY_STANDBY_BODY","component":0}), &body);
    common::assert_json_eq(
        &after["view"],
        &before,
        "invalid rate text remains an ignored raw edit",
    );
    let header = json!({"kind":"DAY_EVENT","event":{"kind":"DUTY_STANDBY_BODY","component":0},"observedEpochMilliseconds":driver.epoch});
    assert!(matches!(
        driver.reject(header.clone(), &vec![b'x'; 256 * 1024 + 1]),
        luna_engine::runtime::form_resource::FormResourceError::InputTooLarge
    ));
    assert!(matches!(
        driver.reject(header, b"{"),
        luna_engine::runtime::form_resource::FormResourceError::InvalidHeader
    ));
}
#[test]
fn all_original_source_draft_duty_and_display_sequences_pass_through_one_shared_pool() {
    let f = value_pool::decode(include_str!(
        "../../reference/day-editor-controller-golden.json"
    ));
    let seeds = value_pool::decode(include_str!(
        "../../reference/day-editor-source-golden.json"
    ));
    let profiles = value_pool::decode(include_str!(
        "../../reference/profile-editor-source-golden.json"
    ));
    let mut driver = Driver::new();
    let mut frames = 0;
    let mut previews = 0;
    for case in f["cases"].as_array().unwrap() {
        let input = &case["input"];
        let seed = &seeds["cases"][input["sourceIndex"].as_u64().unwrap() as usize]["input"];
        let profile = input["profileSourceIndex"]
            .as_u64()
            .map(|index| &profiles["cases"][index as usize]["input"]);
        let marker = driver.registry.preparation_marker().unwrap();
        let opened = driver.open(seed, profile, &f["appearance"]);
        assert_view(&opened, case, 0);
        frames += 1;
        for (index, action) in input["actions"].as_array().unwrap().iter().enumerate() {
            let reply = match action["kind"].as_str().unwrap() {
                "SET" => driver.event(action.clone(), b""),
                "TYPE" => driver.event(json!({"kind":"CHOOSE_TYPE","value":action["value"]}), b""),
                "DUTY" => driver.event(
                    json!({"kind":"CHANGE_DUTY"}),
                    &serde_json::to_vec(&action["value"]).unwrap(),
                ),
                _ => panic!("closed original action"),
            };
            assert_view(&reply, case, index + 1);
            frames += 1;
        }
        // UI-supplied busy is not accepted as native truth. Busy and real IO
        // failure paths remain the next genuine shared-write/ACK package.
        if input["busy"] != true {
            let preview=driver.event(json!({"kind":"PREPARE_SAVE","closeAfterSave":input["closeAfterSave"].as_bool().unwrap_or(false)}),b"");
            assert_eq!(preview["state"], "DAY_SAVE_PREVIEW");
            assert!(preview.get("writeId").is_none());
            assert!(preview.get("effects").is_none());
            if !case["expected"]["save"]["write"].is_null() {
                assert_eq!(
                    preview["feedback"],
                    json!({"state":"WRITE_INTENT_ONLY","stored":false})
                );
            } else {
                assert_eq!(
                    preview["feedback"], case["expected"]["save"],
                    "{} terminal no-write policy",
                    case["id"]
                );
            }
            previews += 1;
        }
        assert!(marker.is_current().unwrap());
        driver.call(json!({"kind":"CLOSE_RESOURCE","resourceId":0}), b"");
    }
    assert_eq!(f["cases"].as_array().unwrap().len(), 4170);
    assert_eq!(frames, 9990);
    assert_eq!(previews, 4162);
}

fn checked_header(_driver: &Driver, command: Value, request: &str, revision: u64) -> Vec<u8> {
    serde_json::to_vec(&json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"day-resource","ownerEpoch":1,"requestId":request,"draftRevision":revision},"command":command})).unwrap()
}
#[test]
fn failed_or_missing_selected_sources_are_unavailable_without_fabricating_a_new_entry() {
    let f = value_pool::decode(include_str!(
        "../../reference/day-editor-controller-golden.json"
    ));
    let seeds = value_pool::decode(include_str!(
        "../../reference/day-editor-source-golden.json"
    ));
    for (failure, code) in [
        (true, "DAY_SOURCE_READ_FAILED"),
        (false, "DAY_ENTRY_MISSING"),
    ] {
        let mut input = seeds["cases"][0]["input"].clone();
        assert!(input["request"]["entryId"].is_string());
        for group in input["entrySources"].as_array_mut().unwrap() {
            if (failure && group["kind"] == "TEMPLATES")
                || (!failure
                    && ["ENTRY_SHIFT", "ENTRY_APPOINTMENT"]
                        .contains(&group["kind"].as_str().unwrap()))
            {
                group["state"] = json!(if failure { "FAILED" } else { "READY" });
                group["presence"] = json!("NULL");
                group["body"] = json!("");
            }
        }
        let mut driver = Driver::new();
        let opened = driver.open(&input, None, &f["appearance"]);
        assert_eq!(opened["state"], "FORM_UNAVAILABLE");
        assert_eq!(opened["reason"]["code"], code);
        assert!(opened.get("resourceId").is_none());
        assert!(opened.get("view").is_none());
    }
}

#[test]
fn raw_duty_body_crosses_the_small_header_without_expanding_limits_and_owner_reset_fences_it() {
    use luna_engine::runtime::form_resource::FormResourceError;
    let f = value_pool::decode(include_str!(
        "../../reference/day-editor-controller-golden.json"
    ));
    let seeds = value_pool::decode(include_str!(
        "../../reference/day-editor-source-golden.json"
    ));
    let mut driver = Driver::new();
    driver.open(&seeds["cases"][0]["input"], None, &f["appearance"]);
    let mut body = vec![b' '; 9000];
    body.extend_from_slice(b"null");
    let changed = driver.event(json!({"kind":"CHANGE_DUTY"}), &body);
    assert_eq!(changed["state"], "DAY_READY");
    let request = format!("day-resource-{}", driver.request);
    let stale = json!({"kind":"DAY_EVENT","resourceId":driver.id,"resourceRevision":0,"observedEpochMilliseconds":driver.epoch,"event":{"kind":"VIEW"}});
    assert!(matches!(
        driver.pool.prepare(
            &driver.registry,
            &driver.registry.utility_owner_marker().unwrap(),
            &checked_header(&driver, stale, &request, driver.revision),
            b""
        ),
        Err(FormResourceError::StaleResource)
    ));
    let command = json!({"kind":"DAY_EVENT","resourceId":driver.id,"resourceRevision":driver.revision,"observedEpochMilliseconds":driver.epoch,"event":{"kind":"CHANGE_DUTY"}});
    assert!(matches!(
        driver.pool.prepare(
            &driver.registry,
            &driver.registry.utility_owner_marker().unwrap(),
            &checked_header(&driver, command, &request, driver.revision),
            &vec![b' '; 256 * 1024 + 1]
        ),
        Err(FormResourceError::InputTooLarge)
    ));
    let foreign = json!({"kind":"DAY_EVENT","resourceId":driver.id,"resourceRevision":driver.revision,"observedEpochMilliseconds":driver.epoch,"event":{"kind":"VIEW"}});
    assert!(matches!(
        driver.pool.prepare(
            &driver.registry,
            &driver.registry.utility_owner_marker().unwrap(),
            &checked_header(&driver, foreign, "foreign-day", driver.revision),
            b""
        ),
        Err(FormResourceError::OwnerChanged)
    ));
    driver
        .registry
        .reset_for_owner(&OwnerIdentity::new("day-resource", 1).unwrap())
        .unwrap();
    let old = json!({"kind":"DAY_EVENT","resourceId":driver.id,"resourceRevision":driver.revision,"observedEpochMilliseconds":driver.epoch,"event":{"kind":"VIEW"}});
    assert!(matches!(
        driver.pool.prepare(
            &driver.registry,
            &driver.registry.utility_owner_marker().unwrap(),
            &checked_header(&driver, old, &request, driver.revision),
            b""
        ),
        Err(FormResourceError::UnknownResource)
    ));
}

#[test]
fn extra_day_sources_are_unique_and_share_one_aggregate_raw_byte_budget() {
    use luna_engine::runtime::form_resource::FormResourceError;
    let f = value_pool::decode(include_str!(
        "../../reference/day-editor-controller-golden.json"
    ));
    let seeds = value_pool::decode(include_str!(
        "../../reference/day-editor-source-golden.json"
    ));
    let input = &seeds["cases"][0]["input"];
    let mut driver = Driver::new();
    let begin=driver.call(json!({"kind":"BEGIN_DAY_EDITOR","stamp":stamp(),"observedEpochMilliseconds":input["observedEpochMilliseconds"],"request":input["request"],"appearance":f["appearance"]}),b"");
    let id = begin["builderId"].as_u64().unwrap();
    let six_mib = vec![b' '; 6 * 1024 * 1024];
    driver.call(
        json!({"kind":"DAY_SOURCE","builderId":id,"group":{"kind":"ENTRY_SHIFT","state":"VALUE"}}),
        &six_mib,
    );
    let request = format!("day-resource-{}", driver.request);
    let duplicate =
        json!({"kind":"DAY_SOURCE","builderId":id,"group":{"kind":"ENTRY_SHIFT","state":"NULL"}});
    assert!(matches!(
        driver.pool.prepare(
            &driver.registry,
            &driver.registry.utility_owner_marker().unwrap(),
            &checked_header(&driver, duplicate, &request, 0),
            b""
        ),
        Err(FormResourceError::InvalidSource)
    ));
    driver.call(json!({"kind":"DAY_SOURCE","builderId":id,"group":{"kind":"ENTRY_APPOINTMENT","state":"VALUE"}}),&six_mib);
    let too_large = json!({"kind":"DAY_SOURCE","builderId":id,"group":{"kind":"ENTRY_TEMPLATE","state":"VALUE"}});
    assert!(matches!(
        driver.pool.prepare(
            &driver.registry,
            &driver.registry.utility_owner_marker().unwrap(),
            &checked_header(&driver, too_large, &request, 0),
            &six_mib
        ),
        Err(FormResourceError::InputTooLarge)
    ));
}
