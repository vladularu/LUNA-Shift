mod common;
use luna_engine::{
    contract::{self, utility::parse_utility_request},
    runtime::utility,
};
use serde_json::{Value, json};
fn envelope(case: &Value, revision: usize) -> Value {
    let input = &case["input"];
    let mut operation =
        json!({"kind":"DUTY_FORM_FEEDBACK","duty":input["duty"],"parent":input["parent"]});
    if let Some(date) = input.get("date") {
        operation["date"] = date.clone();
    }
    json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,
 "guard":{"ownerScope":"duty-form","ownerEpoch":1,"requestId":"duty","draftRevision":revision},"operation":operation})
}
#[test]
fn all_original_form_feedback_crosses_the_closed_public_wire() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/duty-form-golden.json")).unwrap();
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 2470);
    for (index, case) in fixture["cases"].as_array().unwrap().iter().enumerate() {
        let bytes = serde_json::to_vec(&envelope(case, index + 1)).unwrap();
        let request = parse_utility_request(&bytes)
            .unwrap_or_else(|error| panic!("{}:{error:?}", case["id"]));
        let actual = serde_json::to_value(utility::calculate(request.operation())).unwrap();
        assert_eq!(actual["state"], "VALUE", "{}", case["id"]);
        common::assert_json_eq(
            &actual["value"],
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
    }
}
#[test]
fn all_original_form_feedback_uses_owned_native_c_buffers() {
    use luna_engine::ffi::*;
    fn take(buffer: EngineBuffer) -> Value {
        // SAFETY: the engine owns this live buffer until its matching release.
        let value = serde_json::from_slice(unsafe {
            std::slice::from_raw_parts(buffer.bytes, buffer.length)
        })
        .unwrap();
        assert!(luna_engine_release_buffer(buffer.handle));
        value
    }
    take(luna_engine_reset());
    let owner = br#"{"ownerScope":"duty-form","ownerEpoch":1}"#;
    // SAFETY: immutable owner bytes remain live through the bounded native call.
    assert_eq!(
        take(unsafe { luna_engine_bind_owner(owner.as_ptr(), owner.len()) })["ok"],
        true
    );
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/duty-form-golden.json")).unwrap();
    for (index, case) in fixture["cases"].as_array().unwrap().iter().enumerate() {
        let bytes = serde_json::to_vec(&envelope(case, index + 1)).unwrap();
        // SAFETY: immutable request bytes remain live through the bounded native call.
        let reply = take(unsafe { luna_engine_utility(bytes.as_ptr(), bytes.len()) });
        assert_eq!(reply["state"], "COMPLETED", "{}:{reply}", case["id"]);
        common::assert_json_eq(
            &reply["result"]["value"],
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
    }
    take(luna_engine_reset());
}
#[test]
fn operation_rejects_ready_facts_and_unknown_or_wrong_typed_arguments() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/duty-form-golden.json")).unwrap();
    for (key, value) in [
        ("ready", json!(true)),
        ("computedWorkMinutes", json!(42)),
        ("date", json!(42)),
    ] {
        let mut request = envelope(&fixture["cases"][0], 1);
        request["operation"][key] = value;
        assert!(parse_utility_request(&serde_json::to_vec(&request).unwrap()).is_err());
    }
}
