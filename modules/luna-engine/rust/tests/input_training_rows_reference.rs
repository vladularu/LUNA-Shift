mod common;
use luna_engine::input::{InputError, training_rows as t};
use serde_json::{Value, json};
use std::sync::Arc;
fn result(value: Result<Value, InputError>) -> Value {
    match value {
        Ok(value) => json!({"value":value}),
        Err(e) => json!({"error":{"name":e.name(),"message":e.message()}}),
    }
}
fn data() -> Value {
    serde_json::from_str(include_str!("../../reference/training-rows-golden.json")).unwrap()
}
#[test]
fn original_training_sql_mappers_and_lists_match_native_facts() {
    let data = data();
    assert_eq!(data["cases"].as_array().unwrap().len(), 615);
    for case in data["cases"].as_array().unwrap() {
        let input = &case["input"];
        let actual = result(match case["operation"].as_str().unwrap() {
            "profile.map" | "profile.chunk" => t::map_training_profile_row(input),
            "detail.map" | "detail.chunk" => t::map_shift_training_row(input),
            "profile.list" => {
                t::RawTrainingProfiles::try_from_rows(Arc::new(input.as_array().unwrap().clone()))
                    .map(|r| json!(r.saved().as_ref()))
            }
            "detail.list" => {
                t::RawShiftTraining::try_from_rows(Arc::new(input.as_array().unwrap().clone()))
                    .map(|r| json!(r.saved().as_ref()))
            }
            other => panic!("unknown operation {other}"),
        });
        if case["errorPolicy"] == "boundedTemporal" {
            assert_eq!(actual["error"]["name"], "RangeError");
            assert_eq!(
                actual["error"]["message"],
                "Ungültige Zeitangabe in den Ausbildungsdaten."
            );
        } else if case["safeBoundary"] == true {
            assert!(actual.get("error").is_some(), "{}", case["id"]);
            assert!(!actual.to_string().contains("private"));
        } else {
            common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
        }
    }
}
#[test]
fn raw_training_ownership_keeps_binding_metadata_and_queries_shared_native_profiles() {
    let data = data();
    let profile = data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["operation"] == "profile.map" && c["expected"]["value"].is_object())
        .unwrap()["input"]
        .clone();
    let detail = data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["operation"] == "detail.map" && c["expected"]["value"].is_object())
        .unwrap()["input"]
        .clone();
    let raw = Arc::new(vec![profile.clone()]);
    let p = t::RawTrainingProfiles::try_from_rows(raw.clone()).unwrap();
    assert!(Arc::ptr_eq(&raw, p.raw_rows()));
    assert!(Arc::ptr_eq(p.prepared().unwrap(), p.prepared().unwrap()));
    assert_eq!(
        p.prepared()
            .unwrap()
            .for_date("2026-12-01")
            .unwrap()
            .unwrap(),
        &p.saved()[0]
    );
    let data = t::RawShiftTraining::try_from_rows(Arc::new(vec![detail.clone()])).unwrap();
    assert_eq!(data.saved().len(), 1);
    assert_eq!(data.saved()[0]["shiftUpdatedAt"], "2026-01-01T00:00:00Z");
    let mut invalid = profile;
    invalid["ready"] = json!(true);
    assert!(t::map_training_profile_row(&invalid).is_err());
    let mut invalid = detail;
    invalid["data_json_chunks"] = json!(["{}"]);
    assert!(t::map_shift_training_row(&invalid).is_err());
}
