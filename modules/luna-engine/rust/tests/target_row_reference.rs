use luna_engine::{
    input::working_time_target::{self, RawSavedWorkingTimeTarget},
    target::TargetError,
};
use serde_json::{Value, json};
#[test]
fn original_saved_target_row_mapping_matches_including_nanosecond_order() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/target-row-golden.json")).unwrap();
    assert_eq!(
        fixture["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 101);
    for case in fixture["cases"].as_array().unwrap() {
        let result = working_time_target::map_working_time_target_row(&case["input"]);
        if case.get("safeRejection").is_some() {
            let error = result.unwrap_err();
            assert_eq!(error, TargetError::InvalidInput);
            assert!(!error.to_string().contains("private@example.com"));
        } else {
            let actual = match result {
                Ok(value) => {
                    let snapshot = luna_engine::target::profile::project_saved_target_snapshot(
                        Some(&value),
                        Some("Europe/Berlin"),
                        &[],
                    )
                    .unwrap();
                    assert_eq!(
                        snapshot, case["expectedSnapshot"],
                        "snapshot {}",
                        case["id"]
                    );
                    json!({"value":value})
                }
                Err(error) => {
                    json!({"error":{"name":"WorkingTimeTargetError","message":error.to_string()}})
                }
            };
            assert_eq!(actual, case["expected"], "{}", case["id"]);
        }
    }
}
#[test]
fn chunked_raw_rows_bind_large_original_json_without_host_preparation() {
    let settings = json!({"version":1,"context":{"periods":[],"days":[]},"planBindings":[]});
    let text = serde_json::to_string(&settings).unwrap();
    let mut row = json!({"id":"singleton","settings_json_chunks":[&text[..13],&text[13..]],"revision":1,"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-11-01T00:00:00Z"});
    let saved = RawSavedWorkingTimeTarget::try_from_raw_row_chunks(&row).unwrap();
    assert_eq!(saved.saved()["settings"], settings);
    let shared = saved.shared().clone();
    assert!(std::sync::Arc::ptr_eq(saved.shared(), &shared));
    row["context"] = json!({"status":"ready","computedTargetMinutes":0});
    assert!(RawSavedWorkingTimeTarget::try_from_raw_row_chunks(&row).is_err());
    row.as_object_mut().unwrap().remove("context");
    row["settings_json_chunks"] = json!([
        "{\"version\":2,\"version\":1,\"context\":{\"periods\":[],\"days\":[]},\"planBindings\":[]}"
    ]);
    assert!(RawSavedWorkingTimeTarget::try_from_raw_row_chunks(&row).is_err());
}
