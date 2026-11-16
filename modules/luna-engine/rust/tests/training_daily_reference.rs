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
fn all_daily_findings_and_native_credit_prerequisites_match_actual_original_public_source_calls() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/training-daily-golden.json")).unwrap();
    assert_eq!(
        fixture["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 239);
    let ids: PackageIds = serde_json::from_value(fixture["packageIds"].clone()).unwrap();
    let resolvers = fixture["catalogs"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, v)| {
            (
                k.clone(),
                RuleResolver::from_catalog_json(v.clone(), ids.clone(), None).unwrap(),
            )
        })
        .collect::<std::collections::BTreeMap<_, _>>();
    for case in cases {
        let i = &case["input"];
        assert!(i.get("credits").is_none());
        assert!(i.get("facts").is_none());
        let month = i["month"].as_str().unwrap();
        let source = YouthSource::new(
            i["shifts"].as_array().unwrap().clone().into(),
            i["details"].as_array().unwrap().clone().into(),
            Arc::new(i["profile"].clone()),
        );
        let prepared = source.prepare(month).unwrap();
        let profiles =
            PreparedTrainingProfiles::try_from_raw(i["profiles"].as_array().unwrap()).unwrap();
        let resolver = &resolvers[i["resolver"].as_str().unwrap()];
        let context =
            training::prepare_youth_assessment(&prepared, &profiles, month, resolver).unwrap();
        let events = training::check_youth_daily(&context).unwrap();
        let actual=context.days().iter().map(|day|json!({"date":day.date(),"credit":context.daily_credits().get(day.date()).copied().flatten(),"nextEarlySchool":context.next_early_school(day).unwrap(),"shortenedWorkingDays":context.shortened_dates(day).unwrap(),"events":events.iter().filter(|e|e.day_date()==day.date()).map(|e|e.to_json()).collect::<Vec<_>>()})).collect::<Vec<_>>();
        assert!(
            same(&json!(actual), &case["expected"]),
            "{}\nactual {}\nexpected {}",
            case["id"],
            json!(actual),
            case["expected"]
        );
    }
}
