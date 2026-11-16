mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::input::standby_fields;
use serde_json::json;
#[test]
fn original_standby_keyboard_props_match_without_changing_legacy_views() {
    let fixture = value_pool::decode(include_str!("../../reference/standby-ui-golden.json"));
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 7830);
    for case in fixture["cases"].as_array().unwrap() {
        let actual = standby_fields::execute_ui(&case["input"]).unwrap();
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
#[test]
fn original_standby_subforms_cross_public_utility_and_owned_c_buffers() {
    use luna_engine::{
        contract::{self, utility::parse_utility_request},
        ffi::*,
        runtime::utility,
    };
    use serde_json::Value;
    fn take(buffer: EngineBuffer) -> Value {
        // SAFETY: live owned native buffer is copied before its one release.
        let value = serde_json::from_slice(unsafe {
            std::slice::from_raw_parts(buffer.bytes, buffer.length)
        })
        .unwrap();
        assert!(luna_engine_release_buffer(buffer.handle));
        value
    }
    take(luna_engine_reset());
    let owner = br#"{"ownerScope":"standby-fields","ownerEpoch":1}"#;
    // SAFETY: immutable owner bytes stay live for the native call.
    assert_eq!(
        take(unsafe { luna_engine_bind_owner(owner.as_ptr(), owner.len()) })["ok"],
        true
    );
    let fixture = value_pool::decode(include_str!("../../reference/standby-fields-golden.json"));
    for (i, case) in fixture["cases"].as_array().unwrap().iter().enumerate() {
        let command = json!({"kind":"STANDBY_FIELDS","input":case["input"]});
        let envelope = json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"standby-fields","ownerEpoch":1,"requestId":"standby-fields","draftRevision":i+1},"operation":{"kind":"DUTY_FORM_COMMAND","command":command}});
        let bytes = serde_json::to_vec(&envelope).unwrap();
        let parsed = parse_utility_request(&bytes).unwrap();
        let result = serde_json::to_value(utility::calculate(parsed.operation())).unwrap();
        assert_eq!(result["state"], "VALUE");
        common::assert_json_eq(
            &result["value"],
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
        // SAFETY: envelope bytes stay live for the synchronous native call.
        let actual = take(unsafe { luna_engine_utility(bytes.as_ptr(), bytes.len()) });
        assert_eq!(actual["state"], "COMPLETED");
        common::assert_json_eq(
            &actual["result"]["value"],
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
    }
    take(luna_engine_reset());
}
#[test]
fn all_original_standby_subform_views_and_real_event_closures_match() {
    let fixture = value_pool::decode(include_str!("../../reference/standby-fields-golden.json"));
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 7830);
    for case in fixture["cases"].as_array().unwrap() {
        let actual = standby_fields::execute(&case["input"]).unwrap();
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
#[test]
fn raw_subform_input_never_accepts_unknown_components_or_invisible_actions() {
    assert!(standby_fields::execute(&json!({"component":3,"props":{},"actions":[]})).is_err());
    assert!(standby_fields::execute(&json!({"component":1,"props":{"value":{"kind":"STANDBY","settlement":"PAY"}},"actions":[{"type":"DutyChoice","label":"Berechnung der Zeitgutschrift","callback":"onChange","value":"WEIGHTED"}]})).is_err());
}

#[test]
fn persistent_local_state_matches_original_parent_updates_and_partial_rate_text() {
    let fixture = value_pool::decode(include_str!("../../reference/standby-state-golden.json"));
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 7870);
    for case in fixture["cases"].as_array().unwrap() {
        let input = &case["input"];
        let mut props = input["props"].clone();
        let mut form =
            standby_fields::StandbyFieldsState::new(input["component"].as_u64().unwrap(), &props)
                .unwrap();
        let mut events = Vec::new();
        for action in input["actions"].as_array().unwrap() {
            let result = form.apply(&props, std::slice::from_ref(action)).unwrap();
            for event in result["events"].as_array().unwrap() {
                props["value"] = event.clone();
                events.push(event.clone());
            }
        }
        let mut actual = form.apply(&props, &[]).unwrap();
        actual["events"] = json!(events);
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
