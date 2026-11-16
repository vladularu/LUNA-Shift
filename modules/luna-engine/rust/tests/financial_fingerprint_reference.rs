mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    pay::pattern::WorkPatternSettings,
    report::financial::{
        FinancialSnapshotInput,
        fingerprint::{
            FinancialFingerprintBook, FinancialFingerprintInput, LegacyFinancialView,
            StableFinancialDataSpace,
        },
        source::FinancialContext,
    },
    rules::RuleResolver,
};
use std::{collections::BTreeSet, sync::Arc};
#[test]
fn native_month_dependency_keys_follow_original_single_record_mutations() {
    let data = value_pool::decode(include_str!(
        "../../reference/financial-fingerprint-golden.json"
    ));
    let bundled = Arc::new(RuleResolver::bundled().unwrap());
    let preview = Arc::new(
        RuleResolver::new(
            serde_json::from_value(data["resolverData"]["catalog"].clone()).unwrap(),
            serde_json::from_value(data["resolverData"]["packageIds"].clone()).unwrap(),
            Some(serde_json::from_value(data["resolverData"]["historical"].clone()).unwrap()),
        )
        .unwrap(),
    );
    let cases = data["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 1008);
    for c in cases {
        let resolver = if c["resolverRef"] == "preview" {
            &preview
        } else {
            &bundled
        };
        let month = c["month"].as_str().unwrap();
        let mut keys = Vec::new();
        for (which, expected) in [("entries", "before"), ("changed", "after")] {
            let profile = Arc::new(c["profile"].clone());
            let entries = Arc::new(c[which].as_array().unwrap().clone());
            let settings: WorkPatternSettings =
                serde_json::from_value(c["settings"].clone()).unwrap();
            let decisions = Arc::new(vec![]);
            let tests = BTreeSet::new();
            let raw = FinancialSnapshotInput {
                profile: &profile,
                entries: &entries,
                tariff_decisions: &decisions,
                work_pattern_settings: &settings,
                test_months: &tests,
            };
            let mut context = FinancialContext::new(&raw, resolver).unwrap();
            let source = context.salary_month(month).unwrap();
            let actual = serde_json::json!({"pay":source.pay(),"shifts":source.shifts()});
            common::assert_json_eq(
                &actual,
                &c["expected"][expected]["value"],
                c["id"].as_str().unwrap(),
            );
            let fingerprints = FinancialFingerprintBook::new(
                StableFinancialDataSpace::new("luna:internal:offline:fixture-db").unwrap(),
                FinancialFingerprintInput {
                    profile,
                    entries,
                    tariff_decisions: decisions,
                    settings,
                    test_months: tests,
                },
                Arc::clone(resolver),
            )
            .unwrap();
            keys.push(
                fingerprints
                    .legacy_month(month, LegacyFinancialView::Salary)
                    .unwrap(),
            );
        }
        assert_eq!(
            keys[0] != keys[1],
            c["expected"]["keyMustChange"].as_bool().unwrap(),
            "{}",
            c["id"]
        );
    }
}
