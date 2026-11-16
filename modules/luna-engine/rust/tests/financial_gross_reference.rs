mod common;
use luna_engine::{
    net::annual_payment::validate_annual_salary_payments,
    pay::pattern::WorkPatternSettings,
    report::financial::{
        FinancialSnapshotInput,
        gross::{annual_legacy_financial_report, with_annual_salary_payments},
        source::FinancialContext,
    },
    rules::{HistoricalCatalog, PackageIds, RuleResolver},
};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
#[test]
fn annual_money_subset_and_one_off_application_match_original_full_reports() {
    let specs: Value =
        serde_json::from_str(include_str!("../../reference/financial-resolvers.json")).unwrap();
    let mut resolvers = BTreeMap::new();
    for spec in specs["resolvers"].as_array().unwrap() {
        let ids: PackageIds = serde_json::from_value(spec["packageIds"].clone()).unwrap();
        let history: Option<HistoricalCatalog> = spec
            .get("historical")
            .map(|v| serde_json::from_value(v.clone()).unwrap());
        resolvers.insert(
            spec["id"].as_str().unwrap(),
            RuleResolver::from_catalog_json(spec["catalog"].clone(), ids, history).unwrap(),
        );
    }
    resolvers.insert("bundled", RuleResolver::bundled().unwrap());
    let data: Value =
        serde_json::from_str(include_str!("../../reference/financial-gross-golden.json")).unwrap();
    assert_eq!(data["cases"].as_array().unwrap().len(), 112);
    for case in data["cases"].as_array().unwrap() {
        let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let profile = Arc::new(input["profile"].clone());
        let entries = Arc::new(input["entries"].as_array().unwrap().clone());
        let pattern: WorkPatternSettings =
            serde_json::from_value(input["workPatternSettings"].clone()).unwrap();
        let tests: BTreeSet<String> = serde_json::from_value(input["testMonths"].clone()).unwrap();
        let raw = FinancialSnapshotInput {
            profile: &profile,
            entries: &entries,
            tariff_decisions: input["tariffDecisions"].as_array().unwrap(),
            work_pattern_settings: &pattern,
            test_months: &tests,
        };
        let resolver = &resolvers[case["resolverId"].as_str().unwrap()];
        let mut context = FinancialContext::new(&raw, resolver).unwrap();
        let year = input["year"].as_i64().unwrap() as i32;
        let actual = (|| {
            let base = annual_legacy_financial_report(year, &mut context)?;
            let before = context.diagnostics();
            let repeated = annual_legacy_financial_report(year, &mut context)?;
            assert_eq!(
                context.diagnostics(),
                before,
                "unchanged gross report repriced months"
            );
            common::assert_json_eq(
                &serde_json::to_value(&base).unwrap(),
                &serde_json::to_value(repeated).unwrap(),
                "unchanged gross report",
            );
            let mut payments = vec![];
            for variant in case["expected"]["payments"].as_array().unwrap() {
                let input = &variant["payments"];
                let supplied = validate_annual_salary_payments(input).unwrap();
                let report = with_annual_salary_payments(&base, &[], Some(&supplied))?;
                let repeated = with_annual_salary_payments(&report, &[], Some(&supplied))?;
                let removed = with_annual_salary_payments(&report, &[], Some(&[]))?;
                payments.push(
                    json!({"payments":input,"report":report,"repeated":repeated,"removed":removed}),
                );
            }
            Ok::<_, luna_engine::report::financial::FinancialError>(
                json!({"base":base,"payments":payments}),
            )
        })()
        .unwrap_or_else(|error| json!({"$error":error.to_string()}));
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
