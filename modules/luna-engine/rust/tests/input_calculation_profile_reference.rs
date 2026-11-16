mod common;
use luna_engine::{
    calendar::recurrence::CollationRanks,
    input::{
        calculation_profile::{TargetProfileFacts, YouthProtectionFacts, calculation_work_profile},
        calendar_rows::PreparedCalendarRows,
        employment::RawEmploymentHistory,
        stored_profile::checked_stored_work_profile,
        working_time_target::RawSavedWorkingTimeTarget,
    },
    target::InputStatus,
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc};
fn status(s: &str) -> InputStatus {
    match s {
        "loading" => InputStatus::Loading,
        "error" => InputStatus::Error,
        "ready" => InputStatus::Ready,
        _ => panic!("unknown source status"),
    }
}
#[test]
fn complete_raw_profile_history_plan_and_saved_target_match_original_profile_flow() {
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/input-calculation-profile-golden.json"
    ))
    .unwrap();
    assert_eq!(data["cases"].as_array().unwrap().len(), 490);
    let profiles = data["profiles"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            checked_stored_work_profile(
                Arc::new(p["profileRow"].clone()),
                Arc::new(p["salaryRows"].as_array().unwrap().clone()),
            )
            .unwrap()
        })
        .collect::<Vec<_>>();
    let histories = data["histories"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| {
            RawEmploymentHistory::try_from_rows(Arc::new(h.as_array().unwrap().clone())).unwrap()
        })
        .collect::<Vec<_>>();
    let targets = data["targets"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| {
            let saved = if t["row"].is_null() {
                None
            } else {
                let mut row = t["row"].clone();
                let text = row
                    .as_object_mut()
                    .unwrap()
                    .remove("settings_json")
                    .unwrap();
                row["settings_json_chunks"] = json!([text]);
                Some(RawSavedWorkingTimeTarget::try_from_raw_row_chunks(&row).unwrap())
            };
            let prepared = PreparedCalendarRows::from_rows(
                Arc::new(t["shiftRows"].as_array().unwrap().clone()),
                Arc::new(vec![]),
            )
            .unwrap();
            let ranks: CollationRanks = prepared
                .collation_candidates()
                .iter()
                .enumerate()
                .map(|(i, s)| (s.clone(), i as u32))
                .collect::<BTreeMap<_, _>>()
                .into();
            (saved, prepared.into_ranked(&ranks).unwrap())
        })
        .collect::<Vec<_>>();
    let mut gaps = 0;
    for case in data["cases"].as_array().unwrap() {
        let p = &profiles[case["profileIndex"].as_u64().unwrap() as usize];
        let h = &histories[case["historyIndex"].as_u64().unwrap() as usize];
        let (saved, calendar) = &targets[case["targetIndex"].as_u64().unwrap() as usize];
        let facts = match status(case["status"].as_str().unwrap()) {
            InputStatus::Loading => TargetProfileFacts::Loading,
            InputStatus::Error => TargetProfileFacts::Error,
            InputStatus::Ready => TargetProfileFacts::Ready {
                saved: saved.as_ref(),
                calendar,
            },
        };
        let youth = &data["youth"][case["youthIndex"].as_u64().unwrap() as usize];
        let result = calculation_work_profile(
            p,
            h,
            "2026-07-02",
            facts,
            YouthProtectionFacts {
                value: youth["value"].as_bool(),
                status: status(youth["status"].as_str().unwrap()),
            },
        );
        if case["noncanonicalNativeGap"] == true {
            gaps += 1;
            assert!(result.is_err(), "explicit stricter raw-SQL target boundary");
            continue;
        }
        let actual = match result {
            Ok(v) => json!({"value":v.as_ref()}),
            Err(e) => json!({"$error":e.message(),"name":e.name()}),
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
    assert_eq!(gaps, 1);
}
