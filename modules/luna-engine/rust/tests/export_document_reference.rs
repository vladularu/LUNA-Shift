mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    calendar::recurrence::CollationRanks,
    pay::pattern::WorkPatternSettings,
    report::{
        export_document::{
            build::{build_artifact_document, build_report},
            model::ReportInput,
        },
        export_pdf::model::{PdfLayout, PdfOptions},
    },
    runtime::catalog,
};
use serde_json::json;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
#[test]
fn whole_original_export_reports_and_builder_failures_match_without_ts_calculation() {
    let fixture = value_pool::decode(include_str!("../../reference/export-document-golden.json"));
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 404);
    let resolver = Arc::clone(catalog::compiled_preview().unwrap().resolver());
    let artifacts: serde_json::Value = serde_json::from_str(include_str!(
        "../../reference/export-artifact-composition-golden.json"
    ))
    .unwrap();
    let mut artifact_output = vec![];
    let mut output = vec![];
    let mut first_difference = None;
    for c in cases {
        let q = &c["input"];
        let settings: WorkPatternSettings =
            serde_json::from_value(q["workPatternSettings"].clone()).unwrap();
        let ranks: CollationRanks =
            serde_json::from_value::<Vec<(String, u32)>>(q["collationRanks"].clone())
                .unwrap()
                .into_iter()
                .collect::<BTreeMap<_, _>>()
                .into();
        let tests = serde_json::from_value::<BTreeSet<String>>(q["testMonths"].clone()).unwrap();
        let input = ReportInput {
            period: q["period"].as_str().unwrap(),
            entries: Arc::new(q["entries"].as_array().unwrap().clone()),
            profile: Arc::new(q["profile"].clone()),
            tariff_decisions: q["tariffDecisions"].as_array().unwrap(),
            work_pattern_settings: &settings,
            resolver: Arc::clone(&resolver),
            collation: Arc::new(ranks),
            created_at: q["createdAt"].as_str().unwrap(),
            reference_date: q["referenceDate"].as_str().unwrap(),
            youth_protection: q["youthProtection"].as_bool().unwrap(),
            test_months: &tests,
            net_pay_timeline: q["netPayTimeline"].as_array().unwrap(),
            salary_payment_preferences: q.get("salaryPaymentPreferences"),
            net_pay_profile: q.get("netPayProfile").map(|p| Arc::new(p.clone())),
        };
        let actual = match build_report(&input) {
            Ok(value) => {
                let original = artifacts["cases"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|a| a["id"] == c["id"])
                    .unwrap();
                assert_eq!(
                    value.to_csv(16 * 1024 * 1024).unwrap(),
                    original["expectedCsv"].as_str().unwrap(),
                    "{} CSV",
                    c["id"]
                );
                let compact = build_artifact_document(&input).unwrap();
                assert_eq!(
                    compact.to_csv(16 * 1024 * 1024).unwrap(),
                    original["expectedCsv"].as_str().unwrap(),
                    "{} retained CSV",
                    c["id"]
                );
                let mut plans = vec![];
                for (layout, name) in [
                    (PdfLayout::Standard, "standard"),
                    (PdfLayout::Compact, "compact"),
                ] {
                    let options = PdfOptions {
                        layout,
                        include_salary: original["includeSalary"].as_bool().unwrap(),
                    };
                    let full = serde_json::to_value(value.pdf_plan(options).unwrap()).unwrap();
                    let reduced = serde_json::to_value(compact.pdf_plan(options).unwrap()).unwrap();
                    common::assert_json_eq(
                        &reduced,
                        &full,
                        &format!("{} {name} compact artifact fields", c["id"]),
                    );
                    plans.push(json!({"layout":name,"plan":reduced}));
                }
                let full_bytes = serde_json::to_vec(&value).unwrap().len();
                let reduced_bytes = serde_json::to_vec(&compact).unwrap().len();
                assert!(
                    reduced_bytes < full_bytes,
                    "{} private artifact selection",
                    c["id"]
                );
                artifact_output.push(json!({"id":c["id"],"plans":plans,"fullDocumentBytes":full_bytes,"artifactDocumentBytes":reduced_bytes}));
                serde_json::to_value(value).unwrap()
            }
            Err(e) => json!({"$error":{"name":e.source_error_name(),"message":e.to_string()}}),
        };
        if !equal_json(&actual, &c["expected"]) && first_difference.is_none() {
            first_difference = Some((actual.clone(), c));
        }
        output.push(json!({"id":c["id"],"actual":actual}));
    }
    if let Some(path) = std::env::var_os("LUNA_EXPORT_DOCUMENT_DUMP") {
        assert!(std::path::Path::new(&path).is_absolute());
        std::fs::write(path, serde_json::to_vec(&json!({"cases":output})).unwrap()).unwrap();
    }
    if let Some((actual, c)) = first_difference {
        if !c["expected"]["$error"].is_null() {
            common::assert_json_eq(&actual, &c["expected"], c["id"].as_str().unwrap());
        } else {
            assert!(
                actual["$error"].is_null(),
                "{}: {}",
                c["id"],
                actual["$error"]
            );
            let expected = &c["expected"];
            for key in ["period", "createdAt", "entries", "workingTimeTargets"] {
                common::assert_json_eq(&actual[key], &expected[key], &format!("{}.{key}", c["id"]));
            }
            let actual_rows = actual["rows"].as_array().unwrap();
            let expected_rows = expected["rows"].as_array().unwrap();
            for (index, (a, e)) in actual_rows.iter().zip(expected_rows).enumerate() {
                common::assert_json_eq(a, e, &format!("{}.rows[{index}]", c["id"]));
            }
            assert_eq!(
                actual_rows.len(),
                expected_rows.len(),
                "{} row count",
                c["id"]
            );
        }
    }
    if let Some(path) = std::env::var_os("LUNA_EXPORT_ARTIFACT_DUMP") {
        assert!(std::path::Path::new(&path).is_absolute());
        std::fs::write(path,serde_json::to_vec(&json!({"schemaVersion":1,"engineVersion":luna_engine::ENGINE_VERSION,"sourceFixtureSha256":artifacts["sourceSha256"],"cases":artifact_output})).unwrap()).unwrap();
    }
}
fn equal_json(a: &serde_json::Value, b: &serde_json::Value) -> bool {
    use serde_json::Value;
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => {
            use std::str::FromStr;
            bigdecimal::BigDecimal::from_str(&a.to_string()).unwrap()
                == bigdecimal::BigDecimal::from_str(&b.to_string()).unwrap()
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| equal_json(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(k, a)| b.get(k).is_some_and(|b| equal_json(a, b)))
        }
        _ => a == b,
    }
}
