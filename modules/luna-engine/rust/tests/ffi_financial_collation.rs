#[path = "support/snapshot.rs"]
mod snapshot;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{contract, ffi::*, wasm_transport};
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn take(buffer: EngineBuffer) -> Value {
    // SAFETY: copy the live library-owned range before exactly one release.
    let value =
        serde_json::from_slice(unsafe { std::slice::from_raw_parts(buffer.bytes, buffer.length) })
            .unwrap();
    if buffer.handle != 0 {
        assert!(luna_engine_release_buffer(buffer.handle));
        assert!(!luna_engine_release_buffer(buffer.handle));
    }
    value
}
fn command(f: unsafe extern "C" fn(*const u8, usize) -> EngineBuffer, value: Value) -> Value {
    let bytes = serde_json::to_vec(&value).unwrap();
    // SAFETY: the input remains readable through this synchronous operation.
    take(unsafe { f(bytes.as_ptr(), bytes.len()) })
}
fn register(failed: bool, revision: u32) -> Value {
    let fixture = value_pool::decode(include_str!(
        "../../reference/financial-candidates-golden.json"
    ));
    let case = &fixture["cases"][0];
    let mut raw = snapshot::raw_snapshot(u64::from(revision), "ffi-financial", 1);
    let source = raw["sources"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|s| s["kind"] == "CALENDAR_ENTRIES")
        .unwrap();
    source["source"] = if failed {
        json!({"state":"FAILED","code":"READ_FAILED"})
    } else {
        json!({"state":"READY","revision":revision,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":{"shiftRows":case["input"]["shiftRows"],"appointmentRows":case["input"]["appointmentRows"],"platformCollationRanks":case["platformCollationRanks"]}}}})
    };
    snapshot::seal(&mut raw);
    let identity = raw["identity"].clone();
    let result = command(
        luna_engine_execute,
        json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"REGISTER_SNAPSHOT","snapshot":raw}}),
    );
    assert_eq!(result["state"], "REGISTERED");
    identity
}
fn prepare(identity: &Value, id: &str, month: &str) -> Value {
    command(
        luna_engine_financial_collation_prepare,
        json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"ffi-financial","ownerEpoch":1,"requestId":id,"draftRevision":1,"snapshot":identity},"intent":{"month":month,"perspective":"EARNED","filter":null,"includeSpecialDutyPay":false},"localeKey":"test-locale"}),
    )
}
#[test]
fn c_wasm_financial_resources_keep_native_proof_and_bounded_original_rank_strand() {
    // SAFETY: oversized lengths are rejected before dereferencing null.
    for (f, limit) in [
        (
            luna_engine_financial_collation_prepare
                as unsafe extern "C" fn(*const u8, usize) -> EngineBuffer,
            8192,
        ),
        (luna_engine_financial_collation_candidates, 1024),
        (luna_engine_financial_collation_abort, 1024),
    ] {
        assert_eq!(
            take(unsafe { f(std::ptr::null(), limit + 1) })["code"],
            "INPUT_TOO_LARGE"
        );
    }
    assert_eq!(
        take(unsafe {
            luna_engine_financial_collation_finalize(
                std::ptr::null(),
                0,
                std::ptr::null(),
                33_554_433,
            )
        })["code"],
        "INPUT_TOO_LARGE"
    );
    command(
        luna_engine_bind_owner,
        json!({"ownerScope":"ffi-financial","ownerEpoch":1}),
    );
    let identity = register(false, 1);
    let first = prepare(&identity, "july", "2026-07");
    assert_eq!(first["state"], "FINANCIAL_COLLATION_PREPARED");
    assert_eq!(first["cachedVerifiedRanks"], false);
    let mut ranks = BTreeMap::new();
    let mut after = Value::Null;
    loop {
        let value: Value = serde_json::from_str(&wasm_transport::engine_invoke("financialCollationCandidates",&json!({"draftId":first["draftId"],"candidateDigest":first["candidateDigest"],"after":after,"limit":7}).to_string())).unwrap();
        assert_eq!(value["state"], "FINANCIAL_COLLATION_CANDIDATES");
        for text in value["page"]["candidates"].as_array().unwrap() {
            let next = ranks.len();
            assert!(
                ranks
                    .insert(text.as_str().unwrap().to_owned(), next)
                    .is_none()
            );
        }
        after = value["page"]["nextAfter"].clone();
        if after.is_null() {
            break;
        }
    }
    assert_eq!(ranks.len(), first["total"].as_u64().unwrap() as usize);
    let header=json!({"draftId":first["draftId"],"candidateDigest":first["candidateDigest"],"reuseCached":false}).to_string();
    let raw = format!(" \n{}\t", serde_json::to_string(&ranks).unwrap());
    let done: Value = serde_json::from_str(
        &wasm_transport::engine_invoke_financial_collation_finalize(&header, &raw),
    )
    .unwrap();
    assert_eq!(done["state"], "FINANCIAL_COLLATION_READY");
    assert_eq!(done["scope"], first["scope"]);
    assert!(done["token"].as_u64().is_some());
    assert!(done.get("ranks").is_none());
    let request = json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"CALCULATE","request":{"guard":{"snapshot":identity,"requestId":"detail-output","requestRevision":1},"periods":[{"kind":"MONTH","month":"2026-07"}],"sections":{"time":false,"gross":false,"net":false,"checks":false},"perspective":"EARNED","priority":"INTERACTIVE","financialDetails":{"filter":null,"includeSpecialDutyPay":false,"collation":{"token":done["token"],"digest":done["digest"],"localeKey":"test-locale"}}}}});
    let bytes = serde_json::to_vec(&request).unwrap();
    // SAFETY: the request bytes remain live through both tiny admissions.
    assert_eq!(
        take(unsafe { luna_engine_admit(bytes.as_ptr(), bytes.len(), 1) })["ok"],
        false
    );
    assert_eq!(
        take(unsafe { luna_engine_admit(bytes.as_ptr(), bytes.len(), 0) })["state"],
        "QUEUED"
    );
    let calculated = take(luna_engine_run_next(0));
    assert_eq!(calculated["state"], "COMPLETED");
    assert!(
        calculated["result"]["reports"][0]["sections"]
            .get("financialDetails")
            .is_some()
    );
    assert!(
        calculated["result"]["request"]["financialDetails"]
            .get("collation")
            .is_none()
    );
    let next = prepare(&identity, "august", "2026-08");
    assert_eq!(next["cachedVerifiedRanks"], true);
    let cached:Value=serde_json::from_str(&wasm_transport::engine_invoke_financial_collation_finalize(&json!({"draftId":next["draftId"],"candidateDigest":next["candidateDigest"],"reuseCached":true}).to_string(),"")).unwrap();
    assert_eq!(cached["state"], "FINANCIAL_COLLATION_READY");
    let abandoned = prepare(&identity, "abort", "2026-09");
    let abort = command(
        luna_engine_financial_collation_abort,
        json!({"draftId":abandoned["draftId"]}),
    );
    assert_eq!(abort["state"], "FINANCIAL_COLLATION_ABORTED");
    assert_eq!(abort["aborted"], true);
    assert_eq!(
        command(
            luna_engine_financial_collation_candidates,
            json!({"draftId":abandoned["draftId"],"candidateDigest":abandoned["candidateDigest"],"after":null,"limit":7})
        )["ok"],
        false
    );
    take(luna_engine_collect_retired());
    let pending = prepare(&identity, "reset", "2026-10");
    take(luna_engine_reset());
    assert_eq!(
        command(
            luna_engine_financial_collation_candidates,
            json!({"draftId":pending["draftId"],"candidateDigest":pending["candidateDigest"],"after":null,"limit":7})
        )["ok"],
        false
    );
    command(
        luna_engine_bind_owner,
        json!({"ownerScope":"ffi-financial","ownerEpoch":1}),
    );
    let unavailable = prepare(&register(true, 2), "missing", "2026-07");
    assert_eq!(unavailable["state"], "FINANCIAL_COLLATION_UNAVAILABLE");
    assert_eq!(unavailable["reason"]["code"], "SOURCE_READ_FAILED");
    assert!(unavailable.get("draftId").is_none());
    take(luna_engine_reset());
    take(luna_engine_collect_retired());
}
