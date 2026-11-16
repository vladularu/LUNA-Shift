mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::input::stored_rows;
use serde_json::{Value, json};
fn chunks(rows: &Value) -> Value {
    let mut rows = rows.clone();
    for row in rows.as_array_mut().unwrap() {
        let Some(row) = row.as_object_mut() else {
            continue;
        };
        for column in ["data_json", "allocations_json", "decisions_json"] {
            let Some(text) = row.get(column).and_then(Value::as_str) else {
                continue;
            };
            let mut parts = Vec::new();
            let mut start = 0;
            while start < text.len() {
                let mut end = (start + 48000).min(text.len());
                while !text.is_char_boundary(end) {
                    end -= 1
                }
                parts.push(json!(&text[start..end]));
                start = end;
            }
            if parts.is_empty() {
                parts.push(json!(""))
            }
            row.remove(column);
            row.insert(format!("{column}_chunks"), json!(parts));
        }
    }
    rows
}
#[test]
fn original_four_additional_mappers_preserve_values_and_actual_error_ancestry() {
    let corpus = value_pool::decode(include_str!("../../reference/stored-rows-next-golden.json"));
    assert_eq!(corpus["cases"].as_array().unwrap().len(), 1006);
    for case in corpus["cases"].as_array().unwrap() {
        let request =
            json!({"table":case["table"],"rows":chunks(&case["rows"]),"collection":false});
        let actual = stored_rows::execute(&serde_json::to_vec(&request).unwrap())
            .unwrap_or_else(|e| panic!("{}: {e}", case["id"]));
        if let Some(error) = case["expected"].get("error") {
            assert_eq!(actual["state"], "RECORD_ERROR", "{}", case["id"]);
            assert_eq!(
                actual["userFacing"], error["userFacing"],
                "{} ancestry",
                case["id"]
            );
            assert_eq!(
                actual["rowIndex"], error["rowIndex"],
                "{} index",
                case["id"]
            );
            if case["legacyBoundary"] != true && case["errorPolicy"] != "boundedTemporal" {
                assert_eq!(actual["name"], error["name"], "{} name", case["id"]);
                assert_eq!(
                    actual["message"], error["message"],
                    "{} message",
                    case["id"]
                );
            } else {
                assert!(!actual.to_string().contains("private"));
            }
        } else if case["legacyBoundary"] == true {
            // Keep the existing raw SQL text boundary: JSON.parse(null) in JS
            // can revoke overtime, but NULL is not a stored JSON-text column.
            // The original successful value remains unchanged in the corpus.
            assert_eq!(actual["state"], "RECORD_ERROR", "{}", case["id"]);
            assert!(!actual.to_string().contains("private"));
        } else {
            assert_eq!(actual["state"], "VALUE", "{}: {actual}", case["id"]);
            common::assert_json_eq(
                &actual["value"],
                &case["expected"]["value"],
                case["id"].as_str().unwrap(),
            );
        }
    }
}
#[test]
fn raw_parent_joins_match_the_original_backup_loops_including_inert_stale_rows() {
    let corpus = value_pool::decode(include_str!(
        "../../reference/stored-parent-join-golden.json"
    ));
    assert_eq!(corpus["cases"].as_array().unwrap().len(), 1188);
    for case in corpus["cases"].as_array().unwrap() {
        let request = json!({"table":case["table"],"rows":chunks(&case["rows"]),"collection":false,"parents":case["parents"]});
        let actual = stored_rows::execute(&serde_json::to_vec(&request).unwrap()).unwrap();
        let expected = &case["expected"];
        if let Some(error) = expected.get("error") {
            assert_eq!(
                actual,
                json!({"state":"RECORD_ERROR","name":error["name"],"message":error["message"],"userFacing":error["userFacing"],"rowIndex":0}),
                "{}",
                case["id"]
            );
        } else {
            assert_eq!(actual["state"], "VALUE", "{}: {actual}", case["id"]);
            common::assert_json_eq(
                &actual["value"],
                &expected["value"],
                case["id"].as_str().unwrap(),
            );
        }
    }
}
#[test]
fn unrequested_parent_and_collection_policies_are_closed_and_inputs_are_bounded() {
    for table in [
        "REMUNERATION_PROFILE",
        "OVERTIME_ALLOCATION",
        "PAID_ABSENCE",
        "ALLOWANCE_DECISION",
    ] {
        assert!(
            stored_rows::execute(
                &serde_json::to_vec(&json!({"table":table,"rows":[],"collection":true})).unwrap()
            )
            .is_err()
        );
    }
    for table in [
        "REMUNERATION_PROFILE",
        "TRAINING_PROFILE",
        "ALLOWANCE_DECISION",
        "ACTUAL_ANNUAL_PAYMENT",
        "TARIFF_ANNUAL_CLAIM",
    ] {
        assert!(stored_rows::execute(&serde_json::to_vec(&json!({"table":table,"rows":[],"collection":false,"parents":{"shifts":[],"timeZone":null}})).unwrap()).is_err());
    }
    assert_eq!(stored_rows::execute(&serde_json::to_vec(&json!({"table":"PAID_ABSENCE","rows":[],"collection":false,"parents":{"shifts":vec![Value::Null;50001],"timeZone":null}})).unwrap()).unwrap_err(),"STORED_ROWS_LIMIT");
}
