use bigdecimal::BigDecimal;
use luna_engine::{
    rules::{PackageIds, RuleResolver},
    training::{self, PreparedTrainingProfiles, SchoolMode, TrainingDay, YouthEntry, YouthSource},
};
use serde_json::{Value, json};
use std::{str::FromStr, sync::Arc};
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
fn observe_day(day: &TrainingDay<'_>, mode: SchoolMode) -> Value {
    let entries =
        |entries: Vec<&YouthEntry>| entries.iter().map(|e| e.to_json()).collect::<Vec<_>>();
    let legal = day.legal();
    let mut value = json!({"date":day.date(),"week":day.week(),"facts":day.facts(),"rules":{"school":day.school_rules(),"breaks":{"minimumSegmentMinutes":day.minimum_pause_minutes()}},"entries":entries(day.entries().iter().collect()),"schoolEntries":entries(day.school_entries()),"workEntries":entries(day.work_entries()),"legalIdentity":{"packageId":legal.package_id,"versionId":legal.version_id,"engineContractVersion":legal.engine_contract_version}});
    let map = value.as_object_mut().unwrap();
    match mode {
        SchoolMode::Youth => {
            map.insert("age".into(), json!(day.age()));
        }
        SchoolMode::AdultBbig => {
            map.insert("adult".into(), json!(day.adult()));
            map.insert("training".into(), day.training().clone());
        }
    }
    value
}
#[test]
fn raw_native_days_and_school_credits_match_the_actual_public_source_call_arguments_and_results() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/training-school-golden.json")).unwrap();
    assert_eq!(
        fixture["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 86);
    let ids: PackageIds = serde_json::from_value(fixture["packageIds"].clone()).unwrap();
    let resolver = RuleResolver::from_catalog_json(fixture["catalog"].clone(), ids, None).unwrap();
    for case in cases {
        let input = &case["input"];
        assert!(input.get("facts").is_none());
        assert!(input.get("entries").is_none());
        let source = YouthSource::new(
            input["shifts"].as_array().unwrap().clone().into(),
            input["details"].as_array().unwrap().clone().into(),
            Arc::new(input["profile"].clone()),
        );
        let month = input["month"].as_str().unwrap();
        let prepared = source.prepare(month).unwrap();
        let profiles =
            PreparedTrainingProfiles::try_from_raw(input["profiles"].as_array().unwrap()).unwrap();
        let actual=[SchoolMode::Youth,SchoolMode::AdultBbig].into_iter().map(|mode|{
            let days=training::prepare_school_days(mode,&prepared,&profiles,month,&resolver).unwrap();let credit=training::school_credits(&days,month,mode).unwrap();
            json!({"mode":if mode==SchoolMode::Youth{"YOUTH"}else{"ADULT_BBIG"},"days":days.iter().map(|d|observe_day(d,mode)).collect::<Vec<_>>(),"credits":credit.to_json(),"events":credit.events.iter().map(|e|e.to_json()).collect::<Vec<_>>()})
        }).collect::<Vec<_>>();
        assert!(
            same_value(&json!(actual), &case["expected"]),
            "{}\nactual {}\nexpected {}",
            case["id"],
            json!(actual),
            case["expected"]
        );
    }
}

#[test]
fn clipped_native_days_share_original_shift_metadata_and_checked_profile_without_repreparing_entries()
 {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/training-school-golden.json")).unwrap();
    let input = &fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "training-school-dst-overnight-2026-03")
        .unwrap()["input"];
    let source = YouthSource::new(
        input["shifts"].as_array().unwrap().clone().into(),
        input["details"].as_array().unwrap().clone().into(),
        Arc::new(input["profile"].clone()),
    );
    let prepared = source.prepare("2026-03").unwrap();
    let profiles =
        PreparedTrainingProfiles::try_from_raw(input["profiles"].as_array().unwrap()).unwrap();
    let ids: PackageIds = serde_json::from_value(fixture["packageIds"].clone()).unwrap();
    let resolver = RuleResolver::from_catalog_json(fixture["catalog"].clone(), ids, None).unwrap();
    for _ in 0..32 {
        let days = training::prepare_school_days(
            SchoolMode::Youth,
            &prepared,
            &profiles,
            "2026-03",
            &resolver,
        )
        .unwrap();
        let occupied = days
            .iter()
            .filter(|d| !d.entries().is_empty())
            .collect::<Vec<_>>();
        assert_eq!(occupied.len(), 2);
        assert_eq!(
            occupied[0].entries()[0].end_epoch_milliseconds(),
            occupied[1].entries()[0].start_epoch_milliseconds()
        );
        for day in occupied {
            assert!(std::ptr::eq(
                day.entries()[0].shift(),
                prepared.entries()[0].shift()
            ));
            assert!(std::ptr::eq(
                day.training(),
                &profiles.for_date(day.date()).unwrap().unwrap()["data"]
            ));
        }
    }
    assert_eq!(source.stats().entry_preparations, 1);
}
