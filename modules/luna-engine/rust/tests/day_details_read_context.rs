mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    contract::{OwnerIdentity, SourceKind, assembly::SnapshotAssembly},
    runtime::{
        SnapshotRegistry, day_details_source::NativeDayDetailsReadAssembly,
        write_resource::WriteContextStamp,
    },
};
use serde_json::{Value, json};
fn bytes(value: &Value) -> Vec<u8> {
    serde_json::to_vec(value).unwrap()
}
fn stamp() -> WriteContextStamp {
    WriteContextStamp::from_raw(&json!({"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":"11111111111111111111111111111111","databaseSchemaVersion":35})).unwrap()
}
fn source(input: &Value) -> SnapshotAssembly {
    let raw = &input["rawSource"];
    let mut assembly=SnapshotAssembly::begin(br#"{"ownerScope":"source-owner","ownerEpoch":1,"snapshotId":"day-read","snapshotRevision":1,"selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}}"#).unwrap();
    for (kind, key) in [
        (SourceKind::WorkProfile, "profile"),
        (SourceKind::RemunerationProfiles, "historyRows"),
        (SourceKind::WorkPatternSettings, "patternRows"),
        (SourceKind::WorkingTimeTarget, "rawTargetRead"),
        (SourceKind::YouthPreference, "youthPreference"),
    ] {
        if kind == SourceKind::WorkingTimeTarget && raw["targetState"] != "READY" {
            let state = if raw["targetState"] == "LOADING" {
                json!({"state":"LOADING"})
            } else {
                json!({"state":"FAILED","code":"READ_FAILED"})
            };
            assembly
                .source(&bytes(&json!({"kind":kind,"source":state})), &[])
                .unwrap();
            continue;
        }
        let mut body = if kind == SourceKind::WorkingTimeTarget {
            input[key].clone()
        } else {
            raw[key].clone()
        };
        if kind == SourceKind::WorkingTimeTarget && !body["savedRow"].is_null() {
            let row = body["savedRow"].as_object_mut().unwrap();
            let text = row.remove("settings_json").unwrap();
            row.insert("settings_json_chunks".into(), json!([text]));
        }
        let state = json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":if body.is_null(){"NULL"}else{"VALUE"}}}});
        assembly
            .source(
                &bytes(&json!({"kind":kind,"source":state})),
                &if body.is_null() { vec![] } else { bytes(&body) },
            )
            .unwrap();
    }
    for kind in ["TARIFF", "LEGAL", "HOLIDAY"] {
        assembly.catalog(&bytes(&json!({"kind":kind,"source":{"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE"}}}})),br#"{"mode":"COMPILED_LEGACY"}"#).unwrap();
    }
    assembly
}
#[test]
fn actual_original_preferred_profiles_need_no_calendar_entries_or_index() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/day-details-read-context-golden.json"
    ));
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("source-owner", 1).unwrap())
        .unwrap();
    let mut count = 0;
    for c in fixture["cases"].as_array().unwrap() {
        let mut prepared = NativeDayDetailsReadAssembly::new(
            registry.utility_owner_marker().unwrap(),
            stamp(),
            source(&c["input"]),
            c["input"]["rawSource"]["epoch"].as_i64().unwrap(),
        )
        .unwrap();
        prepared.prepare().unwrap();
        let context = prepared.finish(b"{}").unwrap();
        let actual = context
            .profile()
            .unwrap()
            .map(|v| v.as_ref().clone())
            .unwrap_or(Value::Null);
        common::assert_json_eq(&actual, &c["expected"], c["id"].as_str().unwrap());
        count += 1;
    }
    assert_eq!(count, 348);
}

