mod common;
use luna_engine::{
    EngineError,
    calendar::recurrence::CollationRanks,
    credit::{
        context::DailyCreditContextCache,
        daily::{self, CreditResult, DailyCreditContext},
        prepared::PreparedCreditEntries,
    },
    rules::RuleResolver,
};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::sync::Arc;
#[test]
fn fifty_thousand_original_entry_metadata_values_are_shared_under_one_owner() {
    let entries=Arc::new((0..50_000).map(|index|json!({"kind":"SHIFT","id":format!("entry-{index}"),"date":format!("2026-{:02}-{:02}",index/28%12+1,index%28+1),"type":"EARLY","startTime":"08:00","endTime":"16:00","breakMinutes":30,"allDay":false,"specialDuty":null,"deletedAt":null,"note":"metadata".repeat(32),"customMetadata":{"original":index}})).collect::<Vec<_>>());
    let weak = Arc::downgrade(&entries);
    let prepared = PreparedCreditEntries::from_shared(Arc::clone(&entries)).unwrap();
    assert!(Arc::ptr_eq(prepared.shared_owner().unwrap(), &entries));
    assert_eq!(prepared.entries().len(), 50_000);
    assert_eq!(prepared.borrowed_entry_count(), 50_000);
    assert_eq!(prepared.owned_duty_part_count(), 0);
    for index in [0, 25_000, 49_999] {
        assert!(
            std::ptr::eq(prepared.entries().nth(index).unwrap(), &entries[index]),
            "original metadata must be borrowed, never cloned"
        );
    }
    let ranks: CollationRanks = entries
        .iter()
        .filter(|entry| entry["date"] == "2026-07-01")
        .enumerate()
        .map(|(rank, entry)| (entry["id"].as_str().unwrap().to_owned(), rank as u32))
        .collect::<BTreeMap<_, _>>()
        .into();
    drop(entries);
    assert!(weak.upgrade().is_some());
    assert_eq!(
        prepared.entries().next().unwrap()["customMetadata"]["original"],
        0
    );
    let context =
        DailyCreditContext::from_json(&json!({"targetMinutes":462,"absenceReferenceMinutes":462}))
            .unwrap();
    for _ in 0..12 {
        let summary = daily::calculate_daily_work_credit_summary_prepared(
            "2026-07-01",
            &prepared,
            "Europe/Berlin",
            &context,
            &ranks,
        )
        .unwrap();
        assert_eq!(
            CreditResult {
                summary,
                allocations: vec![]
            }
            .to_json()
            .unwrap()["summary"]["actualMinutes"],
            450
        );
    }
    drop(prepared);
    assert!(weak.upgrade().is_none());
}
#[test]
fn prepared_views_full_allocations_and_summary_only_match_every_original_credit_fixture() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/credit-golden.json")).unwrap();
    let resolver = RuleResolver::bundled().unwrap();
    let mut count = 0;
    for case in fixture["cases"].as_array().unwrap() {
        let operation = case["operation"].as_str().unwrap();
        if ![
            "credit.projectDutyCalendarDays",
            "credit.calculateTimedDailyWorkCredit",
            "credit.calculateDailyWorkCredit",
        ]
        .contains(&operation)
        {
            continue;
        }
        let input = &case["input"];
        let entries = input["entries"].as_array().unwrap();
        let shared = Arc::new(entries.clone());
        let views = [
            PreparedCreditEntries::new(entries).unwrap(),
            PreparedCreditEntries::from_refs(entries.iter().collect()).unwrap(),
            PreparedCreditEntries::from_shared(Arc::clone(&shared)).unwrap(),
        ];
        for prepared in views {
            let actual = match operation {
                "credit.projectDutyCalendarDays" => json!(prepared.entries().collect::<Vec<_>>()),
                "credit.calculateTimedDailyWorkCredit" => {
                    daily::calculate_timed_daily_work_credit_prepared(
                        input["date"].as_str().unwrap(),
                        &prepared,
                        input["timeZone"].as_str().unwrap(),
                        &serde_json::from_value(input["collationRanks"].clone()).unwrap(),
                    )
                    .unwrap()
                    .to_json()
                    .unwrap()
                }
                _ => {
                    let date = input["date"].as_str().unwrap();
                    let ranks = serde_json::from_value(input["collationRanks"].clone()).unwrap();
                    let mut cache = DailyCreditContextCache::new(&input["profile"], &resolver);
                    let full = cache
                        .calculate_prepared(date, &prepared, &ranks)
                        .unwrap()
                        .to_json()
                        .unwrap();
                    let summary = cache.summary_prepared(date, &prepared, &ranks).unwrap();
                    let actual = CreditResult {
                        summary,
                        allocations: vec![],
                    }
                    .to_json()
                    .unwrap();
                    common::assert_json_eq(
                        &actual["summary"],
                        &case["expected"]["summary"],
                        case["id"].as_str().unwrap(),
                    );
                    full
                }
            };
            common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
            count += 1;
        }
    }
    assert_eq!(count, 132);
}
#[test]
fn summary_only_keeps_absence_owner_rank_validation_and_stable_equal_ranks() {
    let entries = vec![
        json!({"kind":"SHIFT","id":"ä","date":"2026-07-01","type":"VACATION","allDay":true,"startTime":null,"endTime":null,"breakMinutes":0,"deletedAt":null,"note":"first"}),
        json!({"kind":"SHIFT","id":"a\u{308}","date":"2026-07-01","type":"VACATION","allDay":true,"startTime":null,"endTime":null,"breakMinutes":0,"deletedAt":null,"note":"second"}),
    ];
    let prepared = PreparedCreditEntries::new(&entries).unwrap();
    let context =
        DailyCreditContext::from_json(&json!({"targetMinutes":462,"absenceReferenceMinutes":462}))
            .unwrap();
    assert!(matches!(
        daily::calculate_daily_work_credit_summary_prepared(
            "2026-07-01",
            &prepared,
            "Europe/Berlin",
            &context,
            &CollationRanks::default()
        ),
        Err(EngineError::InvalidCollation)
    ));
    let ranks = serde_json::from_value(json!({"ä":1,"a\u{308}":1})).unwrap();
    let full = daily::calculate_daily_work_credit_prepared(
        "2026-07-01",
        &prepared,
        "Europe/Berlin",
        &context,
        &ranks,
    )
    .unwrap();
    assert_eq!(full.allocations[0].entry["note"], "first");
    assert_eq!(full.allocations[0].entry, entries[0]);
}
