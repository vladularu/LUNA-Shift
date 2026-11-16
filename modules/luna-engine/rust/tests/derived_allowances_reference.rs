use luna_engine::{
    remuneration::{
        allowances::{
            calculation::{AllowanceContextInput, calculate_allowances_from_native_assessment},
            model::SupplementResult,
        },
        assessment::{calculation::derive_dated_allowance_assessments, model::AssessmentInput},
    },
    rules::{PackageIds, RuleResolver},
};
use serde_json::{Value, json};
use std::collections::BTreeMap;
fn calculate<'a>(
    raw: &'a Value,
    resolver: &'a RuleResolver,
) -> Result<SupplementResult<'a>, (String, String)> {
    let assessment = derive_dated_allowance_assessments(&AssessmentInput {
        month: raw["month"].as_str().unwrap(),
        shifts: raw["shifts"].as_array().unwrap(),
        work_profile: &raw["workProfile"],
        history: raw["history"].as_array().unwrap(),
        settings: &raw["settings"],
        decisions: raw["decisions"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or(&[]),
        legacy_decision: raw.get("legacyDecision").filter(|v| !v.is_null()),
        resolver,
    })
    .map_err(|e| (e.class_name().into(), e.to_string()))?;
    // This result leaves the native assessment's scope; its small generated facts
    // must be owned while original history/catalog references remain borrowed.
    calculate_allowances_from_native_assessment(
        raw["month"].as_str().unwrap(),
        raw["shifts"].as_array().unwrap(),
        &AllowanceContextInput {
            work_profile: &raw["workProfile"],
            history: raw["history"].as_array().unwrap(),
            tvl_shift_work: &[],
        },
        resolver,
        &assessment,
    )
    .map_err(|e| (e.class_name().into(), e.to_string()))
}
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
fn native_derived_assessment_to_full_allowance_result_matches_source_after_temporary_facts_drop() {
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/derived-allowances-golden.json"
    ))
    .unwrap();
    assert_eq!(
        data["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let resolvers: BTreeMap<String, RuleResolver> = data["catalogs"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, c)| {
            let catalog: Value = serde_json::from_str(c.as_str().unwrap()).unwrap();
            let ids = PackageIds {
                tariff: catalog["tariff"][0]["packageId"]
                    .as_str()
                    .unwrap_or("missing")
                    .into(),
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
                k.clone(),
                RuleResolver::from_catalog_json(catalog, ids, None).unwrap(),
            )
        })
        .collect();
    let mut failures = vec![];
    let mut checked = 0;
    for case in data["cases"].as_array().unwrap() {
        let raw: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let result = calculate(&raw, &resolvers[case["key"].as_str().unwrap()]);
        let actual = match result {
            Ok(v) => json!({"value":v}),
            Err((name, message)) => json!({"error":{"name":name,"message":message}}),
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
    assert!(checked >= 1560);
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
    eprintln!("Native derived allowances:{checked} exact full raw source outputs/errors");
}
