mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    contract::{OwnerIdentity, SourceKind, assembly::SnapshotAssembly},
    rules::RuleResolver,
    runtime::{
        SnapshotRegistry, day_details_source::NativeDayDetailsSource,
        write_resource::WriteContextStamp,
    },
};
use serde_json::{Value, json};
fn stamp() -> WriteContextStamp {
    WriteContextStamp::from_raw(&json!({"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":"11111111111111111111111111111111","databaseSchemaVersion":35})).unwrap()
}
fn bytes(value: &Value) -> Vec<u8> {
    serde_json::to_vec(value).unwrap()
}
#[test]
fn actual_working_time_provider_join_keeps_calculation_profile_precedence() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/day-details-provider-join-golden.json"
    ));
    let registry = registry();
    let mut distinguished = 0;
    for (index, c) in fixture["cases"].as_array().unwrap().iter().enumerate() {
        let input = &c["input"];
        if input["profileViews"]["profile"]["timeZone"]
            == input["profileViews"]["calculationProfile"]["timeZone"]
        {
            continue;
        }
        distinguished += 1;
        let source = NativeDayDetailsSource::prepare(
            registry.utility_owner_marker().unwrap(),
            stamp(),
            source(input, index),
            input["rawSource"]["epoch"].as_i64().unwrap(),
        )
        .unwrap();
        let actual = source
            .profile()
            .unwrap()
            .map_or(Value::Null, |value| value.as_ref().clone());
        common::assert_json_eq(&actual, &input["profile"], c["id"].as_str().unwrap());
    }
    assert_eq!(distinguished, 32);
}

fn source(input: &Value, index: usize) -> SnapshotAssembly {
    let raw = &input["rawSource"];
    let ids = RuleResolver::bundled()
        .unwrap()
        .default_package_ids()
        .clone();
    let mut source=SnapshotAssembly::begin(&bytes(&json!({"ownerScope":"day-details","ownerEpoch":1,"snapshotId":format!("day-details-{index}"),"snapshotRevision":1,"selectedPackageIds":{"tariff":[ids.tariff],"legal":[ids.legal],"holiday":[ids.holiday]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}}))).unwrap();
    for (kind, key) in [
        (SourceKind::WorkProfile, "profile"),
        (SourceKind::RemunerationProfiles, "historyRows"),
        (SourceKind::WorkPatternSettings, "patternRows"),
        (SourceKind::WorkingTimeTarget, "targetRow"),
        (SourceKind::CalendarEntries, "calendar"),
        (SourceKind::YouthPreference, "youthPreference"),
    ] {
        let kind_name = serde_json::to_value(kind).unwrap();
        if let Some(state) = input
            .get("testSourceStates")
            .and_then(|states| states.get(kind_name.as_str().unwrap()))
        {
            source
                .source(&bytes(&json!({"kind":kind,"source":state})), &[])
                .unwrap();
            continue;
        }
        if kind == SourceKind::WorkingTimeTarget && raw["targetState"] != "READY" {
            let state = if raw["targetState"] == "LOADING" {
                json!({"state":"LOADING"})
            } else {
                json!({"state":"FAILED","code":"READ_FAILED"})
            };
            source
                .source(&bytes(&json!({"kind":kind,"source":state})), &[])
                .unwrap();
            continue;
        }
        let mut body = raw[key].clone();
        if kind == SourceKind::CalendarEntries {
            body["platformCollationRanks"] = if input["testUnranked"] == true {
                json!({})
            } else {
                input["ranks"].clone()
            };
        }
        if kind == SourceKind::WorkingTimeTarget && !body.is_null() {
            // Actual native-engine-source-sql transports original JSON text
            // chunks. No parsed settings or computed target enters the source.
            let text = body
                .as_object_mut()
                .unwrap()
                .remove("settings_json")
                .unwrap();
            body["settings_json_chunks"] = json!([text]);
        }
        let mut state = json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":if body.is_null(){"NULL"}else{"VALUE"}}}});
        if kind == SourceKind::CalendarEntries
            && let Some(coverage) = input.get("testCalendarCoverage")
        {
            state["coverage"] = coverage.clone();
        }
        source
            .source(
                &bytes(&json!({"kind":kind,"source":state})),
                &if body.is_null() { vec![] } else { bytes(&body) },
            )
            .unwrap();
    }
    for kind in ["TARIFF", "LEGAL", "HOLIDAY"] {
        source.catalog(&bytes(&json!({"kind":kind,"source":{"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE"}}}})),br#"{"mode":"COMPILED_LEGACY"}"#).unwrap();
    }
    source
}

