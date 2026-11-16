use bigdecimal::BigDecimal;
use luna_engine::{
    calendar::recurrence::CollationRanks,
    report::core::{self, AnnualCoreError},
};
use serde_json::{Value, json};
use std::str::FromStr;
fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => {
            BigDecimal::from_str(&a.to_string()).unwrap()
                == BigDecimal::from_str(&b.to_string()).unwrap()
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len() && a.iter().all(|(k, v)| b.get(k).is_some_and(|b| same(v, b)))
        }
        _ => a == b,
    }
}
#[test]
fn full_original_timed_annual_core_matches_all_fields_and_map_order() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/annual-core-golden.json")).unwrap();
    assert_eq!(
        fixture["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 212);
    for c in fixture["cases"].as_array().unwrap() {
        let i = &c["input"];
        let ranks: CollationRanks = serde_json::from_value(i["collationRanks"].clone()).unwrap();
        let result = core::build_annual_core_report(
            i["year"].as_i64().unwrap() as i32,
            i["entries"].as_array().unwrap(),
            &i["profile"],
            &ranks,
        );
        let actual = match result {
            Ok(value) => json!({"value":value}),
            Err(e) => {
                json!({"error":{"name":match &e{AnnualCoreError::InvalidYear=>"Error",AnnualCoreError::Metrics(e)=>e.source_error_name()},"message":e.to_string()}})
            }
        };
        assert!(
            same(&actual, &c["expected"]),
            "{}\nactual={}\nexpected={}",
            c["id"],
            actual,
            c["expected"]
        );
    }
}
#[test]
fn core_never_waits_for_unrequested_target_or_catalog_sources() {
    let base = json!({"timeZone":"Europe/Berlin"});
    let mut profile = base.clone();
    profile["workingTimeTarget"] = json!({"status":"loading","context":{"days":vec![json!({"opaque":"unused target fact"});50_000]}});
    let before =
        core::build_annual_core_report(2026, &[], &base, &CollationRanks::default()).unwrap();
    let after =
        core::build_annual_core_report(2026, &[], &profile, &CollationRanks::default()).unwrap();
    assert_eq!(before, after);
    assert_eq!(after["actualMinutes"], json!(0.0));
    assert_eq!(after["targetMinutes"], Value::Null);
    assert_eq!(after["worktimeCoverageComplete"], false);
    assert_eq!(after["complianceCoverageComplete"], false);
    for year in [0, 1899, 4100, 9999] {
        assert!(matches!(
            core::build_annual_core_report(year, &[], &base, &CollationRanks::default()),
            Err(AnnualCoreError::InvalidYear)
        ));
    }
}
