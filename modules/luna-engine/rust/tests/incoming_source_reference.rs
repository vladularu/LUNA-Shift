#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    calendar::incoming::visible::VisibilityContext,
    contract::OwnerIdentity,
    runtime::{
        SnapshotRegistry,
        incoming::{IncomingPoolError, IncomingSourcePool},
    },
};

fn context() -> VisibilityContext<'static> {
    VisibilityContext {
        user_id: Some("viewer"),
        status: "signedIn",
        presentation_account_id: None,
        observed_epoch_milliseconds: 1_792_929_600_000,
    }
}
#[test]
fn native_source_lease_retains_the_complete_original_large_sql_output() {
    let corpus = value_pool::decode(include_str!("../../reference/incoming-rows-golden.json"));
    let case = corpus["cases"].as_array().unwrap().last().unwrap();
    assert_eq!(case["id"], "large-original-json-chunks");
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("incoming-owner", 1).unwrap())
        .unwrap();
    let pool = IncomingSourcePool::new(registry.clone());
    let source = pool
        .supply(
            "sharing-rows-1",
            "viewer",
            &serde_json::to_vec(&case["input"]["rows"]).unwrap(),
            &context(),
        )
        .unwrap();
    let value = source
        .with_observation(|observation| {
            observation.compatibility_value(
                "Europe/Berlin",
                context().observed_epoch_milliseconds,
                None,
            )
        })
        .unwrap();
    assert_eq!(value.value().unwrap()["caches"], case["expected"]);
    assert!(source.is_current().unwrap());
    // Even a same-owner/same-epoch reset must invalidate this native lease.
    registry
        .reset_for_owner(&OwnerIdentity::new("incoming-owner", 1).unwrap())
        .unwrap();
    assert!(!source.is_current().unwrap());
}

#[test]
fn own_source_generations_and_local_calendar_generations_are_independent() {
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("incoming-owner", 1).unwrap())
        .unwrap();
    let pool = IncomingSourcePool::new(registry.clone());
    let raw = small_rows("2026-10-25T12:00:00Z");
    let first = pool
        .supply("sharing-1", "viewer", &raw, &context())
        .unwrap();
    let rows = registry.calendar_rows_marker().unwrap();
    registry.start_calendar_rows(&rows, 99).unwrap();
    let clock = registry.calendar_clock_marker().unwrap();
    registry.start_calendar_clock(&clock, 99).unwrap();
    assert!(first.is_current().unwrap());
    pool.source_changed().unwrap();
    assert!(!first.is_current().unwrap());
    assert!(matches!(
        pool.lease_current(),
        Err(IncomingPoolError::Stale)
    ));
    let second = pool
        .supply(
            "sharing-2",
            "viewer",
            &small_rows("2026-10-25T12:00:01Z"),
            &context(),
        )
        .unwrap();
    assert!(!first.is_current().unwrap());
    assert!(second.is_current().unwrap());
    assert_eq!(second.source_token(), "sharing-2");
    assert_eq!(second.statistics().field_reuses, 2);
    assert_eq!(second.statistics().entries_parses, 0);
    assert!(matches!(
        pool.supply("sharing-3", "viewer", &raw, &context()),
        Err(IncomingPoolError::Capacity)
    ));
    assert!(second.is_current().unwrap());
    drop(first);
    let third = pool
        .supply("sharing-3", "viewer", &raw, &context())
        .unwrap();
    assert!(!second.is_current().unwrap());
    assert!(third.is_current().unwrap());
    assert_eq!(pool.retained_generations(), 2);
    assert!(pool.retained_wire_bytes() <= 64 * 1024 * 1024);
    drop(second);
    assert_eq!(pool.retained_generations(), 1);
}

