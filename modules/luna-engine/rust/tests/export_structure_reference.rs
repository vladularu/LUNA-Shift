mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    input::calendar_rows::PreparedCalendarRows,
    report::export_rows::{ReportEntryError, report_comparison_candidates},
    runtime::export_report::structure::ExportStructureIndex,
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc};
#[test]
fn complete_original_structural_projections_match_without_target_credit_or_money() {
    let fixture = value_pool::decode(include_str!("../../reference/export-structure-golden.json"));
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 910);
    for case in cases {
        let actual = report_comparison_candidates(
            case["entries"].as_array().unwrap(),
            100_000,
            32 * 1024 * 1024,
        )
        .unwrap_or_else(|error| panic!("{}: {error}", case["id"]));
        common::assert_json_eq(
            &json!({"candidates":actual.strings(),"readableCount":actual.readable_entry_count()}),
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
    }
}
#[test]
fn structural_row_text_and_combined_rank_reservation_limits_are_closed_and_exact() {
    let fixture = value_pool::decode(include_str!("../../reference/export-structure-golden.json"));
    let row = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|case| case["entries"].as_array().unwrap())
        .find(|row| row["kind"] == "SHIFT" && row.get("specialDuty").is_none_or(Value::is_null))
        .unwrap()
        .clone();
    let exact = report_comparison_candidates([&row], 1, 32 * 1024 * 1024).unwrap();
    assert_eq!(exact.readable_entry_count(), 1);
    let reserved = exact.reserved_bytes();
    assert!(report_comparison_candidates([&row], 1, reserved).is_ok());
    for result in [
        report_comparison_candidates([&row], 0, 32 * 1024 * 1024),
        report_comparison_candidates([&row], 1, reserved - 1),
    ] {
        assert!(matches!(result, Err(ReportEntryError::TooLarge)));
    }
    assert!(report_comparison_candidates(std::iter::empty(), 0, 8192).is_ok());
    assert!(matches!(
        report_comparison_candidates(std::iter::empty(), 0, 8191),
        Err(ReportEntryError::TooLarge)
    ));
    let mut long = row;
    long["title"] = json!("\u{1f499}".repeat(75_000));
    assert!(report_comparison_candidates([&long], 1, 32 * 1024 * 1024).is_ok());
    long["title"] = json!(format!("{}x", "\u{1f499}".repeat(75_000)));
    let error = report_comparison_candidates([&long], 1, 32 * 1024 * 1024)
        .err()
        .unwrap();
    assert!(matches!(error, ReportEntryError::TooLarge));
    assert!(!error.to_string().contains("xxxx"));
}
#[test]
fn one_calendar_index_preserves_stored_month_membership_and_releases_its_owner() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/export-source-time-golden.json"
    ));
    let case = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["id"] == "family-9-2026-07")
        .unwrap();
    let mut rows = case["input"]["shiftRows"].as_array().unwrap().clone();
    let mut neighbor = rows[0].clone();
    neighbor["id"] = json!("neighbor");
    neighbor["date"] = json!("2026-08-01");
    rows.push(neighbor);
    let mut deleted = rows[0].clone();
    deleted["id"] = json!("deleted");
    deleted["deleted_at"] = json!("2026-11-15T00:00:00Z");
    rows.push(deleted);
    let mut appointment = case["input"]["appointmentRows"][0].clone();
    appointment["id"] = json!("stored-series");
    appointment["date"] = json!("2026-06-01");
    appointment["recurrence_frequency"] = json!("DAY");
    appointment["recurrence_interval"] = json!(1);
    let prepared =
        PreparedCalendarRows::from_rows(Arc::new(rows), Arc::new(vec![appointment])).unwrap();
    // Declared synthetic ranks test membership/ownership only, never source locale equivalence.
    let ranks = prepared
        .collation_candidates()
        .iter()
        .enumerate()
        .map(|(index, text)| (text.clone(), index as u32))
        .collect::<BTreeMap<_, _>>()
        .into();
    let calendar = Arc::new(prepared.into_ranked(&ranks).unwrap());
    let weak = Arc::downgrade(&calendar);
    let count = calendar.entries().len();
    let index = ExportStructureIndex::from_calendar(Arc::clone(&calendar)).unwrap();
    assert!(index.shares_calendar(&calendar));
    assert_eq!(index.scanned_entry_count(), count);
    let july = index.candidates("2026-07").unwrap();
    for absent in ["neighbor", "deleted", "stored-series"] {
        assert!(!july.strings().iter().any(|text| text == absent));
    }
    assert!(
        index
            .candidates("2026-08")
            .unwrap()
            .strings()
            .iter()
            .any(|text| text == "neighbor")
    );
    assert!(
        index
            .candidates("2026")
            .unwrap()
            .strings()
            .iter()
            .any(|text| text == "stored-series")
    );
    for invalid in ["2026-7", "2026-13", "1899", "4100", "bad"] {
        assert!(index.candidates(invalid).is_err());
    }
    assert_eq!(index.scanned_entry_count(), count);
    drop(calendar);
    assert!(weak.upgrade().is_some());
    drop(index);
    assert!(weak.upgrade().is_none());
    assert!(!july.strings().is_empty());
}