#[test]
fn native_read_context_joins_borrowed_typed_windows_against_complete_original_views() {
    use luna_engine::calendar::{
        recurrence::CollationRanks,
        window::{CalendarSourceIndex, WindowSpec},
    };
    use std::{collections::BTreeMap, sync::Arc};
    let reads = value_pool::decode(include_str!(
        "../../reference/day-details-read-context-golden.json"
    ));
    let views = value_pool::decode(include_str!(
        "../../reference/day-details-provider-join-golden.json"
    ));
    let locale: Value = serde_json::from_str(include_str!(
        "../../reference/day-details-platform-ranks.json"
    ))
    .unwrap();
    let recurrence_locale: Value = serde_json::from_str(include_str!(
        "../../reference/day-details-recurrence-ranks.json"
    ))
    .unwrap();
    let locale_rows = locale["cases"]
        .as_array()
        .unwrap()
        .iter()
        .chain(recurrence_locale["cases"].as_array().unwrap())
        .collect::<Vec<_>>();

    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("source-owner", 1).unwrap())
        .unwrap();
    let mut compared = 0;
    for c in reads["cases"].as_array().unwrap() {
        let full = views["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["id"] == c["id"])
            .unwrap();
        // The original screen's transient outer Loading surface is not a pure day-view projection.
        if c["expected"].is_null() || full["expected"]["state"] == "LOADING" {
            continue;
        }
        let epoch = c["input"]["rawSource"]["epoch"].as_i64().unwrap();
        let mut prepared = NativeDayDetailsReadAssembly::new(
            registry.utility_owner_marker().unwrap(),
            stamp(),
            source(&c["input"]),
            epoch,
        )
        .unwrap();
        prepared.prepare().unwrap();
        let context = prepared.finish(b"{}").unwrap();
        let input = &full["input"];
        let date = input["date"].as_str().unwrap();
        let platform = locale_rows.iter().find(|row| row["id"] == c["id"]).unwrap();
        let ranks: CollationRanks =
            serde_json::from_value::<BTreeMap<String, u32>>(platform["ranks"].clone())
                .unwrap()
                .into();
        let rows = Arc::new(
            input["entries"]
                .as_array()
                .unwrap()
                .iter()
                .cloned()
                .map(Arc::new)
                .collect::<Vec<_>>(),
        );
        let extra = context
            .additional_calendar_candidates(&rows, date, epoch)
            .unwrap();
        for name in extra {
            assert!(
                platform["ranks"].get(&name).is_some(),
                "missing frozen genuine rank {name}"
            );
        }
        let index = CalendarSourceIndex::from_entry_source(rows).unwrap();
        let window = index
            .prepare(&WindowSpec::Day { date: date.into() })
            .unwrap()
            .finalize(&ranks)
            .unwrap();
        let view = context
            .prepare_window(date, window, &ranks, epoch)
            .unwrap()
            .unwrap();
        let mut actual = view.metadata_at(epoch).unwrap();
        let mut rows = Vec::new();
        for offset in (0..view.entry_count_at(epoch).unwrap()).step_by(3) {
            rows.extend(view.rows_at(offset, 3, epoch).unwrap());
        }
        actual["entries"] = json!(rows);
        let mut expected = full["expected"].clone();
        for row in expected["entries"].as_array_mut().unwrap() {
            row.as_object_mut().unwrap().remove("route");
        }
        common::assert_json_eq(&actual, &expected, c["id"].as_str().unwrap());
        compared += 1;
    }
    assert_eq!(compared, 342);
}
#[test]
fn read_context_is_fenced_by_same_core_owner_signed_clock_and_epoch_boundary() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/day-details-read-context-golden.json"
    ));
    let c = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| !c["expected"].is_null())
        .unwrap();
    let epoch = c["input"]["rawSource"]["epoch"].as_i64().unwrap();
    let registry = SnapshotRegistry::default();
    let identity = OwnerIdentity::new("source-owner", 1).unwrap();
    registry.reset_for_owner(&identity).unwrap();
    let marker = registry.utility_owner_marker().unwrap();
    let mut prepared =
        NativeDayDetailsReadAssembly::new(marker.clone(), stamp(), source(&c["input"]), epoch)
            .unwrap();
    prepared.prepare().unwrap();
    let context = prepared.finish(b"{}").unwrap();
    assert!(context.shares_owner(&marker));
    assert!(context.is_current_at(epoch).unwrap());
    assert!(!context.is_current_at(epoch - 1).unwrap());
    let until = context.valid_until_epoch_milliseconds().unwrap().unwrap();
    assert!(context.is_current_at(until - 1).unwrap());
    assert!(!context.is_current_at(until).unwrap());
    let foreign = SnapshotRegistry::default();
    foreign.reset_for_owner(&identity).unwrap();
    assert!(!context.shares_owner(&foreign.utility_owner_marker().unwrap()));
    let full = value_pool::decode(include_str!(
        "../../reference/day-details-provider-join-golden.json"
    ));
    let original = full["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["id"] == c["id"])
        .unwrap();
    let input = &original["input"];
    let date = input["date"].as_str().unwrap();
    let ranks: luna_engine::calendar::recurrence::CollationRanks =
        serde_json::from_value::<std::collections::BTreeMap<String, u32>>(input["ranks"].clone())
            .unwrap()
            .into();
    let index = luna_engine::calendar::window::CalendarSourceIndex::new(std::sync::Arc::new(
        input["entries"].as_array().unwrap().clone(),
    ))
    .unwrap();
    let window = index
        .prepare(&luna_engine::calendar::window::WindowSpec::Day { date: date.into() })
        .unwrap()
        .finalize(&ranks)
        .unwrap();
    let view = context
        .prepare_window(date, window, &ranks, epoch)
        .unwrap()
        .unwrap();
    assert!(view.metadata_at(epoch).is_ok());
    assert!(view.metadata_at(until).is_err());
    assert!(view.rows_at(0, 1, until).is_err());
    registry.reset_for_owner(&identity).unwrap();
    assert!(view.metadata_at(epoch).is_err());
    assert!(view.rows_at(0, 1, epoch).is_err());
    assert!(!context.is_current_at(epoch).unwrap());
    assert!(context.profile().is_err());
    assert!(context.stamp().is_err());
}
#[test]
fn read_context_rejects_a_calendar_source_instead_of_silently_building_another_index() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/day-details-read-context-golden.json"
    ));
    let input = &fixture["cases"][0]["input"];
    let mut raw = source(input);
    raw.source(
        &bytes(&json!({"kind":"CALENDAR_ENTRIES","source":{"state":"LOADING"}})),
        &[],
    )
    .unwrap();
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("source-owner", 1).unwrap())
        .unwrap();
    assert!(
        NativeDayDetailsReadAssembly::new(
            registry.utility_owner_marker().unwrap(),
            stamp(),
            raw,
            input["rawSource"]["epoch"].as_i64().unwrap()
        )
        .is_err()
    );
}

