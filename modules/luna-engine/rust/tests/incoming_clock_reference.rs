#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    calendar::incoming::visible::VisibilityContext,
    contract::{OwnerIdentity, SourceState},
    runtime::{
        SnapshotRegistry,
        incoming::{IncomingClockError, IncomingSourcePool, IncomingViewerRole},
    },
};
use serde_json::{Value, json};
use std::sync::Arc;
fn ready(value: Value) -> SourceState {
    serde_json::from_value(json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":value}}})).unwrap()
}

const EPOCH: i64 = 1_792_929_600_000;
fn registry() -> SnapshotRegistry {
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("incoming-clock-owner", 1).unwrap())
        .unwrap();
    registry
}
fn clock(
    registry: &SnapshotRegistry,
    revision: u64,
    loading: bool,
) -> Arc<luna_engine::runtime::calendar_only::CalendarClockLease> {
    let marker = registry
        .start_calendar_clock(&registry.calendar_clock_marker().unwrap(), revision)
        .unwrap();
    let profile = if loading {
        SourceState::Loading
    } else {
        null()
    };
    let identity = registry
        .register_calendar_clock(
            &marker,
            revision,
            &profile,
            &SourceState::NotRequested,
            EPOCH,
        )
        .unwrap();
    Arc::new(registry.lease_calendar_clock(&marker, &identity).unwrap())
}
fn source(
    pool: &IncomingSourcePool,
    fetched: &str,
) -> luna_engine::runtime::incoming::IncomingSourceLease {
    let raw = json!([{"account_id":"viewer","calendar_id":"calendar","metadata_json":"{\"id\":\"calendar\",\"isOwner\":false}","entries_json":"[]","fetched_at":fetched,"visible":1,"local_color":null}]);
    pool.supply(
        "sharing-1",
        "viewer",
        &serde_json::to_vec(&raw).unwrap(),
        &VisibilityContext {
            user_id: Some("viewer"),
            status: "signedIn",
            presentation_account_id: None,
            observed_epoch_milliseconds: EPOCH,
        },
    )
    .unwrap()
}
#[test]
fn identical_public_clock_identity_from_another_core_cannot_be_bound() {
    let a = registry();
    let b = registry();
    let source = source(&IncomingSourcePool::new(a.clone()), "2026-10-25T12:00:00Z");
    let local = clock(&a, 1, false);
    let foreign = clock(&b, 1, false);
    assert_eq!(local.identity(), foreign.identity());
    assert!(matches!(
        source.bind_clock(foreign, IncomingViewerRole::Provider, EPOCH, None),
        Err(IncomingClockError::ScopeMismatch)
    ));
    assert!(
        source
            .bind_clock(local, IncomingViewerRole::Provider, EPOCH, None)
            .is_ok()
    );
    assert!(source.is_current().unwrap());
}
#[test]
fn clock_and_visibility_expiry_and_each_source_generation_remain_independent_fences() {
    let registry = registry();
    let pool = IncomingSourcePool::new(registry.clone());
    let source = source(&pool, "2026-10-24T12:00:00.001Z");
    let clock = clock(&registry, 1, false);
    assert!(clock.is_fresh_at(EPOCH + 1).unwrap());
    let view = source
        .bind_clock(clock, IncomingViewerRole::Provider, EPOCH, None)
        .unwrap();
    assert_eq!(
        view.valid_until_epoch_milliseconds_at(EPOCH).unwrap(),
        Some(EPOCH + 1)
    );
    assert!(view.cacheable_at(EPOCH).unwrap());
    assert!(!view.is_current_at(EPOCH + 1).unwrap());
    assert!(matches!(
        view.days_at(EPOCH + 1),
        Err(IncomingClockError::Stale)
    ));
    registry
        .start_calendar_clock(&registry.calendar_clock_marker().unwrap(), 2)
        .unwrap();
    assert!(!view.is_current_at(EPOCH).unwrap());
    assert!(
        source.is_current().unwrap(),
        "a clock change must not replace sharing rows"
    );
    pool.source_changed().unwrap();
    assert!(!source.is_current().unwrap());
}
#[test]
fn degraded_analysis_clock_never_mints_a_ready_provider_role_or_persistent_expiry() {
    let registry = registry();
    let source = source(
        &IncomingSourcePool::new(registry.clone()),
        "2026-10-25T12:00:00Z",
    );
    let degraded = clock(&registry, 1, true);
    let view = source
        .bind_clock(degraded.clone(), IncomingViewerRole::Analysis, EPOCH, None)
        .unwrap();
    assert_eq!(view.viewer_time_zone_at(EPOCH).unwrap(), "Europe/Berlin");
    assert!(!view.cacheable_at(EPOCH).unwrap());
    assert_eq!(view.valid_until_epoch_milliseconds_at(EPOCH).unwrap(), None);
    assert!(!view.is_current_at(EPOCH + 1).unwrap());
    assert!(matches!(
        source.bind_clock(degraded, IncomingViewerRole::Provider, EPOCH, None),
        Err(IncomingClockError::RoleUnavailable)
    ));
    assert!(source.is_current().unwrap());
    registry
        .reset_for_owner(&OwnerIdentity::new("incoming-clock-owner", 1).unwrap())
        .unwrap();
    assert!(!view.is_current_at(EPOCH).unwrap());
}

