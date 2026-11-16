//! Real C admission/Finance worker/owned-buffer proof for explicit payroll views.
mod common;
#[path = "support/salary_snapshot.rs"]
mod salary_snapshot;
use salary_snapshot::snapshot;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{contract, ffi::*};
use serde_json::{Value, json};
fn take(buffer: EngineBuffer) -> Value {
    assert!(!buffer.bytes.is_null());
    // SAFETY: C owns the live immutable descriptor until release below.
    let v =
        serde_json::from_slice(unsafe { std::slice::from_raw_parts(buffer.bytes, buffer.length) })
            .unwrap();
    if buffer.handle != 0 {
        assert!(luna_engine_release_buffer(buffer.handle));
    }
    v
}
fn envelope(command: Value) -> Vec<u8> {
    serde_json::to_vec(&json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":command})).unwrap()
}
fn payroll_utility(identity: &Value, month: &Value) -> Vec<u8> {
    serde_json::to_vec(&json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":identity["ownerScope"],"ownerEpoch":identity["ownerEpoch"],"requestId":"payroll-seed-c","draftRevision":1,"snapshot":identity},"operation":{"kind":"PAYROLL_FORM","command":{"kind":"ANNUAL_BOOTSTRAP","month":month}}})).unwrap()
}
#[test]
fn source_positive_payroll_pages_cross_the_real_c_queue_without_a_utility_bypass() {
    let reference = value_pool::decode(include_str!("../../reference/payroll-page-golden.json"));
    let forms = value_pool::decode(include_str!("../../reference/payroll-form-golden.json"));
    let ui: Value =
        serde_json::from_str(include_str!("../../reference/payroll-page-ui-golden.json")).unwrap();
    let cases = reference["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| {
            c["id"].as_str().unwrap().starts_with("services-ready-")
                && !c["id"].as_str().unwrap().contains("-pension-")
                && c["settingsState"].is_null()
                && c["testMonth"] != true
        })
        .collect::<Vec<_>>();
    assert_eq!(cases.len(), 4);
    for (index, c) in cases.iter().enumerate() {
        let epoch = u64::try_from(index + 1).unwrap();
        let owner = json!({"ownerScope":"ffi-payroll-page","ownerEpoch":epoch});
        let binding = serde_json::to_vec(&owner).unwrap();
        // SAFETY: vectors remain readable for each synchronous C entrypoint.
        assert_eq!(
            take(unsafe { luna_engine_bind_owner(binding.as_ptr(), binding.len()) })["ok"],
            true
        );
        let mut raw = salary_snapshot::raw(c);
        raw["identity"] = snapshot::raw_snapshot(1, "ffi-payroll-page", epoch)["identity"].clone();
        snapshot::seal(&mut raw);
        let checked = salary_snapshot::facts(raw.clone());
        assert_eq!(
            checked.snapshot().identity().owner_scope(),
            "ffi-payroll-page"
        );
        let body = envelope(json!({"kind":"REGISTER_SNAPSHOT","snapshot":raw}));
        // SAFETY: body remains readable throughout registration.
        assert_eq!(
            take(unsafe { luna_engine_execute(body.as_ptr(), body.len()) })["state"],
            "REGISTERED"
        );
        let seed_request = payroll_utility(&raw["identity"], &c["input"]["month"]);
        // SAFETY: the request buffer remains readable until the synchronous call ends.
        let cold = take(unsafe { luna_engine_utility(seed_request.as_ptr(), seed_request.len()) });
        assert_eq!(
            cold["result"],
            json!({"state":"VALUE","value":{"state":"NEEDS_FINANCE"}})
        );
        let request = json!({"guard":{"snapshot":raw["identity"],"requestId":format!("payroll-c-{index}"),"requestRevision":1},"periods":[{"kind":"MONTH","month":c["input"]["month"]}],"sections":{"time":false,"gross":false,"net":false,"checks":false},"perspective":"PAYOUT","priority":"INTERACTIVE","payrollPage":true});
        let bytes = envelope(json!({"kind":"CALCULATE","request":request}));
        // SAFETY: the same immutable request bytes live through each admission call.
        assert_eq!(
            take(unsafe { luna_engine_execute(bytes.as_ptr(), bytes.len()) })["code"],
            "QUEUED_CALCULATION_REQUIRED"
        );
        // SAFETY: request remains readable; Checks must reject this Finance-only view.
        assert_eq!(
            take(unsafe { luna_engine_admit(bytes.as_ptr(), bytes.len(), 1) })["ok"],
            false
        );
        // SAFETY: request remains readable during Finance admission.
        let admitted = take(unsafe { luna_engine_admit(bytes.as_ptr(), bytes.len(), 0) });
        assert_eq!(admitted["state"], "QUEUED");
        let completed = take(luna_engine_run_next(0));
        assert_eq!(completed["state"], "COMPLETED", "{completed}");
        assert_eq!(completed["jobId"], admitted["jobId"]);
        assert_eq!(completed["result"]["request"], request);
        let report = &completed["result"]["reports"][0];
        common::assert_json_eq(
            &report["views"]["payrollPage"]["value"],
            &c["expected"],
            c["id"].as_str().unwrap(),
        );
        let expected_ui = &ui["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["id"] == c["id"])
            .unwrap()["expected"];
        common::assert_json_eq(
            &report["views"]["payrollPageUi"],
            &json!({"state":"READY","value":expected_ui}),
            "independent UI facts cross the same Finance publication",
        );
        // SAFETY: the same immutable source-bound request is still live after Finance.
        let warm = take(unsafe { luna_engine_utility(seed_request.as_ptr(), seed_request.len()) });
        let original = forms["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|form| form["id"] == format!("original-{}", c["id"].as_str().unwrap()))
            .unwrap();
        common::assert_json_eq(
            &warm["result"],
            &json!({"state":"VALUE","value":{"state":"READY","seed":original["expected"]["seed"]}}),
            "the real C utility only consumes a Finance-produced seed",
        );
        for k in ["time", "gross", "net", "checks"] {
            assert_eq!(report["sections"][k]["state"], "NOT_REQUESTED");
        }
        assert_eq!(take(luna_engine_run_next(0))["state"], "IDLE");
    }
    assert_eq!(take(luna_engine_reset())["ok"], true);
    assert_eq!(take(luna_engine_collect_retired())["ok"], true);
}
