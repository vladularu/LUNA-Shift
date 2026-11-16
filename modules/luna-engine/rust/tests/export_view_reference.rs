mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::report::export_view::{
    model::{ReportDocumentRef, ReportRow},
    report_view,
};
#[test]
fn original_month_year_partial_zero_provisional_and_first_seen_rows_match() {
    let fixture = value_pool::decode(include_str!("../../reference/export-view-golden.json"));
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 96);
    for case in cases {
        let input = &case["input"];
        let rows = input["rows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| ReportRow {
                section: row["section"].as_str().unwrap().into(),
                period: row["period"].as_str().unwrap().into(),
                field: row["field"].as_str().unwrap().into(),
                value: row["value"].as_str().unwrap().into(),
            })
            .collect::<Vec<_>>();
        let document = ReportDocumentRef {
            period: input["period"].as_str().unwrap(),
            created_at: input["createdAt"].as_str().unwrap(),
            rows: &rows,
            entries: &[],
            targets: &[],
        };
        let actual = serde_json::to_value(
            report_view(&document).unwrap_or_else(|error| panic!("{}: {error}", case["id"])),
        )
        .unwrap();
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
#[test]
fn invalid_period_is_not_a_ready_display_with_invented_values() {
    for period in ["", "2026-13", "2026-1", "nope"] {
        let document = ReportDocumentRef {
            period,
            created_at: "2026-11-14T00:00:00Z",
            rows: &[],
            entries: &[],
            targets: &[],
        };
        assert!(report_view(&document).is_err());
    }
}