#[test]
fn historical_negative_epoch_and_expiry_remain_signed_raw_clock_values() {
    let epoch = -2_208_988_800_000_i64;
    let registry = registry();
    let pool = IncomingSourcePool::new(registry.clone());
    let rows = json!([{"account_id":"viewer","calendar_id":"calendar","metadata_json":"{\"id\":\"calendar\",\"isOwner\":false}","entries_json":"[]","fetched_at":"1900-01-01T00:00:00Z","visible":1,"local_color":null}]);
    let source = pool
        .supply(
            "historical-raw",
            "viewer",
            &serde_json::to_vec(&rows).unwrap(),
            &VisibilityContext {
                user_id: Some("viewer"),
                status: "signedIn",
                presentation_account_id: None,
                observed_epoch_milliseconds: epoch,
            },
        )
        .unwrap();
    let marker = registry
        .start_calendar_clock(&registry.calendar_clock_marker().unwrap(), 1)
        .unwrap();
    let identity = registry
        .register_calendar_clock(&marker, 1, &null(), &SourceState::NotRequested, epoch)
        .unwrap();
    let clock = Arc::new(registry.lease_calendar_clock(&marker, &identity).unwrap());
    let view = source
        .bind_clock(clock, IncomingViewerRole::Provider, epoch, None)
        .unwrap();
    assert_eq!(view.viewer_time_zone_at(epoch).unwrap(), "Europe/Berlin");
    let expiry = view
        .valid_until_epoch_milliseconds_at(epoch)
        .unwrap()
        .unwrap();
    assert!(epoch < expiry && expiry < 0);
    assert!(view.is_current_at(expiry - 1).unwrap());
    assert!(!view.is_current_at(expiry).unwrap());
}
fn null() -> SourceState {
    serde_json::from_value(json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"NULL"}}})).unwrap()
}
#[test]
fn original_analysis_and_provider_roles_bind_to_original_shared_calendar_projection() {
    let corpus = value_pool::decode(include_str!("../../reference/incoming-clock-golden.json"));
    let mut compared = 0;
    for case in corpus["cases"].as_array().unwrap() {
        let input = &case["input"];
        let epoch = input["observedEpochMilliseconds"].as_i64().unwrap();
        let registry = SnapshotRegistry::default();
        registry
            .reset_for_owner(&OwnerIdentity::new("incoming-clock-owner", 1).unwrap())
            .unwrap();
        let source = IncomingSourcePool::new(registry.clone())
            .supply(
                "sharing-1",
                "viewer",
                &serde_json::to_vec(&input["rows"]).unwrap(),
                &VisibilityContext {
                    user_id: Some("viewer"),
                    status: "signedIn",
                    presentation_account_id: None,
                    observed_epoch_milliseconds: epoch,
                },
            )
            .unwrap();
        let marker = registry
            .start_calendar_clock(&registry.calendar_clock_marker().unwrap(), 1)
            .unwrap();
        let profile = if input["profile"].is_null() {
            null()
        } else {
            ready(input["profile"].clone())
        };
        let identity = registry
            .register_calendar_clock(
                &marker,
                1,
                &profile,
                &ready(input["historyRows"].clone()),
                epoch,
            )
            .unwrap();
        let clock = Arc::new(registry.lease_calendar_clock(&marker, &identity).unwrap());
        let role = match input["role"].as_str().unwrap() {
            "ANALYSIS" => IncomingViewerRole::Analysis,
            "PROVIDER" => IncomingViewerRole::Provider,
            _ => panic!("closed original role"),
        };
        let projection = source
            .bind_clock(clock, role, epoch, None)
            .unwrap_or_else(|e| panic!("{}:{e:?}", case["id"]));
        assert_eq!(
            projection.viewer_time_zone_at(epoch).unwrap(),
            case["expected"]["timeZone"].as_str().unwrap(),
            "{}",
            case["id"]
        );
        assert_eq!(
            serde_json::to_value(projection.days_at(epoch).unwrap()).unwrap(),
            case["expected"]["days"],
            "{}",
            case["id"]
        );
        assert!(projection.is_current_at(epoch).unwrap());
        assert!(!projection.is_current_at(epoch - 1).unwrap());
        assert!(
            !projection
                .is_current_at(
                    case["expected"]["clockValidUntilEpochMilliseconds"]
                        .as_i64()
                        .unwrap()
                )
                .unwrap()
        );
        compared += 1;
    }
    assert_eq!(compared, 478);
}
