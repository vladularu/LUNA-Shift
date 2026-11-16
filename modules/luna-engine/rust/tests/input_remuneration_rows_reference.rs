mod common;
use luna_engine::input::{InputError, remuneration_rows as r};
use serde_json::{Value, json};
use std::sync::Arc;
fn data() -> Value {
    serde_json::from_str(include_str!(
        "../../reference/remuneration-rows-golden.json"
    ))
    .unwrap()
}
fn result(value: Result<Value, InputError>) -> Value {
    match value {
        Ok(value) => json!({"value":value}),
        Err(e) => json!({"error":{"name":e.name(),"message":e.message()}}),
    }
}
#[test]
fn original_remuneration_sql_mappers_ordered_lists_and_missing_month_match_native_facts() {
    let d = data();
    assert!(d["cases"].as_array().unwrap().len() > 400);
    for c in d["cases"].as_array().unwrap() {
        let input = &c["input"];
        let op = c["operation"].as_str().unwrap();
        let actual = result(match op {
            "absence.map" => r::map_paid_absence_row(input),
            "overtime.map" => r::map_overtime_allocation_row(input),
            "allowance.map" => r::map_allowance_decision_row(input),
            "allowance.load" => r::load_monthly_allowance_row(
                &input["month"],
                input.get("row").filter(|v| !v.is_null()),
            ),
            _ => {
                let kind = match op {
                    "absence.list" => r::RemunerationRowsKind::PaidAbsences,
                    "overtime.list" => r::RemunerationRowsKind::OvertimeAllocations,
                    "allowance.list" => r::RemunerationRowsKind::ScopedAllowances,
                    _ => panic!("unknown {op}"),
                };
                r::RawRemunerationRows::try_from_rows(
                    kind,
                    Arc::new(input.as_array().unwrap().clone()),
                )
                .map(|v| json!(v.saved().as_ref()))
            }
        });
        if c["safeBoundary"] == true {
            assert!(actual.get("error").is_some(), "{}", c["id"]);
            assert!(!actual.to_string().contains("private"));
        } else {
            common::assert_json_eq(&actual, &c["expected"], c["id"].as_str().unwrap());
        }
    }
}
#[test]
fn native_source_owners_preserve_original_rows_zero_revocations_and_saved_empty_months() {
    let d = data();
    let cases = d["cases"].as_array().unwrap();
    for (op, kind) in [
        ("absence.map", r::RemunerationRowsKind::PaidAbsences),
        ("overtime.map", r::RemunerationRowsKind::OvertimeAllocations),
        ("allowance.map", r::RemunerationRowsKind::ScopedAllowances),
    ] {
        let row = cases
            .iter()
            .find(|c| c["operation"] == op && c["expected"]["value"].is_object())
            .unwrap()["input"]
            .clone();
        let raw = Arc::new(vec![row]);
        let checked = r::RawRemunerationRows::try_from_rows(kind, raw.clone()).unwrap();
        assert!(Arc::ptr_eq(&raw, checked.raw_rows()));
        assert_eq!(checked.saved().len(), 1);
    }
    let saved=r::RawRemunerationRows::try_from_rows(r::RemunerationRowsKind::ScopedAllowances,Arc::new(vec![json!({"month":"2026-09","decisions_json":"[]","revision":2,"updated_at":"2026-09-30T12:00:00Z"})])).unwrap();
    assert_eq!(saved.allowance_month("2026-09").unwrap()["revision"], 2);
    assert_eq!(saved.allowance_month("2026-10").unwrap()["revision"], 0);
}
