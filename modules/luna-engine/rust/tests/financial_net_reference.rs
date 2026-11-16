mod common;
use luna_engine::{
    net::{
        payment_schedule::validate_salary_payment_preferences, settings::resolve_net_pay_settings,
    },
    pay::pattern::WorkPatternSettings,
    report::financial::{
        FinancialSnapshotInput,
        net::{PaymentNetPreparation, annual_net_pay, prepare_automatic_net_pay},
        source::FinancialContext,
    },
    rules::RuleResolver,
};
use serde_json::{Value, json};
use std::{collections::BTreeSet, sync::Arc};

#[test]
fn full_earned_and_payout_years_and_prepared_months_match_frozen_source() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/financial-net-golden.json")).unwrap();
    let cases = data["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 954);
    let resolver = RuleResolver::bundled().unwrap();
    for case in cases {
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
        let mut context = FinancialContext::new(&raw, &resolver).unwrap();
        let year = input["year"].as_i64().unwrap() as i32;
        let timeline = input["timeline"].as_array().unwrap();
        let preferences = validate_salary_payment_preferences(&input["preferences"]).unwrap();
        let perspective = serde_json::from_value(input["perspective"].clone()).unwrap();
        let actual=(||{
            let report=annual_net_pay(year,timeline,&preferences,&mut context,perspective)?;
            let before=context.diagnostics();
            let repeated=annual_net_pay(year,timeline,&preferences,&mut context,perspective)?;
            common::assert_json_eq(&serde_json::to_value(&report).unwrap(),&serde_json::to_value(repeated).unwrap(),"unchanged year");
            assert_eq!(context.diagnostics(),before,"{} repeated year must not calculate more months",case["id"]);
            let mut forecasts=vec![];
            for forecast in case["expected"]["forecasts"].as_array().unwrap(){
                let month=forecast["month"].as_str().unwrap();let selected=resolve_net_pay_settings(month,timeline).unwrap();
                let payment=PaymentNetPreparation{preferences:&preferences,perspective,source_settings:timeline,projection:None};
                forecasts.push(json!({"month":month,"result":prepare_automatic_net_pay(month,&selected["settings"],&mut context,Some(&payment))}));
            }
            Ok::<_,luna_engine::report::financial::FinancialError>(json!({"report":report,"forecasts":forecasts}))
        })().unwrap_or_else(|error|json!({"$error":error.to_string()}));
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
