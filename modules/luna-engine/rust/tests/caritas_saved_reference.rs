mod common;
use luna_engine::{input::InputError, remuneration::caritas::saved};
use serde_json::{Value, json};
fn validation(result: Result<Value, InputError>) -> Value {
    match result {
        Ok(value) => json!({"value":value}),
        Err(error) => json!({"$error":error.message(),"name":error.name()}),
    }
}
#[test]
fn caritas_saved_contracts_and_freshness_match_original() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/caritas-saved-golden.json")).unwrap();
    let cases = data["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 713);
    let mut current_overtime_positive = 0;
    for case in cases {
        let input = &case["input"];
        let actual = match case["operation"].as_str().unwrap() {
            "month" => validation(saved::require_month(input)),
            "validateMonth" => validation(saved::validate_month(input)),
            "validateWork" => validation(saved::validate_work_day(input)),
            "validateOvertime" => validation(saved::validate_overtime(input)),
            "currentMonth" => {
                json!({"value":saved::is_current_month(&input["saved"],&input["profile"],input["packageId"].as_str().unwrap(),input["version"].as_str().unwrap())})
            }
            "currentWork" => {
                json!({"value":saved::is_current_work_day(&input["saved"],&input["shift"],input["timeZone"].as_str().unwrap())})
            }
            "currentOvertime" => {
                if case["expected"]["value"] == true {
                    current_overtime_positive += 1;
                }
                json!({"value":saved::is_current_overtime(&input["saved"],&input["shift"],&input["allocation"],&input["profile"],input["version"].as_str().unwrap(),input["timeZone"].as_str().unwrap())})
            }
            _ => panic!("unknown operation"),
        };
        if case["engineDiagnostic"] == true {
            assert_eq!(actual["name"], case["expected"]["name"], "{}", case["id"]);
            assert!(
                actual["$error"].as_str().is_some_and(|s| !s.is_empty()),
                "{}",
                case["id"]
            );
        } else {
            common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
        }
    }
    assert!(current_overtime_positive > 5);
}
