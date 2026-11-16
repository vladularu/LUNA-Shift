mod common;
#[path = "support/snapshot.rs"]
mod snapshot;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    contract::{
        self, ImmutableSnapshot, OwnerIdentity, SourceKind, ValidatedRequest,
        assembly::SnapshotAssembly,
        utility::{UtilityGuard, UtilityKind},
    },
    runtime::{
        SnapshotRegistry,
        day_editor_review::{DayReviewError, NativeDayReviewSource},
        day_editor_source::{
            DayEditorOpenRequest, DayEntryReadState, DayEntrySourceKind, NativeDayEditorSource,
            RawDayEntrySource,
        },
        profile_editor_source::LightProfileContext,
        write_resource::WriteContextStamp,
    },
};
use serde_json::{Value, json};
use std::sync::Arc;
fn stamp() -> WriteContextStamp {
    WriteContextStamp::from_raw(&json!({"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":"11111111111111111111111111111111","databaseSchemaVersion":35})).unwrap()
}
fn ready(value: &Value) -> Value {
    json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":if value.is_null(){json!({"kind":"NULL"})}else{json!({"kind":"VALUE","value":value})}}})
}
fn opened(
    input: &Value,
    index: usize,
) -> (
    SnapshotRegistry,
    Arc<NativeDayEditorSource>,
    luna_engine::runtime::utility_lease::UtilityLease,
) {
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("day-review", 1).unwrap())
        .unwrap();
    let raw = &input["raw"];
    let mut assembly=SnapshotAssembly::begin(&serde_json::to_vec(&json!({"ownerScope":"day-review","ownerEpoch":1,"snapshotId":format!("day-review-light-{index}"),"snapshotRevision":1,"selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}})).unwrap()).unwrap();
    for (kind, key) in [
        (SourceKind::WorkProfile, "profile"),
        (SourceKind::RemunerationProfiles, "historyRows"),
        (SourceKind::WorkPatternSettings, "patternRows"),
    ] {
        let mut source = ready(&raw[key]);
        let data = &mut source["payload"]["data"];
        data.as_object_mut().unwrap().remove("value");
        let bytes = if raw[key].is_null() {
            Vec::new()
        } else {
            serde_json::to_vec(&raw[key]).unwrap()
        };
        assembly
            .source(
                &serde_json::to_vec(&json!({"kind":kind,"source":source})).unwrap(),
                &bytes,
            )
            .unwrap();
    }
    let light = LightProfileContext::prepare(
        registry.utility_owner_marker().unwrap(),
        stamp(),
        assembly,
        input["epoch"].as_i64().unwrap() - 86_400_000,
    )
    .unwrap();
    let row = input["shiftRows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == input["originalId"]);
    let buffers: Vec<(DayEntrySourceKind, DayEntryReadState, Vec<u8>)> = if let Some(row) = row {
        vec![
            (
                DayEntrySourceKind::EntryShift,
                DayEntryReadState::Value,
                serde_json::to_vec(row).unwrap(),
            ),
            (
                DayEntrySourceKind::EntryAppointment,
                DayEntryReadState::Null,
                vec![],
            ),
            (
                DayEntrySourceKind::EntryTemplate,
                DayEntryReadState::Null,
                vec![],
            ),
            (
                DayEntrySourceKind::Templates,
                DayEntryReadState::Value,
                b"[]".to_vec(),
            ),
        ]
    } else {
        vec![(
            DayEntrySourceKind::Templates,
            DayEntryReadState::Value,
            b"[]".to_vec(),
        )]
    };
    let groups: Vec<_> = buffers
        .iter()
        .map(|(kind, state, body)| RawDayEntrySource {
            kind: *kind,
            state: *state,
            body,
        })
        .collect();
    let editor = Arc::new(
        NativeDayEditorSource::from_light(
            light,
            &stamp(),
            DayEditorOpenRequest {
                entry_id: input["originalId"].as_str().map(str::to_owned),
                mode: luna_engine::input::entry_editor_draft::EntryEditorMode::Shift,
                date: "2026-07-15".into(),
            },
            &groups,
        )
        .unwrap(),
    );
    let mut body = snapshot::raw_snapshot(1, "day-review", 1);
    // Deliberately a different analysis date; Provider/Now must not read this field.
    body["referenceDate"] = json!("2026-07-15");
    for (kind, data) in [
        (SourceKind::WorkProfile, raw["profile"].clone()),
        (SourceKind::RemunerationProfiles, raw["historyRows"].clone()),
        (SourceKind::WorkPatternSettings, raw["patternRows"].clone()),
        (
            SourceKind::CalendarEntries,
            json!({"shiftRows":input["shiftRows"],"appointmentRows":[],"platformCollationRanks":input["platformCollationRanks"]}),
        ),
    ] {
        let tag = serde_json::to_value(kind).unwrap();
        body["sources"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|group| group["kind"] == tag)
            .unwrap()["source"] = ready(&data);
    }
    body["catalogs"]["current"]["selectedPackageIds"] = json!({"tariff":["tvoed-p-vka-legacy"],"legal":["de-arbzg-care-legacy"],"holiday":["de-holidays-legacy"]});
    for kind in ["tariff", "legal", "holiday"] {
        body["catalogs"]["current"][kind] = ready(&json!({"mode":"COMPILED_LEGACY"}));
    }
    snapshot::seal(&mut body);
    let envelope = json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"REGISTER_SNAPSHOT","snapshot":body}});
    let snapshot: ImmutableSnapshot =
        match contract::parse_request(&serde_json::to_vec(&envelope).unwrap()).unwrap() {
            ValidatedRequest::RegisterSnapshot(value) => value,
            _ => panic!("native snapshot"),
        };
    let identity = snapshot.identity().clone();
    registry.register(snapshot).unwrap();
    let guard:UtilityGuard=serde_json::from_value(json!({"ownerScope":"day-review","ownerEpoch":1,"requestId":format!("day-review-{index}"),"draftRevision":1,"snapshot":identity})).unwrap();
    let lease = registry
        .lease_utility(
            &registry.utility_owner_marker().unwrap(),
            &guard,
            UtilityKind::DutyFormCommand,
        )
        .unwrap();
    (registry, editor, lease)
}
fn output(result: Result<Value, DayReviewError>) -> Value {
    match result {
        Ok(value) => json!({"ok":true,"value":value}),
        Err(DayReviewError::Input(error)) => {
            json!({"ok":false,"error":{"name":error.name(),"message":error.message()}})
        }
        Err(DayReviewError::Compliance(error)) => {
            json!({"ok":false,"error":{"name":error.source_error_name(),"message":error.to_string()}})
        }
        Err(error) => panic!("source admission: {error:?}"),
    }
}
#[test]
fn actual_raw_provider_calendar_catalog_and_post_save_clock_roles_match_original() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/day-review-source-golden.json"
    ));
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 204);
    for (index, case) in fixture["cases"].as_array().unwrap().iter().enumerate() {
        let input = &case["input"];
        let (_registry, editor, lease) = opened(input, index);
        let source = NativeDayReviewSource::from_lease(
            lease,
            editor,
            &stamp(),
            input["epoch"].as_i64().unwrap(),
        )
        .unwrap()
        .unwrap();
        let candidates = output(
            source
                .candidates(&input["next"])
                .map(|rows| serde_json::to_value(rows).unwrap()),
        );
        common::assert_json_eq(
            &candidates,
            &case["expected"]["candidates"],
            case["id"].as_str().unwrap(),
        );
        let ids: Vec<String> = serde_json::from_value(input["selectedIds"].clone()).unwrap();
        let transfer = if ids.is_empty() {
            json!({"ok":true,"value":[]})
        } else {
            output(
                source
                    .transfer_inputs(&input["next"], &ids)
                    .map(Value::Array),
            )
        };
        common::assert_json_eq(
            &transfer,
            &case["expected"]["transfer"],
            case["id"].as_str().unwrap(),
        );
        let critical = if input["saved"].is_null() {
            json!({"ok":true,"value":null})
        } else {
            output(source.critical_issue(&input["saved"], input["epoch"].as_i64().unwrap()))
        };
        common::assert_json_eq(
            &critical,
            &case["expected"]["critical"],
            case["id"].as_str().unwrap(),
        );
        let message = if input["next"].is_null() {
            json!({"ok":true,"value":null})
        } else {
            output(source.billing_message(&input["next"]))
        };
        common::assert_json_eq(
            &message,
            &case["expected"]["message"],
            case["id"].as_str().unwrap(),
        );
    }
}
#[test]
fn identical_owner_strings_do_not_allow_cross_core_sources_and_unrelated_facts_are_released() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/day-review-source-golden.json"
    ));
    let input = &fixture["cases"][0]["input"];
    let (registry, editor, lease) = opened(input, 1000);
    let (foreign_registry, _foreign_editor, foreign_lease) = opened(input, 1000);
    assert!(matches!(
        NativeDayReviewSource::from_lease(
            foreign_lease,
            Arc::clone(&editor),
            &stamp(),
            input["epoch"].as_i64().unwrap()
        ),
        Err(DayReviewError::SourceChanged)
    ));
    let facts = Arc::downgrade(lease.facts().unwrap());
    let review = NativeDayReviewSource::from_lease(
        lease,
        editor,
        &stamp(),
        input["epoch"].as_i64().unwrap(),
    )
    .unwrap()
    .unwrap();
    assert!(
        facts.upgrade().is_some(),
        "registry still owns the current source"
    );
    drop(registry);
    assert!(
        facts.upgrade().is_none(),
        "read review must not retain the complete unrelated snapshot facts"
    );
    assert!(matches!(
        review.candidates(&input["next"]),
        Err(DayReviewError::SourceChanged)
    ));
    drop(foreign_registry);
}
#[test]
fn a_captured_original_closure_survives_report_replacement_but_never_an_owner_reset() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/day-review-source-golden.json"
    ));
    let input = &fixture["cases"][0]["input"];
    let (registry, editor, lease) = opened(input, 2000);
    let capture = NativeDayReviewSource::from_lease(
        lease,
        editor,
        &stamp(),
        input["epoch"].as_i64().unwrap(),
    )
    .unwrap()
    .unwrap()
    .capture()
    .unwrap();
    let raw = snapshot::raw_snapshot(2, "day-review", 1);
    let envelope = json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"REGISTER_SNAPSHOT","snapshot":raw}});
    let next = match contract::parse_request(&serde_json::to_vec(&envelope).unwrap()).unwrap() {
        ValidatedRequest::RegisterSnapshot(value) => value,
        _ => panic!("snapshot"),
    };
    registry.register(next).unwrap();
    assert!(
        capture.is_current(),
        "an original pre-write closure is independent of report generations"
    );
    registry
        .reset_for_owner(&OwnerIdentity::new("day-review", 1).unwrap())
        .unwrap();
    assert!(
        !capture.is_current(),
        "even a reset to identical owner strings permanently retires the closure"
    );
}
#[test]
fn private_raw_review_assembly_preserves_every_original_result_without_global_report_preparation() {
    use luna_engine::{
        contract::assembly::CatalogKind, runtime::day_editor_review::NativeDayReviewAssembly,
    };
    let fixture = value_pool::decode(include_str!(
        "../../reference/day-review-source-golden.json"
    ));
    let platform: Value = serde_json::from_str(include_str!(
        "../../reference/day-review-platform-ranks.json"
    ))
    .unwrap();
    for (index, case) in fixture["cases"].as_array().unwrap().iter().enumerate() {
        let input = &case["input"];
        let (registry, editor, lease) = opened(input, index + 3000);
        let identity = lease.facts().unwrap().snapshot().identity().clone();
        let marker = registry.preparation_marker().unwrap();
        let mut builder =
            NativeDayReviewAssembly::new(editor, stamp(), input["epoch"].as_i64().unwrap())
                .unwrap();
        let mut state = ready(&json!({}));
        state["payload"]["data"]
            .as_object_mut()
            .unwrap()
            .remove("value");
        builder.calendar(&state,&serde_json::to_vec(&json!({"shiftRows":input["shiftRows"],"appointmentRows":[],"platformCollationRanks":{}})).unwrap()).unwrap();
        for kind in [
            CatalogKind::Tariff,
            CatalogKind::Legal,
            CatalogKind::Holiday,
        ] {
            builder
                .catalog(kind, &state, br#"{"mode":"COMPILED_LEGACY"}"#)
                .unwrap();
        }
        builder.prepare().unwrap();
        assert!(builder.catalog_candidates().unwrap().is_empty());
        assert!(
            builder
                .calendar_candidates()
                .unwrap()
                .iter()
                .all(|name| platform["cases"][index]["ranks"].get(name).is_some()),
            "missing platform metadata in case {index}: {:?}",
            builder
                .calendar_candidates()
                .unwrap()
                .iter()
                .filter(|name| platform["cases"][index]["ranks"].get(*name).is_none())
                .collect::<Vec<_>>()
        );
        let source = builder
            .finish(
                &serde_json::to_vec(&platform["cases"][index]["ranks"]).unwrap(),
                b"{}",
            )
            .unwrap()
            .unwrap();
        assert!(
            marker.is_current().unwrap(),
            "private review must not start a report preparation"
        );
        assert!(
            registry.snapshot(&identity).is_ok(),
            "private review must not replace the current report"
        );
        common::assert_json_eq(
            &output(
                source
                    .candidates(&input["next"])
                    .map(|rows| serde_json::to_value(rows).unwrap()),
            ),
            &case["expected"]["candidates"],
            case["id"].as_str().unwrap(),
        );
        let critical = if input["saved"].is_null() {
            json!({"ok":true,"value":null})
        } else {
            output(source.critical_issue(&input["saved"], input["epoch"].as_i64().unwrap()))
        };
        common::assert_json_eq(
            &critical,
            &case["expected"]["critical"],
            case["id"].as_str().unwrap(),
        );
        drop(lease);
    }
}
#[test]
fn private_review_never_turns_missing_reads_duplicate_groups_or_expired_owners_into_ready_data() {
    use luna_engine::runtime::day_editor_review::{
        DayReviewAssemblyError, NativeDayReviewAssembly,
    };
    let fixture = value_pool::decode(include_str!(
        "../../reference/day-review-source-golden.json"
    ));
    let input = &fixture["cases"][0]["input"];
    let (registry, editor, _lease) = opened(input, 4000);
    let mut builder = NativeDayReviewAssembly::new(
        Arc::clone(&editor),
        stamp(),
        input["epoch"].as_i64().unwrap(),
    )
    .unwrap();
    assert!(matches!(
        builder.prepare(),
        Err(DayReviewAssemblyError::Unavailable)
    ));
    builder
        .calendar(&json!({"state":"FAILED","code":"READ_FAILED"}), b"")
        .unwrap();
    assert!(matches!(
        builder.prepare(),
        Err(DayReviewAssemblyError::Unavailable)
    ));
    assert!(matches!(
        builder.calendar(&json!({"state":"FAILED","code":"READ_FAILED"}), b""),
        Err(DayReviewAssemblyError::InvalidState)
    ));
    let mut oversized =
        NativeDayReviewAssembly::new(editor, stamp(), input["epoch"].as_i64().unwrap()).unwrap();
    assert!(matches!(
        oversized.calendar(
            &json!({"state":"FAILED","code":"READ_FAILED"}),
            &vec![b' '; 16_515_073]
        ),
        Err(DayReviewAssemblyError::TooLarge)
    ));
    registry
        .reset_for_owner(&OwnerIdentity::new("day-review", 1).unwrap())
        .unwrap();
    assert!(matches!(
        builder.prepare(),
        Err(DayReviewAssemblyError::OwnerChanged)
    ));
}
