mod common;
use luna_engine::{
    net::{
        payment_schedule::validate_salary_payment_preferences,
        provider::reuse::SharedGrossReuseCache, settings::resolve_net_pay_settings,
    },
    pay::pattern::WorkPatternSettings,
    report::financial::{
        FinancialSnapshotInput,
        fingerprint::StableFinancialDataSpace,
        net::{PaymentNetPreparation, prepare_automatic_net_pay, reuse::SharedNetReuseCache},
        source::FinancialContext,
    },
    rules::RuleResolver,
};
use serde_json::{Value, json};
use std::{collections::BTreeSet, sync::Arc};
fn context(
    input: &Value,
    resolver: Arc<RuleResolver>,
    gross: Arc<SharedGrossReuseCache>,
    net: Arc<SharedNetReuseCache>,
) -> FinancialContext<'static> {
    let profile = Arc::new(input["profile"].clone());
    let entries = Arc::new(input["entries"].as_array().unwrap().clone());
    let settings: WorkPatternSettings =
        serde_json::from_value(input["workPatternSettings"].clone()).unwrap();
    let tests: BTreeSet<String> = serde_json::from_value(input["testMonths"].clone()).unwrap();
    let mut context = FinancialContext::new_shared_with_reuse(
        &FinancialSnapshotInput {
            profile: &profile,
            entries: &entries,
            tariff_decisions: input["tariffDecisions"].as_array().unwrap(),
            work_pattern_settings: &settings,
            test_months: &tests,
        },
        resolver,
        StableFinancialDataSpace::new("luna:internal:offline:net-reuse-db").unwrap(),
        gross,
    )
    .unwrap();
    context.enable_shared_net_reuse(net);
    context
}
#[test]
fn identical_fresh_snapshots_reuse_complete_native_net_without_tax_or_sfn_work() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/financial-net-golden.json")).unwrap();
    let case = data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| {
            case["expected"]["forecasts"]
                .as_array()
                .is_some_and(|forecasts| {
                    forecasts
                        .iter()
                        .any(|forecast| forecast["result"]["result"]["status"] == "available")
                })
        })
        .unwrap();
    let forecast = case["expected"]["forecasts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|forecast| forecast["result"]["result"]["status"] == "available")
        .unwrap();
    let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
    let resolver = Arc::new(RuleResolver::bundled().unwrap());
    let gross = Arc::new(SharedGrossReuseCache::new());
    let net = Arc::new(SharedNetReuseCache::new());
    let month = forecast["month"].as_str().unwrap();
    let timeline = input["timeline"].as_array().unwrap();
    let preferences = validate_salary_payment_preferences(&input["preferences"]).unwrap();
    let perspective = serde_json::from_value(input["perspective"].clone()).unwrap();
    let settings = resolve_net_pay_settings(month, timeline).unwrap();
    let payment = PaymentNetPreparation {
        preferences: &preferences,
        perspective,
        source_settings: timeline,
        projection: None,
    };
    for index in 0..2 {
        let mut current = context(
            &input,
            Arc::clone(&resolver),
            Arc::clone(&gross),
            Arc::clone(&net),
        );
        let actual =
            prepare_automatic_net_pay(month, &settings["settings"], &mut current, Some(&payment));
        common::assert_json_eq(&actual, &forecast["result"], "native net cache");
        assert_eq!(
            current.reuse_diagnostics()["nativeNetPasses"],
            if index == 0 { 1 } else { 0 },
            "fresh equal snapshot must skip native SFN and net calculation"
        );
    }
}

fn full_output(case: &Value, input: &Value, context: &mut FinancialContext<'_>) -> Value {
    use luna_engine::report::financial::net::annual_net_pay;
    let timeline = input["timeline"].as_array().unwrap();
    let preferences = validate_salary_payment_preferences(&input["preferences"]).unwrap();
    let perspective = serde_json::from_value(input["perspective"].clone()).unwrap();
    (||{let report=annual_net_pay(input["year"].as_i64().unwrap() as i32,timeline,&preferences,context,perspective)?;let mut forecasts=vec![];for forecast in case["expected"]["forecasts"].as_array().unwrap(){let month=forecast["month"].as_str().unwrap();let saved=resolve_net_pay_settings(month,timeline).unwrap();let payment=PaymentNetPreparation{preferences:&preferences,perspective,source_settings:timeline,projection:None};forecasts.push(json!({"month":month,"result":prepare_automatic_net_pay(month,&saved["settings"],context,Some(&payment))}));}Ok::<_,luna_engine::report::financial::FinancialError>(json!({"report":report,"forecasts":forecasts}))})().unwrap_or_else(|error|json!({"$error":error.to_string()}))
}
#[test]
fn all_original_full_net_years_and_months_remain_exact_through_shared_result_reuse() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/financial-net-golden.json")).unwrap();
    let resolver = Arc::new(RuleResolver::bundled().unwrap());
    let gross = Arc::new(SharedGrossReuseCache::new());
    let net = Arc::new(SharedNetReuseCache::new());
    for case in data["cases"].as_array().unwrap() {
        let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        for _ in 0..2 {
            let mut current = context(
                &input,
                Arc::clone(&resolver),
                Arc::clone(&gross),
                Arc::clone(&net),
            );
            let actual = full_output(case, &input, &mut current);
            common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
        }
    }
    let stats = net.stats().unwrap();
    assert!(stats.hits > 1_000);
    assert!(stats.entries <= 96 && stats.retained_serialized_bytes <= 16 * 1024 * 1024);
}