#[test]
fn independent_locale_preflight_builds_the_same_source_from_unranked_original_rows() {
    use luna_engine::runtime::day_details_source::NativeDayDetailsAssembly;
    let fixture = value_pool::decode(include_str!(
        "../../reference/day-details-provider-join-golden.json"
    ));
    let registry = registry();
    let locale: Value = serde_json::from_str(include_str!(
        "../../reference/day-details-platform-ranks.json"
    ))
    .unwrap();
    let recurrence_locale: Value = serde_json::from_str(include_str!(
        "../../reference/day-details-recurrence-ranks.json"
    ))
    .unwrap();
    let cases: Vec<_> = fixture["cases"].as_array().unwrap().iter().collect();
    let locale_rows: Vec<_> = locale["cases"]
        .as_array()
        .unwrap()
        .iter()
        .chain(recurrence_locale["cases"].as_array().unwrap())
        .collect();
    assert_eq!(cases.len(), 348);
    for (index, case) in cases.into_iter().enumerate() {
        let mut input = case["input"].clone();
        input["testUnranked"] = json!(true);
        input["ranks"] = locale_rows[index]["ranks"].clone();
        assert_eq!(locale_rows[index]["id"], case["id"]);
        let mut assembly = NativeDayDetailsAssembly::new(
            registry.utility_owner_marker().unwrap(),
            stamp(),
            source(&input, index),
            input["rawSource"]["epoch"].as_i64().unwrap(),
            input["date"].as_str().unwrap(),
        )
        .unwrap();
        assembly
            .prepare()
            .unwrap_or_else(|error| panic!("{}:{error:?}", case["id"]));
        for name in assembly.calendar_candidates().unwrap() {
            assert!(
                input["ranks"].get(name).is_some(),
                "{} missing original locale fact {name}",
                case["id"]
            );
        }
        assert!(assembly.catalog_candidates().unwrap().is_empty());
        let source = assembly.finish(&bytes(&input["ranks"]), b"{}").unwrap();
        let actual = source
            .profile()
            .unwrap()
            .map_or(Value::Null, |profile| profile.as_ref().clone());
        common::assert_json_eq(&actual, &input["profile"], case["id"].as_str().unwrap());
        let date = input["date"].as_str().unwrap();
        let actual = match source.project(date).unwrap() {
            None => json!({"state":"LOADING"}),
            Some(view) => {
                let mut value = view.metadata().unwrap();
                let mut rows = Vec::new();
                for offset in (0..view.entry_count().unwrap()).step_by(3) {
                    rows.extend(view.rows(offset, 3).unwrap());
                }
                value["entries"] = Value::Array(rows);
                value
            }
        };
        let mut expected = case["expected"].clone();
        if let Some(rows) = expected.get_mut("entries").and_then(Value::as_array_mut) {
            for row in rows {
                row.as_object_mut().unwrap().remove("route");
            }
        }
        common::assert_json_eq(&actual, &expected, case["id"].as_str().unwrap());
    }
}

