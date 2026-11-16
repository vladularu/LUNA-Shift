mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::calendar::presentation::shared_entry::detail;
use std::sync::Arc;
#[test]
fn all_original_shared_editor_props_match_the_native_incoming_selection_and_time_labels() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/shared-entry-details-golden.json"
    ));
    let mut count = 0;
    for case in fixture["cases"].as_array().unwrap() {
        let input = &case["input"];
        let actual = detail(
            Arc::new(input["calendars"].as_array().unwrap().clone()),
            input["timeZone"].as_str().unwrap(),
            input["date"].as_str().unwrap(),
            input["calendarId"].as_str().unwrap(),
            input["entryId"].as_str().unwrap(),
        )
        .unwrap();
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
        count += 1;
    }
    assert_eq!(count, 3725);
}
#[test]
fn large_sharing_source_is_released_after_the_small_readonly_display_result() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/shared-entry-details-golden.json"
    ));
    let case = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["expected"].is_object())
        .unwrap();
    let input = &case["input"];
    let mut calendars = input["calendars"].as_array().unwrap().clone();
    let template = calendars[0]["entries"][0].clone();
    calendars[0]["entries"] = serde_json::Value::Array(
        (0..50_000)
            .map(|index| {
                let mut row = template.clone();
                row["id"] = serde_json::json!(format!("entry-{index}"));
                row
            })
            .collect(),
    );
    let owner = Arc::new(calendars);
    let weak = Arc::downgrade(&owner);
    let actual = detail(
        owner,
        input["timeZone"].as_str().unwrap(),
        input["date"].as_str().unwrap(),
        input["calendarId"].as_str().unwrap(),
        "entry-49999",
    )
    .unwrap();
    common::assert_json_eq(&actual, &case["expected"], "same source entry display");
    assert!(serde_json::to_vec(&actual).unwrap().len() < 4096);
    assert!(
        weak.upgrade().is_none(),
        "display retains no source calendar/entry tree"
    );
}
