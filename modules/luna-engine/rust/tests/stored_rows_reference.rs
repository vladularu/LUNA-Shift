mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::input::stored_rows;
use serde_json::{Value, json};
fn encoded_rows(rows: &Value) -> Value {
    let mut rows = rows.clone();
    for row in rows.as_array_mut().unwrap() {
        let Some(row) = row.as_object_mut() else {
            continue;
        };
        for column in [
            "payment_json",
            "claim_json",
            "actual_payment_json",
            "data_json",
        ] {
            let chunk_column = format!("{column}_chunks");
            if row.contains_key(&chunk_column) {
                continue;
            }
            let Some(text) = row.get(column).and_then(Value::as_str) else {
                continue;
            };
            let mut parts = Vec::new();
            let mut start = 0;
            while start < text.len() {
                let mut end = (start + 48_000).min(text.len());
                while !text.is_char_boundary(end) {
                    end -= 1
                }
                parts.push(json!(&text[start..end]));
                start = end;
            }
            if parts.is_empty() {
                parts.push(json!(""));
            }
            row.remove(column);
            row.insert(chunk_column, Value::Array(parts));
        }
    }
    rows
}
#[test]
fn original_row_collections_preserve_output_order_errors_and_real_error_ancestry() {
    let corpus = value_pool::decode(include_str!(
        "../../reference/stored-rows-ancestry-golden.json"
    ));
    assert_eq!(corpus["cases"].as_array().unwrap().len(), 900);
    for case in corpus["cases"].as_array().unwrap() {
        let raw = json!({"table":case["table"],"rows":encoded_rows(&case["rows"]),"collection":case["collection"]});
        let actual = stored_rows::execute(&serde_json::to_vec(&raw).unwrap())
            .unwrap_or_else(|e| panic!("{}: {e}", case["id"]));
        let expected = &case["expected"];
        if expected.get("error").is_some() {
            assert_eq!(actual["state"], "RECORD_ERROR", "{}", case["id"]);
            assert_eq!(
                actual["userFacing"], expected["error"]["userFacing"],
                "{} ancestry",
                case["id"]
            );
            assert_eq!(
                actual["rowIndex"], expected["error"]["rowIndex"],
                "{} row",
                case["id"]
            );
            if case["safeBoundary"] != true && case["errorPolicy"] != "boundedTemporal" {
                assert_eq!(
                    actual["name"], expected["error"]["name"],
                    "{} name",
                    case["id"]
                );
                assert_eq!(
                    actual["message"], expected["error"]["message"],
                    "{} message",
                    case["id"]
                );
            } else {
                assert!(!actual.to_string().contains("private"));
            }
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