#[test]
fn preflight_rejects_unavailable_partial_or_prematurely_ranked_sources_and_stale_owners() {
    use luna_engine::runtime::day_details_source::NativeDayDetailsAssembly;
    let registry = registry();
    let mut input = first();
    let date = input["date"].as_str().unwrap().to_owned();
    let epoch = input["rawSource"]["epoch"].as_i64().unwrap();
    let make = |input: &Value, requested: &str| {
        NativeDayDetailsAssembly::new(
            registry.utility_owner_marker().unwrap(),
            stamp(),
            source(input, 0),
            epoch,
            requested,
        )
        .unwrap()
    };
    assert!(make(&input, &date).prepare().is_err());
    input["testUnranked"] = json!(true);
    input["testCalendarCoverage"] =
        json!({"kind":"DATE_RANGES","ranges":[{"start":"2026-07-01","end":"2026-07-01"}]});
    assert!(make(&input, &date).prepare().is_err());
    input
        .as_object_mut()
        .unwrap()
        .remove("testCalendarCoverage");
    input["testSourceStates"] = json!({"CALENDAR_ENTRIES":{"state":"FAILED","code":"READ_FAILED"}});
    assert!(make(&input, &date).prepare().is_err());
    input.as_object_mut().unwrap().remove("testSourceStates");
    let mut missing = make(&input, "2026-07-02");
    missing.prepare().unwrap();
    assert!(
        missing
            .calendar_candidates()
            .unwrap()
            .contains("2026-07-02")
    );
    assert!(missing.finish(&bytes(&input["ranks"]), b"{}").is_err());
    let mut stale = make(&input, &date);
    stale.prepare().unwrap();
    registry
        .reset_for_owner(&OwnerIdentity::new("day-details", 1).unwrap())
        .unwrap();
    assert!(stale.calendar_candidates().is_err());
    assert!(stale.catalog_candidates().is_err());
    assert!(stale.finish(&bytes(&input["ranks"]), b"{}").is_err());
}

