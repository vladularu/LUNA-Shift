use luna_engine::{
    contract::{self, OwnerIdentity},
    runtime::{SnapshotRegistry, form_resource::FormResourcePool},
};
use serde_json::{Value, json};
#[path = "support/value_pool.rs"]
mod value_pool;
fn header(command: Value) -> Vec<u8> {
    serde_json::to_vec(&json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"form-owner","ownerEpoch":1,"requestId":"form-owner-1","draftRevision":0},"command":command})).unwrap()
}
#[test]
fn owner_bound_private_profile_builder_begins_without_changing_report_generation() {
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("form-owner", 1).unwrap())
        .unwrap();
    let pool = FormResourcePool::new();
    let global = registry.preparation_marker().unwrap();
    let request = header(
        json!({"kind":"BEGIN_PROFILE","stamp":{"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":"11111111111111111111111111111111","databaseSchemaVersion":35},"observedEpochMilliseconds":1794488400000_i64,"section":"WORK","fromMore":true}),
    );
    let prepared = pool
        .prepare(
            &registry,
            &registry.utility_owner_marker().unwrap(),
            &request,
            b"",
        )
        .unwrap();
    let reply: Value = serde_json::from_slice(&prepared.complete().unwrap()).unwrap();
    assert_eq!(reply["ok"], true);
    assert_eq!(reply["state"], "PROFILE_SOURCE_OPEN");
    assert!(reply["builderId"].as_u64().is_some());
    assert!(global.is_current().unwrap());
}

fn call(
    pool: &FormResourcePool,
    registry: &SnapshotRegistry,
    command: Value,
    body: &[u8],
) -> Value {
    let prepared = pool
        .prepare(
            registry,
            &registry.utility_owner_marker().unwrap(),
            &header(command),
            body,
        )
        .unwrap();
    serde_json::from_slice(&prepared.complete().unwrap()).unwrap()
}
fn begin_command(i: &Value) -> Value {
    json!({"kind":"BEGIN_PROFILE","stamp":{"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":"11111111111111111111111111111111","databaseSchemaVersion":35},"observedEpochMilliseconds":i["observedEpochMilliseconds"],"section":i["section"],"fromMore":i["fromMore"]})
}
#[test]
fn private_source_open_preserves_all_available_original_editor_drafts_and_no_profile_is_not_ready()
{
    let d = value_pool::decode(include_str!(
        "../../reference/profile-editor-source-golden.json"
    ));
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("form-owner", 1).unwrap())
        .unwrap();
    let pool = FormResourcePool::new();
    let mut compared = 0;
    for case in d["cases"].as_array().unwrap().iter() {
        let i = &case["input"];
        let global = registry.preparation_marker().unwrap();
        let begun = call(&pool, &registry, begin_command(i), b"");
        let id = begun["builderId"].as_u64().unwrap();
        for (kind, key) in [
            ("WORK_PROFILE", "profile"),
            ("REMUNERATION_PROFILES", "historyRows"),
            ("WORK_PATTERN_SETTINGS", "patternRows"),
        ] {
            let null = i[key].is_null();
            let group = json!({"kind":kind,"source":{"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":if null{"NULL"}else{"VALUE"}}}}});
            let body = if null {
                vec![]
            } else {
                serde_json::to_vec(&i[key]).unwrap()
            };
            call(
                &pool,
                &registry,
                json!({"kind":"SOURCE","builderId":id,"group":group}),
                &body,
            );
        }
        let opened = call(
            &pool,
            &registry,
            json!({"kind":"OPEN_PROFILE","builderId":id}),
            b"",
        );
        if case["expected"]["ok"] == false {
            assert_eq!(opened["state"], "FORM_UNAVAILABLE", "{}", case["id"]);
            assert!(opened.get("resourceId").is_none());
            assert_eq!(
                opened["error"]["name"], case["expected"]["name"],
                "{}",
                case["id"]
            );
            assert_eq!(
                opened["error"]["message"], case["expected"]["message"],
                "{}",
                case["id"]
            );
        } else if case["expected"]["value"].is_null() {
            assert_eq!(opened["state"], "FORM_UNAVAILABLE");
            assert!(opened.get("resourceId").is_none());
        } else {
            assert_eq!(opened["state"], "PROFILE_READY", "{}", case["id"]);
            assert_eq!(
                opened["view"]["editor"]["draft"], case["expected"]["value"]["bootstrap"]["draft"],
                "{}",
                case["id"]
            );
            assert_eq!(
                opened["view"]["editor"]["preview"],
                case["expected"]["value"]["bootstrap"]["preview"],
                "{}",
                case["id"]
            );
            assert_eq!(
                opened["view"]["flow"]["referenceDate"],
                case["expected"]["value"]["referenceDate"]
            );
            assert!(opened["view"].get("profile").is_none());
            assert!(opened["view"]["flow"].get("base").is_none());
            let close = json!({"kind":"CLOSE_RESOURCE","resourceId":opened["resourceId"]});
            call(&pool, &registry, close.clone(), b"");
            call(&pool, &registry, close, b"");
        }
        assert!(global.is_current().unwrap());
        compared += 1;
    }
    assert_eq!(compared, 1662);
}
#[test]
fn prepared_publication_is_single_use_owner_fenced_and_raw_source_bounds_are_independent() {
    use luna_engine::runtime::form_resource::{FormResourceError, MAX_FORM_BODY_BYTES};
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("form-owner", 1).unwrap())
        .unwrap();
    let pool = FormResourcePool::new();
    let d = value_pool::decode(include_str!(
        "../../reference/profile-editor-source-golden.json"
    ));
    let i = &d["cases"][0]["input"];
    let req = header(begin_command(i));
    let p = pool
        .prepare(
            &registry,
            &registry.utility_owner_marker().unwrap(),
            &req,
            b"",
        )
        .unwrap();
    p.complete().unwrap();
    assert!(matches!(
        p.complete(),
        Err(FormResourceError::AlreadyPublished)
    ));
    registry
        .reset_for_owner(&OwnerIdentity::new("form-owner", 1).unwrap())
        .unwrap();
    assert!(!p.is_current().unwrap());
    assert!(matches!(p.complete(), Err(FormResourceError::OwnerChanged)));
    assert!(pool.collect_retired().unwrap());
    assert!(matches!(
        pool.prepare(
            &registry,
            &registry.utility_owner_marker().unwrap(),
            &req,
            &vec![b' '; MAX_FORM_BODY_BYTES + 1]
        ),
        Err(FormResourceError::InputTooLarge)
    ));
    let mut wrong: Value = serde_json::from_slice(&req).unwrap();
    wrong["expectedEngineVersion"] = json!("wrong");
    assert!(matches!(
        pool.prepare(
            &registry,
            &registry.utility_owner_marker().unwrap(),
            &serde_json::to_vec(&wrong).unwrap(),
            b""
        ),
        Err(FormResourceError::UnsupportedEngine)
    ));
    let b = call(&pool, &registry, begin_command(i), b"");
    let bad = json!({"kind":"SOURCE","builderId":b["builderId"],"group":{"kind":"WORKING_TIME_TARGET","source":{"state":"NOT_REQUESTED"}}});
    assert!(matches!(
        pool.prepare(
            &registry,
            &registry.utility_owner_marker().unwrap(),
            &header(bad),
            b""
        ),
        Err(FormResourceError::InvalidSource)
    ));
}