#[test]
fn same_immutable_native_read_basis_reprojects_all_original_clock_epochs_without_new_source() {
    let source_fixture = value_pool::decode(include_str!(
        "../../reference/day-details-read-context-golden.json"
    ));
    let clock_fixture = value_pool::decode(include_str!(
        "../../reference/day-details-rebase-golden.json"
    ));
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("source-owner", 1).unwrap())
        .unwrap();
    let mut count = 0;
    for c in source_fixture["cases"].as_array().unwrap() {
        let epoch = c["input"]["rawSource"]["epoch"].as_i64().unwrap();
        let mut assembly = NativeDayDetailsReadAssembly::new(
            registry.utility_owner_marker().unwrap(),
            stamp(),
            source(&c["input"]),
            epoch,
        )
        .unwrap();
        assembly.prepare().unwrap();
        let initial = assembly.finish(b"{}").unwrap();
        for observed in clock_fixture["cases"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|o| o["input"]["sourceCaseId"] == c["id"])
        {
            let at = observed["input"]["epoch"].as_i64().unwrap();
            let context = initial.rebase_at(at).unwrap();
            let actual = context
                .profile()
                .unwrap()
                .map(|p| p.as_ref().clone())
                .unwrap_or(Value::Null);
            common::assert_json_eq(
                &actual,
                &observed["expected"],
                observed["id"].as_str().unwrap(),
            );
            assert_eq!(context.stamp().unwrap(), initial.stamp().unwrap());
            assert!(context.is_current_at(at).unwrap());
            count += 1;
        }
    }
    assert_eq!(count, 696);
}

#[test]
fn fresh_clock_rebase_shares_prepared_profile_and_releases_it_after_last_reader() {
    use std::sync::Arc;
    let fixture = value_pool::decode(include_str!(
        "../../reference/day-details-read-context-golden.json"
    ));
    let c = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| !c["expected"].is_null())
        .unwrap();
    let epoch = c["input"]["rawSource"]["epoch"].as_i64().unwrap();
    let registry = SnapshotRegistry::default();
    let owner = OwnerIdentity::new("source-owner", 1).unwrap();
    registry.reset_for_owner(&owner).unwrap();
    let mut assembly = NativeDayDetailsReadAssembly::new(
        registry.utility_owner_marker().unwrap(),
        stamp(),
        source(&c["input"]),
        epoch,
    )
    .unwrap();
    assembly.prepare().unwrap();
    let initial = assembly.finish(b"{}").unwrap();
    let until = initial.valid_until_epoch_milliseconds().unwrap().unwrap();
    let same = initial.rebase_at(until - 1).unwrap();
    let p = initial.profile().unwrap().unwrap();
    assert!(Arc::ptr_eq(p, same.profile().unwrap().unwrap()));
    let weak = Arc::downgrade(p);
    let next = initial.rebase_at(until).unwrap();
    assert!(next.is_current_at(until).unwrap());
    assert!(!initial.is_current_at(until).unwrap());
    drop(initial);
    assert!(weak.upgrade().is_some());
    drop(same);
    assert!(weak.upgrade().is_none());
    registry.reset_for_owner(&owner).unwrap();
    assert!(next.rebase_at(until).is_err());
}
