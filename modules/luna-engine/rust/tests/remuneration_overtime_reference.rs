use luna_engine::{
    EngineError,
    remuneration::overtime::{
        self, OvertimeError,
        calculation::{
            OvertimeInput, ShiftOvertimeOptions, calculate_dated_shift_overtime,
            calculate_monthly_dated_overtime,
        },
    },
    rules::{PackageIds, RuleResolver},
};
use serde_json::{Value, json};
use std::collections::BTreeMap;
fn difference(actual: &Value, expected: &Value, path: &str) -> String {
    match (actual, expected) {
        (Value::Object(actual), Value::Object(expected)) => {
            for (k, e) in expected {
                if actual.get(k) != Some(e) {
                    return difference(
                        actual.get(k).unwrap_or(&Value::Null),
                        e,
                        &format!("{path}.{k}"),
                    );
                }
            }
            format!("{path} object keys")
        }
        (Value::Array(actual), Value::Array(expected)) => {
            for (i, (a, e)) in actual.iter().zip(expected).enumerate() {
                if a != e {
                    return difference(a, e, &format!("{path}[{i}]"));
                }
            }
            format!("{path} lengths {} vs{}", actual.len(), expected.len())
        }
        _ => format!("{path} actual {actual}; expected {expected}"),
    }
}
#[test]
fn full_dated_overtime_and_saved_allocations_match_source_from_raw_facts() {
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/remuneration-overtime-golden.json"
    ))
    .unwrap();
    assert_eq!(
        data["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let catalog: Value = serde_json::from_str(data["catalogJson"].as_str().unwrap()).unwrap();
    let packages: BTreeMap<String, Value> = data["packageJson"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, p)| {
            (
                k.clone(),
                serde_json::from_str(p.as_str().unwrap()).unwrap(),
            )
        })
        .collect();
    let mut resolvers = BTreeMap::new();
    let mut failures = vec![];
    let mut safe = 0;
    let mut exact = 0;
    for case in data["cases"].as_array().unwrap() {
        let key = case["key"].as_str().unwrap_or("missing").to_owned();
        let resolver=resolvers.entry(key.clone()).or_insert_with(||{let p=packages.get(&key);let tariff=p.and_then(|p|p["packageId"].as_str()).unwrap_or("missing").into();RuleResolver::from_catalog_json(json!({"tariff":p.into_iter().cloned().collect::<Vec<_>>(),"legal":catalog["legal"],"holiday":catalog["holiday"]}),PackageIds{tariff,legal:catalog["packageIds"]["legal"].as_str().unwrap().into(),holiday:catalog["packageIds"]["holiday"].as_str().unwrap().into()},None).unwrap()});
        let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let result: Result<Value, OvertimeError> = match case["operation"].as_str().unwrap() {
            "validateSaved" => overtime::saved::validate_overtime_allocation(&input["value"])
                .map(|v| serde_json::to_value(v).unwrap()),
            "isCurrent" => Ok(json!(overtime::saved::is_current_overtime_allocation(
                &input["value"],
                &input["shift"],
                input["timeZone"].as_str().unwrap()
            ))),
            "shift" => calculate_dated_shift_overtime(
                &input["shift"],
                &OvertimeInput {
                    work_profile: &input["workProfile"],
                    history: input["history"].as_array().unwrap(),
                },
                resolver,
                &ShiftOvertimeOptions {
                    allocations: input
                        .get("allocations")
                        .map(|v| v.as_array().unwrap().as_slice()),
                    included_month: input.get("includedMonth").and_then(Value::as_str),
                    saved_allocation: input.get("savedAllocation"),
                },
            )
            .map(|r| serde_json::to_value(r).unwrap()),
            "month" => {
                let allocations = input
                    .get("allocations")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .map(|pair| {
                        (
                            pair[0].as_str().unwrap().into(),
                            pair[1].as_array().unwrap().clone(),
                        )
                    })
                    .collect();
                let saved = input
                    .get("savedAllocations")
                    .and_then(Value::as_array)
                    .map(Vec::as_slice)
                    .unwrap_or(&[]);
                calculate_monthly_dated_overtime(
                    input["month"].as_str().unwrap(),
                    input["shifts"].as_array().unwrap(),
                    &OvertimeInput {
                        work_profile: &input["workProfile"],
                        history: input["history"].as_array().unwrap(),
                    },
                    resolver,
                    &allocations,
                    saved,
                )
                .map(|r| serde_json::to_value(r).unwrap())
            }
            _ => panic!("Unknown operation"),
        };
        if case["rejectionPolicy"] == "SAFE_INVALID_TIME_ZONE" {
            assert!(
                matches!(
                    result,
                    Err(OvertimeError::Time(EngineError::InvalidTimeZone))
                ),
                "{} {result:?}",
                case["id"]
            );
            safe += 1;
            continue;
        }
        let actual = match result {
            Ok(value) => json!({"value":value}),
            Err(error) => json!({"error":{"name":error.class_name(),"message":error.to_string()}}),
        };
        exact += 1;
        if actual != case["expected"] {
            failures.push(format!(
                "{} {}",
                case["id"],
                difference(&actual, &case["expected"], "$")
            ));
        }
    }
    assert!(exact + safe >= 4_800, "Overtime corpus is incomplete");
    assert!(
        failures.is_empty(),
        "{} mismatches\n{}",
        failures.len(),
        failures
            .iter()
            .take(14)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n\n")
    );
    eprintln!(
        "Dated overtime: {exact} exact raw source cases; {safe} named safe timezone rejections"
    );
}
