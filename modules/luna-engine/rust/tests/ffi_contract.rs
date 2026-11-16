use luna_engine::{
    contract::{self, ALL_SOURCE_KINDS},
    ffi::*,
};
use serde_json::{Value, json};
fn take(buffer: EngineBuffer) -> Value {
    assert!(!buffer.bytes.is_null());
    assert!(buffer.length <= 4 * 1024 * 1024);
    // SAFETY: this is a live buffer returned by the matching library; no release
    // occurs until serde has copied its bytes into owned JSON.
    let value =
        serde_json::from_slice(unsafe { std::slice::from_raw_parts(buffer.bytes, buffer.length) })
            .unwrap();
    if buffer.handle != 0 {
        assert!(luna_engine_release_buffer(buffer.handle));
        assert!(!luna_engine_release_buffer(buffer.handle));
    }
    value
}
fn execute(command: Value) -> Value {
    let bytes=serde_json::to_vec(&json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":command})).unwrap();
    // SAFETY: the vector is alive and readable until the synchronous call returns.
    take(unsafe { luna_engine_execute(bytes.as_ptr(), bytes.len()) })
}
fn bind(scope: &str, epoch: u64) -> Value {
    let bytes = serde_json::to_vec(&json!({"ownerScope":scope,"ownerEpoch":epoch})).unwrap();
    // SAFETY: the vector is alive and readable until the synchronous call returns.
    take(unsafe { luna_engine_bind_owner(bytes.as_ptr(), bytes.len()) })
}
#[test]
fn exported_info_uses_the_real_compiled_identity_and_owned_buffers() {
    let info = take(luna_engine_info());
    assert_eq!(info["ok"], true);
    assert_eq!(info["abiVersion"], ABI_VERSION);
    assert_eq!(info["engineVersion"], luna_engine::ENGINE_VERSION);
    assert_eq!(info["engineBuildDigest"], luna_engine::ENGINE_BUILD_DIGEST);
    assert_eq!(info["timeZoneDbVersion"], "2026b");
    assert_eq!(info["capabilities"]["fullCalculation"], false);
    assert_eq!(info["capabilities"]["domainReports"], true);
    assert_eq!(
        info["sourceKinds"],
        serde_json::to_value(contract::ALL_SOURCE_KINDS).unwrap()
    );
    assert_eq!(info["limits"]["inputBytes"], contract::MAX_INPUT_BYTES);
}

#[test]
fn c_calendar_preflight_pages_only_native_candidates_without_locale_guesses() {
    use std::collections::BTreeSet;
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/input-calendar-rows-golden.json"
    ))
    .unwrap();
    let case = data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| {
            c["operation"] == "listCalendarEntries" && c["candidates"].as_array().unwrap().len() > 4
        })
        .unwrap();
    let call = |request: &Value| {
        let bytes = serde_json::to_vec(request).unwrap();
        // SAFETY: the owned vector remains readable for this synchronous call.
        take(unsafe { luna_engine_calendar_candidates(bytes.as_ptr(), bytes.len()) })
    };
    let mut request = json!({"calendar":{"shiftRows":case["input"]["shiftRows"],"appointmentRows":case["input"]["appointmentRows"],"platformCollationRanks":{}},"after":null,"limit":2});
    let mut strings = BTreeSet::new();
    loop {
        let response = call(&request);
        assert_eq!(response["ok"], true);
        assert_eq!(response["engineVersion"], luna_engine::ENGINE_VERSION);
        let page = &response["page"];
        assert!(page["candidates"].as_array().unwrap().len() <= 2);
        assert!(page.get("entries").is_none());
        for string in page["candidates"].as_array().unwrap() {
            assert!(strings.insert(string.as_str().unwrap().to_owned()));
        }
        if page["nextAfter"].is_null() {
            break;
        }
        request["after"] = page["nextAfter"].clone();
    }
    let expected: BTreeSet<String> = serde_json::from_value(case["candidates"].clone()).unwrap();
    assert_eq!(strings, expected);
    request["after"] = json!("unknown-private-cursor");
    let rejected = call(&request);
    assert_eq!(rejected["code"], "INVALID_CALENDAR_SOURCE");
    assert!(!rejected.to_string().contains("private"));
    request["after"] = Value::Null;
    request["calendar"]["entries"] = case["expected"]["value"].clone();
    assert_eq!(call(&request)["code"], "INVALID_CALENDAR_SOURCE");
}
#[test]
fn invalid_pointers_sizes_or_json_do_not_echo_input_or_free_arbitrary_memory() {
    // SAFETY: null/oversized buffers are explicitly rejected before dereference.
    let null = take(unsafe { luna_engine_execute(std::ptr::null(), 1) });
    assert_eq!(null["code"], "INVALID_JSON");
    // SAFETY: the byte-limit check rejects this size before reading the pointer.
    let large = take(unsafe {
        luna_engine_execute(std::ptr::null(), contract::MAX_INPUT_BYTES as usize + 1)
    });
    assert_eq!(large["code"], "INPUT_TOO_LARGE");
    let bytes = b"{\"private\":\"sample@example.test\"}";
    // SAFETY: the slice is alive and readable until return.
    let malformed = take(unsafe { luna_engine_execute(bytes.as_ptr(), bytes.len()) });
    assert_eq!(malformed["code"], "MALFORMED_ENVELOPE");
    assert!(!malformed.to_string().contains("sample"));
    assert!(!luna_engine_release_buffer(u64::MAX));
}
#[test]
fn c_transport_roundtrips_snapshots_and_refuses_to_bypass_calculation_admission() {
    assert_eq!(bind("ffi-owner-a", 1)["state"], "OWNER_BOUND");
    let sources: Vec<_> = ALL_SOURCE_KINDS
        .iter()
        .map(|kind| json!({"kind":kind,"source":{"state":"NOT_REQUESTED"}}))
        .collect();
    let mut snapshot = json!({"identity":{"ownerScope":"ffi-owner-a","ownerEpoch":1,"snapshotId":"ffi-snapshot-a","snapshotRevision":1,"inputDigest":"a".repeat(64),"catalogDigest":"b".repeat(64)},"referenceDate":"2026-11-12","sources":sources,"catalogs":{"current":{"selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"tariff":{"state":"NOT_REQUESTED"},"legal":{"state":"NOT_REQUESTED"},"holiday":{"state":"NOT_REQUESTED"}},"history":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}});
    let bytes = serde_json::to_vec(&snapshot).unwrap();
    // SAFETY: the input vector is alive and readable until return.
    let digests = take(unsafe { luna_engine_snapshot_digests(bytes.as_ptr(), bytes.len()) });
    assert_eq!(digests["ok"], true);
    snapshot["identity"]["inputDigest"] = digests["digests"]["inputDigest"].clone();
    snapshot["identity"]["catalogDigest"] = digests["digests"]["catalogDigest"].clone();
    let registration = json!({"kind":"REGISTER_SNAPSHOT","snapshot":snapshot});
    assert_eq!(execute(registration.clone())["state"], "REGISTERED");
    let result = execute(
        json!({"kind":"CALCULATE","request":{"guard":{"snapshot":snapshot["identity"],"requestId":"ffi-request-a","requestRevision":0},"periods":[{"kind":"YEAR","year":2026}],"sections":{"time":false,"gross":true,"net":false,"checks":false},"perspective":"EARNED","priority":"INTERACTIVE"}}),
    );
    assert_eq!(result["ok"], false);
    assert_eq!(result["code"], "QUEUED_CALCULATION_REQUIRED");
    let fence = serde_json::to_vec(
        &json!({"ownerScope":"ffi-owner-a","ownerEpoch":1,"snapshotRevision":2}),
    )
    .unwrap();
    // SAFETY: the metadata vector is readable until the synchronous call returns.
    let fenced = take(unsafe { luna_engine_advance_revision(fence.as_ptr(), fence.len()) });
    assert_eq!(fenced["state"], "REVISION_FENCED");
    assert_eq!(fenced["changed"], true);
    assert_eq!(execute(registration.clone())["code"], "STALE_SNAPSHOT");
    assert_eq!(bind("ffi-owner-b", 2)["state"], "OWNER_BOUND");
    assert_eq!(execute(registration)["code"], "OWNER_MISMATCH");
    assert_eq!(take(luna_engine_reset())["state"], "RESET");
    assert_eq!(take(luna_engine_collect_retired())["ok"], true);
}
