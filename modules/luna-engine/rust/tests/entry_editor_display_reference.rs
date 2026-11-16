mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::input::entry_editor_display;
#[test]
fn original_render_flags_durations_and_dated_tariffs_match() {
    let fixture = value_pool::decode(include_str!("../../reference/entry-display-golden.json"));
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 712);
    assert_eq!(
        fixture["cases"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|c| c["expected"]["renderFailed"] == true)
            .count(),
        12
    );
    for case in fixture["cases"].as_array().unwrap() {
        let actual = entry_editor_display::prepare_raw(&case["input"]).unwrap();
        for field in ["display", "renderFailed", "tariff", "tariffError"] {
            common::assert_json_eq(
                &actual[field],
                &case["expected"][field],
                &format!("{}:{field}", case["id"]),
            );
        }
    }
}

#[test]
fn display_does_not_duplicate_foreign_profile_trees_or_turn_failed_render_into_fake_minutes() {
    let fixture = value_pool::decode(include_str!("../../reference/entry-display-golden.json"));
    let mut input = fixture["cases"][1]["input"].clone();
    input["profile"]["unrelatedSourceRows"] =
        serde_json::json!(vec![serde_json::json!({"ignored":true}); 50_000]);
    let actual = entry_editor_display::prepare_raw(&input).unwrap();
    assert!(serde_json::to_vec(&actual).unwrap().len() < 1024);
    let failed = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["expected"]["renderFailed"] == true)
        .unwrap();
    let actual = entry_editor_display::prepare_raw(&failed["input"]).unwrap();
    assert_eq!(actual["renderFailed"], true);
    assert_eq!(actual["display"], serde_json::Value::Null);
    assert!(actual.get("sourceRenderException").is_none());
    input["mode"] = serde_json::json!("SOURCE_READY");
    assert!(entry_editor_display::prepare_raw(&input).is_err());
}
