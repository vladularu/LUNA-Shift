mod common;
use luna_engine::{
    contract::{self, utility::*},
    runtime::{self, SnapshotRegistry, utility_lease::UtilityFenceError},
};
use serde_json::{Value, json};

fn envelope(operation: Value, revision: u64) -> Value {
    json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"net-form","ownerEpoch":1,"requestId":"editor","draftRevision":revision},"operation":operation})
}
fn request(command: Value, revision: u64) -> UtilityRequest {
    parse_utility_request(
        &serde_json::to_vec(&envelope(
            json!({"kind":"NET_FORM","command":command}),
            revision,
        ))
        .unwrap(),
    )
    .unwrap()
}
fn operation(case: &Value) -> Option<Value> {
    let input = &case["input"];
    let mut command = input.clone();
    let kind = match case["operation"].as_str().unwrap() {
        "prefill" => "VALUES",
        "setupPrefill" => {
            command.as_object_mut().unwrap().remove("worksInSaxony");
            command["federalState"] = json!(if input["worksInSaxony"] == true {
                "SN"
            } else {
                "NW"
            });
            "SETUP_VALUES"
        }
        "monthly" => {
            // The source's third argument is explicitly unused, not wire evidence.
            command.as_object_mut().unwrap().remove("previous");
            "PREPARE_MONTHLY"
        }
        "step" => "VALIDATE_STEP",
        "setup" => "PREPARE_SETUP",
        "amounts" => "PARSE_AMOUNTS",
        "decimal" => return None,
        other => panic!("{other}"),
    };
    command["kind"] = json!(kind);
    Some(command)
}
#[test]
fn every_original_net_form_command_output_and_error_is_preserved_through_bounded_utility() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/net-form-golden.json")).unwrap();
    let mut count = 0;
    for case in fixture["cases"].as_array().unwrap() {
        let Some(command) = operation(case) else {
            continue;
        };
        let parsed = request(command, 1);
        assert_eq!(parsed.operation().kind(), UtilityKind::NetForm);
        let actual = serde_json::to_value(runtime::utility::calculate(parsed.operation())).unwrap();
        let expected = if let Some(error) = case["expected"].get("$error") {
            json!({"state":"INPUT_ERROR","name":error["name"],"message":error["message"]})
        } else {
            json!({"state":"VALUE","value":case["expected"]})
        };
        common::assert_json_eq(&actual, &expected, case["id"].as_str().unwrap());
        count += 1;
    }
    assert_eq!(count, 729);
}
#[test]
fn raw_commands_are_closed_and_native_owner_draft_fences_are_mandatory() {
    for command in [
        json!({"kind":"CALCULATE","pay":{"ready":true}}),
        json!({"kind":"VALUES","ready":true}),
        json!({"kind":"PARSE_AMOUNTS","form":{},"pay":{}}),
    ] {
        assert!(
            parse_utility_request(
                &serde_json::to_vec(&envelope(json!({"kind":"NET_FORM","command":command}), 1))
                    .unwrap()
            )
            .is_err()
        );
    }
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&contract::OwnerIdentity::new("net-form", 1).unwrap())
        .unwrap();
    let older = request(json!({"kind":"VALUES"}), 1);
    let marker = registry.utility_owner_marker().unwrap();
    let completion = runtime::utility::prepare(&registry, &marker, &older).unwrap();
    let newer = request(json!({"kind":"VALUES"}), 2);
    let marker = registry.utility_owner_marker().unwrap();
    let current = runtime::utility::prepare(&registry, &marker, &newer).unwrap();
    assert!(current.serialize_current().is_ok());
    assert!(completion.serialize_current().is_err());
    let marker = registry.utility_owner_marker().unwrap();
    assert!(matches!(
        runtime::utility::prepare(&registry, &marker, &older),
        Err(UtilityFenceError::StaleDraft)
    ));
    registry
        .reset_for_owner(&contract::OwnerIdentity::new("net-form", 1).unwrap())
        .unwrap();
    assert!(current.serialize_current().is_err());
}

#[test]
fn net_form_commands_use_the_actual_c_and_portable_text_contract() {
    use luna_engine::ffi::*;
    fn take(buffer: EngineBuffer) -> Value {
        // SAFETY: descriptor comes from this linked library; bytes are copied
        // before releasing its opaque handle exactly once.
        let value = serde_json::from_slice(unsafe {
            std::slice::from_raw_parts(buffer.bytes, buffer.length)
        })
        .unwrap();
        if buffer.handle != 0 {
            assert!(luna_engine_release_buffer(buffer.handle));
            assert!(!luna_engine_release_buffer(buffer.handle));
        }
        value
    }
    fn invoke(request: &Value) -> Value {
        let bytes = serde_json::to_vec(request).unwrap();
        // SAFETY: bounded byte slice lives throughout the synchronous call.
        take(unsafe { luna_engine_utility(bytes.as_ptr(), bytes.len()) })
    }
    take(luna_engine_reset());
    let owner = serde_json::to_vec(&json!({"ownerScope":"net-form","ownerEpoch":1})).unwrap();
    // SAFETY: owner is a live bounded byte slice.
    assert_eq!(
        take(unsafe { luna_engine_bind_owner(owner.as_ptr(), owner.len()) })["ok"],
        true
    );
    let request = envelope(
        json!({"kind":"NET_FORM","command":{"kind":"SETUP_VALUES","federalState":"SN","initial":null}}),
        1,
    );
    let result = invoke(&request);
    assert_eq!(result["state"], "COMPLETED");
    assert_eq!(result["operation"], "NET_FORM");
    assert_eq!(result["guard"], request["guard"]);
    assert_eq!(result["result"]["value"]["worksInSaxony"], true);
    let text: Value = serde_json::from_str(&luna_engine::wasm_transport::engine_invoke(
        "utility",
        &request.to_string(),
    ))
    .unwrap();
    assert_eq!(text, result);
    let invalid = envelope(
        json!({"kind":"NET_FORM","command":{"kind":"PREPARE_MONTHLY","month":"2026-07","form":{"birthDate":"private-secret"}}}),
        2,
    );
    let error = invoke(&invalid);
    assert_eq!(error["result"]["state"], "INPUT_ERROR");
    assert!(!error.to_string().contains("private-secret"));
    take(luna_engine_reset());
    assert_eq!(invoke(&request)["code"], "OWNER_MISMATCH");
}
