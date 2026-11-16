mod common;
use luna_engine::input::special_duty_draft;
use serde_json::Value;
#[test]
fn original_component_actions_and_cached_mode_round_trips_match() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/duty-draft-golden.json")).unwrap();
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 832);
    assert_eq!(fixture["sequences"].as_array().unwrap().len(), 8);
    for case in fixture["cases"].as_array().unwrap() {
        let actual = special_duty_draft::execute(&case["input"]).unwrap();
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
    for sequence in fixture["sequences"].as_array().unwrap() {
        let mut state = sequence[0]["input"]["state"].clone();
        for step in sequence.as_array().unwrap() {
            let mut input = step["input"].clone();
            input["state"] = state.clone();
            let actual = special_duty_draft::execute(&input).unwrap();
            common::assert_json_eq(&actual, &step["expected"], "mode cache sequence");
            for event in actual["events"].as_array().unwrap() {
                let field = event["field"].as_str().unwrap();
                state[if field == "duty" { "value" } else { field }] = event["value"].clone();
            }
            state["drafts"] = actual["drafts"].clone();
        }
    }
}
