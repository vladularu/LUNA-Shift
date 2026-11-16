use bigdecimal::BigDecimal;
use luna_engine::{
    calendar::recurrence::CollationRanks,
    compliance::{
        annual::{self, AnnualComplianceSource, AnnualTraining},
        selection::PreparedComplianceEntries,
    },
    rules::RuleResolver,
    training::PreparedTrainingProfiles,
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, str::FromStr, sync::Arc};
fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => {
            BigDecimal::from_str(&a.to_string()).unwrap()
                == BigDecimal::from_str(&b.to_string()).unwrap()
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len() && a.iter().all(|(k, v)| b.get(k).is_some_and(|b| same(v, b)))
        }
        _ => a == b,
    }
}
#[test]
fn complete_raw_annual_legal_fields_and_revision_selections_match_original_public_year() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../reference/compliance-annual-golden.json"
    ))
    .unwrap();
    assert_eq!(
        fixture["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let mut resolvers = BTreeMap::new();
    for c in fixture["catalogs"].as_array().unwrap() {
        let id = c["id"].as_str().unwrap();
        resolvers.insert(
            id,
            Arc::new(if id == "bundled" {
                RuleResolver::bundled().unwrap()
            } else {
                RuleResolver::from_catalog_json(
                    c["packages"].clone(),
                    serde_json::from_value(c["selections"].clone()).unwrap(),
                    None,
                )
                .unwrap()
            }),
        );
    }
    let ranks: CollationRanks = serde_json::from_value(fixture["collationRanks"].clone()).unwrap();
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 98);
    for case in cases {
        let i: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let resolver = &resolvers[i["catalogRef"].as_str().unwrap()];
        let actual = if case["operation"] == "compliance.selectShifts" {
            let source =
                PreparedComplianceEntries::new(Arc::from(i["entries"].as_array().unwrap().clone()))
                    .unwrap();
            match source.select(i["month"].as_str().unwrap(), resolver) {
                Ok(v) => serde_json::to_value(v).unwrap(),
                Err(e) => json!({"$error":{"name":e.source_error_name(),"message":e.to_string()}}),
            }
        } else {
            let entry_ranks: CollationRanks =
                serde_json::from_value(i["collationRanks"].clone()).unwrap();
            let source = AnnualComplianceSource::new(
                Arc::from(i["entries"].as_array().unwrap().clone()),
                Arc::new(i["profile"].clone()),
                Arc::clone(resolver),
                entry_ranks,
                i["referenceDate"].as_str().unwrap().into(),
                i["youthProtection"].as_bool().unwrap(),
            )
            .unwrap();
            let profiles = if i["training"].is_object() {
                Some(
                    PreparedTrainingProfiles::try_from_raw(
                        i["training"]["profiles"].as_array().unwrap(),
                    )
                    .unwrap(),
                )
            } else {
                None
            };
            let training = match i["training"]["loadState"].as_str() {
                None => None,
                Some("loading") => Some(AnnualTraining::Loading),
                Some("error") => Some(AnnualTraining::Error(i["training"]["loadError"].as_str())),
                Some("ready") => Some(AnnualTraining::Ready {
                    shifts: Arc::from(i["training"]["shifts"].as_array().unwrap().clone()),
                    details: Arc::from(i["training"]["details"].as_array().unwrap().clone()),
                    profiles: profiles.as_ref().unwrap(),
                }),
                other => panic!("Unknown state {other:?}"),
            };
            match annual::calculate_annual_compliance(
                i["year"].as_i64().unwrap().try_into().unwrap(),
                &source,
                training.as_ref(),
                &ranks,
            ) {
                Ok(v) => v.into_json(),
                Err(e) => json!({"$error":{"name":e.source_error_name(),"message":e.to_string()}}),
            }
        };
        assert!(
            same(&actual, &case["expected"]),
            "{}\nactual {actual}\nexpected {}",
            case["id"],
            case["expected"]
        );
    }
}
