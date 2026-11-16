//! Opt-in bounded actual Rust output for the production SQLite adapter gate.
//! This is not an expected fixture; the unchanged original SQL corpus is truth.
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::input::{day_write::NativeDayWriteSource, entry_editor_save::EntrySaveFailure};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::sync::Arc;
#[test]
fn dump_actual_native_calendar_plans_for_original_sqlite_postimage_gate() {
    let raw = include_str!("../../reference/day-write-golden.json");
    let fixture = value_pool::decode(raw);
    let mut cases = Vec::new();
    for case in fixture["cases"].as_array().unwrap() {
        let input = &case["input"];
        let source = NativeDayWriteSource::from_raw_rows(
            Arc::from(input["before"]["shifts"].as_array().unwrap().clone()),
            Arc::from(input["before"]["appointments"].as_array().unwrap().clone()),
        )
        .unwrap();
        let operation = input["operation"].as_str().unwrap();
        let allocated = if operation == "APPOINTMENT" {
            &input["allocatedIds"]["APPOINTMENT"]
        } else {
            &input["allocatedIds"]["SHIFT"]
        };
        let result = source.prepare(
            operation,
            &input["value"],
            input["epochMilliseconds"].as_f64().unwrap(),
            allocated.as_str().unwrap(),
        );
        let result = match result {
            Ok(plan) => json!({"body":plan.value(),"returned":plan.returned(),"error":null}),
            Err(error) => {
                json!({"body":null,"returned":null,"error":{"name":error.name(),"message":error.message(),"userFacing":matches!(EntrySaveFailure::from_input_error(&error),EntrySaveFailure::UserFacing(_))}})
            }
        };
        cases.push(json!({"id":case["id"],"result":result}));
    }
    assert_eq!(cases.len(), 327);
    if let Ok(file) = std::env::var("LUNA_DAY_SQL_NATIVE_DUMP") {
        let dump = json!({"schemaVersion":1,"producer":"ACTUAL_RUST_POLICY_TEST","engineVersion":luna_engine::ENGINE_VERSION,"fixtureSha256":format!("{:x}",Sha256::digest(raw)),"cases":cases});
        let bytes = serde_json::to_vec(&dump).unwrap();
        assert!(bytes.len() <= 32 * 1024 * 1024);
        std::fs::write(file, bytes).unwrap();
    }
}
