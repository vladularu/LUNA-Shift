use bigdecimal::BigDecimal;
use luna_engine::{
    calendar::recurrence::CollationRanks,
    compliance::dated::{self, PreparedDatedComplianceSource},
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
fn full_dated_monthly_results_match_original_public_calculator() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/compliance-dated-golden.json")).unwrap();
    assert_eq!(
        fixture["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let mut resolvers = BTreeMap::new();
    for c in fixture["catalogs"].as_array().unwrap() {
        let id = c["id"].as_str().unwrap();
        resolvers.insert(
            id,
            if id == "bundled" {
                RuleResolver::bundled().unwrap()
            } else {
                RuleResolver::from_catalog_json(
                    c["packages"].clone(),
                    serde_json::from_value(c["selections"].clone()).unwrap(),
                    None,
                )
                .unwrap()
            },
        );
    }
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 683);
    let mut sources = BTreeMap::new();
    for case in cases {
        let i: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let key = i["shifts"].to_string();
        let source = sources.entry(key).or_insert_with(|| {
            let ranks: CollationRanks =
                serde_json::from_value(i["collationRanks"].clone()).unwrap();
            PreparedDatedComplianceSource::new(
                Arc::from(i["shifts"].as_array().unwrap().clone()),
                ranks,
            )
        });
        let actual = dated::calculate_monthly_compliance(
            i["month"].as_str().unwrap(),
            source,
            i["timeZone"].as_str().unwrap(),
            &i["options"],
            "2026-07-15",
            &resolvers[i["catalogRef"].as_str().unwrap()],
        );
        let actual = match actual {
            Ok(v) => v.into_json(),
            Err(e) => json!({"$error":{"name":e.source_error_name(),"message":e.to_string()}}),
        };
        assert!(
            same_value(&actual, &case["expected"]),
            "{}\nactual {actual}\nexpected {}",
            case["id"],
            case["expected"]
        );
    }
    assert!(
        sources
            .values()
            .any(|source| source.prepared_zone_count().unwrap() > 1)
    );
    assert!(
        sources
            .values()
            .all(|source| source.prepared_zone_count().unwrap() <= 32)
    );
}
