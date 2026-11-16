mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::input::{day_write::NativeDayWriteSource, entry_editor_save::EntrySaveFailure};
use serde_json::{Value, json};
use std::sync::Arc;
fn source(before: &Value) -> NativeDayWriteSource {
    NativeDayWriteSource::from_raw_rows(
        Arc::from(before["shifts"].as_array().unwrap().clone()),
        Arc::from(before["appointments"].as_array().unwrap().clone()),
    )
    .unwrap()
}
fn apply(before: &Value, plan: &Value) -> Value {
    let mut state = before.clone();
    for mutation in plan["mutations"].as_array().unwrap() {
        let kind = mutation["kind"].as_str().unwrap();
        let group = if kind == "UPSERT_SHIFT_ENTRY"
            || (kind == "TOMBSTONE_CALENDAR_ENTRY" && mutation["entryKind"] == "SHIFT")
        {
            "shifts"
        } else {
            "appointments"
        };
        let rows = state[group].as_array_mut().unwrap();
        let index = rows
            .iter()
            .position(|row| row["id"] == mutation["row"]["id"]);
        if mutation["expected"].is_null() {
            assert!(index.is_none());
            rows.push(mutation["row"].clone());
        } else {
            let index = index.expect("actual current raw row");
            assert_eq!(rows[index]["revision"], mutation["expected"]["revision"]);
            assert!(rows[index]["deleted_at"].is_null());
            if kind == "TOMBSTONE_CALENDAR_ENTRY" {
                for key in ["revision", "updated_at", "deleted_at"] {
                    rows[index][key] = mutation["row"][key].clone();
                }
            } else {
                rows[index] = mutation["row"].clone();
            }
        }
        rows.sort_by(|a, b| a["id"].as_str().unwrap().cmp(b["id"].as_str().unwrap()));
    }
    state
}
#[test]
fn original_actual_sqlite_validation_cas_writes_deletes_bulk_receipts_and_postimages_match() {
    let fixture = value_pool::decode(include_str!("../../reference/day-write-golden.json"));
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 327);
    let mut successful = 0;
    let mut unsafe_utf16 = 0;
    let mut sql_constraint_intents = 0;
    for case in fixture["cases"].as_array().unwrap() {
        let input = &case["input"];
        let operation = input["operation"].as_str().unwrap();
        let allocated = if operation == "APPOINTMENT" {
            &input["allocatedIds"]["APPOINTMENT"]
        } else {
            &input["allocatedIds"]["SHIFT"]
        };
        let result = source(&input["before"]).prepare(
            operation,
            &input["value"],
            input["epochMilliseconds"].as_f64().unwrap(),
            allocated.as_str().unwrap(),
        );
        if input["nativeMalformed"] == true {
            assert!(result.is_err());
            unsafe_utf16 += 1;
            continue;
        }
        match result {
            Ok(plan) => {
                if case["expected"]["result"]["error"]["name"] == "SqliteError" {
                    // A pure plan is not SQL success. The actual closed SQL adapter
                    // must enforce the same physical CHECK; do not fake it as InputError.
                    assert_eq!(
                        case["expected"]["result"]["error"]["message"],
                        "CHECK constraint failed: length(date) = 10"
                    );
                    assert_eq!(
                        plan.value()["mutations"][0]["row"]["date"],
                        input["value"]["date"]
                    );
                    assert_eq!(input["before"], case["expected"]["after"]);
                    sql_constraint_intents += 1;
                    continue;
                }
                assert_eq!(case["expected"]["result"]["ok"], true, "{}", case["id"]);
                common::assert_json_eq(
                    plan.returned(),
                    &case["expected"]["result"]["value"],
                    case["id"].as_str().unwrap(),
                );
                common::assert_json_eq(
                    &apply(&input["before"], plan.value()),
                    &case["expected"]["after"],
                    case["id"].as_str().unwrap(),
                );
                successful += 1;
                assert_eq!(plan.value()["guards"], json!([]));
            }
            Err(error) => {
                assert_eq!(
                    case["expected"]["result"]["ok"], false,
                    "{}: {error:?}",
                    case["id"]
                );
                common::assert_json_eq(
                    &json!({"name":error.name(),"message":error.message(),"userFacing":matches!(EntrySaveFailure::from_input_error(&error),EntrySaveFailure::UserFacing(_))}),
                    &case["expected"]["result"]["error"],
                    case["id"].as_str().unwrap(),
                );
                assert_eq!(
                    input["before"], case["expected"]["after"],
                    "no partial bulk update {}",
                    case["id"]
                );
            }
        }
        assert_eq!(case["expected"]["inTransaction"], false);
    }
    assert_eq!(successful, 186);
    assert_eq!(unsafe_utf16, 1);
    assert_eq!(sql_constraint_intents, 2);
}

#[test]
fn raw_row_scope_budget_and_selected_receipt_ownership_are_closed() {
    let fixture = value_pool::decode(include_str!("../../reference/day-write-golden.json"));
    let raw = &fixture["cases"][0]["input"]["before"];
    let row = raw["shifts"][0].clone();
    assert!(
        NativeDayWriteSource::from_raw_rows(
            Arc::from(vec![row.clone(), row.clone()]),
            Arc::from(vec![])
        )
        .is_err()
    );
    assert!(
        NativeDayWriteSource::from_raw_rows(
            Arc::from(vec![Value::Null; 50_001]),
            Arc::from(vec![])
        )
        .is_err()
    );
    let mut invalid = row.clone();
    invalid["cachedProfile"] = json!({"ready":true});
    assert!(
        NativeDayWriteSource::from_raw_rows(Arc::from(vec![invalid]), Arc::from(vec![])).is_err()
    );
    let mut oversized = row;
    oversized["note"] = json!("x".repeat(16_515_072));
    assert!(
        NativeDayWriteSource::from_raw_rows(Arc::from(vec![oversized]), Arc::from(vec![])).is_err()
    );
    let input = &fixture["cases"][0]["input"];
    let mut value = input["value"].clone();
    let s = source(raw);
    let plan = s
        .prepare(
            "SHIFT",
            &value,
            input["epochMilliseconds"].as_f64().unwrap(),
            input["allocatedIds"]["SHIFT"].as_str().unwrap(),
        )
        .unwrap();
    let before = plan.returned().clone();
    value["title"] = json!("changed after preparation");
    assert_eq!(plan.returned(), &before);
    assert!(s.prepare("UI_READY", &value, 0.0, "fake").is_err());
}
