use bigdecimal::BigDecimal;
use luna_engine::{
    calendar::recurrence::CollationRanks,
    compliance::{
        dated::{self, PreparedDatedComplianceSource},
        model::ComplianceError,
    },
    rules::{RuleResolver, holidays::HolidayError},
    training::{self, PreparedTrainingProfiles, TrainingLoad, YouthSource},
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
fn complete_public_training_merge_recomputes_adult_and_youth_from_raw_facts() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/training-feature-golden.json")).unwrap();
    assert_eq!(
        fixture["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let ranks: CollationRanks = serde_json::from_value(fixture["collationRanks"].clone()).unwrap();
    let mut resolvers = BTreeMap::new();
    for c in fixture["catalogs"].as_array().unwrap() {
        resolvers.insert(
            c["id"].as_str().unwrap(),
            RuleResolver::from_catalog_json(
                c["packages"].clone(),
                serde_json::from_value(c["selections"].clone()).unwrap(),
                None,
            )
            .unwrap(),
        );
    }
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 1843);
    let mut unavailable = 0;
    for case in cases {
        let i: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        assert!(i.get("adult").is_none() && i.get("facts").is_none());
        let month = i["month"].as_str().unwrap();
        let resolver = &resolvers[i["catalogRef"].as_str().unwrap()];
        let raw: Arc<[Value]> = Arc::from(i["shifts"].as_array().unwrap().clone());
        let source = YouthSource::new(
            Arc::clone(&raw),
            Arc::from(i["details"].as_array().unwrap().clone()),
            Arc::new(i["profile"].clone()),
        );
        let entries = source.prepare(month).unwrap();
        let profiles =
            PreparedTrainingProfiles::try_from_raw(i["profiles"].as_array().unwrap()).unwrap();
        let adult = if i["adultRequested"] == true {
            let shift_ranks: CollationRanks =
                serde_json::from_value(i["shiftCollationRanks"].clone()).unwrap();
            let adult_source = PreparedDatedComplianceSource::new(raw, shift_ranks);
            let mut options = i["options"].clone();
            options
                .as_object_mut()
                .unwrap()
                .insert("employmentProfile".into(), i["profile"].clone());
            match dated::calculate_monthly_compliance(
                month,
                &adult_source,
                i["profile"]["timeZone"].as_str().unwrap(),
                &options,
                "2026-07-15",
                resolver,
            ) {
                Ok(value) => Some(value),
                Err(
                    ComplianceError::Rules(_)
                    | ComplianceError::Holiday(HolidayError::Resolution(_)),
                ) => {
                    unavailable += 1;
                    None
                }
                Err(error) => panic!("unexpected native adult error: {error}"),
            }
        } else {
            None
        };
        let state = match i["loadState"].as_str().unwrap() {
            "loading" => TrainingLoad::Loading,
            "error" => TrainingLoad::Error(i["loadError"].as_str()),
            "ready" => TrainingLoad::Ready {
                entries: &entries,
                profiles: &profiles,
            },
            _ => panic!("unknown state"),
        };
        let actual = training::calculate_training_compliance_for_state(
            month,
            adult.as_ref(),
            state,
            resolver,
            &ranks,
        );
        let actual = match actual {
            Ok(v) => v.map_or(Value::Null, |v| v.into_json()),
            Err(e) => json!({"$error":{"name":e.source_error_name(),"message":e.to_string()}}),
        };
        assert!(
            same(&actual, &case["expected"]),
            "{}\nactual {actual}\nexpected {}",
            case["id"],
            case["expected"]
        );
    }
    assert_eq!(
        unavailable,
        fixture["adultUnavailable"].as_u64().unwrap() as usize
    );
}
