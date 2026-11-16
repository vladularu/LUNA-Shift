#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::calendar::incoming::raw_rows::RawIncomingCacheRows;
use luna_engine::contract::ContractError;
use serde_json::{Value, json};
use std::sync::Arc;

#[test]
fn original_sqlite_cache_list_mapper_full_outputs_match() {
    let corpus = value_pool::decode(include_str!("../../reference/incoming-rows-golden.json"));
    assert_eq!(corpus["cases"].as_array().unwrap().len(), 129);
    for case in corpus["cases"].as_array().unwrap() {
        let input = &case["input"];
        let raw = serde_json::to_vec(&input["rows"]).unwrap();
        let mapped = RawIncomingCacheRows::parse(input["accountId"].as_str().unwrap(), &raw)
            .unwrap_or_else(|error| panic!("{}: {error:?}", case["id"]));
        assert_eq!(
            serde_json::to_value(mapped.calendars().as_ref()).unwrap(),
            case["expected"],
            "{}",
            case["id"]
        );
    }
}

fn row() -> Value {
    json!({"account_id":"viewer","calendar_id":"calendar","metadata_json":"{\"id\":\"calendar\",\"isOwner\":false}","entries_json":"[]","fetched_at":"2026-10-25T12:00:00Z","visible":1,"local_color":null})
}
#[test]
fn raw_shape_account_and_original_json_are_checked_without_creating_empty_ready_facts() {
    let mut cases = vec![json!({}), json!([null])];
    for field in [
        "account_id",
        "calendar_id",
        "metadata_json",
        "entries_json",
        "fetched_at",
        "visible",
        "local_color",
    ] {
        let mut value = row();
        value.as_object_mut().unwrap().remove(field);
        cases.push(json!([value]));
    }
    let mut wrong = row();
    wrong["account_id"] = json!("other");
    cases.push(json!([wrong]));
    let mut both = row();
    both["entries_json_chunks"] = json!(["[]"]);
    cases.push(json!([both]));
    let mut trailing = row();
    trailing["entries_json"] = json!("[]\u{0}ignored");
    cases.push(json!([trailing]));
    let mut duplicate = row();
    duplicate["metadata_json"] = json!("{\"x\":1,\"x\":2}");
    cases.push(json!([duplicate]));
    for value in cases {
        assert!(
            RawIncomingCacheRows::parse("viewer", &serde_json::to_vec(&value).unwrap()).is_err()
        );
    }
    let parsed =
        RawIncomingCacheRows::parse("viewer", &serde_json::to_vec(&json!([row()])).unwrap())
            .unwrap();
    let owner = Arc::clone(parsed.calendars());
    assert!(Arc::ptr_eq(parsed.calendars(), &owner));
    assert_eq!(owner[0]["accountId"], "viewer");
}

fn chunked_row(text: &str) -> Value {
    let mut value = row();
    value.as_object_mut().unwrap().remove("entries_json");
    value["entries_json_chunks"] = json!(
        text.as_bytes()
            .chunks(65536)
            .map(|chunk| std::str::from_utf8(chunk).unwrap())
            .collect::<Vec<_>>()
    );
    value
}

#[test]
fn separate_original_json_columns_cannot_reset_the_shared_decoded_node_budget() {
    let leaf = format!("[{}]", vec!["false"; 500].join(","));
    let text = format!("[{}]", vec![leaf; 2000].join(","));
    let first = chunked_row(&text);
    let one = serde_json::to_vec(&json!([first.clone()])).unwrap();
    assert!(RawIncomingCacheRows::parse("viewer", &one).is_ok());
    let two = serde_json::to_vec(&json!([first.clone(), first])).unwrap();
    assert!(matches!(
        RawIncomingCacheRows::parse("viewer", &two),
        Err(ContractError::TooManyJsonNodes)
    ));
}

#[test]
fn decoded_bytes_and_composed_depth_are_bounded_before_a_ready_owner_exists() {
    let text = format!("{}[]", " ".repeat(17 * 1024 * 1024));
    let bytes = serde_json::to_vec(&json!([chunked_row(&text)])).unwrap();
    assert!(matches!(
        RawIncomingCacheRows::parse("viewer", &bytes),
        Err(ContractError::InputTooLarge)
    ));
    for (depth, allowed) in [(46, true), (47, false)] {
        let text = format!("{}0{}", "[".repeat(depth), "]".repeat(depth));
        let bytes = serde_json::to_vec(&json!([chunked_row(&text)])).unwrap();
        let parsed = RawIncomingCacheRows::parse("viewer", &bytes);
        if allowed {
            assert!(parsed.is_ok());
        } else {
            assert!(matches!(parsed, Err(ContractError::JsonTooDeep)));
        }
    }
}
