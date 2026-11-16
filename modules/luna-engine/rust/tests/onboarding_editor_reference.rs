mod common;
use luna_engine::{
    contract::{self, utility::parse_utility_request},
    runtime::utility,
};
use serde_json::{Value, json};
fn command(case: &Value) -> Value {
    let i = &case["input"];
    match case["operation"].as_str().unwrap() {
        "OPTIONS" => {
            json!({"kind":"ONBOARDING_OPTIONS","selection":i["selection"],"federalState":i["federalState"],"instant":i["instant"]})
        }
        "SUMMARY" => {
            json!({"kind":"ONBOARDING_SUMMARY","selection":i["selection"],"gross":i["gross"]})
        }
        "ADVANCE" => json!({"kind":"ONBOARDING_ADVANCE","input":i}),
        "PREPARE" => json!({"kind":"ONBOARDING_PREPARE","input":i}),
        "PARSE_WEEKLY" => json!({"kind":"PARSE_WEEKLY","text":i["text"]}),
        "WEEKLY_ERROR" => json!({"kind":"WEEKLY_ERROR","text":i["text"]}),
        "NORMALIZE_GROSS" => json!({"kind":"NORMALIZE_GROSS","text":i["text"]}),
        _ => panic!("unknown operation"),
    }
}
fn envelope(case: &Value, revision: usize) -> Value {
    json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"onboarding-editor","ownerEpoch":1,"requestId":"form","draftRevision":revision},"operation":{"kind":"PROFILE_FORM","command":command(case)}})
}
fn corpus() -> Value {
    serde_json::from_str(include_str!(
        "../../reference/onboarding-editor-golden.json"
    ))
    .unwrap()
}
fn assert_result(result: &Value, case: &Value) {
    assert_eq!(result["state"], "VALUE");
    let frame = &result["value"];
    let actual = match frame["state"].as_str().unwrap() {
        "READY" => frame["value"].clone(),
        "FORM_ERROR" => json!({"$error":{"name":frame["name"],"message":frame["message"]}}),
        _ => panic!("{}:{frame}", case["id"]),
    };
    common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
}
#[test]
fn original_component_advance_save_and_options_cross_public_native_contract() {
    let fixture = corpus();
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 10570);
    for (index, case) in cases.iter().enumerate() {
        let bytes = serde_json::to_vec(&envelope(case, index + 1)).unwrap();
        let request =
            parse_utility_request(&bytes).unwrap_or_else(|e| panic!("{}:{e:?}", case["id"]));
        assert_result(
            &serde_json::to_value(utility::calculate(request.operation())).unwrap(),
            case,
        );
    }
}
#[test]
fn original_onboarding_component_outputs_cross_c_copy_release() {
    use luna_engine::ffi::*;
    fn take(buffer: EngineBuffer) -> Value {
        // SAFETY: the library owns this live descriptor until the matching release.
        let result = serde_json::from_slice(unsafe {
            std::slice::from_raw_parts(buffer.bytes, buffer.length)
        })
        .unwrap();
        assert!(luna_engine_release_buffer(buffer.handle));
        result
    }
    take(luna_engine_reset());
    let owner = br#"{"ownerScope":"onboarding-editor","ownerEpoch":1}"#;
    // SAFETY: immutable owner bytes remain live throughout the bounded native call.
    assert_eq!(
        take(unsafe { luna_engine_bind_owner(owner.as_ptr(), owner.len()) })["ok"],
        true
    );
    for (index, case) in corpus()["cases"].as_array().unwrap().iter().enumerate() {
        let bytes = serde_json::to_vec(&envelope(case, index + 1)).unwrap();
        // SAFETY: immutable request bytes remain live throughout the bounded native call.
        let reply = take(unsafe { luna_engine_utility(bytes.as_ptr(), bytes.len()) });
        assert_eq!(reply["state"], "COMPLETED", "{}:{reply}", case["id"]);
        assert_result(&reply["result"], case);
    }
    take(luna_engine_reset());
}

#[test]
fn original_summary_parse_and_classification_are_preserved() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../reference/onboarding-summary-golden.json"
    ))
    .unwrap();
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 90);
    for (index, case) in cases.iter().enumerate() {
        let bytes = serde_json::to_vec(&envelope(case, index + 1)).unwrap();
        let request = parse_utility_request(&bytes).unwrap();
        assert_result(
            &serde_json::to_value(utility::calculate(request.operation())).unwrap(),
            case,
        );
    }
}

#[test]
fn original_radix_unicode_and_nonfinite_number_boundaries_are_preserved() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../reference/form-number-boundaries-golden.json"
    ))
    .unwrap();
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 48);
    for (index, case) in cases.iter().enumerate() {
        let bytes = serde_json::to_vec(&envelope(case, index + 1)).unwrap();
        let request = parse_utility_request(&bytes).unwrap();
        assert_result(
            &serde_json::to_value(utility::calculate(request.operation())).unwrap(),
            case,
        );
    }
}
