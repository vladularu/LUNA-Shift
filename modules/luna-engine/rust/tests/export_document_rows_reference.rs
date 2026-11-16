mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::report::export_document::rows::{DocumentError, DocumentRows, append_report_data};
use serde_json::json;
#[test]
fn every_original_export_field_label_unit_and_row_order_is_exact() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/export-document-rows-golden.json"
    ));
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 39);
    for c in cases {
        let q = &c["input"];
        let mut rows = DocumentRows::default();
        let actual = match append_report_data(
            &mut rows,
            q["section"].as_str().unwrap(),
            q["period"].as_str().unwrap(),
            q["record"].as_str().unwrap(),
            &q["data"],
        ) {
            Ok(()) => serde_json::to_value(rows.into_rows()).unwrap(),
            Err(e) => json!({"$error":e.to_string()}),
        };
        common::assert_json_eq(&actual, &c["expected"], c["id"].as_str().unwrap());
    }
}
#[test]
fn document_output_budgets_are_explicit_and_never_publish_a_partial_success() {
    for mut rows in [
        DocumentRows::with_limits(0, 1000),
        DocumentRows::with_limits(10, 1),
    ] {
        assert_eq!(
            append_report_data(
                &mut rows,
                "Profil",
                "2026",
                "Input",
                &json!({"weeklyMinutes":2310})
            ),
            Err(DocumentError::TooLarge)
        );
        assert!(rows.as_slice().is_empty());
    }
}
