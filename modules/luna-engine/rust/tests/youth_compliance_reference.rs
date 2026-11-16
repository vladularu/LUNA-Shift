use bigdecimal::BigDecimal;
use luna_engine::{
    EngineError,
    calendar::recurrence::CollationRanks,
    rules::{PackageIds, RuleResolver},
    training::{self, PreparedTrainingProfiles, YouthSource},
};
use serde_json::Value;
use std::{str::FromStr, sync::Arc};
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
fn complete_original_youth_public_result_matches_native_draft_and_platform_finish() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/youth-compliance-golden.json")).unwrap();
    assert_eq!(
        fixture["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 915);
    let ranks: CollationRanks = serde_json::from_value(fixture["collationRanks"].clone()).unwrap();
    let resolvers = fixture["resolvers"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, v)| {
            let ids: PackageIds = serde_json::from_value(v["packageIds"].clone()).unwrap();
            (
                k.clone(),
                RuleResolver::from_catalog_json(v["catalog"].clone(), ids, None).unwrap(),
            )
        })
        .collect::<std::collections::BTreeMap<_, _>>();
    for case in cases {
        let i = &case["input"];
        assert!(i.get("facts").is_none());
        let month = i["month"].as_str().unwrap();
        let source = YouthSource::new(
            i["shifts"].as_array().unwrap().clone().into(),
            i["details"].as_array().unwrap().clone().into(),
            Arc::new(i["profile"].clone()),
        );
        let entries = source.prepare(month).unwrap();
        let profiles =
            PreparedTrainingProfiles::try_from_raw(i["profiles"].as_array().unwrap()).unwrap();
        let draft = training::prepare_youth_compliance(
            month,
            &entries,
            &profiles,
            &resolvers[i["resolver"].as_str().unwrap()],
        )
        .unwrap();
        for code in draft.finding_code_candidates() {
            assert!(
                training::code_candidates().contains(&code.as_str()),
                "missing startup code {code}"
            );
        }
        let actual = draft.finish(&ranks).unwrap();
        assert!(
            same(&actual, &case["expected"]),
            "{}\nactual {actual}\nexpected {}",
            case["id"],
            case["expected"]
        );
    }
}
#[test]
fn missing_platform_rank_is_not_a_byte_sort_fallback() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/youth-compliance-golden.json")).unwrap();
    let case = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| !c["expected"]["findings"].as_array().unwrap().is_empty())
        .unwrap();
    let i = &case["input"];
    let r = &fixture["resolvers"][i["resolver"].as_str().unwrap()];
    let ids: PackageIds = serde_json::from_value(r["packageIds"].clone()).unwrap();
    let resolver = RuleResolver::from_catalog_json(r["catalog"].clone(), ids, None).unwrap();
    let source = YouthSource::new(
        i["shifts"].as_array().unwrap().clone().into(),
        i["details"].as_array().unwrap().clone().into(),
        Arc::new(i["profile"].clone()),
    );
    let month = i["month"].as_str().unwrap();
    let entries = source.prepare(month).unwrap();
    let profiles =
        PreparedTrainingProfiles::try_from_raw(i["profiles"].as_array().unwrap()).unwrap();
    let draft = training::prepare_youth_compliance(month, &entries, &profiles, &resolver).unwrap();
    assert_eq!(
        draft.finish(&CollationRanks::default()).unwrap_err(),
        EngineError::InvalidCollation
    );
}