#[path = "support/value_pool.rs"]
mod value_pool;
#[test]
fn duty_tax_lag_annual_basis_and_test_month_mutations_match_original_complete_years() {
    let data = value_pool::decode(include_str!("../../reference/net-reuse-golden.json"));
    let resolver = Arc::new(RuleResolver::bundled().unwrap());
    for case in data["cases"].as_array().unwrap() {
        let gross = Arc::new(SharedGrossReuseCache::new());
        let net = Arc::new(SharedNetReuseCache::new());
        for (which, expected) in [("inputJson", "before"), ("changedJson", "after")] {
            let input: Value = serde_json::from_str(case[which].as_str().unwrap()).unwrap();
            let mut current = context(
                &input,
                Arc::clone(&resolver),
                Arc::clone(&gross),
                Arc::clone(&net),
            );
            let expected_case = json!({"expected":case[expected]});
            let actual = full_output(&expected_case, &input, &mut current);
            common::assert_json_eq(&actual, &case[expected], case["id"].as_str().unwrap());
        }
        // Unavailable forecasts are deliberately not retained. Require genuine
        // neighboring hits where the original year has ample available months.
        if case["mutation"] == "april-end"
            && case["before"]["report"]["availableMonthCount"]
                .as_u64()
                .unwrap_or(0)
                >= 6
        {
            assert!(
                net.stats().unwrap().hits > 0,
                "unchanged real neighbor months must survive a duty edit: {}",
                case["id"]
            );
        }
    }
}

#[test]
fn target_context_changes_reuse_net_without_retaining_raw_owners() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/financial-net-golden.json")).unwrap();
    let case = data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| {
            case["expected"]["forecasts"].as_array().is_some_and(|fs| {
                fs.iter()
                    .any(|f| f["result"]["result"]["status"] == "available")
            })
        })
        .unwrap();
    let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
    let resolver = Arc::new(RuleResolver::bundled().unwrap());
    let gross = Arc::new(SharedGrossReuseCache::new());
    let net = Arc::new(SharedNetReuseCache::new());
    let mut first = context(
        &input,
        Arc::clone(&resolver),
        Arc::clone(&gross),
        Arc::clone(&net),
    );
    let before = full_output(case, &input, &mut first);
    drop(first);
    let mut changed = input.clone();
    changed["profile"]["workingTimeTarget"] = json!({"facts":(0..50_000).map(|index|json!({"id":index,"minutes":480})).collect::<Vec<_>>()});
    let mut current = context(&changed, resolver, gross, net);
    let weak = Arc::downgrade(current.profile());
    let actual = full_output(case, &changed, &mut current);
    common::assert_json_eq(&actual, &before, "target-only change");
    assert_eq!(current.reuse_diagnostics()["nativeNetPasses"], 0);
    assert_eq!(
        current.diagnostics()["raw"]["profiles"]["fullProfileSerializations"],
        0
    );
    assert_eq!(
        current.diagnostics()["raw"]["profiles"]["fullProfileMaterializations"],
        0
    );
    drop(current);
    assert!(weak.upgrade().is_none());
}

