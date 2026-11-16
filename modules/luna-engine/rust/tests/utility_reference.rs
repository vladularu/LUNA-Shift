mod common;
#[path = "support/snapshot.rs"]
mod snapshot_fixture;
use luna_engine::{
    contract::{self, utility::*},
    runtime::{SnapshotRegistry, utility_lease::UtilityFenceError},
};
use serde_json::{Value, json};
use std::sync::Arc;
fn request(
    operation: Value,
    revision: u64,
    snapshot: Option<&contract::SnapshotIdentity>,
) -> UtilityRequest {
    named_request(operation, revision, snapshot, "editor")
}
fn named_request(
    operation: Value,
    revision: u64,
    snapshot: Option<&contract::SnapshotIdentity>,
    id: &str,
) -> UtilityRequest {
    let mut guard = json!({"ownerScope":"utility-owner","ownerEpoch":1,"requestId":id,"draftRevision":revision});
    if let Some(snapshot) = snapshot {
        guard["snapshot"] = json!(snapshot);
    }
    parse_utility_request(&serde_json::to_vec(&json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":guard,"operation":operation})).unwrap()).unwrap()
}
fn new_registry() -> SnapshotRegistry {
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&contract::OwnerIdentity::new("utility-owner", 1).unwrap())
        .unwrap();
    registry
}
#[test]
fn forgotten_channel_cannot_accept_an_arrival_that_predated_its_eviction() {
    let registry = new_registry();
    let paused = registry.utility_owner_marker().unwrap();
    for index in 0..129 {
        let request = named_request(
            json!({"kind":"ISO_WEEK","date":"2026-11-13"}),
            10,
            None,
            &format!("editor-{index}"),
        );
        let marker = registry.utility_owner_marker().unwrap();
        drop(
            registry
                .lease_utility(&marker, request.guard(), UtilityKind::IsoWeek)
                .unwrap(),
        );
    }
    let old = named_request(
        json!({"kind":"ISO_WEEK","date":"2026-11-13"}),
        1,
        None,
        "editor-0",
    );
    assert!(matches!(
        registry.lease_utility(&paused, old.guard(), UtilityKind::IsoWeek),
        Err(UtilityFenceError::Stale)
    ));
    let marker = registry.utility_owner_marker().unwrap();
    assert!(
        registry
            .lease_utility(&marker, old.guard(), UtilityKind::IsoWeek)
            .unwrap()
            .is_current()
            .unwrap()
    );
}
#[test]
fn a_slow_old_parse_cannot_replace_a_newer_arrival_for_the_same_draft_and_operation() {
    let registry = new_registry();
    let request = request(json!({"kind":"ISO_WEEK","date":"2026-11-13"}), 1, None);
    let old = registry.utility_owner_marker().unwrap();
    let new = registry.utility_owner_marker().unwrap();
    let current = registry
        .lease_utility(&new, request.guard(), UtilityKind::IsoWeek)
        .unwrap();
    assert!(matches!(
        registry.lease_utility(&old, request.guard(), UtilityKind::IsoWeek),
        Err(UtilityFenceError::Stale)
    ));
    assert!(current.is_current().unwrap());
}
#[test]
fn active_channels_are_bounded_and_serialization_refuses_obsolete_completion() {
    let registry = new_registry();
    let mut leases = Vec::new();
    for index in 0..128 {
        let request = named_request(
            json!({"kind":"ISO_WEEK","date":"2026-11-13"}),
            1,
            None,
            &format!("editor-{index}"),
        );
        leases.push(
            registry
                .lease_utility(
                    &registry.utility_owner_marker().unwrap(),
                    request.guard(),
                    UtilityKind::IsoWeek,
                )
                .unwrap(),
        );
    }
    let overflow = named_request(
        json!({"kind":"ISO_WEEK","date":"2026-11-13"}),
        1,
        None,
        "overflow",
    );
    assert!(matches!(
        registry.lease_utility(
            &registry.utility_owner_marker().unwrap(),
            overflow.guard(),
            UtilityKind::IsoWeek
        ),
        Err(UtilityFenceError::Capacity)
    ));
    drop(leases);
    let marker = registry.utility_owner_marker().unwrap();
    let completion = luna_engine::runtime::utility::prepare(&registry, &marker, &overflow).unwrap();
    assert!(completion.serialize_current().is_ok());
    registry
        .reset_for_owner(&contract::OwnerIdentity::new("utility-owner", 1).unwrap())
        .unwrap();
    assert!(matches!(
        completion.serialize_current(),
        Err(luna_engine::runtime::utility::UtilityExecutionError::Fence(
            UtilityFenceError::Stale
        ))
    ));
}
#[test]
fn utilities_use_original_calendar_time_and_recurrence_outputs_without_rounding_changes() {
    let data: Value = serde_json::from_str(include_str!("../../reference/cases.json")).unwrap();
    let mut count = 0;
    for case in data["cases"].as_array().unwrap() {
        let input = &case["input"];
        let operation = match case["operation"].as_str().unwrap() {
            "calendar.monthGrid" => json!({"kind":"MONTH_GRID","month":input["month"]}),
            "calendar.monthRange" => json!({"kind":"MONTH_RANGE","month":input["month"]}),
            "calendar.addMonths" => {
                json!({"kind":"ADD_MONTHS","month":input["month"],"amount":input["amount"]})
            }
            "calendar.isoWeek" => json!({"kind":"ISO_WEEK","date":input["date"]}),
            "time.shiftMinutes" => {
                json!({"kind":"SHIFT_DURATION","draft":input["shift"],"timeZone":input["timeZone"]})
            }
            "time.shiftBounds" => {
                json!({"kind":"SHIFT_BOUNDS","draft":input["shift"],"timeZone":input["timeZone"]})
            }
            _ => continue,
        };
        let input = request(operation, 1, None);
        let actual =
            serde_json::to_value(luna_engine::runtime::utility::calculate(input.operation()))
                .unwrap();
        assert_eq!(actual["state"], "VALUE");
        common::assert_json_eq(
            &actual["value"],
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
        count += 1;
    }
    assert_eq!(count, 46);
    let data: Value =
        serde_json::from_str(include_str!("../../reference/recurrence-golden.json")).unwrap();
    let mut recurrence_count = 0;
    let mut limited = 0;
    for case in data["cases"].as_array().unwrap() {
        if case["operation"] != "calendar.expandAppointmentSeries" {
            continue;
        }
        let input = &case["input"];
        let input = request(
            json!({"kind":"APPOINTMENT_SERIES","appointment":input["appointment"],"startDate":input["startDate"],"endDate":input["endDate"]}),
            1,
            None,
        );
        let actual =
            serde_json::to_value(luna_engine::runtime::utility::calculate(input.operation()))
                .unwrap();
        if actual["state"] == "OPERATION_LIMIT" {
            limited += 1;
            continue;
        }
        assert_eq!(actual["state"], "VALUE", "{}", case["id"]);
        common::assert_json_eq(
            &actual["value"],
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
        recurrence_count += 1;
    }
    assert_eq!(recurrence_count, 18);
    assert_eq!(
        limited, 9,
        "explicit utility preview limits are outside admitted parity"
    );
}
#[test]
fn civil_clock_and_editor_expansion_admission_are_explicit_and_bounded() {
    for (zone, expected) in [
        ("Europe/Berlin", "1970-01-01"),
        ("America/New_York", "1969-12-31"),
    ] {
        let input = request(
            json!({"kind":"CIVIL_CLOCK","epochMilliseconds":0,"timeZone":zone}),
            0,
            None,
        );
        let result =
            serde_json::to_value(luna_engine::runtime::utility::calculate(input.operation()))
                .unwrap();
        assert_eq!(result["value"]["date"], expected);
        assert_eq!(result["value"]["timeZone"], zone);
    }
    for operation in [
        json!({"kind":"CIVIL_CLOCK","epochMilliseconds":0,"timeZone":"Factory"}),
        json!({"kind":"MONTH_RANGE","month":"2026-02-30"}),
        json!({"kind":"SHIFT_DURATION","draft":{"date":"2026-11-13","startTime":"secret","endTime":"09:00","breakMinutes":0},"timeZone":"UTC"}),
    ] {
        let input = request(operation, 1, None);
        let result =
            serde_json::to_value(luna_engine::runtime::utility::calculate(input.operation()))
                .unwrap();
        assert_eq!(result["state"], "DOMAIN_ERROR");
        assert!(!result.to_string().contains("secret"));
    }
    for (start, end, payload) in [
        ("2026-01-01", "2028-01-01", json!({"date":"2026-01-01"})),
        (
            "2026-01-01",
            "2026-01-02",
            json!({"date":"2026-01-01","note":"x".repeat(2048)}),
        ),
        (
            "2026-01-01",
            "2026-01-02",
            json!({"date":"2026-01-01","recurrence":{"frequency":"DAY","interval":0}}),
        ),
    ] {
        let input = request(
            json!({"kind":"APPOINTMENT_SERIES","appointment":payload,"startDate":start,"endDate":end}),
            1,
            None,
        );
        assert_eq!(
            serde_json::to_value(luna_engine::runtime::utility::calculate(input.operation()))
                .unwrap()["state"],
            "OPERATION_LIMIT"
        );
    }
}
#[test]
fn current_draft_kinds_are_independent_but_replacement_and_same_epoch_reset_fence_old_work() {
    let registry = new_registry();
    let marker = registry.utility_owner_marker().unwrap();
    let old = request(json!({"kind":"MONTH_RANGE","month":"2026-11"}), 1, None);
    let first = registry
        .lease_utility(&marker, old.guard(), UtilityKind::MonthRange)
        .unwrap();
    let independent = registry
        .lease_utility(&marker, old.guard(), UtilityKind::IsoWeek)
        .unwrap();
    assert!(first.is_current().unwrap());
    assert!(independent.is_current().unwrap());
    let replacement = registry
        .lease_utility(&marker, old.guard(), UtilityKind::MonthRange)
        .unwrap();
    assert!(!first.is_current().unwrap());
    assert!(independent.is_current().unwrap());
    let next = request(json!({"kind":"MONTH_RANGE","month":"2026-12"}), 2, None);
    let newer = registry
        .lease_utility(&marker, next.guard(), UtilityKind::MonthRange)
        .unwrap();
    assert!(!replacement.is_current().unwrap());
    assert!(!independent.is_current().unwrap());
    assert!(newer.is_current().unwrap());
    assert!(matches!(
        registry.lease_utility(&marker, old.guard(), UtilityKind::MonthRange),
        Err(UtilityFenceError::StaleDraft)
    ));
    registry
        .reset_for_owner(&contract::OwnerIdentity::new("utility-owner", 1).unwrap())
        .unwrap();
    assert!(!newer.is_current().unwrap());
    assert!(matches!(
        registry.lease_utility(&marker, next.guard(), UtilityKind::MonthRange),
        Err(UtilityFenceError::Stale)
    ));
    let other = new_registry();
    assert!(matches!(
        other.lease_utility(
            &registry.utility_owner_marker().unwrap(),
            next.guard(),
            UtilityKind::MonthRange
        ),
        Err(UtilityFenceError::OwnerMismatch)
    ));
}
#[test]
fn source_bound_utilities_share_facts_and_owner_only_work_survives_source_revision_changes() {
    let registry = new_registry();
    let raw = snapshot_fixture::raw_snapshot(1, "utility-owner", 1);
    let bytes=serde_json::to_vec(&json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"REGISTER_SNAPSHOT","snapshot":raw}})).unwrap();
    let contract::ValidatedRequest::RegisterSnapshot(snapshot) =
        contract::parse_request(&bytes).unwrap()
    else {
        panic!("snapshot")
    };
    let snapshot = registry.register(snapshot).unwrap();
    let marker = registry.utility_owner_marker().unwrap();
    let input = request(
        json!({"kind":"MONTH_RANGE","month":"2026-11"}),
        1,
        Some(snapshot.identity()),
    );
    let first = registry
        .lease_utility(&marker, input.guard(), UtilityKind::MonthRange)
        .unwrap();
    let second = registry
        .lease_utility(&marker, input.guard(), UtilityKind::MonthGrid)
        .unwrap();
    assert!(Arc::ptr_eq(first.facts().unwrap(), second.facts().unwrap()));
    let pure = request(json!({"kind":"ISO_WEEK","date":"2026-11-13"}), 1, None);
    let pure = registry
        .lease_utility(&marker, pure.guard(), UtilityKind::IsoWeek)
        .unwrap();
    registry
        .advance_revision(
            &contract::RevisionFence::new(
                contract::OwnerIdentity::new("utility-owner", 1).unwrap(),
                2,
            )
            .unwrap(),
        )
        .unwrap();
    assert!(!first.is_current().unwrap());
    assert!(!second.is_current().unwrap());
    assert!(pure.is_current().unwrap());
    assert!(matches!(
        registry.lease_utility(&marker, input.guard(), UtilityKind::MonthRange),
        Err(UtilityFenceError::MissingSnapshot)
    ));
}
#[test]
fn utility_validators_preserve_frozen_full_results_and_user_facing_errors() {
    type ValidatorReference<'a> = (&'a str, &'a str, &'a [(&'a str, &'a str)]);
    let data: [ValidatorReference<'_>; 3] = [
        (
            "calendar",
            include_str!("../../reference/input-calendar-golden.json"),
            &[
                ("validateShift", "SHIFT"),
                ("validateTemplate", "TEMPLATE"),
                ("validateAppointment", "APPOINTMENT"),
                ("validateMonthlyTariffDecision", "MONTHLY_TARIFF_DECISION"),
            ],
        ),
        (
            "profile",
            include_str!("../../reference/input-profile-golden.json"),
            &[("validateProfile", "USER_PROFILE")],
        ),
        (
            "employment",
            include_str!("../../reference/input-employment-golden.json"),
            &[
                ("validateEmploymentData", "EMPLOYMENT_DATA"),
                ("decodeEmploymentPayload", "EMPLOYMENT_DECODE"),
            ],
        ),
    ];
    let mut count = 0;
    for (_, source, operations) in data {
        let data: Value = serde_json::from_str(source).unwrap();
        for case in data["cases"].as_array().unwrap() {
            let Some((_, validator)) = operations
                .iter()
                .find(|(operation, _)| case["operation"] == *operation)
            else {
                continue;
            };
            let input = request(
                json!({"kind":"VALIDATE_INPUT","validator":validator,"input":case["input"]}),
                1,
                None,
            );
            let actual = luna_engine::runtime::utility::calculate(input.operation());
            let value = serde_json::to_value(actual).unwrap();
            if case["malformedType"] == true
                || case["engineDiagnostic"] == true
                || case["nativeMalformed"] == true
            {
                assert_eq!(value["state"], "INPUT_ERROR", "{}", case["id"]);
                continue;
            }
            let expected = &case["expected"];
            let normalized = if value["state"] == "VALUE" {
                json!({"value":value["value"]})
            } else {
                json!({"$error":value["message"],"name":value["name"]})
            };
            common::assert_json_eq(&normalized, expected, case["id"].as_str().unwrap());
            count += 1;
        }
    }
    assert!(count > 1500, "complete source cases {count}");
}
