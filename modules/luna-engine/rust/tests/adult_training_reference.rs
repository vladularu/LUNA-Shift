use bigdecimal::BigDecimal;
use luna_engine::{
    rules::{PackageIds, RuleResolver},
    training::{self, PreparedTrainingProfiles, YouthSource},
};
use serde_json::{Value, json};
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
fn complete_original_adult_training_result_matches_native_raw_source_pipeline() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/adult-training-golden.json")).unwrap();
    assert_eq!(
        fixture["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 626);
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
        assert!(i.get("entries").is_none());
        let month = i["month"].as_str().unwrap();
        let source = YouthSource::new(
            i["shifts"].as_array().unwrap().clone().into(),
            i["details"].as_array().unwrap().clone().into(),
            Arc::new(i["profile"].clone()),
        );
        let entries = source.prepare(month).unwrap();
        let profiles =
            PreparedTrainingProfiles::try_from_raw(i["profiles"].as_array().unwrap()).unwrap();
        let result = training::calculate_adult_training(
            month,
            &entries,
            &profiles,
            &resolvers[i["resolver"].as_str().unwrap()],
        )
        .unwrap();
        let actual = json!({"findings":result.findings,"dailyCredits":{"$type":"Map","entries":result.daily_credits.iter().collect::<Vec<_>>()},"blockWeeklyCredits":{"$type":"Map","entries":result.block_weekly_credits.iter().collect::<Vec<_>>()},"assessedDates":result.assessed_dates});
        assert!(
            same(&actual, &case["expected"]),
            "{}\nactual {actual}\nexpected {}",
            case["id"],
            case["expected"]
        );
    }
}
