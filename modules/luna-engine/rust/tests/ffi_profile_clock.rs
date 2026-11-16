use luna_engine::{ffi::*, wasm_transport};
use serde_json::{Value, json};
fn take(buffer: EngineBuffer) -> Value {
    // SAFETY: copy this live native descriptor before releasing its handle.
    let result =
        serde_json::from_slice(unsafe { std::slice::from_raw_parts(buffer.bytes, buffer.length) })
            .unwrap();
    if buffer.handle != 0 {
        assert!(luna_engine_release_buffer(buffer.handle));
        assert!(!luna_engine_release_buffer(buffer.handle));
    }
    result
}
fn call(f: unsafe extern "C" fn(*const u8, usize) -> EngineBuffer, value: Value) -> Value {
    let bytes = serde_json::to_vec(&value).unwrap();
    // SAFETY: the vector remains readable throughout the synchronous call.
    take(unsafe { f(bytes.as_ptr(), bytes.len()) })
}
fn begin() -> u64 {
    let reply = call(
        luna_engine_snapshot_begin,
        json!({"ownerScope":"ffi-clock","ownerEpoch":1,"snapshotId":"clock","snapshotRevision":1,"selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}}),
    );
    assert_eq!(reply["state"], "BUILDING");
    reply["builderId"].as_u64().unwrap()
}
fn profile(id: u64, failed: bool) {
    let source = if failed {
        json!({"state":"FAILED","code":"READ_FAILED"})
    } else {
        json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"NULL"}}})
    };
    let bytes = serde_json::to_vec(
        &json!({"builderId":id,"target":"SOURCE","group":{"kind":"WORK_PROFILE","source":source}}),
    )
    .unwrap();
    // SAFETY: the header is readable; NULL/FAILED presence has no body bytes.
    assert_eq!(
        take(unsafe {
            luna_engine_snapshot_source(bytes.as_ptr(), bytes.len(), std::ptr::null(), 0)
        })["state"],
        "SOURCE_ADDED"
    );
}
#[test]
fn c_and_wasm_route_derive_clock_from_raw_builder_sources_and_fence_reset() {
    let info = take(luna_engine_info());
    assert_eq!(info["capabilities"]["profileClock"], true);
    assert_eq!(info["profileClockSchemaVersion"], 1);
    assert_eq!(info["capabilities"]["fullCalculation"], false);
    // SAFETY: an oversized length must be rejected before dereferencing NULL.
    assert_eq!(
        take(unsafe { luna_engine_snapshot_profile_clock(std::ptr::null(), 1025) })["code"],
        "INPUT_TOO_LARGE"
    );
    call(
        luna_engine_bind_owner,
        json!({"ownerScope":"ffi-clock","ownerEpoch":1}),
    );
    let id = begin();
    let missing = call(
        luna_engine_snapshot_profile_clock,
        json!({"builderId":id,"epochMilliseconds":0}),
    );
    assert_eq!(missing["state"], "PROFILE_CLOCK_UNAVAILABLE");
    assert_eq!(missing["reason"]["source"], "WORK_PROFILE");
    assert_eq!(
        call(luna_engine_snapshot_seal, json!({"builderId":id}))["ok"],
        false
    );
    call(luna_engine_snapshot_abort, json!({"builderId":id}));
    let id = begin();
    profile(id, false);
    let frame = json!({"builderId":id,"epochMilliseconds":0});
    let ready = call(luna_engine_snapshot_profile_clock, frame.clone());
    assert_eq!(ready["state"], "PROFILE_CLOCK_READY");
    assert_eq!(ready["clock"]["referenceDate"], "1970-01-01");
    assert_eq!(ready["clock"]["onboarding"], true);
    assert_eq!(ready["sourceClockKey"].as_str().unwrap().len(), 64);
    assert_eq!(ready["profiles"]["state"], "READY");
    assert!(ready.get("builderId").is_none());
    let wasm: Value = serde_json::from_str(&wasm_transport::engine_invoke(
        "snapshotProfileClock",
        &frame.to_string(),
    ))
    .unwrap();
    assert_eq!(ready, wasm);
    assert_eq!(
        call(luna_engine_snapshot_seal, json!({"builderId":id}))["state"],
        "REGISTERED"
    );
    let id = begin();
    profile(id, true);
    let failed = call(
        luna_engine_snapshot_profile_clock,
        json!({"builderId":id,"epochMilliseconds":0}),
    );
    assert_eq!(failed["state"], "PROFILE_CLOCK_UNAVAILABLE");
    assert!(failed.get("clock").is_none());
    assert!(failed.get("sourceClockKey").is_none());
    call(luna_engine_snapshot_abort, json!({"builderId":id}));
    for raw in [
        "{}",
        "{\"builderId\":1,\"epochMilliseconds\":null}",
        "{\"builderId\":1,\"epochMilliseconds\":0.5}",
        "{\"builderId\":1,\"epochMilliseconds\":0,\"clock\":{\"ready\":true}}",
        "{\"builderId\":1,\"epochMilliseconds\":0,\"epochMilliseconds\":1}",
    ] {
        // SAFETY: every raw frame is readable for its exact UTF-8 byte length.
        let rejected = take(unsafe { luna_engine_snapshot_profile_clock(raw.as_ptr(), raw.len()) });
        assert_eq!(rejected["ok"], false);
        assert!(rejected.get("clock").is_none());
    }
    let old = begin();
    profile(old, false);
    call(
        luna_engine_bind_owner,
        json!({"ownerScope":"ffi-clock","ownerEpoch":1}),
    );
    assert_eq!(
        call(
            luna_engine_snapshot_profile_clock,
            json!({"builderId":old,"epochMilliseconds":0})
        )["ok"],
        false
    );
}
