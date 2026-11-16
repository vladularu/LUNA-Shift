use bigdecimal::BigDecimal;
use luna_engine::{
    calendar::recurrence::CollationRanks,
    compliance::monthly::{self, PreparedComplianceSource},
    rules::RuleResolver,
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, str::FromStr, sync::Arc};
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
                    .all(|(k, v)| b.get(k).is_some_and(|b| same_value(v, b)))
        }
        _ => a == b,
    }
}
#[test]
fn complete_general_monthly_core_matches_original_frozen_steps() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../reference/compliance-monthly-golden.json"
    ))
    .unwrap();
    assert_eq!(
        fixture["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    assert_eq!(
        fixture["oracle"]["sourceSha256"],
        "26f49b6e37fd1e780c424c4860690b7c321eedf973833ffa9ece234693c8f95c"
    );
    assert_eq!(fixture["oracle"]["typescriptVersion"], "6.0.3");
    let mut resolvers = BTreeMap::new();
    for catalog in fixture["catalogs"].as_array().unwrap() {
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
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 599);
    let mut sources = BTreeMap::new();
    let mut reuse_count = 0;
    for case in cases {
        let i: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let ranks: CollationRanks = serde_json::from_value(i["collationRanks"].clone()).unwrap();
        // Fixture-only grouping checks the same immutable native preparation
        // across different options. This JSON key is never production policy.
        let key = (
            i["shifts"].to_string(),
            i["timeZone"].as_str().unwrap().to_owned(),
        );
        if sources.contains_key(&key) {
            reuse_count += 1;
        }
        if !sources.contains_key(&key) {
            let raw: Arc<[Value]> = Arc::from(i["shifts"].as_array().unwrap().clone());
            let source = PreparedComplianceSource::new(Arc::clone(&raw), &key.1, &ranks);
            if let Ok(source) = &source {
                assert!(std::ptr::eq(raw.as_ptr(), source.shifts().as_ptr()));
            }
            sources.insert(key.clone(), source);
        }
        let actual = sources[&key]
            .as_ref()
            .map_err(|e| json!({"$error":{"name":e.source_error_name(),"message":e.to_string()}}))
            .and_then(|source| {
                monthly::calculate_monthly_core(
                    i["month"].as_str().unwrap(),
                    source,
                    &i["options"],
                    "2026-07-15",
                    &resolvers[i["catalogRef"].as_str().unwrap()],
                )
                .map(|v| v.into_json())
                .map_err(
                    |e| json!({"$error":{"name":e.source_error_name(),"message":e.to_string()}}),
                )
            });
        let actual = match actual {
            Ok(v) => v,
            Err(e) => e,
        };
        assert!(
            same_value(&actual, &case["expected"]),
            "{}\nactual {actual}\nexpected {}",
            case["id"],
            case["expected"]
        );
    }
    assert!(reuse_count > 100);
}
