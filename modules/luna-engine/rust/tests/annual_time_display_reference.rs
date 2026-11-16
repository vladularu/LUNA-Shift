mod common;
use luna_engine::report::time_display::present_year;
use serde_json::Value;
#[test]
fn complete_original_year_cards_rows_and_bars_are_preserved_including_pending_core() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../reference/annual-time-display-golden.json"
    ))
    .unwrap();
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 440);
    for case in fixture["cases"].as_array().unwrap() {
        let actual = present_year(
            &case["input"]["report"],
            case["input"]["pending"].as_bool().unwrap(),
        )
        .unwrap_or_else(|error| panic!("{}:{error:?}", case["id"]));
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
