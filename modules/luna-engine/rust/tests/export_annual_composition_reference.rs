mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    calendar::recurrence::CollationRanks,
    compliance::annual::AnnualComplianceSource,
    pay::pattern::WorkPatternSettings,
    report::{
        export_document::annual,
        financial::{FinancialSnapshotInput, source::FinancialContext},
        time::TimeReportContext,
    },
    runtime::catalog,
};
use serde_json::json;
use std::{collections::BTreeSet, sync::Arc};
#[test]
fn actual_export_arguments_produce_the_complete_original_annual_available_report() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/export-annual-composition-golden.json"
    ));
    let resolver = Arc::clone(catalog::compiled_preview().unwrap().resolver());
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 16);
    for c in cases {
        let q = &c["input"];
        let profile = Arc::new(q["profile"].clone());
        let entries = Arc::new(q["entries"].as_array().unwrap().clone());
        let ranks: CollationRanks =
            serde_json::from_value::<Vec<(String, u32)>>(q["collationRanks"].clone())
                .unwrap()
                .into_iter()
                .collect::<std::collections::BTreeMap<_, _>>()
                .into();
        let settings: WorkPatternSettings = serde_json::from_value(q["settings"].clone()).unwrap();
        let mut time = TimeReportContext::new(
            Arc::clone(&profile),
            Arc::clone(&entries),
            Arc::clone(&resolver),
            ranks.clone(),
        )
        .unwrap();
        let input = FinancialSnapshotInput {
            profile: &profile,
            entries: &entries,
            tariff_decisions: q["decisions"].as_array().unwrap(),
            work_pattern_settings: &settings,
            test_months: &BTreeSet::new(),
        };
        let mut financial = FinancialContext::new(&input, &resolver).unwrap();
        let checks = AnnualComplianceSource::new(
            entries.as_slice().to_vec().into(),
            Arc::clone(&profile),
            Arc::clone(&resolver),
            ranks.clone(),
            q["referenceDate"].as_str().unwrap().into(),
            q["youthProtection"].as_bool().unwrap(),
        )
        .unwrap();
        let actual = match annual::calculate(
            q["year"].as_i64().unwrap() as i32,
            &mut time,
            &mut financial,
            &checks,
            &ranks,
        ) {
            Ok(v) => v,
            Err(e) => json!({"$error":{"name":"Error","message":e.to_string()}}),
        };
        common::assert_json_eq(&actual, &c["expected"], c["id"].as_str().unwrap());
    }
}
