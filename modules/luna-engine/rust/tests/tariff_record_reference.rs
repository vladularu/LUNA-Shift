use luna_engine::input::record_rows::{RecordRowKind, map_rows};
use serde_json::{Value, json};
#[test]
fn actual_save_intent_reuses_unchanged_original_month_status_results() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/input-calendar-golden.json")).unwrap();
    let mut count = 0;
    for case in data["cases"].as_array().unwrap() {
        let field = match case["operation"].as_str().unwrap() {
            "requireLocalMonth" => "month",
            "requireAllowanceStatus" => "allowanceStatus",
            _ => continue,
        };
        let mut input = json!({"month":"2026-11","allowanceStatus":"NONE"});
        input[field] = case["input"].clone();
        match map_rows(RecordRowKind::TariffDecisionInput, &[input]) {
            Ok(value) => assert_eq!(value[0][field], case["expected"]["value"], "{}", case["id"]),
            Err(error) => {
                assert_eq!(
                    error.name(),
                    case["expected"]["name"].as_str().unwrap(),
                    "{}",
                    case["id"]
                );
                assert_eq!(
                    error.message(),
                    case["expected"]["$error"].as_str().unwrap(),
                    "{}",
                    case["id"]
                );
            }
        }
        count += 1;
    }
    assert_eq!(
        count, 18,
        "all 10 original month and 8 original status cases"
    );
    assert_eq!(
        map_rows(
            RecordRowKind::TariffDecisionInput,
            &[json!({"month":"2026-11","allowanceStatus":"NONE","expectedRevision":null})]
        )
        .unwrap(),
        json!([{"month":"2026-11","allowanceStatus":"NONE"}])
    );
    assert!(
        map_rows(
            RecordRowKind::TariffDecision,
            &[json!({"month":"2026-11","allowance_status":"NONE"})]
        )
        .is_err()
    );
}
