mod common;
use luna_engine::input::{
    InputError,
    record_rows::{RecordRowKind, map_rows},
};
use serde_json::{Value, json};
fn outcome(value: Result<Value, InputError>) -> Value {
    match value {
        Ok(value) => json!({"value":value[0]}),
        Err(error) => json!({"$error":error.message(),"name":error.name()}),
    }
}
#[test]
fn existing_record_channel_preserves_original_net_storage_rows_and_failures() {
    let source: Value = serde_json::from_str(include_str!(
        "../../reference/input-finance-rows-golden.json"
    ))
    .unwrap();
    let mut count = 0;
    for case in source["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["operation"] == "mapNetPayProfileRow")
    {
        let actual = map_rows(
            RecordRowKind::NetPayProfile,
            std::slice::from_ref(&case["input"]),
        );
        if case["engineDiagnostic"] == true || case["nativeMalformed"] == true {
            assert!(actual.is_err(), "{}", case["id"]);
        } else {
            common::assert_json_eq(
                &outcome(actual),
                &case["expected"],
                case["id"].as_str().unwrap(),
            );
        }
        count += 1;
    }
    assert!(count > 20);
}
#[test]
fn record_input_normalization_reuses_the_original_net_settings_validator() {
    let source: Value =
        serde_json::from_str(include_str!("../../reference/net-settings-golden.json")).unwrap();
    let mut count = 0;
    for case in source["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["operation"] == "settings")
    {
        let actual = map_rows(
            RecordRowKind::NetPayProfileInput,
            std::slice::from_ref(&case["input"]["value"]),
        );
        let actual = match actual {
            Ok(value) => value[0].clone(),
            Err(error) => {
                if case["expected"].get("name").is_some() {
                    json!({"$error":error.message(),"name":error.name()})
                } else {
                    json!({"$error":error.message()})
                }
            }
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
        count += 1;
    }
    assert!(count > 20);
}
