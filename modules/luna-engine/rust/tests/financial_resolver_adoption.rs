mod common;
use luna_engine::{
    net::{
        payment_schedule::validate_salary_payment_preferences, settings::resolve_net_pay_settings,
    },
    pay::pattern::WorkPatternSettings,
    report::financial::{
        FinancialSnapshotInput,
        annual_salary::annual_salary_proposal_result,
        net::{PaymentNetPreparation, annual_net_pay, prepare_automatic_net_pay},
        source::FinancialContext,
    },
    rules::{HistoricalCatalog, PackageIds, RulePackage, RuleResolutionFailure, RuleResolver},
};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
fn selection(result: Result<&RulePackage, RuleResolutionFailure>) -> Value {
    match result {
        Ok(package) => {
            json!({"ok":true,"packageId":package.package_id,"versionId":package.version_id})
        }
        Err(error) => json!({"ok":false,"error":error}),
    }
}
fn attempt<T: serde::Serialize>(
    result: Result<T, luna_engine::report::financial::FinancialError>,
) -> Value {
    match result {
        Ok(value) => serde_json::to_value(value).unwrap(),
        Err(error) => json!({"$error":error.to_string()}),
    }
}
#[test]
fn actual_preview_catalog_and_equal_custom_catalog_preserve_full_financial_results() {
    let specs: Value =
        serde_json::from_str(include_str!("../../reference/financial-resolvers.json")).unwrap();
    assert_eq!(specs["previewGeneration"], 6);
    let mut resolvers = BTreeMap::new();
    for spec in specs["resolvers"].as_array().unwrap() {
        assert_eq!(
            spec["sourceValidation"]["valid"], true,
            "every synthetic adoption catalog must pass the original complete package validator"
        );
        let ids: PackageIds = serde_json::from_value(spec["packageIds"].clone()).unwrap();
        let historical: Option<HistoricalCatalog> = spec
            .get("historical")
            .map(|value| serde_json::from_value(value.clone()).unwrap());
        let resolver =
            RuleResolver::from_catalog_json(spec["catalog"].clone(), ids, historical).unwrap();
        assert!(
            !resolver.is_bundled(),
            "Embedded reviewed and equal custom catalogs must not claim compiled bundled origin"
        );
        for expected in spec["selection"].as_array().unwrap() {
            let date = expected["date"].as_str().unwrap();
            let actual = json!({"date":date,"tariff":selection(resolver.resolve_tariff(date,None)),"legal":selection(resolver.resolve_legal(date)),"holiday":selection(resolver.resolve_holiday(date))});
            common::assert_json_eq(&actual, expected, spec["id"].as_str().unwrap());
        }
        resolvers.insert(spec["id"].as_str().unwrap(), Arc::new(resolver));
    }
    assert!(RuleResolver::bundled().unwrap().is_bundled());
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/financial-resolver-adoption-golden.json"
    ))
    .unwrap();
    assert_eq!(data["cases"].as_array().unwrap().len(), 660);
    for case in data["cases"].as_array().unwrap() {
        let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let profile = Arc::new(input["profile"].clone());
        let entries = Arc::new(input["entries"].as_array().unwrap().clone());
        let tests: BTreeSet<String> = serde_json::from_value(input["testMonths"].clone()).unwrap();
        let pattern: WorkPatternSettings =
            serde_json::from_value(input["workPatternSettings"].clone()).unwrap();
        let raw = FinancialSnapshotInput {
            profile: &profile,
            entries: &entries,
            tariff_decisions: input["tariffDecisions"].as_array().unwrap(),
            work_pattern_settings: &pattern,
            test_months: &tests,
        };
        let resolver = &resolvers[case["resolverId"].as_str().unwrap()];
        let mut context: FinancialContext<'static> =
            FinancialContext::new_shared(&raw, Arc::clone(resolver)).unwrap();
        let month = input["month"].as_str().unwrap();
        let year = input["year"].as_i64().unwrap() as i32;
        let timeline = input["timeline"].as_array().unwrap();
        let preferences = validate_salary_payment_preferences(&input["preferences"]).unwrap();
        let perspective = serde_json::from_value(input["perspective"].clone()).unwrap();
        let source = attempt(context.salary_month(month));
        let projection = attempt(context.salary_projection(month, &preferences, perspective));
        let proposal = attempt(annual_salary_proposal_result(year, &mut context));
        let report = attempt(annual_net_pay(
            year,
            timeline,
            &preferences,
            &mut context,
            perspective,
        ));
        let mut forecasts = vec![];
        for forecast in case["expected"]["forecasts"].as_array().unwrap() {
            let month = forecast["month"].as_str().unwrap();
            let selected = resolve_net_pay_settings(month, timeline).unwrap();
            let payment = PaymentNetPreparation {
                preferences: &preferences,
                perspective,
                source_settings: timeline,
                projection: None,
            };
            forecasts.push(json!({"month":month,"result":prepare_automatic_net_pay(month,&selected["settings"],&mut context,Some(&payment))}));
        }
        let actual = json!({"source":source,"projection":projection,"proposal":proposal,"report":report,"forecasts":forecasts});
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