#[test]
fn supplied_mutable_cash_projection_keeps_its_original_native_validation() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/financial-net-golden.json")).unwrap();
    let case = data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| {
            case["id"].as_str().unwrap().ends_with("PAYOUT")
                && case["expected"]["forecasts"].as_array().is_some_and(|fs| {
                    fs.iter()
                        .any(|f| f["result"]["result"]["status"] == "available")
                })
        })
        .unwrap();
    let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
    let forecast = case["expected"]["forecasts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["result"]["result"]["status"] == "available")
        .unwrap();
    let month = forecast["month"].as_str().unwrap();
    let timeline = input["timeline"].as_array().unwrap();
    let preferences = validate_salary_payment_preferences(&input["preferences"]).unwrap();
    let settings = resolve_net_pay_settings(month, timeline).unwrap();
    let resolver = Arc::new(RuleResolver::bundled().unwrap());
    let gross = Arc::new(SharedGrossReuseCache::new());
    let net = Arc::new(SharedNetReuseCache::new());
    let mut first = context(
        &input,
        Arc::clone(&resolver),
        Arc::clone(&gross),
        Arc::clone(&net),
    );
    let payment = PaymentNetPreparation {
        preferences: &preferences,
        perspective: luna_engine::net::payment_schedule::SalaryPerspective::Payout,
        source_settings: timeline,
        projection: None,
    };
    let warm = prepare_automatic_net_pay(month, &settings["settings"], &mut first, Some(&payment));
    assert_eq!(warm["result"]["status"], "available");
    let mut current = context(&input, resolver, gross, Arc::clone(&net));
    let mut projection = current
        .salary_projection(month, &preferences, payment.perspective)
        .unwrap();
    projection.available = false;
    projection.pay["available"] = json!(false);
    let supplied = PaymentNetPreparation {
        projection: Some(&projection),
        ..payment
    };
    let hits = net.stats().unwrap().hits;
    let result =
        prepare_automatic_net_pay(month, &settings["settings"], &mut current, Some(&supplied));
    assert_eq!(result["result"]["status"], "unavailable");
    assert_eq!(current.reuse_diagnostics()["nativeNetPasses"], 1);
    assert_eq!(
        net.stats().unwrap().hits,
        hits,
        "supplied projection must not consume a shared ready result"
    );
}

#[test]
fn actual_preview_equal_custom_and_missing_future_catalogs_keep_complete_native_outputs() {
    use luna_engine::{
        report::financial::{annual_salary::annual_salary_proposal_result, net::annual_net_pay},
        rules::{HistoricalCatalog, PackageIds},
    };
    fn attempt<T: serde::Serialize>(
        value: Result<T, luna_engine::report::financial::FinancialError>,
    ) -> Value {
        value
            .map(|v| serde_json::to_value(v).unwrap())
            .unwrap_or_else(|e| json!({"$error":e.to_string()}))
    }
    let specs: Value =
        serde_json::from_str(include_str!("../../reference/financial-resolvers.json")).unwrap();
    let mut resolvers = std::collections::BTreeMap::new();
    for spec in specs["resolvers"].as_array().unwrap() {
        let ids: PackageIds = serde_json::from_value(spec["packageIds"].clone()).unwrap();
        let historical: Option<HistoricalCatalog> = spec
            .get("historical")
            .map(|v| serde_json::from_value(v.clone()).unwrap());
        resolvers.insert(
            spec["id"].as_str().unwrap(),
            Arc::new(
                RuleResolver::from_catalog_json(spec["catalog"].clone(), ids, historical).unwrap(),
            ),
        );
    }
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/financial-resolver-adoption-golden.json"
    ))
    .unwrap();
    let gross = Arc::new(SharedGrossReuseCache::new());
    let net = Arc::new(SharedNetReuseCache::new());
    for case in data["cases"].as_array().unwrap() {
        let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let resolver = &resolvers[case["resolverId"].as_str().unwrap()];
        for _ in 0..2 {
            let mut current = context(
                &input,
                Arc::clone(resolver),
                Arc::clone(&gross),
                Arc::clone(&net),
            );
            let month = input["month"].as_str().unwrap();
            let year = input["year"].as_i64().unwrap() as i32;
            let timeline = input["timeline"].as_array().unwrap();
            let preferences = validate_salary_payment_preferences(&input["preferences"]).unwrap();
            let perspective = serde_json::from_value(input["perspective"].clone()).unwrap();
            let source = attempt(current.salary_month(month));
            let projection = attempt(current.salary_projection(month, &preferences, perspective));
            let proposal = attempt(annual_salary_proposal_result(year, &mut current));
            let report = attempt(annual_net_pay(
                year,
                timeline,
                &preferences,
                &mut current,
                perspective,
            ));
            let mut forecasts = vec![];
            for forecast in case["expected"]["forecasts"].as_array().unwrap() {
                let month = forecast["month"].as_str().unwrap();
                let saved = resolve_net_pay_settings(month, timeline).unwrap();
                let payment = PaymentNetPreparation {
                    preferences: &preferences,
                    perspective,
                    source_settings: timeline,
                    projection: None,
                };
                forecasts.push(json!({"month":month,"result":prepare_automatic_net_pay(month,&saved["settings"],&mut current,Some(&payment))}));
            }
            common::assert_json_eq(
                &json!({"source":source,"projection":projection,"proposal":proposal,"report":report,"forecasts":forecasts}),
                &case["expected"],
                case["id"].as_str().unwrap(),
            );
        }
    }
    assert!(net.stats().unwrap().hits > 100);
}
