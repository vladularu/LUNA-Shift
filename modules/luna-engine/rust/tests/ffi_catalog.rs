use luna_engine::{ffi::*, wasm_transport};
use serde_json::{Value, json};
fn take(buffer: EngineBuffer) -> Value {
    // SAFETY: descriptor comes from this library; copy before exactly one free.
    let value =
        serde_json::from_slice(unsafe { std::slice::from_raw_parts(buffer.bytes, buffer.length) })
            .unwrap();
    if buffer.handle != 0 {
        assert!(luna_engine_release_buffer(buffer.handle));
        assert!(!luna_engine_release_buffer(buffer.handle));
    }
    value
}
fn command(
    function: unsafe extern "C" fn(*const u8, usize) -> EngineBuffer,
    value: Value,
) -> Value {
    let bytes = serde_json::to_vec(&value).unwrap();
    // SAFETY: the vector remains readable for this complete synchronous call.
    take(unsafe { function(bytes.as_ptr(), bytes.len()) })
}
fn begin() -> u64 {
    command(luna_engine_snapshot_begin,json!({"ownerScope":"ffi-catalog","ownerEpoch":1,"snapshotId":"catalog","snapshotRevision":1,"referenceDate":"2026-11-13","selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}}))["builderId"].as_u64().unwrap()
}
fn source(id: u64, kind: &str, failed: bool) {
    let state = if failed {
        json!({"state":"FAILED","code":"READ_FAILED"})
    } else {
        json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE"}}})
    };
    let header = serde_json::to_vec(
        &json!({"builderId":id,"target":"CATALOG","group":{"kind":kind,"source":state}}),
    )
    .unwrap();
    let data = if failed {
        b"".as_slice()
    } else {
        br#"{"mode":"COMPILED_PREVIEW"}"#.as_slice()
    };
    // SAFETY: both bounded original byte ranges live through the C operation.
    assert_eq!(
        take(unsafe {
            luna_engine_snapshot_source(header.as_ptr(), header.len(), data.as_ptr(), data.len())
        })["state"],
        "SOURCE_ADDED"
    );
}
#[test]
fn c_wasm_catalog_builder_preserves_failure_states_limits_and_original_two_string_binding() {
    // SAFETY: bounds are checked before touching an oversized null pointer.
    assert_eq!(
        take(unsafe { luna_engine_snapshot_catalog_candidates(std::ptr::null(), 1025) })["code"],
        "INPUT_TOO_LARGE"
    );
    assert_eq!(
        take(unsafe {
            luna_engine_snapshot_catalog_finalize(std::ptr::null(), 1025, std::ptr::null(), 0)
        })["code"],
        "INPUT_TOO_LARGE"
    );
    assert_eq!(
        command(
            luna_engine_bind_owner,
            json!({"ownerScope":"ffi-catalog","ownerEpoch":1})
        )["ok"],
        true
    );
    let id = begin();
    for kind in ["TARIFF", "LEGAL", "HOLIDAY"] {
        source(id, kind, false);
    }
    let page = command(
        luna_engine_snapshot_catalog_candidates,
        json!({"builderId":id,"after":null,"limit":1024}),
    );
    assert_eq!(page["state"], "CATALOG_CANDIDATES");
    assert_eq!(page["page"]["total"], 0);
    let wasm: Value = serde_json::from_str(&wasm_transport::engine_invoke(
        "snapshotCatalogCandidates",
        &json!({"builderId":id,"after":null,"limit":2}).to_string(),
    ))
    .unwrap();
    assert_eq!(wasm["defaultPackageIds"], page["defaultPackageIds"]);
    let finalized: Value = serde_json::from_str(&wasm_transport::engine_invoke_catalog_finalize(
        &json!({"builderId":id}).to_string(),
        " {} ",
    ))
    .unwrap();
    assert_eq!(finalized["state"], "CATALOG_FINALIZED");
    assert_eq!(
        command(luna_engine_snapshot_seal, json!({"builderId":id}))["state"],
        "REGISTERED"
    );
    command(
        luna_engine_bind_owner,
        json!({"ownerScope":"ffi-catalog","ownerEpoch":1}),
    );
    let id = begin();
    for kind in ["TARIFF", "LEGAL", "HOLIDAY"] {
        source(id, kind, true);
    }
    assert_eq!(
        command(
            luna_engine_snapshot_catalog_candidates,
            json!({"builderId":id,"after":null,"limit":2})
        )["state"],
        "CATALOG_UNAVAILABLE"
    );
    assert_eq!(
        command(luna_engine_snapshot_seal, json!({"builderId":id}))["state"],
        "REGISTERED"
    );
    assert_eq!(
        command(
            luna_engine_snapshot_catalog_candidates,
            json!({"builderId":id,"limit":2})
        )["code"],
        "MALFORMED_ENVELOPE"
    );
    take(luna_engine_reset());
    assert_eq!(
        command(
            luna_engine_snapshot_catalog_candidates,
            json!({"builderId":id,"after":null,"limit":2})
        )["ok"],
        false
    );
}
