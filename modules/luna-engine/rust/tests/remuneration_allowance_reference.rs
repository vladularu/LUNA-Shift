use luna_engine::{
    remuneration::allowances::{
        calculation::{AllowanceInput, calculate_monthly_dated_allowances},
        own::calculate_own_monthly_allowances,
    },
    rules::{PackageIds, RuleResolver},
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::OnceLock};
fn first_difference(actual: &Value, expected: &Value, path: &str) -> String {
    match (actual, expected) {
        (Value::Object(actual), Value::Object(expected)) => {
            for (key, value) in expected {
                if actual.get(key) != Some(value) {
                    return first_difference(
                        actual.get(key).unwrap_or(&Value::Null),
                        value,
                        &format!("{path}.{key}"),
                    );
                }
            }
            format!("{path}: different object keys")
        }
        (Value::Array(actual), Value::Array(expected)) => {
            for (index, (actual, expected)) in actual.iter().zip(expected).enumerate() {
                if actual != expected {
                    return first_difference(actual, expected, &format!("{path}[{index}]"));
                }
            }
            format!(
                "{path}: actual {} rows; expected {} rows",
                actual.len(),
                expected.len()
            )
        }
        _ => format!("{path}: actual {actual}; expected {expected}"),
    }
}
#[test]
fn personal_fixed_allowances_match_source_without_second_part_time_factor() {
    run(true, None);
}
#[test]
fn full_monthly_allowances_match_frozen_source_from_raw_inputs() {
    run(false, None);
}
#[test]
fn cross_midnight_monthly_activity_and_entitlement_order_stress() {
    run(false, Some(10_296));
}
fn run(own: bool, minimum_id: Option<u64>) {
    static DATA: OnceLock<Value> = OnceLock::new();
    let data = DATA.get_or_init(|| {
        serde_json::from_str(include_str!(
            "../../reference/remuneration-allowance-golden.json"
        ))
        .unwrap()
    });
    assert_eq!(
        data["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let catalog: Value = serde_json::from_str(data["catalogJson"].as_str().unwrap()).unwrap();
    let packages: BTreeMap<String, Value> = data["packageJson"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, v)| {
            (
                k.clone(),
                serde_json::from_str(v.as_str().unwrap()).unwrap(),
            )
        })
        .collect();
    let mut resolvers = BTreeMap::new();
    let mut checked = 0;
    let mut failures = vec![];
    for case in data["cases"].as_array().unwrap().iter().filter(|case| {
        (case["operation"] == "own") == own
            && minimum_id.is_none_or(|minimum| {
                case["id"]
                    .as_str()
                    .and_then(|s| s.strip_prefix("dated-allowance-"))
                    .and_then(|n| n.parse::<u64>().ok())
                    .is_some_and(|n| n >= minimum)
            })
    }) {
        let key = case["key"].as_str().unwrap_or("missing").to_owned();
        let resolver=resolvers.entry(key.clone()).or_insert_with(||{
   let package=packages.get(&key);let tariff=package.map(|p|p["packageId"].as_str().unwrap()).unwrap_or("missing").into();
   RuleResolver::from_catalog_json(json!({"tariff":package.into_iter().cloned().collect::<Vec<_>>(),"legal":catalog["legal"],"holiday":catalog["holiday"]}),PackageIds{tariff,legal:catalog["packageIds"]["legal"].as_str().unwrap().into(),holiday:catalog["packageIds"]["holiday"].as_str().unwrap().into()},None).unwrap()
  });
        let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let result = if own {
            calculate_own_monthly_allowances(
                input["month"].as_str().unwrap(),
                input["history"].as_array().unwrap(),
                resolver,
            )
            .map(|value| serde_json::to_value(value).unwrap())
        } else {
            let facts = input
                .get("tvlShiftWork")
                .and_then(Value::as_array)
                .map(Vec::as_slice)
                .unwrap_or(&[]);
            calculate_monthly_dated_allowances(
                input["month"].as_str().unwrap(),
                input["shifts"].as_array().unwrap(),
                &AllowanceInput {
                    work_profile: &input["workProfile"],
                    history: input["history"].as_array().unwrap(),
                    entitlements: input["entitlements"].as_array().unwrap(),
                    tvl_shift_work: facts,
                },
                resolver,
            )
            .map(|value| serde_json::to_value(value).unwrap())
        };
        let actual = match result {
            Ok(value) => json!({"value":value}),
            Err(error) => json!({"error":{"name":error.class_name(),"message":error.to_string()}}),
        };
        checked += 1;
        if actual != case["expected"] {
            failures.push(format!(
                "{} {}",
                case["id"],
                first_difference(&actual, &case["expected"], "$")
            ));
        }
    }
    assert!(
        checked
            >= if own || minimum_id.is_some() {
                100
            } else {
                10_000
            },
        "Allowance corpus is incomplete"
    );
    assert!(
        failures.is_empty(),
        "{} mismatches\n{}",
        failures.len(),
        failures
            .iter()
            .take(10)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n\n")
    );
    eprintln!("Dated allowances (own-only={own}): {checked} exact raw source cases");
}
