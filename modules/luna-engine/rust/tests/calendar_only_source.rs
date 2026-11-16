mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    calendar::recurrence::CollationRanks,
    calendar::window::{WindowOptions, WindowSpec},
    contract::SourceState,
    runtime::calendar_only::{CalendarClock, CalendarClockOrigin, CalendarRows},
};
use serde_json::{Value, json};
fn ready(value: Value) -> SourceState {
    serde_json::from_value(json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":value}}})).unwrap()
}
fn null() -> SourceState {
    serde_json::from_value(json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"NULL"}}})).unwrap()
}
fn clocks() -> Value {
    value_pool::decode(include_str!("../../reference/profile-clock-golden.json"))
}
#[test]
fn calendar_clock_preserves_original_analysis_role_and_all_selection_midnight_bounds() {
    let data = clocks();
    let mut count = 0;
    let mut distinct_provider = 0;
    for case in data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["expected"]["value"].is_object())
    {
        let i = &case["input"];
        let expected = &case["expected"]["value"];
        let epoch = i["observedEpochMilliseconds"].as_i64().unwrap();
        let p = if i["profile"].is_null() {
            null()
        } else {
            ready(i["profile"].clone())
        };
        let clock = CalendarClock::prepare(
            "calendar-owner",
            &p,
            &ready(i["historyRows"].clone()),
            epoch,
        )
        .unwrap();
        let meta = serde_json::to_value(clock.metadata()).unwrap();
        assert_eq!(
            meta["timeZone"], expected["analysisTimeZone"],
            "{}",
            case["id"]
        );
        assert_eq!(
            meta["referenceDate"], expected["referenceDate"],
            "{}",
            case["id"]
        );
        assert_eq!(meta["month"], expected["month"]);
        assert_eq!(
            meta["validUntilEpochMilliseconds"],
            expected["validUntilEpochMilliseconds"]
        );
        assert_eq!(
            clock.metadata().origin,
            CalendarClockOrigin::AnalysisProfile
        );
        assert!(clock.metadata().cacheable);
        assert!(meta["issue"].is_null());
        let until = clock.metadata().valid_until_epoch_milliseconds.unwrap();
        assert!(clock.is_valid_at(epoch));
        assert!(clock.is_valid_at(until - 1));
        assert!(!clock.is_valid_at(epoch - 1));
        assert!(!clock.is_valid_at(until));
        let next = CalendarClock::prepare(
            "calendar-owner",
            &p,
            &ready(i["historyRows"].clone()),
            epoch + 1,
        )
        .unwrap();
        // `until` was compared above with the complete original M1 output.
        // The added three-zone millisecond case intentionally crosses that
        // selection midnight; reuse is allowed only inside the same anchor.
        if epoch + 1 < until {
            assert_eq!(
                clock.key(),
                next.key(),
                "{} within original clock anchor",
                case["id"]
            );
        } else {
            assert_ne!(
                clock.key(),
                next.key(),
                "{} crossed original selection midnight",
                case["id"]
            );
        }
        if expected["providerTimeZone"] != expected["analysisTimeZone"] {
            distinct_provider += 1;
        }
        assert!(serde_json::to_vec(&meta).unwrap().len() < 2048);
        assert!(meta.get("providerProfile").is_none());
        count += 1;
    }
    assert!(count >= 239);
    assert!(
        distinct_provider > 0,
        "contradictory three-zone source case required"
    );
}
#[test]
fn degraded_clock_is_explicit_nonpersistent_and_uses_only_a_valid_saved_zone() {
    let data = clocks();
    let c = data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "zone-1-instant-0-history-0")
        .unwrap();
    let i = &c["input"];
    let failed: SourceState =
        serde_json::from_value(json!({"state":"FAILED","code":"READ_FAILED"})).unwrap();
    let epoch = i["observedEpochMilliseconds"].as_i64().unwrap();
    let clock = CalendarClock::prepare(
        "calendar-owner",
        &ready(i["profile"].clone()),
        &failed,
        epoch,
    )
    .unwrap();
    assert_eq!(
        clock.metadata().origin,
        CalendarClockOrigin::DegradedSavedZone
    );
    assert_eq!(clock.metadata().time_zone, "America/Los_Angeles");
    assert!(!clock.metadata().cacheable);
    assert!(clock.metadata().valid_until_epoch_milliseconds.is_none());
    assert!(!clock.is_valid_at(epoch));
    assert_eq!(
        clock.metadata().issue.as_ref().unwrap().code,
        "SOURCE_READ_FAILED"
    );
    for source in [
        failed.clone(),
        SourceState::Loading,
        SourceState::NotRequested,
    ] {
        let clock = CalendarClock::prepare("calendar-owner", &source, &failed, epoch).unwrap();
        assert_eq!(clock.metadata().origin, CalendarClockOrigin::DegradedBerlin);
        assert_eq!(clock.metadata().time_zone, "Europe/Berlin");
        assert!(!clock.metadata().cacheable);
    }
    assert!(CalendarClock::prepare("calendar-owner", &failed, &failed, i64::MAX).is_err());
    assert!(CalendarClock::prepare("", &failed, &failed, epoch).is_err());
    let recovered = CalendarClock::prepare(
        "calendar-owner",
        &ready(i["profile"].clone()),
        &ready(i["historyRows"].clone()),
        epoch,
    )
    .unwrap();
    assert!(recovered.metadata().cacheable);
    assert_ne!(clock.key(), recovered.key());
}
#[test]
fn raw_calendar_normalization_and_selected_order_match_all_original_template_sql_cases() {
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/calendar-templates-golden.json"
    ))
    .unwrap();
    let mut count = 0;
    for case in data["cases"].as_array().unwrap() {
        let mut raw = case["input"].clone();
        raw["platformCollationRanks"] = json!({});
        let rows = CalendarRows::prepare(&ready(raw.clone())).unwrap();
        let again = CalendarRows::prepare(&ready(raw.clone())).unwrap();
        assert_eq!(rows.key(), again.key());
        let ranks: CollationRanks =
            serde_json::from_value(case["input"]["platformCollationRanks"].clone()).unwrap();
        let prepared = rows
            .index()
            .prepare(&WindowSpec::PrototypeYear {
                year: "2026".into(),
            })
            .unwrap();
        let view = prepared
            .finalize(&ranks)
            .unwrap()
            .index(WindowOptions {
                show_appointments: true,
                show_shifts: true,
            })
            .unwrap();
        // The original fixture includes rows outside this year; compare the same original bounds.
        let expected = case["expected"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|v| {
                v["date"].as_str().unwrap() >= "2026-01-01"
                    && v["date"].as_str().unwrap() <= "2026-12-31"
            })
            .cloned()
            .collect::<Vec<_>>();
        let actual = serde_json::to_value(view).unwrap();
        common::assert_json_eq(
            &actual["expanded"],
            &json!(expected),
            case["id"].as_str().unwrap(),
        );
        raw["computedReady"] = json!(true);
        assert!(CalendarRows::prepare(&ready(raw)).is_err());
        count += 1;
    }
    assert_eq!(count, 72);
}
#[test]
fn missing_null_failed_and_empty_calendar_sources_remain_distinct() {
    let empty = ready(
        json!({"shiftRows":[],"appointmentRows":[],"templateRows":[],"platformCollationRanks":{}}),
    );
    assert!(
        CalendarRows::prepare(&empty)
            .unwrap()
            .index()
            .source_entries()
            .is_empty()
    );
    for (state, code) in [
        (SourceState::NotRequested, "SOURCE_NOT_REQUESTED"),
        (SourceState::Loading, "SOURCE_LOADING"),
        (null(), "SOURCE_NULL"),
    ] {
        assert_eq!(CalendarRows::prepare(&state).err().unwrap().code, code);
    }
    let missing:SourceState=serde_json::from_value(json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"MISSING"}}})).unwrap();
    assert_eq!(
        CalendarRows::prepare(&missing).err().unwrap().code,
        "SOURCE_MISSING"
    );
    assert!(
        CalendarRows::prepare(&ready(
            json!({"shiftRows":[],"appointmentRows":[],"platformCollationRanks":{"Ready":0}})
        ))
        .is_err()
    );
}
