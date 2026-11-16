mod common;
use luna_engine::{
    pay::pattern::WorkPatternSettings,
    report::financial::{
        FinancialSnapshotInput,
        annual_salary::{
            SalaryAnnualFamily as F, annual_payout_months, annual_salary_forecast,
            annual_salary_proposal_result,
        },
        source::FinancialContext,
    },
    rules::RuleResolver,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

#[test]
fn annual_proposals_and_saved_or_automatic_schedules_match_raw_source() {
    let inputs: Value =
        serde_json::from_str(include_str!("../../reference/financial-source-golden.json")).unwrap();
    let reference: Value = serde_json::from_str(include_str!(
        "../../reference/financial-annual-salary-golden.json"
    ))
    .unwrap();
    let source = inputs["cases"].as_array().unwrap();
    let raw_facts: Vec<Value> = source
        .iter()
        .map(|case| json!([case["id"], case["inputJson"]]))
        .collect();
    assert_eq!(
        format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&raw_facts).unwrap())
        ),
        reference["sourceInputsSha256"].as_str().unwrap()
    );
    let facts: BTreeMap<&str, &str> = source
        .iter()
        .map(|case| {
            (
                case["id"].as_str().unwrap(),
                case["inputJson"].as_str().unwrap(),
            )
        })
        .collect();
    let cases = reference["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 3722);
    let resolver = RuleResolver::bundled().unwrap();
    for case in cases {
        let input: Value = serde_json::from_str(facts[case["sourceId"].as_str().unwrap()]).unwrap();
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
        let mut context = FinancialContext::new(&raw, &resolver).unwrap();
        let year = case["year"].as_i64().unwrap() as i32;
        let actual=(||{
            let proposal=annual_salary_proposal_result(year,&mut context)?;
            let diagnostic_before=context.diagnostics();
            let repeated=annual_salary_proposal_result(year,&mut context)?;
            common::assert_json_eq(&serde_json::to_value(&proposal).unwrap(),&serde_json::to_value(repeated).unwrap(),"unchanged proposal");
            assert_eq!(context.diagnostics(),diagnostic_before,"year repeat must not calculate another month");
            let mut forecasts=vec![];
            for forecast in case["expected"]["forecasts"].as_array().unwrap(){let saved=forecast["saved"].as_array().unwrap();forecasts.push(json!({"saved":saved,"result":annual_salary_forecast(year,&mut context,saved)?}));}
            Ok::<_,luna_engine::report::financial::FinancialError>(json!({"proposal":proposal,"forecasts":forecasts}))
        })().unwrap_or_else(|error|json!({"$error":error.to_string()}));
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
    let schedules = reference["schedules"].as_array().unwrap();
    assert_eq!(schedules.len(), 84);
    for case in schedules {
        let family = match case["family"].as_str().unwrap() {
            "TVOED_P" => F::TvoedP,
            "TVOED_E" => F::TvoedE,
            "TVOED_SUE" => F::TvoedSue,
            "TVL_KR" => F::TvlKr,
            "TVH_KR" => F::TvhKr,
            "TVUK" => F::Tvuk,
            "TVAOED" => F::Tvaoed,
            "TVAL" => F::Tval,
            "CARITAS" => F::Caritas,
            "DRK" => F::Drk,
            "AVR_DD" => F::AvrDd,
            "OWN" => F::Own,
            other => panic!("unknown family {other}"),
        };
        let actual = annual_payout_months(family, case["year"].as_i64().unwrap() as i32)
            .map(|months| json!(months))
            .unwrap_or_else(|error| json!({"$error":error.to_string()}));
        common::assert_json_eq(&actual, &case["expected"], "annual source schedule");
    }
}
