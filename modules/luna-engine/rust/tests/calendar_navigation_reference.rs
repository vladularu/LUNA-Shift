mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::calendar::presentation::navigation::{NavigationInput, calculate};
use serde_json::json;

#[test]
fn navigation_input_preserves_nullable_selection_and_rejects_unbounded_or_malformed_requests() {
    let valid = json!({
        "anchorMonth":"2026-11","referenceDate":"2026-11-14",
        "selectedDate":null,"before":24,"after":36
    });
    let input: NavigationInput = serde_json::from_value(valid.clone()).unwrap();
    assert_eq!(calculate(&input).unwrap().selected_date, "2026-11-14");
    for key in [
        "selectedDate",
        "anchorMonth",
        "referenceDate",
        "before",
        "after",
    ] {
        let mut missing = valid.clone();
        missing.as_object_mut().unwrap().remove(key);
        assert!(
            serde_json::from_value::<NavigationInput>(missing).is_err(),
            "{key}"
        );
    }
    for (key, value) in [
        ("unknown", json!(true)),
        ("before", json!(-1)),
        ("after", json!(65536)),
        ("before", json!(0.5)),
        ("selectedDate", json!(false)),
    ] {
        let mut malformed = valid.clone();
        malformed[key] = value;
        assert!(serde_json::from_value::<NavigationInput>(malformed).is_err());
    }
    for (key, value) in [
        ("anchorMonth", json!("2026-13")),
        ("anchorMonth", json!("invalid")),
        ("referenceDate", json!("2026-02-29")),
        ("referenceDate", json!("")),
        ("selectedDate", json!("2026-11-31")),
        ("before", json!(65535)),
    ] {
        let mut invalid = valid.clone();
        invalid[key] = value;
        let input: NavigationInput = serde_json::from_value(invalid).unwrap();
        assert!(calculate(&input).is_err());
    }
    let mut boundary = valid;
    boundary["before"] = json!(63);
    boundary["after"] = json!(64);
    let input = serde_json::from_value(boundary).unwrap();
    assert_eq!(calculate(&input).unwrap().grids.len(), 128);
}
#[test]
fn original_navigation_headers_selection_and_every_prepared_grid_match() {
    let corpus = value_pool::decode(include_str!(
        "../../reference/calendar-navigation-golden.json"
    ));
    assert_eq!(
        corpus["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let cases = corpus["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 108);
    for case in cases {
        let input: NavigationInput = serde_json::from_value(case["input"].clone()).unwrap();
        let value = calculate(&input).unwrap_or_else(|error| panic!("{}: {error:?}", case["id"]));
        common::assert_json_eq(
            &serde_json::to_value(value).unwrap(),
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
    }
}
