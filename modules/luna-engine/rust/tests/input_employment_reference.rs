mod common;
use luna_engine::input::{
    employment::{
        RawEmploymentHistory, decode_employment_payload, encode_employment_payload,
        map_remuneration_profile_row, validate_employment_data,
    },
    require_instant,
};
use serde_json::{Value, json};
use std::sync::Arc;
#[test]
fn all_stored_employment_payloads_json_encoders_and_rows_match_original_source() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/input-employment-golden.json")).unwrap();
    let cases = data["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 2841);
    for case in cases {
        if case["operation"] == "preciseInstantNanoseconds" {
            continue;
        }
        let input = &case["input"];
        let result = match case["operation"].as_str().unwrap() {
            "validateEmploymentData" => validate_employment_data(input),
            "decodeEmploymentPayload" => decode_employment_payload(input),
            "encodeEmploymentPayload" => encode_employment_payload(
                &input["data"],
                input.get("employment"),
                input.get("employmentOverrides"),
            )
            .map(|value| json!(value)),
            "mapRemunerationProfileRow" => map_remuneration_profile_row(input),
            "requireInstant" => require_instant(input, "Zeitstempel").map(|value| json!(value)),
            operation => panic!("unknown {operation}"),
        };
        if case["malformedType"] == true {
            assert!(result.is_err(), "malformed JSON must fail safely");
            continue;
        }
        let actual = match result {
            Ok(value) => json!({"value":value}),
            Err(error) => json!({"$error":error.message(),"name":error.name()}),
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
fn row() -> Value {
    json!({"id":"from:2026-07-01","effective_from":"2026-07-01","data_json":"{\"version\":1,\"weeklyMinutes\":2310,\"selection\":{\"kind\":\"own-monthly\",\"monthlyGrossCents\":400000}}","revision":1,"created_at":"2026-01-01T00:00:00.000000002Z","updated_at":"2026-01-01T00:00:00.000000001Z"})
}
#[test]
fn opaque_history_preserves_raw_rows_and_rejects_injected_flags_or_ambiguous_dates() {
    let rows = Arc::new(vec![row()]);
    let checked = RawEmploymentHistory::try_from_rows(Arc::clone(&rows)).unwrap();
    assert!(Arc::ptr_eq(checked.raw_rows(), &rows));
    assert_eq!(checked.profiles().len(), 1);
    assert_eq!(checked.profiles()[0]["createdAt"], row()["created_at"]);
    assert_eq!(
        checked.profiles()[0]["updatedAt"],
        row()["updated_at"],
        "source compares milliseconds and accepts reverse nanos within the same millisecond"
    );
    let duplicated = Arc::new(vec![row(), row()]);
    let error = RawEmploymentHistory::try_from_rows(duplicated)
        .err()
        .unwrap();
    assert_eq!(error.message(), "Mehrdeutige Vergütungshistorie.");
    let mut injected = row();
    injected["ready"] = json!(true);
    assert!(RawEmploymentHistory::try_from_rows(Arc::new(vec![injected])).is_err());
}
#[test]
fn integer_valued_json_numbers_follow_javascript_semantics_and_encoder_preserves_original_order() {
    let payload:Value=serde_json::from_str("{\"weeklyMinutes\":2310.0,\"selection\":{\"monthlyGrossCents\":400000.0,\"kind\":\"own-monthly\"},\"version\":1.0}").unwrap();
    let encoded = encode_employment_payload(&payload, None, None).unwrap();
    assert_eq!(
        encoded,
        "{\"weeklyMinutes\":2310,\"selection\":{\"monthlyGrossCents\":400000,\"kind\":\"own-monthly\"},\"version\":1}"
    );
    assert!(decode_employment_payload(&payload).is_ok());
}
