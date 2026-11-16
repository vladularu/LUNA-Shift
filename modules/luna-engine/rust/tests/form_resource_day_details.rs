mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    contract::{self, OwnerIdentity},
    runtime::{
        SnapshotRegistry,
        form_resource::{FormResourceError, FormResourcePool},
    },
};
use serde_json::{Value, json};
fn bytes(v: &Value) -> Vec<u8> {
    serde_json::to_vec(v).unwrap()
}
fn header(command: Value) -> Vec<u8> {
    bytes(
        &json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"details","ownerEpoch":1,"requestId":"details-1","draftRevision":0},"command":command}),
    )
}
fn call(
    pool: &FormResourcePool,
    registry: &SnapshotRegistry,
    command: Value,
    body: &[u8],
) -> Result<Value, FormResourceError> {
    let p = pool.prepare(
        registry,
        &registry.utility_owner_marker().unwrap(),
        &header(command),
        body,
    )?;
    Ok(serde_json::from_slice(&p.complete()?).unwrap())
}
fn registry() -> SnapshotRegistry {
    let r = SnapshotRegistry::default();
    r.reset_for_owner(&OwnerIdentity::new("details", 1).unwrap())
        .unwrap();
    r
}
fn open(pool: &FormResourcePool, r: &SnapshotRegistry, input: &Value, ranks: &Value) -> Value {
    let raw = &input["rawSource"];
    let epoch = &raw["epoch"];
    let begun=call(pool,r,json!({"kind":"BEGIN_DAY_DETAILS","stamp":{"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":"11111111111111111111111111111111","databaseSchemaVersion":35},"observedEpochMilliseconds":epoch,"date":input["date"]}),b"").unwrap();
    let id = &begun["builderId"];
    for (kind, key) in [
        ("WORK_PROFILE", "profile"),
        ("REMUNERATION_PROFILES", "historyRows"),
        ("WORK_PATTERN_SETTINGS", "patternRows"),
        ("WORKING_TIME_TARGET", "targetRow"),
        ("CALENDAR_ENTRIES", "calendar"),
        ("YOUTH_PREFERENCE", "youthPreference"),
    ] {
        let mut body = raw[key].clone();
        if kind == "CALENDAR_ENTRIES" {
            body["platformCollationRanks"] = json!({});
        }
        if kind == "WORKING_TIME_TARGET" && !body.is_null() {
            let text = body
                .as_object_mut()
                .unwrap()
                .remove("settings_json")
                .unwrap();
            body["settings_json_chunks"] = json!([text]);
        }
        let mut state = json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":if body.is_null(){"NULL"}else{"VALUE"}}}});
        if kind == "WORKING_TIME_TARGET" && raw["targetState"] != "READY" {
            state = if raw["targetState"] == "LOADING" {
                json!({"state":"LOADING"})
            } else {
                json!({"state":"FAILED","code":"READ_FAILED"})
            };
        }
        let payload = if state["state"] != "READY" || body.is_null() {
            vec![]
        } else {
            bytes(&body)
        };
        call(
            pool,
            r,
            json!({"kind":"DAY_DETAILS_SOURCE","builderId":id,"group":{"kind":kind,"source":state}}),
            &payload,
        )
        .unwrap();
    }
    for kind in ["TARIFF", "LEGAL", "HOLIDAY"] {
        call(pool,r,json!({"kind":"DAY_DETAILS_CATALOG","builderId":id,"group":{"kind":kind,"source":{"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE"}}}}}),br#"{"mode":"COMPILED_LEGACY"}"#).unwrap();
    }
    call(
        pool,
        r,
        json!({"kind":"PREPARE_DAY_DETAILS","builderId":id}),
        b"",
    )
    .unwrap();
    for family in ["CALENDAR", "CATALOG"] {
        let mut offset = 0;
        loop {
            let page=call(pool,r,json!({"kind":"DAY_DETAILS_CANDIDATES","builderId":id,"family":family,"offset":offset}),b"").unwrap();
            let values = page["values"].as_array().unwrap();
            if family == "CALENDAR" {
                for name in values {
                    assert!(ranks.get(name.as_str().unwrap()).is_some());
                }
            } else {
                assert!(values.is_empty());
            }
            offset += values.len();
            if offset == page["total"].as_u64().unwrap() as usize {
                break;
            }
            assert!(!values.is_empty());
        }
    }
    call(
        pool,
        r,
        json!({"kind":"DAY_DETAILS_CALENDAR_RANKS","builderId":id}),
        &bytes(ranks),
    )
    .unwrap();
    call(
        pool,
        r,
        json!({"kind":"OPEN_DAY_DETAILS","builderId":id,"observedEpochMilliseconds":epoch}),
        b"{}",
    )
    .unwrap()
}
#[test]
fn private_pool_matches_all_original_day_detail_frames_and_keeps_report_generation_unchanged() {
    let a = value_pool::decode(include_str!(
        "../../reference/day-details-source-golden.json"
    ));
    let b = value_pool::decode(include_str!(
        "../../reference/day-details-recurrence-golden.json"
    ));
    let ar: Value = serde_json::from_str(include_str!(
        "../../reference/day-details-platform-ranks.json"
    ))
    .unwrap();
    let br: Value = serde_json::from_str(include_str!(
        "../../reference/day-details-recurrence-ranks.json"
    ))
    .unwrap();
    let cases = a["cases"]
        .as_array()
        .unwrap()
        .iter()
        .chain(b["cases"].as_array().unwrap());
    let ranks = ar["cases"]
        .as_array()
        .unwrap()
        .iter()
        .chain(br["cases"].as_array().unwrap());
    let r = registry();
    let pool = FormResourcePool::new();
    let generation = r.preparation_marker().unwrap();
    let mut count = 0;
    for (case, locale) in cases.zip(ranks) {
        assert_eq!(case["id"], locale["id"]);
        let input = &case["input"];
        let opened = open(&pool, &r, input, &locale["ranks"]);
        let id = &opened["resourceId"];
        let mut actual = if opened["state"] == "DAY_DETAILS_LOADING" {
            json!({"state":"LOADING"})
        } else {
            opened["view"].clone()
        };
        if opened["state"] == "DAY_DETAILS_READY" {
            let mut rows = vec![];
            let total = opened["rowCount"].as_u64().unwrap() as u32;
            for offset in (0..total).step_by(3) {
                let page=call(&pool,&r,json!({"kind":"DAY_DETAILS_ROWS","resourceId":id,"resourceRevision":0,"observedEpochMilliseconds":input["rawSource"]["epoch"],"offset":offset,"limit":3}),b"").unwrap();
                rows.extend(page["rows"].as_array().unwrap().iter().cloned());
            }
            actual["entries"] = json!(rows);
        }
        let mut expected = case["expected"].clone();
        if let Some(rows) = expected.get_mut("entries").and_then(Value::as_array_mut) {
            for row in rows {
                row.as_object_mut().unwrap().remove("route");
            }
        }
        common::assert_json_eq(&actual, &expected, case["id"].as_str().unwrap());
        for command in [
            json!({"kind":"TAKE_WRITE","resourceId":id,"resourceRevision":0,"writeId":1}),
            json!({"kind":"WRITE_CONTEXT","resourceId":id,"resourceRevision":0,"writeId":1,"stamp":{"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":"11111111111111111111111111111111","databaseSchemaVersion":35},"observedEpochMilliseconds":input["rawSource"]["epoch"]}),
            json!({"kind":"ACK_WRITE","resourceId":id,"resourceRevision":0,"writeId":1,"stamp":{"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":"11111111111111111111111111111111","databaseSchemaVersion":35},"observedEpochMilliseconds":input["rawSource"]["epoch"]}),
            json!({"kind":"DAY_DETAILS_ROWS","resourceId":id,"resourceRevision":0,"observedEpochMilliseconds":input["rawSource"]["epoch"],"offset":0,"limit":129}),
            json!({"kind":"DAY_DETAILS_ROWS","resourceId":id,"resourceRevision":1,"observedEpochMilliseconds":input["rawSource"]["epoch"],"offset":0,"limit":1}),
            json!({"kind":"DAY_DETAILS_ROWS","resourceId":id,"resourceRevision":0,"observedEpochMilliseconds":input["rawSource"]["epoch"].as_i64().unwrap()-1,"offset":0,"limit":1}),
        ] {
            assert!(call(&pool, &r, command, b"").is_err());
        }
        call(
            &pool,
            &r,
            json!({"kind":"CLOSE_RESOURCE","resourceId":id}),
            b"",
        )
        .unwrap();
        assert!(generation.is_current().unwrap());
        count += 1;
    }
    assert_eq!(count, 348);
}
