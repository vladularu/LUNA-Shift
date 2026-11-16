use luna_engine::{
    remuneration::assessment::{
        calculation::derive_dated_allowance_assessments,
        decisions::validate_scoped_allowance_decisions, model::AssessmentInput,
    },
    rules::{PackageIds, RuleResolver},
};
use serde_json::{Value, json};
use std::collections::BTreeMap;
fn difference(a: &Value, e: &Value, p: &str) -> String {
    match (a, e) {
        (Value::Object(a), Value::Object(e)) => {
            for (k, v) in e {
                if a.get(k) != Some(v) {
                    return difference(a.get(k).unwrap_or(&Value::Null), v, &format!("{p}.{k}"));
                }
            }
            format!("{p}:object keys")
        }
        (Value::Array(a), Value::Array(e)) => {
            for (i, (a, e)) in a.iter().zip(e).enumerate() {
                if a != e {
                    return difference(a, e, &format!("{p}[{i}]"));
                }
            }
            format!("{p}: lengths {} vs {}", a.len(), e.len())
        }
        _ => format!("{p}: actual {a}; expected {e}"),
    }
}
#[test]
fn native_dated_allowance_assessment_and_strict_decisions_match_source() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/dated-assessment-golden.json")).unwrap();
    assert_eq!(
        data["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let resolvers: BTreeMap<String, RuleResolver> = data["catalogs"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(key, raw)| {
            let catalog: Value = serde_json::from_str(raw.as_str().unwrap()).unwrap();
            let tariff = catalog["tariff"][0]["packageId"]
                .as_str()
                .unwrap_or("missing")
                .into();
            let ids = PackageIds {
                tariff,
                legal: catalog["legal"][0]["packageId"]
                    .as_str()
                    .unwrap_or("missing")
                    .into(),
                holiday: catalog["holiday"][0]["packageId"]
                    .as_str()
                    .unwrap_or("missing")
                    .into(),
            };
            (
                key.clone(),
                RuleResolver::from_catalog_json(catalog, ids, None).unwrap(),
            )
        })
        .collect();
    let mut failures = vec![];
    let empty = vec![];
    let mut checked = 0;
    for case in data["cases"].as_array().unwrap() {
        let raw: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let result = if case["operation"] == "decisions" {
            validate_scoped_allowance_decisions(&raw["value"])
                .map(|v| serde_json::to_value(v).unwrap())
        } else {
            derive_dated_allowance_assessments(&AssessmentInput {
                month: raw["month"].as_str().unwrap(),
                shifts: raw["shifts"].as_array().unwrap(),
                work_profile: &raw["workProfile"],
                history: raw["history"].as_array().unwrap(),
                settings: &raw["settings"],
                decisions: raw["decisions"].as_array().unwrap_or(&empty),
                legacy_decision: raw.get("legacyDecision").filter(|v| !v.is_null()),
                resolver: &resolvers[case["key"].as_str().unwrap()],
            })
            .map(|v| serde_json::to_value(v).unwrap())
        };
        let actual = match result {
            Ok(v) => json!({"value":v}),
            Err(e) => json!({"error":{"name":e.class_name(),"message":e.to_string()}}),
        };
        checked += 1;
        if actual != case["expected"] {
            failures.push(format!(
                "{} {}",
                case["id"],
                difference(&actual, &case["expected"], "$")
            ));
        }
    }
    assert!(checked >= 1700, "Assessment corpus incomplete");
    assert!(
        failures.is_empty(),
        "{} mismatches\n{}",
        failures.len(),
        failures
            .iter()
            .take(20)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n\n")
    );
    eprintln!("Dated allowance assessment: {checked} exact raw source outputs/errors");
}
