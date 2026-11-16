mod common;
use luna_engine::{
    net::payment_schedule::validate_salary_payment_preferences,
    pay::pattern::WorkPatternSettings,
    report::financial::{FinancialSnapshotInput, source::FinancialContext},
    rules::RuleResolver,
};
use serde_json::{Value, json};
use std::{collections::BTreeSet, sync::Arc};

#[test]
fn exact_salary_hook_windows_test_months_and_fixed_only_timing_use_native_money() {
    let reference: Value =
        serde_json::from_str(include_str!("../../reference/financial-source-golden.json")).unwrap();
    let resolver = RuleResolver::bundled().unwrap();
    let cases = reference["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 1861);
    for case in cases {
        let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let profile = Arc::new(input["profile"].clone());
        let entries = Arc::new(input["entries"].as_array().unwrap().clone());
        let decisions = input["tariffDecisions"].as_array().unwrap();
        let pattern: WorkPatternSettings =
            serde_json::from_value(input["workPatternSettings"].clone()).unwrap();
        let tests: BTreeSet<String> = serde_json::from_value(input["testMonths"].clone()).unwrap();
        let raw = FinancialSnapshotInput {
            profile: &profile,
            entries: &entries,
            tariff_decisions: decisions,
            work_pattern_settings: &pattern,
            test_months: &tests,
        };
        let actual = (|| {
            let mut context = FinancialContext::new(&raw, &resolver)?;
            let month = input["month"].as_str().unwrap();
            let source = context.salary_month(month)?;
            let preferences = validate_salary_payment_preferences(&input["preferences"]).unwrap();
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

#[test]
fn owned_context_outlives_assembler_inputs_and_releases_its_resolver() {
    fn requires_send_sync<T: Send + Sync>() {}
    requires_send_sync::<FinancialContext<'static>>();
    let data: Value =
        serde_json::from_str(include_str!("../../reference/financial-source-golden.json")).unwrap();
    let case = &data["cases"][0];
    let resolver = Arc::new(RuleResolver::bundled().unwrap());
    let weak = Arc::downgrade(&resolver);
    let mut context: FinancialContext<'static> = {
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
        FinancialContext::new_shared(&raw, Arc::clone(&resolver)).unwrap()
    };
    drop(resolver);
    assert!(weak.upgrade().is_some());
    let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
    let month = input["month"].as_str().unwrap();
    let first = context.salary_month(month).unwrap();
    common::assert_json_eq(
        &serde_json::to_value(first).unwrap(),
        &case["expected"]["source"],
        "owned source",
    );
    let before = context.diagnostics();
    let second = context.salary_month(month).unwrap();
    assert_eq!(context.diagnostics(), before);
    common::assert_json_eq(
        &serde_json::to_value(second).unwrap(),
        &case["expected"]["source"],
        "next independent month job",
    );
    drop(context);
    assert!(
        weak.upgrade().is_none(),
        "resolver must be released with the owned snapshot"
    );
}

#[test]
fn fifty_thousand_target_facts_are_shared_across_month_year_and_projection_cache_jobs() {
    use luna_engine::{
        net::payment_schedule::SalaryPerspective,
        net::settings::resolve_net_pay_settings,
        report::financial::net::{
            PaymentNetPreparation, annual_net_pay, prepare_automatic_net_pay,
        },
    };
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/financial-resolver-adoption-golden.json"
    ))
    .unwrap();
    let case = data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["id"] == "preview-generation-6-legacy-2026-EARNED-0")
        .unwrap();
    let mut input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
    // Opaque loaded target context: financial policies must not inspect/copy its
    // factual payload. Target/credit paths retain this original profile Arc.
    input["profile"]["workingTimeTarget"] = json!({"facts":(0..50_000).map(|index|json!({"id":index,"date":"2026-01-01","minutes":480})).collect::<Vec<_>>()});
    let profile = Arc::new(input["profile"].clone());
    let entries = Arc::new(input["entries"].as_array().unwrap().clone());
    let pattern: WorkPatternSettings =
        serde_json::from_value(input["workPatternSettings"].clone()).unwrap();
    let tests = BTreeSet::new();
    let raw = FinancialSnapshotInput {
        profile: &profile,
        entries: &entries,
        tariff_decisions: input["tariffDecisions"].as_array().unwrap(),
        work_pattern_settings: &pattern,
        test_months: &tests,
    };
    let mut context =
        FinancialContext::new_shared(&raw, Arc::new(RuleResolver::bundled().unwrap())).unwrap();
    assert!(
        context
            .calculation_profile()
            .get("workingTimeTarget")
            .is_none()
    );
    let source = context.salary_month("2026-01").unwrap();
    assert!(
        source
            .calculation_profile()
            .get("workingTimeTarget")
            .is_none()
    );
    assert!(
        std::ptr::eq(
            &source.profile()["workingTimeTarget"],
            &profile["workingTimeTarget"]
        ),
        "compatibility metadata must reference the original context"
    );
    let preferences = validate_salary_payment_preferences(&input["preferences"]).unwrap();
    let timeline = input["timeline"].as_array().unwrap();
    let first = annual_net_pay(
        2026,
        timeline,
        &preferences,
        &mut context,
        SalaryPerspective::Earned,
    )
    .unwrap();
    let before = context.diagnostics();
    let again = annual_net_pay(
        2026,
        timeline,
        &preferences,
        &mut context,
        SalaryPerspective::Earned,
    )
    .unwrap();
    assert_eq!(context.diagnostics(), before);
    assert_eq!(
        serde_json::to_value(first).unwrap(),
        serde_json::to_value(again).unwrap()
    );
    let projection = context
        .salary_projection("2026-07", &preferences, SalaryPerspective::Payout)
        .unwrap();
    let settings = resolve_net_pay_settings("2026-07", timeline).unwrap();
    let payment = PaymentNetPreparation {
        preferences: &preferences,
        perspective: SalaryPerspective::Payout,
        source_settings: timeline,
        projection: Some(&projection),
    };
    let first = prepare_automatic_net_pay(
        "2026-07",
        &settings["settings"],
        &mut context,
        Some(&payment),
    );
    let before = context.diagnostics();
    let again = prepare_automatic_net_pay(
        "2026-07",
        &settings["settings"],
        &mut context,
        Some(&payment),
    );
    assert_eq!(first, again);
    assert_eq!(context.diagnostics(), before);
    assert_eq!(before["raw"]["profiles"]["compactProfileViews"], 1);
    assert_eq!(before["raw"]["profiles"]["fullProfileMaterializations"], 0);
    assert_eq!(
        before["raw"]["profiles"]["fullProfileSerializations"], 0,
        "financial cache keys must not serialize target-rich source metadata"
    );
    let mut changed = projection.clone();
    changed.available = false;
    changed.pay["available"] = json!(false);
    changed.pay["estimatedGrossAmount"] = Value::Null;
    let changed_payment = PaymentNetPreparation {
        projection: Some(&changed),
        ..payment
    };
    let changed_result = prepare_automatic_net_pay(
        "2026-07",
        &settings["settings"],
        &mut context,
        Some(&changed_payment),
    );
    assert_ne!(
        changed_result, first,
        "changed Rust projection must not hit an unchanged forecast key"
    );
    let serialized = serde_json::to_value(&source).unwrap();
    assert_eq!(
        serialized["profile"]["workingTimeTarget"]["facts"]
            .as_array()
            .unwrap()
            .len(),
        50_000
    );
    assert_eq!(
        context.diagnostics()["raw"]["profiles"]["fullProfileSerializations"],
        1
    );
    assert_eq!(
        context.diagnostics()["raw"]["profiles"]["fullProfileMaterializations"],
        0
    );
}
