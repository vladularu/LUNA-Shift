use luna_engine::training::{self, TrainingError};
use serde_json::{Value, json};
fn run(case: &Value) -> Result<Value, TrainingError> {
    let parsed;
    let i = if let Some(s) = case.get("inputJson").and_then(Value::as_str) {
        parsed = serde_json::from_str::<Value>(s).unwrap();
        &parsed
    } else {
        &case["input"]
    };
    match case["operation"].as_str().unwrap() {
        "training.profile" => training::validate_training_profile(&i["value"]),
        "training.select" => training::training_profile_for_date(
            i["profiles"].as_array().unwrap(),
            i["date"].as_str().unwrap(),
        )
        .map(|v| v.unwrap_or(Value::Null)),
        "training.details" => training::validate_shift_training_data(&i["value"]),
        "training.saved" => training::validate_saved_shift_training(&i["value"]),
        "training.revision" => training::training_revision(&i["value"]).map(|v| json!(v)),
        "training.current" => Ok(json!(training::is_current_shift_training(
            &i["saved"],
            &i["shift"],
            i["timeZone"].as_str().unwrap()
        ))),
        "training.parent" => {
            let saved = training::validate_saved_shift_training(&i["saved"])?;
            training::require_shift_training_parent(&saved, &i["shift"])?;
            Ok(Value::Null)
        }
        "training.block" => {
            let saved = training::validate_saved_shift_training(&i["saved"])?;
            training::youth_block_shift_binding(
                &i["shift"],
                &saved,
                i["timeZone"].as_str().unwrap(),
            )
            .map(|v| json!(v))
        }
        op => panic!("Unknown {op}"),
    }
}
#[test]
fn all_training_domain_raw_contracts_match_frozen_source() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/training-data-golden.json")).unwrap();
    assert_eq!(
        fixture["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 692);
    for case in cases {
        let result = run(case);
        if case["errorPolicy"] == "boundedTemporal" {
            let e = result.unwrap_err();
            assert_eq!(e.name(), "RangeError", "{}", case["id"]);
            assert_eq!(e.message(), "Ungültige Zeitangabe in den Ausbildungsdaten.");
            continue;
        }
        let actual = match result {
            Ok(v) => v,
            Err(e) => json!({"$error":{"name":e.name(),"message":e.message()}}),
        };
        assert_eq!(actual, case["expected"], "{}", case["id"]);
    }
}

#[test]
fn prepared_profiles_normalize_once_and_borrow_stable_rows_without_backdating() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/training-data-golden.json")).unwrap();
    let case = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "training-data-select-2026-07-01")
        .unwrap();
    let input = &case["input"];
    let raw = input["profiles"].as_array().unwrap();
    let prepared = training::PreparedTrainingProfiles::try_from_raw(raw).unwrap();
    let row = prepared.for_date("2026-07-01").unwrap().unwrap();
    assert_eq!(row, &case["expected"]);
    assert_eq!(row["data"]["training"]["profession"], "Pflegefachperson");
    assert_eq!(
        raw[0]["data"]["training"]["profession"],
        " Pflegefachperson "
    );
    for _ in 0..1024 {
        assert!(std::ptr::eq(
            row,
            prepared.for_date("2026-07-15").unwrap().unwrap()
        ));
    }
    assert!(prepared.for_date("2025-12-31").unwrap().is_none());
    assert!(prepared.for_date("2026-02-30").is_err());
}
