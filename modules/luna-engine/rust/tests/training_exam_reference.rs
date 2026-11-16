use bigdecimal::BigDecimal;
use luna_engine::{
    rules::{PackageIds, RuleResolver},
    training::{self, PreparedTrainingProfiles, SchoolMode, YouthSource},
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
fn complete_youth_exam_kernel_results_and_reports_match_original_source_from_raw_inputs() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/training-exam-golden.json")).unwrap();
    assert_eq!(
        fixture["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 74);
    let ids: PackageIds = serde_json::from_value(fixture["packageIds"].clone()).unwrap();
    let resolvers = fixture["catalogs"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, v)| {
            (
                k,
                RuleResolver::from_catalog_json(v.clone(), ids.clone(), None).unwrap(),
            )
        })
        .collect::<std::collections::BTreeMap<_, _>>();
    for case in cases {
        let i = &case["input"];
        assert!(i.get("baseCredits").is_none());
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
        let resolver = &resolvers[&i["resolver"].as_str().unwrap().to_owned()];
        let days =
            training::prepare_school_days(SchoolMode::Youth, &prepared, &profiles, month, resolver)
                .unwrap();
        let school = training::school_credits(&days, month, SchoolMode::Youth).unwrap();
        let exams = training::assess_youth_exams(&days, &school.daily).unwrap();
        let actual = json!({"baseCredits":school.to_json()["daily"],"daily":{"$type":"Map","entries":exams.daily.iter().collect::<Vec<_>>()},"events":exams.events.iter().map(|e|e.to_json()).collect::<Vec<_>>()});
        assert!(
            same(&actual, &case["expected"]),
            "{}\nactual {actual}\nexpected {}",
            case["id"],
            case["expected"]
        );
    }
}
