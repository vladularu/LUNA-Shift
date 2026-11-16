mod common;
use luna_engine::input::special_duty_inline;
use serde_json::Value;
#[test]
fn actual_original_inline_jsx_callbacks_match_including_last_of_maximum_arrays() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/duty-inline-golden.json")).unwrap();
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 249);
    assert!(
        fixture["cases"]
            .as_array()
            .unwrap()
            .iter()
            .any(|case| case["input"]["index"] == 63)
    );
    for case in fixture["cases"].as_array().unwrap() {
        let actual = special_duty_inline::execute(&case["input"]).unwrap();
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
