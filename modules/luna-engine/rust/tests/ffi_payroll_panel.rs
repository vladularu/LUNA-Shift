//! Real public C queue transport, not a direct presenter shortcut.
mod common;
#[path = "support/salary_snapshot.rs"]
mod salary_snapshot;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{contract, ffi::*};
use serde_json::{Value, json};
fn take(buffer: EngineBuffer) -> Value {
    assert!(!buffer.bytes.is_null());
    // SAFETY: the engine owns this live immutable descriptor until release.
    let result =
        serde_json::from_slice(unsafe { std::slice::from_raw_parts(buffer.bytes, buffer.length) })
            .unwrap();
    if buffer.handle != 0 {
        assert!(luna_engine_release_buffer(buffer.handle));
    }
    result
}
fn envelope(command: Value) -> Vec<u8> {
    serde_json::to_vec(&json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":command})).unwrap()
}
#[test]
fn original_panels_cross_c_finance_queue_without_other_sections_or_utility_math() {
    let reference = value_pool::decode(include_str!("../../reference/payroll-page-golden.json"));
    let panels = value_pool::decode(include_str!("../../reference/payroll-panel-golden.json"));
    let tariff = value_pool::decode(include_str!(
        "../../reference/tariff-assessment-screen-golden.json"
    ));
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
        let epoch = (index + 1) as u64;
        let owner = json!({"ownerScope":"ffi-payroll-panel","ownerEpoch":epoch});
        let owner_bytes = serde_json::to_vec(&owner).unwrap();
        // SAFETY: byte vectors remain readable through each synchronous entrypoint.
        assert_eq!(
            take(unsafe { luna_engine_bind_owner(owner_bytes.as_ptr(), owner_bytes.len()) })["ok"],
            true
        );
        let mut raw = salary_snapshot::raw(c);
        raw["identity"] =
            salary_snapshot::snapshot::raw_snapshot(1, "ffi-payroll-panel", epoch)["identity"]
                .clone();
        salary_snapshot::snapshot::seal(&mut raw);
        let checked = salary_snapshot::facts(raw.clone());
        assert_eq!(
            checked.snapshot().identity().owner_scope(),
            "ffi-payroll-panel"
        );
        drop(checked);
        let bytes = envelope(json!({"kind":"REGISTER_SNAPSHOT","snapshot":raw}));
        // SAFETY: owned input bytes live for the complete synchronous registration.
        assert_eq!(
            take(unsafe { luna_engine_execute(bytes.as_ptr(), bytes.len()) })["state"],
            "REGISTERED"
        );
        let expected = &panels["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == c["id"])
            .unwrap()["expected"];
        for (revision, panel) in ["COMPONENTS", "BASIS", "SPECIAL_DUTIES", "TARIFF_ASSESSMENT"]
            .iter()
            .enumerate()
        {
            let request = json!({"guard":{"snapshot":raw["identity"],"requestId":format!("panel-{revision}"),"requestRevision":revision as u64+1},"periods":[{"kind":"MONTH","month":c["input"]["month"]}],"sections":{"time":false,"gross":false,"net":false,"checks":false},"perspective":"PAYOUT","priority":"INTERACTIVE","payrollPanel":panel});
            let bytes = envelope(json!({"kind":"CALCULATE","request":request}));
            // SAFETY: bytes stay live during each read-only admission call.
            assert_eq!(
                take(unsafe { luna_engine_execute(bytes.as_ptr(), bytes.len()) })["code"],
                "QUEUED_CALCULATION_REQUIRED"
            );
            // SAFETY: immutable request bytes are live; Checks must reject Finance views.
            assert_eq!(
                take(unsafe { luna_engine_admit(bytes.as_ptr(), bytes.len(), 1) })["ok"],
                false
            );
            // SAFETY: immutable request bytes stay readable throughout Finance admission.
            assert_eq!(
                take(unsafe { luna_engine_admit(bytes.as_ptr(), bytes.len(), 0) })["state"],
                "QUEUED"
            );
            let done = take(luna_engine_run_next(0));
            assert_eq!(done["state"], "COMPLETED", "{done}");
            assert_eq!(done["result"]["request"], request);
            let report = &done["result"]["reports"][0];
            for section in ["time", "gross", "net", "checks"] {
                assert_eq!(
                    report["sections"][section],
                    json!({"state":"NOT_REQUESTED"})
                );
            }
            assert!(report["views"].get("payrollPage").is_none());
            assert!(report["views"].get("financialDetails").is_none());
            let value = &report["views"]["payrollPanel"]["value"];
            assert_eq!(value["panel"], *panel);
            assert_eq!(value["month"], c["input"]["month"]);
            if *panel == "TARIFF_ASSESSMENT" {
                let id = format!("raw:{}", c["id"].as_str().unwrap());
                let expected = &tariff["cases"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|p| p["id"] == id)
                    .unwrap()["expected"];
                let mut actual = value.as_object().unwrap().clone();
                actual.remove("month");
                actual.remove("panel");
                common::assert_json_eq(&Value::Object(actual), expected, &id);
            } else {
                common::assert_json_eq(
                    &value["blocks"],
                    &expected[*panel],
                    c["id"].as_str().unwrap(),
                );
            }
        }
    }
}
