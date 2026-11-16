use bigdecimal::BigDecimal;
use luna_engine::{
    calendar::recurrence::CollationRanks,
    compliance::{
        average::AverageContext,
        model::{self, ComplianceError},
        night_average, preparation, working_average,
    },
    rules::RuleResolver,
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, str::FromStr};
fn same_value(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => {
            BigDecimal::from_str(&a.to_string()).unwrap()
                == BigDecimal::from_str(&b.to_string()).unwrap()
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same_value(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(key, value)| b.get(key).is_some_and(|b| same_value(value, b)))
        }
        _ => a == b,
    }
}
fn run(case: &Value, resolver: &RuleResolver) -> Result<Value, ComplianceError> {
    let input = &case["input"];
    let month = input["month"].as_str().unwrap();
    let options = &input["options"];
    let ranks: CollationRanks = serde_json::from_value(input["collationRanks"].clone()).unwrap();
    let prepared = preparation::prepare_calendar(
        month,
        input["shifts"].as_array().unwrap(),
        input["timeZone"].as_str().unwrap(),
        options,
        "2026-07-15",
        resolver,
        &ranks,
    )?;
    let rules = prepared.legal_package.rules();
    let version = input
        .get("contractVersion")
        .and_then(Value::as_u64)
        .map(|value| u32::try_from(value).unwrap())
        .unwrap_or(prepared.legal_package.engine_contract_version);
    let night_worker = model::qualify_as_night_worker(
        &prepared.intervals,
        rules,
        version,
        prepared.first.year(),
        options,
    )?;
    let context = AverageContext {
        month,
        intervals: &prepared.intervals,
        shifts: &prepared.shifts,
        options,
        reference_date: prepared.reference_date,
        rules,
        resolver,
        version,
        night_worker,
    };
    match case["operation"].as_str().unwrap() {
        "compliance.checkWorkingAverage" => {
            working_average::check_working_time_average(&context).map(Value::Array)
        }
        "compliance.checkNightAverage" => {
            night_average::check_night_working_time_average(&context).map(Value::Array)
        }
        operation => panic!("Unknown {operation}"),
    }
}
#[test]
fn raw_average_windows_neutral_absences_deadlines_and_night_branches_match_source() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../reference/compliance-average-golden.json"
    ))
    .unwrap();
    assert_eq!(
        fixture["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 124);
    let mut resolvers = BTreeMap::new();
    for catalog in fixture["catalogs"].as_array().unwrap() {
        let id = catalog["id"].as_str().unwrap();
        let resolver = if id == "bundled" {
            RuleResolver::bundled().unwrap()
        } else {
            RuleResolver::from_catalog_json(
                catalog["packages"].clone(),
                serde_json::from_value(catalog["selections"].clone()).unwrap(),
                None,
            )
            .unwrap()
        };
        resolvers.insert(id, resolver);
    }
    for case in cases {
        let resolver = resolvers
            .get(case["input"]["catalogRef"].as_str().unwrap())
            .unwrap();
        let actual = match run(case, resolver) {
            Ok(value) => value,
            Err(error) => {
                json!({"$error":{"name":error.source_error_name(),"message":error.to_string()}})
            }
        };
        assert!(
            same_value(&actual, &case["expected"]),
            "{}\nactual {actual}\nexpected {}",
            case["id"],
            case["expected"]
        );
    }
}
