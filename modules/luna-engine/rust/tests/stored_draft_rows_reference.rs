mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::input::stored_rows;
use serde_json::{Value, json};
fn chunks(value: &Value) -> Value {
    let mut value = value.clone();
    match &mut value {
        Value::Array(rows) => {
            for row in rows {
                *row = chunks(row)
            }
        }
        Value::Object(row) => {
            for item in row.values_mut() {
                *item = chunks(item)
            }
            for key in [
                "facts_json",
                "confirmation_json",
                "data_json",
                "allocations_json",
                "special_duty_json",
                "notification_json",
                "location_json",
            ] {
                let Some(text) = row.get(key).and_then(Value::as_str) else {
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
                    start = end
                }
                if parts.is_empty() {
                    parts.push(json!(""))
                }
                row.remove(key);
                row.insert(format!("{key}_chunks"), json!(parts));
            }
        }
        _ => {}
    }
    value
}
#[test]
fn original_draft_raw_rows_and_complete_raw_parent_joins_match() {
    let corpus = value_pool::decode(include_str!(
        "../../reference/stored-draft-rows-golden.json"
    ));
    assert_eq!(corpus["cases"].as_array().unwrap().len(), 3012);
    assert_eq!(corpus["parentCases"].as_array().unwrap().len(), 161);
    assert_eq!(corpus["largeCases"].as_array().unwrap().len(), 10);
    for group in ["cases", "parentCases", "largeCases"] {
        for case in corpus[group].as_array().unwrap() {
            let mut request =
                json!({"table":case["table"],"rows":chunks(&case["rows"]),"collection":false});
            if let Some(parents) = case.get("parents") {
                request["parents"] = chunks(parents)
            }
            let actual = stored_rows::execute(&serde_json::to_vec(&request).unwrap())
                .unwrap_or_else(|e| panic!("{}: {e}", case["id"]));
            if let Some(error) = case["expected"].get("error") {
                assert_eq!(actual["state"], "RECORD_ERROR", "{}", case["id"]);
                assert_eq!(
                    actual["userFacing"], error["userFacing"],
                    "{} ancestry",
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
                    assert!(!actual.to_string().contains("private"))
                }
            } else {
                assert_eq!(actual["state"], "VALUE", "{}: {actual}", case["id"]);
                common::assert_json_eq(
                    &actual["value"],
                    &case["expected"]["value"],
                    case["id"].as_str().unwrap(),
                )
            }
        }
    }
}
