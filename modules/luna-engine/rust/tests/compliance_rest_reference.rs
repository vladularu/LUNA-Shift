use luna_engine::{
    calendar::recurrence::CollationRanks,
    compliance::{
        model::ComplianceError,
        preparation,
        sunday::{self, SundayContext},
    },
    rules::RuleResolver,
};
use serde_json::{Value, json};
use std::collections::BTreeMap;
fn run(case: &Value, resolver: &RuleResolver) -> Result<Value, ComplianceError> {
    let i = &case["input"];
    let month = i["month"].as_str().unwrap();
    let options = &i["options"];
    let ranks: CollationRanks = serde_json::from_value(i["collationRanks"].clone()).unwrap();
    let c = preparation::prepare_calendar(
        month,
        i["shifts"].as_array().unwrap(),
        i["timeZone"].as_str().unwrap(),
        options,
        "2026-07-15",
        resolver,
        &ranks,
    )?;
    let context = SundayContext {
        month,
        intervals: &c.intervals,
        shifts: &c.calculation_shifts,
        options,
        reference_date: c.reference_date,
        rules: c.legal_package.rules(),
        resolver,
        version: i
            .get("contractVersion")
            .and_then(Value::as_u64)
            .map(|v| v as u32)
            .unwrap_or(c.legal_package.engine_contract_version),
        time_zone: i["timeZone"].as_str().unwrap(),
        coverage_start: i
            .get("coverageStart")
            .and_then(Value::as_str)
            .unwrap_or(&c.start),
        coverage_end: i
            .get("coverageEnd")
            .and_then(Value::as_str)
            .unwrap_or(&c.end),
    };
    sunday::check_sunday_holiday_rest(&context).map(Value::Array)
}
#[test]
fn complete_raw_sunday_holiday_findings_and_dated_scope_match_frozen_source() {
    let g: Value =
        serde_json::from_str(include_str!("../../reference/compliance-rest-golden.json")).unwrap();
    assert_eq!(
        g["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let cases = g["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 69);
    let mut resolvers = BTreeMap::new();
    for catalog in g["catalogs"].as_array().unwrap() {
        let id = catalog["id"].as_str().unwrap();
        resolvers.insert(
            id,
            if id == "bundled" {
                RuleResolver::bundled().unwrap()
            } else {
                RuleResolver::from_catalog_json(
                    catalog["packages"].clone(),
                    serde_json::from_value(catalog["selections"].clone()).unwrap(),
                    None,
                )
                .unwrap()
            },
        );
    }
    for case in cases {
        let actual = match run(
            case,
            resolvers
                .get(case["input"]["catalogRef"].as_str().unwrap())
                .unwrap(),
        ) {
            Ok(v) => v,
            Err(e) => json!({"$error":{"name":e.source_error_name(),"message":e.to_string()}}),
        };
        assert_eq!(actual, case["expected"], "{}", case["id"]);
    }
}
