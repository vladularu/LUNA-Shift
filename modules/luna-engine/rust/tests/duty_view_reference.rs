mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::input::duty_view;
use serde_json::json;
#[test]
fn full_original_special_duty_and_child_timeblock_display_projections_match() {
    let fixture = value_pool::decode(include_str!("../../reference/duty-view-golden.json"));
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 484);
    for case in fixture["cases"].as_array().unwrap() {
        let value = duty_view::prepare(&case["input"]).unwrap();
        common::assert_json_eq(&value, &case["expected"], case["id"].as_str().unwrap());
    }
}
#[test]
fn raw_display_does_not_admit_unknown_source_shapes_or_unbounded_blocks() {
    let fixture = value_pool::decode(include_str!("../../reference/duty-view-golden.json"));
    assert!(duty_view::prepare(&json!({"ready":true})).is_err());
    let mut input = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["input"]["value"]["kind"] == "SPLIT")
        .unwrap()["input"]
        .clone();
    input["value"]["parts"] = json!(vec![json!({"start":0,"end":1,"breakMinutes":0}); 9]);
    assert!(duty_view::prepare(&input).is_err());
}

#[test]
fn original_jsx_identity_callback_and_fragment_roles_bind_each_gap_and_travel_field() {
    let fixture = value_pool::decode(include_str!("../../reference/duty-view-roles-golden.json"));
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 484);
    for case in fixture["cases"].as_array().unwrap() {
        common::assert_json_eq(
            &duty_view::prepare_ui(&case["input"]).unwrap(),
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
    }
}

#[test]
fn original_computed_displays_cross_closed_utility_parser_and_actual_owned_c_buffers() {
    use luna_engine::{
        contract::{self, utility::parse_utility_request},
        ffi::*,
        runtime::utility,
    };
    use serde_json::Value;
    fn take(buffer: EngineBuffer) -> Value {
        // SAFETY: copy a live engine-owned buffer, then release exactly once.
        let value = serde_json::from_slice(unsafe {
            std::slice::from_raw_parts(buffer.bytes, buffer.length)
        })
        .unwrap();
        assert!(luna_engine_release_buffer(buffer.handle));
        value
    }
    take(luna_engine_reset());
    let owner = br#"{"ownerScope":"duty-view","ownerEpoch":1}"#;
    // SAFETY: owner bytes remain live for the synchronous binding call.
    assert_eq!(
        take(unsafe { luna_engine_bind_owner(owner.as_ptr(), owner.len()) })["ok"],
        true
    );
    let fixture = value_pool::decode(include_str!("../../reference/duty-view-golden.json"));
    for (index, case) in fixture["cases"].as_array().unwrap().iter().enumerate() {
        let envelope = json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"duty-view","ownerEpoch":1,"requestId":"duty-view","draftRevision":index+1},"operation":{"kind":"DUTY_FORM_COMMAND","command":{"kind":"VIEW","input":case["input"]}}});
        let bytes = serde_json::to_vec(&envelope).unwrap();
        let parsed = parse_utility_request(&bytes).unwrap();
        let result = serde_json::to_value(utility::calculate(parsed.operation())).unwrap();
        assert_eq!(result["state"], "VALUE");
        common::assert_json_eq(
            &result["value"],
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
        // SAFETY: envelope bytes remain live throughout the synchronous call.
        let result = take(unsafe { luna_engine_utility(bytes.as_ptr(), bytes.len()) });
        assert_eq!(result["state"], "COMPLETED");
        common::assert_json_eq(
            &result["result"]["value"],
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
    }
    take(luna_engine_reset());
}