#[test]
fn failed_source_does_not_create_empty_ready_data_or_destroy_checked_provenance() {
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("incoming-owner", 1).unwrap())
        .unwrap();
    let pool = IncomingSourcePool::new(registry);
    let raw = small_rows("2026-10-25T12:00:00Z");
    let first = pool
        .supply("sharing-1", "viewer", &raw, &context())
        .unwrap();
    assert!(matches!(
        pool.supply("sharing-bad", "viewer", b"[null]", &context()),
        Err(IncomingPoolError::Source(_))
    ));
    assert!(!first.is_current().unwrap());
    assert!(matches!(
        pool.lease_current(),
        Err(IncomingPoolError::Stale)
    ));
    let next = pool
        .supply("sharing-2", "viewer", &raw, &context())
        .unwrap();
    assert_eq!(next.statistics().field_reuses, 2);
    assert!(next.is_current().unwrap());
    assert!(pool.invalidate().unwrap());
    assert!(!next.is_current().unwrap());
    assert!(!pool.invalidate().unwrap());
    assert!(pool.collect_retired().unwrap());
    drop(first);
    drop(next);
    assert_eq!(pool.retained_generations(), 0);
    assert_eq!(pool.retained_wire_bytes(), 0);
}

#[test]
fn publication_rechecks_the_owner_after_native_borrowed_consumption() {
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("incoming-owner", 1).unwrap())
        .unwrap();
    let pool = IncomingSourcePool::new(registry.clone());
    let first = pool
        .supply(
            "sharing-1",
            "viewer",
            &small_rows("2026-10-25T12:00:00Z"),
            &context(),
        )
        .unwrap();
    let result = first.with_observation(|_| {
        registry
            .reset_for_owner(&OwnerIdentity::new("incoming-owner", 1).unwrap())
            .unwrap();
        Ok(serde_json::json!({"mustNotPublish":true}))
    });
    assert!(matches!(result, Err(IncomingPoolError::Stale)));
    assert!(!first.is_current().unwrap());
    let next = pool
        .supply(
            "sharing-2",
            "viewer",
            &small_rows("2026-10-25T12:00:00Z"),
            &context(),
        )
        .unwrap();
    assert_eq!(next.statistics().field_reuses, 0);
    assert_eq!(next.statistics().entries_parses, 1);
}

fn small_rows(fetched: &str) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!([{"account_id":"viewer","calendar_id":"calendar","metadata_json":"{\"id\":\"calendar\",\"isOwner\":false}","entries_json":"[]","fetched_at":fetched,"visible":1,"local_color":null}])).unwrap()
}

#[test]
fn all_original_sql_list_results_pass_through_the_private_source_boundary() {
    use luna_engine::calendar::incoming::{
        cache::RetainedIncomingCache, raw_rows::RawIncomingCacheRows,
        raw_source::IncomingSourceError,
    };
    let corpus = value_pool::decode(include_str!("../../reference/incoming-rows-golden.json"));
    let mut compared = 0;
    for case in corpus["cases"].as_array().unwrap() {
        let account = case["input"]["accountId"].as_str().unwrap();
        let raw = serde_json::to_vec(&case["input"]["rows"]).unwrap();
        let mapped = RawIncomingCacheRows::parse(account, &raw).unwrap();
        let expected =
            RetainedIncomingCache::new().observe(mapped.calendars().as_ref().clone(), &context());
        let registry = SnapshotRegistry::default();
        registry
            .reset_for_owner(&OwnerIdentity::new("incoming-owner", 1).unwrap())
            .unwrap();
        let pool = IncomingSourcePool::new(registry);
        match (
            expected,
            pool.supply("original-source", account, &raw, &context()),
        ) {
            (Ok(expected), Ok(actual)) => {
                let expected = expected
                    .compatibility_value(
                        "Europe/Berlin",
                        context().observed_epoch_milliseconds,
                        None,
                    )
                    .unwrap();
                let actual = actual
                    .with_observation(|observation| {
                        observation.compatibility_value(
                            "Europe/Berlin",
                            context().observed_epoch_milliseconds,
                            None,
                        )
                    })
                    .unwrap();
                assert_eq!(actual.value().unwrap(), &expected, "{}", case["id"]);
            }
            (
                Err(expected),
                Err(IncomingPoolError::Source(IncomingSourceError::Projection(actual))),
            ) => assert_eq!(
                format!("{actual:?}"),
                format!("{expected:?}"),
                "{}",
                case["id"]
            ),
            _ => panic!(
                "{}: source boundary changed the original mapped result",
                case["id"]
            ),
        }
        compared += 1;
    }
    assert_eq!(compared, 129);
}
