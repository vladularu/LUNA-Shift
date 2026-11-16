use luna_engine::{
    contract::{self, utility::MAX_UTILITY_INPUT_BYTES},
    ffi::*,
};
use serde_json::{Value, json};
fn take(buffer: EngineBuffer) -> Value {
    // SAFETY: matching library descriptor, copied before exactly one free.
    let value =
        serde_json::from_slice(unsafe { std::slice::from_raw_parts(buffer.bytes, buffer.length) })
            .unwrap();
    if buffer.handle != 0 {
        assert!(luna_engine_release_buffer(buffer.handle));
        assert!(!luna_engine_release_buffer(buffer.handle));
    }
    value
}
fn envelope(operation: Value) -> Value {
    json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"ffi-utility","ownerEpoch":1,"requestId":"clock","draftRevision":0},"operation":operation})
}
fn invoke(value: &Value) -> Value {
    let bytes = serde_json::to_vec(value).unwrap();
    // SAFETY: bytes live through the synchronous C call.
    take(unsafe { luna_engine_utility(bytes.as_ptr(), bytes.len()) })
}
#[test]
fn c_and_wasm_utility_use_strict_owner_guarded_contract_and_matching_buffer_ownership() {
    let info = take(luna_engine_info());
    assert_eq!(info["capabilities"]["utilities"], true);
    assert_eq!(info["capabilities"]["viewOverlays"], true);
    assert_eq!(info["viewSchemaVersion"], 1);
    assert_eq!(info["capabilities"]["fullCalculation"], false);
    // SAFETY: oversized null is rejected before reading its pointer.
    assert_eq!(
        take(unsafe { luna_engine_utility(std::ptr::null(), MAX_UTILITY_INPUT_BYTES + 1) })["code"],
        "INPUT_TOO_LARGE"
    );
    let request =
        envelope(json!({"kind":"CIVIL_CLOCK","epochMilliseconds":0,"timeZone":"Europe/Berlin"}));
    assert_eq!(invoke(&request)["code"], "OWNER_MISMATCH");
    let owner = serde_json::to_vec(&json!({"ownerScope":"ffi-utility","ownerEpoch":1})).unwrap();
    // SAFETY: owner is a live bounded byte slice.
    assert_eq!(
        take(unsafe { luna_engine_bind_owner(owner.as_ptr(), owner.len()) })["ok"],
        true
    );
    let result = invoke(&request);
    assert_eq!(result["state"], "COMPLETED");
    assert_eq!(result["operation"], "CIVIL_CLOCK");
    assert_eq!(result["guard"], request["guard"]);
    assert_eq!(result["engineVersion"], luna_engine::ENGINE_VERSION);
    assert_eq!(result["result"]["value"]["date"], "1970-01-01");
    let wasm: Value = serde_json::from_str(&luna_engine::wasm_transport::engine_invoke(
        "utility",
        &request.to_string(),
    ))
    .unwrap();
    assert_eq!(wasm, result);
    let mut malformed = request.clone();
    malformed["guard"]["snapshot"] = Value::Null;
    assert_eq!(invoke(&malformed)["code"], "MALFORMED_ENVELOPE");
    let mut missing = request.clone();
    missing["expectedEngineVersion"] = json!("stale");
    assert_eq!(invoke(&missing)["code"], "UNSUPPORTED_ENGINE");
    assert_eq!(
        invoke(&envelope(
            json!({"kind":"CALCULATE","sections":{"gross":true}})
        ))["code"],
        "MALFORMED_ENVELOPE"
    );
    let result = invoke(&envelope(
        json!({"kind":"VALIDATE_INPUT","validator":"USER_PROFILE","input":{"name":"secret@example.com"}}),
    ));
    assert_eq!(result["result"]["state"], "INPUT_ERROR");
    assert!(!result.to_string().contains("secret"));
    let mut other = request.clone();
    other["guard"]["ownerScope"] = json!("another-owner");
    assert_eq!(invoke(&other)["code"], "OWNER_MISMATCH");
    take(luna_engine_reset());
    assert_eq!(invoke(&request)["code"], "OWNER_MISMATCH");
}
