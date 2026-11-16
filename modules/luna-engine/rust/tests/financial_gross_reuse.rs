mod common;
use luna_engine::{
    net::payment_schedule::validate_salary_payment_preferences,
    net::provider::reuse::SharedGrossReuseCache,
    pay::pattern::WorkPatternSettings,
    report::financial::{
        FinancialSnapshotInput, fingerprint::StableFinancialDataSpace, source::FinancialContext,
    },
    rules::RuleResolver,
};
use serde_json::{Value, json};
use std::{collections::BTreeSet, sync::Arc};
fn context(
    input: &Value,
    resolver: Arc<RuleResolver>,
    cache: Arc<SharedGrossReuseCache>,
    space: &str,
) -> FinancialContext<'static> {
    let profile = Arc::new(input["profile"].clone());
    let entries = Arc::new(input["entries"].as_array().unwrap().clone());
    let settings: WorkPatternSettings =
        serde_json::from_value(input["workPatternSettings"].clone()).unwrap();
    let tests: BTreeSet<String> = serde_json::from_value(input["testMonths"].clone()).unwrap();
    FinancialContext::new_shared_with_reuse(
        &FinancialSnapshotInput {
            profile: &profile,
            entries: &entries,
            tariff_decisions: input["tariffDecisions"].as_array().unwrap(),
            work_pattern_settings: &settings,
            test_months: &tests,
        },
        resolver,
        StableFinancialDataSpace::new(space).unwrap(),
        cache,
    )
    .unwrap()
}
#[test]
fn independent_equal_snapshots_reuse_money_without_old_source_owners() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/financial-source-golden.json")).unwrap();
    let case = &fixture["cases"][0];
    let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
    let resolver = Arc::new(RuleResolver::bundled().unwrap());
    let cache = Arc::new(SharedGrossReuseCache::new());
    let month = input["month"].as_str().unwrap();
    let mut first = context(
        &input,
        Arc::clone(&resolver),
        Arc::clone(&cache),
        "luna:internal:offline:reuse-db",
    );
    let firstsource = first.salary_month(month).unwrap();
    common::assert_json_eq(
        &serde_json::to_value(firstsource).unwrap(),
        &case["expected"]["source"],
        "first snapshot",
    );
    assert_eq!(first.reuse_diagnostics()["raw"]["nativePricingPasses"], 1);
    let mut next = context(&input, resolver, cache, "luna:internal:offline:reuse-db");
    let secondsource = next.salary_month(month).unwrap();
    common::assert_json_eq(
        &serde_json::to_value(secondsource).unwrap(),
        &case["expected"]["source"],
        "fresh equal snapshot",
    );
    assert_eq!(
        next.reuse_diagnostics()["raw"]["nativePricingPasses"],
        0,
        "equal fresh snapshot must not price again"
    );
}

#[test]
fn all_original_source_and_payout_outputs_survive_cross_snapshot_sharing() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/financial-source-golden.json")).unwrap();
    let resolver = Arc::new(RuleResolver::bundled().unwrap());
    let cache = Arc::new(SharedGrossReuseCache::new());
    for case in fixture["cases"].as_array().unwrap() {
        let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        for _ in 0..2 {
            let mut context = context(
                &input,
                Arc::clone(&resolver),
                Arc::clone(&cache),
                "luna:internal:offline:all-source-db",
            );
            let actual = (|| {
                let month = input["month"].as_str().unwrap();
                let source = context.salary_month(month)?;
                let preferences =
                    validate_salary_payment_preferences(&input["preferences"]).unwrap();
                let projection = context.salary_projection(
                    month,
                    &preferences,
                    serde_json::from_value(input["perspective"].clone()).unwrap(),
                )?;
                Ok::<_, luna_engine::report::financial::FinancialError>(
                    json!({"source":source,"projection":projection}),
                )
            })()
            .unwrap_or_else(|error| json!({"$error":error.to_string()}));
            common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
        }
    }
    let stats = cache.stats().unwrap();
    assert!(
        stats.hits > 1_000,
        "expected real sharing across original valid sources"
    );
    assert!(stats.entries <= 48 && stats.retained_serialized_bytes <= 16 * 1024 * 1024);
}

