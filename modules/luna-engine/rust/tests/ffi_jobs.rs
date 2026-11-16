use luna_engine::{contract, ffi::*};
use serde_json::{Value, json};
#[path = "support/snapshot.rs"]
mod snapshot_fixture;
fn take(buffer: EngineBuffer) -> Value {
    // SAFETY: the descriptor originates from the matching live C library and
    // its bytes are copied before releasing its owned handle.
    let value =
        serde_json::from_slice(unsafe { std::slice::from_raw_parts(buffer.bytes, buffer.length) })
            .unwrap();
    if buffer.handle != 0 {
        assert!(luna_engine_release_buffer(buffer.handle));
    }
    value
}
fn envelope(command: Value) -> Vec<u8> {
    serde_json::to_vec(&json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":command})).unwrap()
}
fn request(
    snapshot: &Value,
    revision: u64,
    month: &str,
    checks: bool,
    background: bool,
) -> Vec<u8> {
    envelope(
        json!({"kind":"CALCULATE","request":{"guard":{"snapshot":snapshot["identity"],"requestId":format!("ffi-job-{revision}"),"requestRevision":revision},"periods":[{"kind":"MONTH","month":month}],"sections":{"time":!checks,"gross":false,"net":false,"checks":checks},"perspective":"EARNED","priority":if background{"BACKGROUND"}else{"INTERACTIVE"}}}),
    )
}
fn bind(owner: &str, epoch: u64) {
    let bytes = serde_json::to_vec(&json!({"ownerScope":owner,"ownerEpoch":epoch})).unwrap();
    // SAFETY: bytes are readable until this synchronous call returns.
    assert_eq!(
        take(unsafe { luna_engine_bind_owner(bytes.as_ptr(), bytes.len()) })["ok"],
        true
    );
}
fn admit(bytes: &[u8], lane: u8) -> Value {
    // SAFETY: the borrowed slice is readable for the synchronous admission.
    take(unsafe { luna_engine_admit(bytes.as_ptr(), bytes.len(), lane) })
}
#[test]
fn ordinary_admission_budget_precedes_invalid_json_and_envelope_errors() {
    for lane in [0, 1] {
        for (head, code) in [("x", "INVALID_JSON"), ("{}", "MALFORMED_ENVELOPE")] {
            let mut bytes = head.as_bytes().to_vec();
            bytes.resize(8192, b' ');
            assert_eq!(admit(&bytes, lane)["code"], code);
            bytes.push(b' ');
            assert_eq!(admit(&bytes, lane)["code"], "INPUT_TOO_LARGE");
        }
        // SAFETY: the size guard must reject before reading the null pointer.
        assert_eq!(
            take(unsafe { luna_engine_admit(std::ptr::null(), 8193, lane) })["code"],
            "INPUT_TOO_LARGE"
        );
        let snapshot = snapshot_fixture::raw_snapshot(1, "ffi-ordinary-budget", 1);
        let mut bytes = request(&snapshot, 1, "2026-01", lane == 1, false);
        bytes.resize(8193, b' ');
        assert_eq!(admit(&bytes, lane)["code"], "INPUT_TOO_LARGE");
    }
}
#[test]
fn c_admission_worker_pulls_cancellation_and_owner_fences_settle_opaque_jobs() {
    let info = take(luna_engine_info());
    assert_eq!(info["capabilities"]["jobScheduling"], true);
    assert_eq!(info["capabilities"]["fullCalculation"], false);
    // SAFETY: oversized inputs must be rejected before reading any pointer.
    assert_eq!(
        take(unsafe { luna_engine_admit(std::ptr::null(), 8193, 0) })["code"],
        "INPUT_TOO_LARGE"
    );
    bind("ffi-jobs", 1);
    let snapshot = snapshot_fixture::raw_snapshot(1, "ffi-jobs", 1);
    let bytes = envelope(json!({"kind":"REGISTER_SNAPSHOT","snapshot":snapshot}));
    // SAFETY: the registration vector remains readable until return.
    assert_eq!(
        take(unsafe { luna_engine_execute(bytes.as_ptr(), bytes.len()) })["state"],
        "REGISTERED"
    );
    let bg = admit(&request(&snapshot, 1, "2026-01", false, true), 0);
    let foreground = admit(&request(&snapshot, 2, "2026-02", false, false), 0);
    assert_eq!(bg["state"], "QUEUED");
    let result = take(luna_engine_run_next(0));
    assert_eq!(result["jobId"], foreground["jobId"]);
    assert_eq!(result["state"], "COMPLETED");
    assert_eq!(
        result["result"]["reports"][0]["sections"]["time"]["state"],
        "UNAVAILABLE"
    );
    let cancel = serde_json::to_vec(&json!({"jobId":bg["jobId"]})).unwrap();
    // SAFETY: the small cancellation vector remains readable until return.
    assert_eq!(
        take(unsafe { luna_engine_cancel_job(cancel.as_ptr(), cancel.len()) })["canceled"],
        true
    );
    let result = take(luna_engine_run_next(0));
    assert_eq!(result["state"], "IDLE");
    assert_eq!(result["skippedJobs"], json!([bg["jobId"]]));
    let old = admit(&request(&snapshot, 3, "2026-03", false, false), 0);
    let new = admit(&request(&snapshot, 4, "2026-03", false, false), 0);
    let result = take(luna_engine_run_next(0));
    assert_eq!(result["jobId"], new["jobId"]);
    assert_eq!(result["skippedJobs"], json!([old["jobId"]]));
    let checks = admit(&request(&snapshot, 5, "2026-03", true, false), 1);
    let result = take(luna_engine_run_next(1));
    assert_eq!(result["jobId"], checks["jobId"]);
    assert_eq!(result["state"], "COMPLETED");
    let retired = admit(&request(&snapshot, 6, "2026-04", false, false), 0);
    bind("other-owner", 2);
    let result = take(luna_engine_run_next(0));
    assert_eq!(result["state"], "IDLE");
    assert_eq!(result["skippedJobs"], json!([retired["jobId"]]));
    assert_eq!(
        admit(&request(&snapshot, 7, "2026-05", false, false), 0)["code"],
        "MISSING_SNAPSHOT"
    );
    assert_eq!(take(luna_engine_collect_retired())["ok"], true);
    for bad in [
        json!({"jobId":0}),
        json!({"jobId":"private"}),
        json!({"jobId":1,"extra":true}),
    ] {
        let bytes = serde_json::to_vec(&bad).unwrap();
        // SAFETY: each malformed command still uses a readable vector.
        let result = take(unsafe { luna_engine_cancel_job(bytes.as_ptr(), bytes.len()) });
        assert_eq!(result["ok"], false);
        assert!(!result.to_string().contains("private"));
    }
    assert_eq!(take(luna_engine_run_next(2))["code"], "INVALID_LANE");
    assert_eq!(take(luna_engine_reset())["ok"], true);
}
