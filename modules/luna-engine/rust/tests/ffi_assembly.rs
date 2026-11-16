#[path = "support/snapshot.rs"]
mod snapshot;
use luna_engine::{
    contract, ffi,
    wasm_transport::{engine_invoke, engine_invoke_calendar_ranks, engine_invoke_source},
};
use serde_json::{Value, json};

fn take(buffer: ffi::EngineBuffer) -> Value {
    assert!(!buffer.bytes.is_null());
    assert!(buffer.length <= 4 * 1024 * 1024);
    // SAFETY: matching Rust C operations returned this live descriptor.
    let bytes = unsafe { std::slice::from_raw_parts(buffer.bytes, buffer.length) }.to_vec();
    if buffer.handle != 0 {
        assert!(ffi::luna_engine_release_buffer(buffer.handle));
        assert!(!ffi::luna_engine_release_buffer(buffer.handle));
    }
    serde_json::from_slice(&bytes).unwrap()
}
fn call(operation: &str, value: Value) -> Value {
    serde_json::from_str(&engine_invoke(
        operation,
        &serde_json::to_string(&value).unwrap(),
    ))
    .unwrap()
}
fn begin(raw: &Value) -> Value {
    let i = &raw["identity"];
    json!({"ownerScope":i["ownerScope"],"ownerEpoch":i["ownerEpoch"],"snapshotId":i["snapshotId"],"snapshotRevision":i["snapshotRevision"],"referenceDate":raw["referenceDate"],"selectedPackageIds":raw["catalogs"]["current"]["selectedPackageIds"],"completeness":raw["completeness"]})
}
#[test]
fn actual_c_and_shared_wasm_routes_assemble_register_abort_and_fence_without_echo() {
    assert_eq!(
        call(
            "bindOwner",
            json!({"ownerScope":"ffi-assembly","ownerEpoch":1})
        )["ok"],
        true
    );
    let mut raw = snapshot::raw_snapshot(1, "ffi-assembly", 1);
    raw["sources"][0]["source"] = json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":{"text":"ä猫🦀","zero":0,"empty":[],"nullable":null}}}});
    snapshot::seal(&mut raw);
    let first = call("snapshotBegin", begin(&raw));
    assert_eq!(first["state"], "BUILDING");
    let id = first["builderId"].as_u64().unwrap();
    let mut group = raw["sources"][0].clone();
    let data = group["source"]["payload"]["data"]
        .as_object_mut()
        .unwrap()
        .remove("value")
        .unwrap();
    let header =
        serde_json::to_string(&json!({"builderId":id,"target":"SOURCE","group":group})).unwrap();
    let original = serde_json::to_string(&data).unwrap();
    // SAFETY: borrowed byte strings remain valid for this synchronous call.
    let added = take(unsafe {
        ffi::luna_engine_snapshot_source(
            header.as_ptr(),
            header.len(),
            original.as_ptr(),
            original.len(),
        )
    });
    assert_eq!(added["state"], "SOURCE_ADDED");
    let registered = call("snapshotSeal", json!({"builderId":id}));
    assert_eq!(registered["state"], "REGISTERED");
    assert_eq!(registered["identity"], raw["identity"]);
    assert_eq!(
        call("snapshotAbort", json!({"builderId":id}))["aborted"],
        false
    );
    // Equal-fence newer Begin cancels the older ID even before any source parse.
    let old = call("snapshotBegin", begin(&raw))["builderId"].clone();
    let new = call("snapshotBegin", begin(&raw))["builderId"].clone();
    assert_ne!(old, new);
    assert_eq!(call("snapshotSeal", json!({"builderId":old}))["ok"], false);
    let catalog = json!({"builderId":new,"target":"CATALOG","group":{"kind":"TARIFF","source":{"state":"NOT_REQUESTED"}}});
    let added: Value =
        serde_json::from_str(&engine_invoke_source(&catalog.to_string(), "")).unwrap();
    assert_eq!(added["ok"], true);
    assert_eq!(
        call("snapshotAbort", json!({"builderId":new}))["aborted"],
        true
    );
    assert_eq!(call("snapshotSeal", json!({"builderId":new}))["ok"], false);
    let stale = call("snapshotBegin", begin(&raw))["builderId"].clone();
    assert_eq!(
        call(
            "bindOwner",
            json!({"ownerScope":"ffi-assembly","ownerEpoch":1})
        )["ok"],
        true
    );
    assert_eq!(
        call("snapshotSeal", json!({"builderId":stale}))["ok"],
        false
    );
    for command in [
        json!({"builderId":0}),
        json!({"builderId":contract::MAX_SAFE_REVISION+1}),
        json!({"builderId":1,"ready":true}),
    ] {
        let response = call("snapshotAbort", command);
        assert_eq!(response["ok"], false);
    }
    let private: Value = serde_json::from_str(&engine_invoke_source(
        "{\"private\":\"person@example.com\"}",
        "private-source",
    ))
    .unwrap();
    assert_eq!(private["ok"], false);
    assert!(!private.to_string().contains("private"));
    assert!(!private.to_string().contains("person@"));
    // SAFETY: over-limit lengths and null ranges are rejected before reading.
    for response in unsafe {
        [
            ffi::luna_engine_snapshot_begin(std::ptr::null(), 1),
            ffi::luna_engine_snapshot_begin(b"x".as_ptr(), 128 * 1024 + 1),
            ffi::luna_engine_snapshot_seal(b"x".as_ptr(), 1025),
            ffi::luna_engine_snapshot_abort(b"x".as_ptr(), 1025),
            ffi::luna_engine_snapshot_source(
                b"x".as_ptr(),
                1,
                b"x".as_ptr(),
                contract::MAX_INPUT_BYTES as usize + 1,
            ),
        ]
    } {
        assert_eq!(take(response)["ok"], false);
    }
    assert_eq!(
        serde_json::from_str::<Value>(&engine_invoke("collectRetired", "")).unwrap()["ok"],
        true
    );
    let id = call("snapshotBegin", begin(&raw))["builderId"].clone();
    let added:Value=serde_json::from_str(&engine_invoke_source(&json!({"builderId":id,"target":"SOURCE","group":{"kind":"CALENDAR_ENTRIES","source":{"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE"}}}}}).to_string(),r#"{"shiftRows":[],"appointmentRows":[],"templateRows":[],"platformCollationRanks":{}}"#)).unwrap();
    assert_eq!(added["ok"], true);
    let page = call(
        "snapshotCalendarCandidates",
        json!({"builderId":id,"after":null,"limit":1024}),
    );
    assert_eq!(page["page"]["total"], 64);
    let ranks = page["page"]["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .map(|text| (text.as_str().unwrap().to_owned(), json!(0)))
        .collect::<serde_json::Map<_, _>>();
    let reply: Value = serde_json::from_str(&engine_invoke_calendar_ranks(
        &json!({"builderId":id}).to_string(),
        &serde_json::to_string(&ranks).unwrap(),
    ))
    .unwrap();
    assert_eq!(reply["state"], "CALENDAR_RANKS_BOUND");
    assert_eq!(
        call("snapshotSeal", json!({"builderId":id}))["state"],
        "REGISTERED"
    );
    for malformed in [
        json!({"builderId":id,"limit":1}),
        json!({"builderId":id,"after":null,"limit":1,"ready":true}),
    ] {
        assert_eq!(call("snapshotCalendarCandidates", malformed)["ok"], false);
    }
    // SAFETY: these byte lengths are rejected before dereferencing the range.
    assert_eq!(
        take(unsafe { ffi::luna_engine_snapshot_calendar_candidates(b"x".as_ptr(), 1025) })["ok"],
        false
    );
    assert_eq!(
        take(unsafe {
            ffi::luna_engine_snapshot_calendar_ranks(b"x".as_ptr(), 1025, b"x".as_ptr(), 1)
        })["ok"],
        false
    );
}