#[path = "support/value_pool.rs"]
mod value_pool;
#[test]
fn original_single_record_mutations_reprice_only_real_dependent_months() {
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
    for case in data["cases"].as_array().unwrap() {
        let resolver = if case["resolverRef"] == "preview" {
            &preview
        } else {
            &bundled
        };
        let cache = Arc::new(SharedGrossReuseCache::new());
        for (index, (entries, expected)) in [("entries", "before"), ("changed", "after")]
            .iter()
            .enumerate()
        {
            let input = json!({"profile":case["profile"],"entries":case[entries],"workPatternSettings":case["settings"],"tariffDecisions":[],"testMonths":[]});
            let mut current = context(
                &input,
                Arc::clone(resolver),
                Arc::clone(&cache),
                "luna:internal:offline:mutation-db",
            );
            let source = current
                .salary_month(case["month"].as_str().unwrap())
                .unwrap();
            common::assert_json_eq(
                &json!({"pay":source.pay(),"shifts":source.shifts()}),
                &case["expected"][expected]["value"],
                case["id"].as_str().unwrap(),
            );
            let should_price = index == 0 || case["expected"]["keyMustChange"] == true;
            assert_eq!(
                current.reuse_diagnostics()["raw"]["nativePricingPasses"],
                json!(if should_price { 1 } else { 0 }),
                "{}",
                case["id"]
            );
        }
    }
}

#[test]
fn shared_cores_never_retain_or_replay_target_rich_source_metadata() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/financial-source-golden.json")).unwrap();
    let input: Value =
        serde_json::from_str(fixture["cases"][0]["inputJson"].as_str().unwrap()).unwrap();
    let resolver = Arc::new(RuleResolver::bundled().unwrap());
    let cache = Arc::new(SharedGrossReuseCache::new());
    let month = input["month"].as_str().unwrap();
    let mut first = context(
        &input,
        Arc::clone(&resolver),
        Arc::clone(&cache),
        "luna:internal:offline:metadata-db",
    );
    let first_pay = first.salary_month(month).unwrap().pay().clone();
    drop(first);
    let mut target = input.clone();
    target["profile"]["workingTimeTarget"] = json!({"facts":(0..50_000).map(|index|json!({"id":index,"minutes":480})).collect::<Vec<_>>()});
    let mut current = context(
        &target,
        Arc::clone(&resolver),
        Arc::clone(&cache),
        "luna:internal:offline:metadata-db",
    );
    let weak = Arc::downgrade(current.profile());
    let source = current.salary_month(month).unwrap();
    assert_eq!(source.pay(), &first_pay);
    assert_eq!(current.reuse_diagnostics()["raw"]["nativePricingPasses"], 0);
    assert!(
        std::ptr::eq(
            &source.profile()["workingTimeTarget"],
            &current.profile()["workingTimeTarget"]
        ),
        "metadata must reference this snapshot rather than a cached profile"
    );
    drop(source);
    drop(current);
    assert!(
        weak.upgrade().is_none(),
        "shared cores must release the raw snapshot"
    );
    let mut other = context(&input, resolver, cache, "luna:internal:offline:other-db");
    assert_eq!(other.salary_month(month).unwrap().pay(), &first_pay);
    assert_eq!(
        other.reuse_diagnostics()["raw"]["nativePricingPasses"],
        1,
        "foreign data space must price independently"
    );
}

#[test]
fn native_reused_gross_and_sfn_traces_preserve_full_earned_and_cash_net_years() {
    use luna_engine::{
        net::settings::resolve_net_pay_settings,
        report::financial::net::{
            PaymentNetPreparation, annual_net_pay, prepare_automatic_net_pay,
        },
    };
    let data: Value =
        serde_json::from_str(include_str!("../../reference/financial-net-golden.json")).unwrap();
    let resolver = Arc::new(RuleResolver::bundled().unwrap());
    let cache = Arc::new(SharedGrossReuseCache::new());
    for case in data["cases"].as_array().unwrap() {
        let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        for _ in 0..2 {
            let mut context = context(
                &input,
                Arc::clone(&resolver),
                Arc::clone(&cache),
                "luna:internal:offline:net-db",
            );
            let timeline = input["timeline"].as_array().unwrap();
            let preferences = validate_salary_payment_preferences(&input["preferences"]).unwrap();
            let perspective = serde_json::from_value(input["perspective"].clone()).unwrap();
            let actual=(||{
                let report=annual_net_pay(input["year"].as_i64().unwrap() as i32,timeline,&preferences,&mut context,perspective)?;
                let mut forecasts=vec![];
                for forecast in case["expected"]["forecasts"].as_array().unwrap(){let month=forecast["month"].as_str().unwrap();let selected=resolve_net_pay_settings(month,timeline).unwrap();let payment=PaymentNetPreparation{preferences:&preferences,perspective,source_settings:timeline,projection:None};forecasts.push(json!({"month":month,"result":prepare_automatic_net_pay(month,&selected["settings"],&mut context,Some(&payment))}));}
                Ok::<_,luna_engine::report::financial::FinancialError>(json!({"report":report,"forecasts":forecasts}))
            })().unwrap_or_else(|error|json!({"$error":error.to_string()}));
            common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
        }
    }
    assert!(cache.stats().unwrap().hits > 1000);
}
