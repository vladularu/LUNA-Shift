mod common;
#[path = "support/salary_snapshot.rs"]
mod salary_snapshot;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::runtime::financial_report::candidates::FinancialCandidateError;
use luna_engine::{
    contract::SalaryPerspective,
    runtime::financial_report::{candidates::FinancialCollationCandidates, presentation},
};
use serde_json::json;
use std::collections::BTreeSet;
use std::sync::Arc;

#[test]
fn structural_candidates_cover_original_s6_and_preserve_complete_detail_outputs() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/financial-candidates-golden.json"
    ));
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 264);
    for case in cases {
        let entries = case["entries"].as_array().unwrap();
        let base = case["baseCandidates"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_owned())
            .collect::<BTreeSet<_>>();
        let before = base.clone();
        let financial = FinancialCollationCandidates::prepare(entries, &base).unwrap();
        assert_eq!(base, before);
        let mut combined = base;
        combined.extend(financial.into_additional());
        for required in case["requiredComparisonStrings"].as_array().unwrap() {
            assert!(
                combined.contains(required.as_str().unwrap()),
                "{} missing {}",
                case["id"],
                required
            );
        }
        // Freeze platform locale equivalence; keep only strings enumerated by
        // the native structural preflight, never the entire source DTO.
        let mut narrowed = case.clone();
        narrowed["platformCollationRanks"]
            .as_object_mut()
            .unwrap()
            .retain(|key, _| combined.contains(key));
        let facts = salary_snapshot::facts(salary_snapshot::raw(&narrowed));
        let input = &case["input"];
        let perspective: SalaryPerspective =
            serde_json::from_value(input["perspective"].clone()).unwrap();
        let actual = presentation::details(
            &facts,
            input["month"].as_str().unwrap(),
            perspective,
            None,
            input["includeSpecialDutyPay"].as_bool().unwrap(),
        )
        .unwrap();
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}

#[test]
fn budget_and_malformed_duty_errors_preserve_the_calendar_base_without_input_echo() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/financial-candidates-golden.json"
    ));
    let case = &fixture["cases"][0];
    let entry = case["entries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["kind"] == "SHIFT")
        .unwrap()
        .clone();
    let base = BTreeSet::from(["unchanged-calendar-candidate".to_owned()]);
    let original = base.clone();
    for special in [
        json!({"kind":"SPLIT","endDay":0,"parts":vec![json!({"start":60,"end":120,"breakMinutes":0});9],"callouts":[]}),
        json!({"kind":"ON_CALL","endDay":1,"parts":[],"callouts":vec![json!({});65]}),
        json!({"kind":"private-secret","endDay":1,"parts":[],"callouts":[]}),
    ] {
        let mut raw = entry.clone();
        raw["specialDuty"] = special;
        let error = FinancialCollationCandidates::prepare(&[raw], &base)
            .err()
            .unwrap();
        assert_eq!(error, FinancialCandidateError::InvalidEntry);
        assert!(!error.to_string().contains("private-secret"));
        assert_eq!(base, original);
    }
    let full = (0..100_000)
        .map(|i| format!("calendar-{i}"))
        .collect::<BTreeSet<_>>();
    let count = full.len();
    assert_eq!(
        FinancialCollationCandidates::prepare(&[], &full).err(),
        Some(FinancialCandidateError::CandidateLimit)
    );
    assert_eq!(full.len(), count);
    let mut oversized = entry;
    oversized["id"] = json!("x".repeat(300_001));
    assert_eq!(
        FinancialCollationCandidates::prepare(&[oversized], &base).err(),
        Some(FinancialCandidateError::TextLimit)
    );
    assert_eq!(base, original);
    assert_eq!(
        FinancialCollationCandidates::prepare(&vec![serde_json::Value::Null; 100_001], &base).err(),
        Some(FinancialCandidateError::InputLimit)
    );
    let large = (0..120)
        .map(|i| format!("{i:04}{}", "x".repeat(299_996)))
        .collect::<BTreeSet<_>>();
    assert_eq!(
        FinancialCollationCandidates::prepare(&[], &large).err(),
        Some(FinancialCandidateError::TextLimit)
    );
    // No financial operation has touched this independent, usable calendar.
    let facts = salary_snapshot::facts(salary_snapshot::raw(case));
    assert!(facts.calendar().is_ok());
}

#[test]
fn fifty_thousand_sources_share_private_metadata_and_retain_only_bounded_sort_strings() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/financial-candidates-golden.json"
    ));
    let mut entry = fixture["cases"][0]["entries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["kind"] == "SHIFT")
        .unwrap()
        .clone();
    entry["specialDuty"] = serde_json::Value::Null;
    let mut entries = (0..50_000)
        .map(|i| {
            let mut raw = entry.clone();
            raw["id"] = json!(format!("native-row-{i}"));
            raw
        })
        .collect::<Vec<_>>();
    entries[0]["futureMetadata"] =
        json!({"largePrivateContext":vec!["private-never-a-sort-key";50_000]});
    let source = Arc::new(entries);
    let weak = Arc::downgrade(&source);
    let metadata = source[0]["futureMetadata"].as_object().unwrap() as *const _;
    let base = BTreeSet::new();
    let result = FinancialCollationCandidates::prepare(source.as_slice(), &base).unwrap();
    assert_eq!(
        metadata,
        source[0]["futureMetadata"].as_object().unwrap() as *const _
    );
    assert!(result.total_count() >= 50_000 && result.total_count() < 51_000);
    assert!(result.rank_wire_upper_bound() <= 33_554_432);
    assert!(result.additional().contains("native-row-49999"));
    assert!(
        !result
            .additional()
            .iter()
            .any(|v| v.contains("private-never"))
    );
    drop(source);
    assert!(weak.upgrade().is_none());
    assert!(result.additional().contains("native-row-0"));
}
