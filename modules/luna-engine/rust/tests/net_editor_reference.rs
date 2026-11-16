mod common;
use luna_engine::{
    contract::{self, utility::parse_utility_request},
    runtime::utility,
};
use serde_json::{Value, json};

#[test]
fn native_editor_initialization_matches_original_component_state_expressions() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/net-editor-golden.json")).unwrap();
    let cases = fixture["cases"].as_array().unwrap();
    assert!(cases.len() >= 100);
    for case in cases {
        let mut command = case["input"].clone();
        command["kind"] = json!("SETUP_EDITOR");
        let request = parse_utility_request(&serde_json::to_vec(&json!({
            "wireSchemaVersion":contract::SCHEMA_VERSION,
            "expectedEngineVersion":luna_engine::ENGINE_VERSION,
            "calculationContractVersion":contract::CONTRACT_VERSION,
            "guard":{"ownerScope":"net-editor","ownerEpoch":1,"requestId":"editor","draftRevision":1},
            "operation":{"kind":"NET_FORM","command":command}
        })).unwrap()).unwrap_or_else(|error| panic!("{}: {error:?}", case["id"]));
        common::assert_json_eq(
            &serde_json::to_value(utility::calculate(request.operation())).unwrap(),
            &json!({"state":"VALUE","value":case["expected"]}),
            case["id"].as_str().unwrap(),
        );
    }
}

#[test]
fn native_editor_uses_c_ownership_copy_release_and_closed_utility_validation() {
    use luna_engine::ffi::*;
    fn take(buffer: EngineBuffer) -> Value {
        // SAFETY: the linked library owns this live descriptor until release.
        let value = serde_json::from_slice(unsafe {
            std::slice::from_raw_parts(buffer.bytes, buffer.length)
        })
        .unwrap();
        assert!(luna_engine_release_buffer(buffer.handle));
        value
    }
    take(luna_engine_reset());
    let owner = br#"{"ownerScope":"net-editor","ownerEpoch":1}"#;
    // SAFETY: the bounded owner bytes remain live through this call.
    assert_eq!(
        take(unsafe { luna_engine_bind_owner(owner.as_ptr(), owner.len()) })["ok"],
        true
    );
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/net-editor-golden.json")).unwrap();
    let mut revision = 0;
    let mut invoke = |mut command: Value| {
        revision += 1;
        command["kind"] = json!("SETUP_EDITOR");
        let frame = json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,
            "calculationContractVersion":contract::CONTRACT_VERSION,
            "guard":{"ownerScope":"net-editor","ownerEpoch":1,"requestId":"editor","draftRevision":revision},
            "operation":{"kind":"NET_FORM","command":command}});
        let bytes = serde_json::to_vec(&frame).unwrap();
        // SAFETY: bytes remain live through this synchronous call.
        take(unsafe { luna_engine_utility(bytes.as_ptr(), bytes.len()) })
    };
    for case in fixture["cases"].as_array().unwrap() {
        let actual = invoke(case["input"].clone());
        assert_eq!(actual["state"], "COMPLETED");
        common::assert_json_eq(
            &actual["result"],
            &json!({"state":"VALUE","value":case["expected"]}),
            case["id"].as_str().unwrap(),
        );
    }
    for rate in [0, 7, 10] {
        assert_eq!(
            invoke(json!({"initial":null,"federalState":null,"churchTaxDefaultPercent":rate}))["result"]
                ["state"],
            "INPUT_ERROR"
        );
    }
    assert_eq!(
        invoke(
            json!({"initial":null,"federalState":null,"churchTaxDefaultPercent":9,"computedReady":true})
        )["ok"],
        false
    );
    take(luna_engine_reset());
}
