mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::input::standby_fields;
use serde_json::{Value, json};
#[test]
fn stateless_raw_ui_state_preserves_all_original_controlled_parent_flows() {
    let fixture = value_pool::decode(include_str!("../../reference/standby-state-golden.json"));
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 7870);
    for case in fixture["cases"].as_array().unwrap() {
        let input = &case["input"];
        let mut props = input["props"].clone();
        let mut state = Value::Null;
        let mut events = Vec::new();
        for action in input["actions"].as_array().unwrap() {
            let result=standby_fields::execute(&json!({"component":input["component"],"props":props,"actions":[action],"state":state})).unwrap_or_else(|error|panic!("{} {error:?}",case["id"]));
            state = result["state"].clone();
            for event in result["events"].as_array().unwrap() {
                props["value"] = event.clone();
                events.push(event.clone());
            }
        }
        let mut result = standby_fields::execute(
            &json!({"component":input["component"],"props":props,"actions":[],"state":state}),
        )
        .unwrap();
        result["events"] = json!(events);
        common::assert_json_eq(&result, &case["expected"], case["id"].as_str().unwrap());
    }
}
#[test]
fn raw_ui_state_does_not_accept_computed_objects_or_malformed_local_text() {
    let fixture = value_pool::decode(include_str!("../../reference/standby-state-golden.json"));
    let props = &fixture["cases"][0]["input"]["props"];
    for state in [
        json!({"ready":true}),
        json!([true]),
        json!(["true", "1,"]),
        json!([true, 2]),
        json!([true, "1,", false]),
    ] {
        assert!(
            standby_fields::execute(
                &json!({"component":0,"props":props,"actions":[],"state":state})
            )
            .is_err()
        );
    }
}
