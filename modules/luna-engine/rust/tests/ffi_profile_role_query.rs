#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{contract, ffi::*};
use serde_json::{Value, json};
fn take(buffer: EngineBuffer) -> Value {
    let result =
        serde_json::from_slice(unsafe { std::slice::from_raw_parts(buffer.bytes, buffer.length) })
            .unwrap();
    if buffer.handle != 0 {
        assert!(luna_engine_release_buffer(buffer.handle));
    }
    result
}
fn call(function: unsafe extern "C" fn(*const u8, usize) -> EngineBuffer, value: &Value) -> Value {
    let bytes = serde_json::to_vec(value).unwrap();
    take(unsafe { function(bytes.as_ptr(), bytes.len()) })
}
fn query(header: &Value, body: &Value) -> Value {
    let header = serde_json::to_vec(header).unwrap();
    let body = serde_json::to_vec(body).unwrap();
    take(unsafe {
        luna_engine_calendar_source(header.as_ptr(), header.len(), body.as_ptr(), body.len())
    })
}
#[test]
fn private_raw3_query_survives_builder_abort_and_rejects_a_different_original_clock_key() {
    call(
        luna_engine_bind_owner,
        &json!({"ownerScope":"provided-role","ownerEpoch":1}),
    );
    let cases = value_pool::decode(include_str!("../../reference/profile-clock-golden.json"));
    let mut count = 0;
    for case in cases["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["expected"]["value"].is_object())
    {
        let i = &case["input"];
        let builder = call(luna_engine_snapshot_begin,&json!({"ownerScope":"provided-role","ownerEpoch":1,"snapshotId":"metadata","snapshotRevision":count+1,"selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}}))["builderId"].clone();
        let mut groups = Vec::new();
        for (kind, key) in [
            ("WORK_PROFILE", "profile"),
            ("REMUNERATION_PROFILES", "historyRows"),
            ("WORK_PATTERN_SETTINGS", "patternRows"),
        ] {
            let value = &i[key];
            let header = serde_json::to_vec(&json!({"builderId":builder,"target":"SOURCE","group":{"kind":kind,"source":{"state":"READY","revision":count+1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":if value.is_null(){"NULL"}else{"VALUE"}}}}}})).unwrap();
            let body = if value.is_null() {
                Vec::new()
            } else {
                serde_json::to_vec(value).unwrap()
            };
            let reply = take(unsafe {
                luna_engine_snapshot_source(
                    header.as_ptr(),
                    header.len(),
                    body.as_ptr(),
                    body.len(),
                )
            });
            assert_eq!(reply["state"], "SOURCE_ADDED", "{}:{reply}", case["id"]);
            groups.push(if value.is_null() {
                json!({"kind":kind,"state":"READY","presence":"NULL"})
            } else {
                json!({"kind":kind,"state":"READY","presence":"VALUE","value":value})
            });
        }
        let metadata = call(
            luna_engine_snapshot_profile_clock,
            &json!({"builderId":builder,"epochMilliseconds":i["observedEpochMilliseconds"]}),
        );
        assert_eq!(
            metadata["profiles"]["state"], "READY",
            "{}:{metadata}",
            case["id"]
        );
        call(luna_engine_snapshot_abort, &json!({"builderId":builder}));
        let mut header = json!({"kind":"PRESENTATION","wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"provided-role","ownerEpoch":1,"requestId":"role-query","draftRevision":count*3},"command":{"kind":"PROFILE_ROLE_QUERY"}});
        let mut body = json!({"sourceClockKey":metadata["sourceClockKey"],"sourceEpochMilliseconds":i["observedEpochMilliseconds"],"renderEpochMilliseconds":i["observedEpochMilliseconds"],"sources":groups});
        let actual = query(&header, &body);
        assert_eq!(
            actual["state"], "CALENDAR_PRESENTED",
            "{}:{actual}",
            case["id"]
        );
        assert!(actual["value"].is_null() || actual["value"].is_string());
        if i["profile"].is_null() {
            assert!(actual["value"].is_null());
        }
        header["guard"]["draftRevision"] = json!(count * 3 + 1);
        body["sourceClockKey"] = json!("0".repeat(64));
        assert_eq!(
            query(&header, &body)["code"],
            "PROFILE_ROLE_SOURCE_MISMATCH"
        );
        count += 1;
    }
    assert_eq!(count, 239);
}
