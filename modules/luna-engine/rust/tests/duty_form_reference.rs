mod common;
use luna_engine::input::special_duty_feedback;
use serde_json::Value;
#[test]
fn all_original_special_duty_form_errors_and_minute_facts_are_preserved() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/duty-form-golden.json")).unwrap();
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 2470);
    for case in fixture["cases"].as_array().unwrap() {
        let input = &case["input"];
        let actual = special_duty_feedback::feedback(
            &input["duty"],
            &input["parent"],
            input["date"].as_str(),
        )
        .unwrap_or_else(|error| panic!("{}:{error:?}", case["id"]));
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}

#[test]
fn form_arrays_stay_within_the_same_eight_part_and_sixty_four_callout_controls() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/duty-form-golden.json")).unwrap();
    let source = &fixture["cases"][0]["input"];
    for (key, count) in [("parts", 9), ("callouts", 65)] {
        let mut duty = source["duty"].clone();
        duty[key] = serde_json::json!(vec![
            serde_json::json!({"start":0,"end":60,"breakMinutes":0});
            count
        ]);
        assert!(special_duty_feedback::feedback(&duty, &source["parent"], None).is_err());
    }
    assert!(
        special_duty_feedback::feedback(&serde_json::json!({}), &source["parent"], None).is_err()
    );
}
