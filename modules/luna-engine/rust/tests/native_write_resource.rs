use luna_engine::{
    contract::OwnerIdentity,
    input::profile_write::ProfileWriteRoute,
    runtime::{
        SnapshotRegistry,
        write_resource::{
            NativeWriteContext, WriteContextKind, WriteContextStamp, WriteResourceError,
        },
    },
};
use serde_json::{Value, json};
#[path = "support/value_pool.rs"]
mod value_pool;
fn registry() -> SnapshotRegistry {
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("private-writer", 1).unwrap())
        .unwrap();
    registry
}
fn stamp(token: &str) -> WriteContextStamp {
    WriteContextStamp::from_raw(&json!({"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":token,"databaseSchemaVersion":35})).unwrap()
}
const BEFORE: &str = "11111111111111111111111111111111";
const AFTER: &str = "22222222222222222222222222222222";

fn raw_profile() -> (Value, Value, f64) {
    let data = value_pool::decode(include_str!(
        "../../reference/profile-write-sql-golden.json"
    ));
    let input = &data["cases"][0]["input"];
    (
        input["state"].clone(),
        serde_json::from_str(input["rawInputJson"].as_str().unwrap()).unwrap(),
        input["observedEpochMilliseconds"].as_f64().unwrap(),
    )
}
fn profile_context(registry: &SnapshotRegistry, raw: &Value) -> NativeWriteContext {
    NativeWriteContext::from_raw(
        registry.utility_owner_marker().unwrap(),
        stamp(BEFORE),
        WriteContextKind::Profile,
        &serde_json::to_vec(raw).unwrap(),
    )
    .unwrap()
}
#[test]
fn foreign_owners_contexts_replays_abort_and_ack_stamp_cannot_publish_a_profile() {
    let registry = registry();
    let (raw, input, epoch) = raw_profile();
    let context = profile_context(&registry, &raw);
    let foreign = profile_context(&registry, &raw);
    let permit = context
        .prepare_profile(&input, ProfileWriteRoute::AppPort, epoch)
        .unwrap();
    assert!(matches!(
        foreign.take(&permit),
        Err(WriteResourceError::ForeignPermit)
    ));
    assert!(matches!(
        foreign.abort(&permit),
        Err(WriteResourceError::ForeignPermit)
    ));
    context.take(&permit).unwrap();
    assert!(matches!(
        context.acknowledge(&permit, stamp(BEFORE)),
        Err(WriteResourceError::InvalidStamp)
    ));
    for (key, value) in [
        ("dataSpaceId", json!(AFTER)),
        ("databaseSchemaVersion", json!(36)),
    ] {
        let mut raw_stamp = serde_json::to_value(stamp(AFTER)).unwrap();
        raw_stamp[key] = value;
        assert!(matches!(
            context.acknowledge(&permit, WriteContextStamp::from_raw(&raw_stamp).unwrap()),
            Err(WriteResourceError::InvalidStamp)
        ));
    }
    context.abort(&permit).unwrap();
    assert!(matches!(
        context.acknowledge(&permit, stamp(AFTER)),
        Err(WriteResourceError::AlreadyCompleted)
    ));
    assert!(matches!(
        context.take(&permit),
        Err(WriteResourceError::AlreadyTaken)
    ));
    let pending = context
        .prepare_profile(&input, ProfileWriteRoute::AppPort, epoch)
        .unwrap();
    context.abort(&pending).unwrap();
    assert!(matches!(
        context.take(&pending),
        Err(WriteResourceError::AlreadyTaken)
    ));
    let reset = context
        .prepare_profile(&input, ProfileWriteRoute::AppPort, epoch)
        .unwrap();
    registry
        .reset_for_owner(&OwnerIdentity::new("private-writer", 1).unwrap())
        .unwrap();
    assert!(matches!(
        context.take(&reset),
        Err(WriteResourceError::OwnerChanged)
    ));
    assert!(matches!(
        context.prepare_profile(&input, ProfileWriteRoute::AppPort, epoch),
        Err(WriteResourceError::OwnerChanged)
    ));
    assert!(matches!(
        context.acknowledge(&reset, stamp(AFTER)),
        Err(WriteResourceError::OwnerChanged)
    ));
}
#[test]
fn raw_source_budgets_presence_and_closed_stamp_are_checked_before_permit_minting() {
    let registry = registry();
    for raw in [
        json!(null),
        json!({}),
        json!({"userProfile":[],"history":[],"preferences":[],"testMonths":[],"ready":true}),
        json!({"netProfiles":[],"salaryPreference":null,"profileRows":[],"testMonths":[],"settings":{}}),
    ] {
        assert!(
            NativeWriteContext::from_raw(
                registry.utility_owner_marker().unwrap(),
                stamp(BEFORE),
                WriteContextKind::Profile,
                &serde_json::to_vec(&raw).unwrap()
            )
            .is_err()
        );
    }
    for bytes in [b"{".as_slice(), b"null", b"[]"] {
        assert!(
            NativeWriteContext::from_raw(
                registry.utility_owner_marker().unwrap(),
                stamp(BEFORE),
                WriteContextKind::Profile,
                bytes
            )
            .is_err()
        );
    }
    assert!(matches!(
        NativeWriteContext::from_raw(
            registry.utility_owner_marker().unwrap(),
            stamp(BEFORE),
            WriteContextKind::Profile,
            &vec![b' '; 16_515_073]
        ),
        Err(WriteResourceError::InputTooLarge)
    ));
    for (key, value) in [
        ("dataSpaceId", json!("ABCDEF0123456789abcdef0123456789ab")),
        ("inputToken", json!("short")),
        ("databaseSchemaVersion", json!(0)),
        ("databaseSchemaVersion", json!(-1)),
        ("databaseSchemaVersion", json!(9007199254740992_u64)),
        ("trusted", json!(true)),
    ] {
        let mut raw = serde_json::to_value(stamp(BEFORE)).unwrap();
        raw[key] = value;
        assert!(WriteContextStamp::from_raw(&raw).is_err());
    }
    let deep = format!("{}0{}", "[".repeat(50), "]".repeat(50));
    assert!(matches!(
        NativeWriteContext::from_raw(
            registry.utility_owner_marker().unwrap(),
            stamp(BEFORE),
            WriteContextKind::Profile,
            deep.as_bytes()
        ),
        Err(WriteResourceError::InvalidContext)
    ));
}
#[test]
fn one_native_permit_has_only_one_concurrent_take() {
    use std::sync::{Arc, Barrier};
    let registry = registry();
    let (raw, input, epoch) = raw_profile();
    let context = Arc::new(profile_context(&registry, &raw));
    let permit = Arc::new(
        context
            .prepare_profile(&input, ProfileWriteRoute::AppPort, epoch)
            .unwrap(),
    );
    let barrier = Arc::new(Barrier::new(8));
    let threads = (0..8)
        .map(|_| {
            let c = Arc::clone(&context);
            let p = Arc::clone(&permit);
            let b = Arc::clone(&barrier);
            std::thread::spawn(move || {
                b.wait();
                c.take(&p).is_ok()
            })
        })
        .collect::<Vec<_>>();
    assert_eq!(
        threads
            .into_iter()
            .map(|t| usize::from(t.join().unwrap()))
            .sum::<usize>(),
        1
    );
    assert!(
        context
            .acknowledge(&permit, stamp(AFTER))
            .unwrap()
            .profile()
            .is_some()
    );
}
#[test]
fn combined_raw_context_row_budget_is_enforced_independently_of_per_table_caps() {
    let registry = registry();
    let raw = json!({"userProfile":[],"history":vec![json!({});50_000],"preferences":[{"key":"tvoed_assignment","value":"PERMANENT","updated_at":"old-unparsed"}],"testMonths":vec![json!({});50_000]});
    assert!(matches!(
        NativeWriteContext::from_raw(
            registry.utility_owner_marker().unwrap(),
            stamp(BEFORE),
            WriteContextKind::Profile,
            &serde_json::to_vec(&raw).unwrap()
        ),
        Err(WriteResourceError::InputTooLarge)
    ));
}
fn epoch(value: &Value) -> f64 {
    match value.as_str() {
        Some("NaN") => f64::NAN,
        Some("Infinity") => f64::INFINITY,
        Some("-Infinity") => f64::NEG_INFINITY,
        _ => value.as_f64().unwrap(),
    }
}
#[test]
fn payroll_permits_reuse_all_original_548_plan_bodies_and_preserve_noop_and_cas_text() {
    use luna_engine::input::net_form::InitialNetSettings;
    let registry = registry();
    let data = value_pool::decode(include_str!(
        "../../reference/payroll-write-plan-golden.json"
    ));
    assert_eq!(data["cases"].as_array().unwrap().len(), 548);
    for case in data["cases"].as_array().unwrap() {
        let i = &case["input"];
        let raw = json!({"netProfiles":i.get("rows").cloned().unwrap_or(json!([])),"salaryPreference":i.get("preference").cloned().unwrap_or(Value::Null),"profileRows":[{"id":"singleton"}],"testMonths":[]});
        let prepared = (|| {
            let context = NativeWriteContext::from_raw(
                registry.utility_owner_marker().unwrap(),
                stamp(BEFORE),
                WriteContextKind::Payroll,
                &serde_json::to_vec(&raw).unwrap(),
            )?;
            let permit = if i["kind"] == "TIMING" {
                context.prepare_timing(
                    i["month"].as_str().unwrap(),
                    i["choice"].as_str().unwrap(),
                    epoch(&i["epoch"]),
                )?
            } else if i["kind"] == "CONTINUOUS" {
                context.prepare_net(
                    &InitialNetSettings::try_from_raw(&i["settings"])?,
                    epoch(&i["epoch"]),
                )?
            } else {
                context
                    .prepare_annual_reset(i["year"].as_i64().unwrap() as i32, epoch(&i["epoch"]))?
            };
            let taken = context.take(&permit)?;
            let value: Value = serde_json::from_str(&taken.body).unwrap();
            let changed = !value["mutations"].as_array().unwrap().is_empty();
            let committed =
                context.acknowledge(&permit, stamp(if changed { AFTER } else { BEFORE }))?;
            assert!(committed.profile().is_none());
            Ok::<Value, WriteResourceError>(value)
        })();
        let actual = match prepared {
            Ok(value) => value,
            Err(WriteResourceError::Input(e)) => {
                json!({"$error":{"name":e.name(),"message":e.message()}})
            }
            Err(e) => panic!("{}: {e:?}", case["id"]),
        };
        assert_eq!(actual, case["expected"], "{}", case["id"]);
    }
}
#[test]
fn actual_original_profile_outputs_are_retained_only_by_native_single_use_permits() {
    let data = value_pool::decode(include_str!(
        "../../reference/profile-write-sql-golden.json"
    ));
    let registry = registry();
    let mut successes = 0;
    let mut errors = 0;
    for case in data["cases"].as_array().unwrap() {
        let input = &case["input"];
        let context = NativeWriteContext::from_raw(
            registry.utility_owner_marker().unwrap(),
            stamp(BEFORE),
            WriteContextKind::Profile,
            &serde_json::to_vec(&input["state"]).unwrap(),
        )
        .unwrap();
        let raw: Value = serde_json::from_str(input["rawInputJson"].as_str().unwrap()).unwrap();
        let route = if input["route"] == "APP_PORT" {
            ProfileWriteRoute::AppPort
        } else {
            ProfileWriteRoute::EmploymentRepository
        };
        let result = context.prepare_profile(
            &raw,
            route,
            input["observedEpochMilliseconds"].as_f64().unwrap(),
        );
        if case["expected"]["result"]["ok"] == true {
            let permit = result.unwrap_or_else(|e| panic!("{}: {e:?}", case["id"]));
            assert!(matches!(
                context.acknowledge(&permit, stamp(AFTER)),
                Err(WriteResourceError::NotTaken)
            ));
            let taken = context.take(&permit).unwrap();
            assert_eq!(taken.stamp, stamp(BEFORE));
            let plan: Value = serde_json::from_str(&taken.body).unwrap();
            assert_eq!(plan["schemaVersion"], 1);
            assert!(matches!(
                context.take(&permit),
                Err(WriteResourceError::AlreadyTaken)
            ));
            let post_stamp = stamp(if plan["mutations"].as_array().unwrap().is_empty() {
                BEFORE
            } else {
                AFTER
            });
            let committed = context
                .acknowledge(&permit, post_stamp.clone())
                .unwrap_or_else(|e| panic!("{}: {e:?}", case["id"]));
            assert_eq!(
                committed.profile().unwrap().as_ref(),
                &case["expected"]["result"]["value"]
            );
            assert_eq!(committed.stamp(), &post_stamp);
            assert!(matches!(
                context.acknowledge(&permit, stamp(AFTER)),
                Err(WriteResourceError::AlreadyCompleted)
            ));
            successes += 1;
        } else {
            let error = match result {
                Err(WriteResourceError::Profile(e)) => e,
                _ => panic!("{}: expected original typed failure", case["id"]),
            };
            assert_eq!(
                json!({"name":error.name(),"message":error.message(),"userFacing":error.is_user_facing()}),
                case["expected"]["result"]["error"]
            );
            errors += 1;
        }
    }
    assert_eq!((successes, errors), (715, 389));
}