fn first() -> Value {
    value_pool::decode(include_str!(
        "../../reference/day-details-source-golden.json"
    ))["cases"][0]["input"]
        .clone()
}
fn registry() -> SnapshotRegistry {
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("day-details", 1).unwrap())
        .unwrap();
    registry
}
fn prepared(registry: &SnapshotRegistry, input: &Value) -> NativeDayDetailsSource {
    NativeDayDetailsSource::prepare(
        registry.utility_owner_marker().unwrap(),
        stamp(),
        source(input, 0),
        input["rawSource"]["epoch"].as_i64().unwrap(),
    )
    .unwrap()
}
#[test]
fn unchanged_days_reuse_bounded_native_views_and_owner_reset_fences_already_returned_pages() {
    use luna_engine::contract::RevisionFence;
    let input = first();
    let registry = registry();
    let source = prepared(&registry, &input);
    let date = input["date"].as_str().unwrap();
    let first = source.project(date).unwrap().unwrap();
    assert!(first.shares_projection(&source.project(date).unwrap().unwrap()));
    assert_eq!(source.stamp().unwrap(), &stamp());
    let epoch = input["rawSource"]["epoch"].as_i64().unwrap();
    assert!(source.is_fresh_at(epoch).unwrap());
    assert!(!source.is_fresh_at(epoch - 1).unwrap());
    let expires = source.valid_until_epoch_milliseconds().unwrap().unwrap();
    assert!(source.is_fresh_at(expires - 1).unwrap());
    assert!(!source.is_fresh_at(expires).unwrap());
    assert!(source.is_fresh_at(i64::MAX).is_err());
    let fence = RevisionFence::new(OwnerIdentity::new("day-details", 1).unwrap(), 2).unwrap();
    registry.advance_revision(&fence).unwrap();
    assert!(source.is_current().unwrap());
    assert!(first.shares_projection(&source.project(date).unwrap().unwrap()));
    for next in ["2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05"] {
        source.project(next).unwrap().unwrap();
    }
    assert!(!first.shares_projection(&source.project(date).unwrap().unwrap()));
    registry
        .reset_for_owner(&OwnerIdentity::new("day-details", 1).unwrap())
        .unwrap();
    assert!(!source.is_current().unwrap());
    assert!(source.project(date).is_err());
    assert!(source.profile().is_err());
    assert!(first.metadata().is_err());
    assert!(first.entry_count().is_err());
    assert!(first.rows(0, 1).is_err());
}
#[test]
fn unrelated_sources_and_incomplete_profile_or_calendar_reads_never_create_empty_ready_views() {
    let input = first();
    let registry = registry();
    let epoch = input["rawSource"]["epoch"].as_i64().unwrap();
    for kind in ["WORK_PROFILE", "CALENDAR_ENTRIES"] {
        for state in [
            json!({"state":"NOT_REQUESTED"}),
            json!({"state":"LOADING"}),
            json!({"state":"FAILED","code":"READ_FAILED"}),
        ] {
            let mut input = input.clone();
            input["testSourceStates"] = json!({});
            input["testSourceStates"][kind] = state;
            assert!(
                NativeDayDetailsSource::prepare(
                    registry.utility_owner_marker().unwrap(),
                    stamp(),
                    source(&input, 0),
                    epoch
                )
                .is_err()
            );
        }
    }
    let mut outside = source(&input, 1);
    outside.source(&bytes(&json!({"kind":"NET_PAY_SETTINGS_TIMELINE","source":{"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"NULL"}}}})),&[]).unwrap();
    assert!(matches!(
        NativeDayDetailsSource::prepare(
            registry.utility_owner_marker().unwrap(),
            stamp(),
            outside,
            epoch
        ),
        Err(luna_engine::runtime::day_details_source::DayDetailsSourceError::InvalidSourceScope)
    ));
    let other = SnapshotRegistry::default();
    other
        .reset_for_owner(&OwnerIdentity::new("foreign", 1).unwrap())
        .unwrap();
    assert!(
        NativeDayDetailsSource::prepare(
            other.utility_owner_marker().unwrap(),
            stamp(),
            source(&input, 2),
            epoch
        )
        .is_err()
    );
    let mut null = input.clone();
    null["rawSource"]["profile"] = Value::Null;
    let empty = prepared(&registry, &null);
    assert!(empty.profile().unwrap().is_none());
    assert!(empty.project("2026-07-01").unwrap().is_none());
    assert!(empty.project("invalid").is_err());
}
#[test]
fn visible_completion_does_not_retain_unrelated_profile_or_target_facts_after_source_disposal() {
    use std::sync::Arc;
    let input = first();
    let registry = registry();
    let source = prepared(&registry, &input);
    let profile = Arc::downgrade(source.profile().unwrap().unwrap());
    let view = source
        .project(input["date"].as_str().unwrap())
        .unwrap()
        .unwrap();
    assert!(profile.upgrade().is_some());
    drop(source);
    assert!(profile.upgrade().is_none());
    assert!(view.metadata().is_ok());
    assert!(view.rows(0, 128).is_ok());
}
#[test]
fn genuine_raw_sources_match_original_profiles_and_full_day_details_without_global_preparation() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/day-details-provider-join-golden.json"
    ));
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 348);
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("day-details", 1).unwrap())
        .unwrap();
    for (index, case) in fixture["cases"].as_array().unwrap().iter().enumerate() {
        let input = &case["input"];
        let global = registry.preparation_marker().unwrap();
        let source = NativeDayDetailsSource::prepare(
            registry.utility_owner_marker().unwrap(),
            stamp(),
            source(input, index),
            input["rawSource"]["epoch"].as_i64().unwrap(),
        )
        .unwrap_or_else(|error| panic!("{}: {error:?}", case["id"]));
        let profile = source
            .profile()
            .unwrap()
            .map_or(Value::Null, |value| value.as_ref().clone());
        common::assert_json_eq(&profile, &input["profile"], case["id"].as_str().unwrap());
        assert!(source.is_current().unwrap());
        assert!(global.is_current().unwrap());
        let actual = match source.project(input["date"].as_str().unwrap()).unwrap() {
            None => json!({"state":"LOADING"}),
            Some(view) => {
                let mut value = view.metadata().unwrap();
                let mut rows = Vec::new();
                for offset in (0..view.entry_count().unwrap()).step_by(3) {
                    rows.extend(view.rows(offset, 3).unwrap());
                }
                value["entries"] = Value::Array(rows);
                value
            }
        };
        let mut expected = case["expected"].clone();
        if let Some(rows) = expected.get_mut("entries").and_then(Value::as_array_mut) {
            for row in rows {
                row.as_object_mut().unwrap().remove("route");
            }
        }
        common::assert_json_eq(&actual, &expected, case["id"].as_str().unwrap());
    }
}
