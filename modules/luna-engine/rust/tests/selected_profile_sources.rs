#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    contract::{OwnerIdentity, SourceKind, SourceState, assembly::SnapshotAssembly},
    runtime::{SnapshotRegistry, calendar_selected::*, write_resource::WriteContextStamp},
};
use serde_json::{Value, json};
use std::sync::Arc;

type Model =
    NativeSelectedLifecycle<NativeSelectedBase, NativeSelectedHistory, NativeSelectedTarget>;
fn stamp() -> WriteContextStamp {
    WriteContextStamp::from_raw(&json!({"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":"11111111111111111111111111111111","databaseSchemaVersion":35})).unwrap()
}
fn begin(index: usize) -> SnapshotAssembly {
    SnapshotAssembly::begin(&serde_json::to_vec(&json!({"ownerScope":"selected-source","ownerEpoch":1,"snapshotId":format!("selected-{index}"),"snapshotRevision":1,"selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}})).unwrap()).unwrap()
}
fn add(source: &mut SnapshotAssembly, kind: SourceKind, raw: &Value) {
    let null = raw.is_null();
    let header = json!({"kind":kind,"source":{"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":if null{"NULL"}else{"VALUE"}}}}});
    source
        .source(
            &serde_json::to_vec(&header).unwrap(),
            &if null {
                vec![]
            } else {
                serde_json::to_vec(raw).unwrap()
            },
        )
        .unwrap();
}
fn state(_kind: SourceKind, raw: &Value) -> SourceState {
    let data = if raw.is_null() {
        json!({"kind":"NULL"})
    } else {
        json!({"kind":"VALUE","value":raw})
    };
    serde_json::from_value(json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":data}})).unwrap()
}
fn input_base(
    registry: &SnapshotRegistry,
    raw: &Value,
    epoch: i64,
    index: usize,
) -> Arc<NativeSelectedBase> {
    let mut source = begin(index);
    let mut profile = raw["profile"]
        .as_array()
        .unwrap()
        .first()
        .cloned()
        .unwrap_or(Value::Null);
    // The existing native SQL projection selects the 18 profile columns and
    // omits the physical singleton primary key. No profile value is inferred.
    if let Some(row) = profile.as_object_mut() {
        row.remove("id");
    }
    let prefs = raw["preferences"].as_array().unwrap();
    // This supplemental original corpus has only these three preference rows.
    // Do not silently discard a future salary preference in this test adapter.
    assert!(prefs.iter().all(|r| matches!(
        r["key"].as_str(),
        Some(
            "tvoed_workplace_coverage"
                | "tvoed_assignment"
                | "youth_protection_enabled"
                | "unrelated_synthetic"
        )
    )));
    let salary = Vec::<Value>::new();
    let pattern = prefs
        .iter()
        .filter(|r| {
            matches!(
                r["key"].as_str(),
                Some("tvoed_workplace_coverage" | "tvoed_assignment")
            )
        })
        .cloned()
        .collect::<Vec<_>>();
    add(
        &mut source,
        SourceKind::WorkProfile,
        &if profile.is_null() {
            Value::Null
        } else {
            json!({"profileRow":profile,"salaryRows":salary})
        },
    );
    add(
        &mut source,
        SourceKind::RemunerationProfiles,
        &raw["history"],
    );
    add(
        &mut source,
        SourceKind::WorkPatternSettings,
        &json!(pattern),
    );
    Arc::new(
        NativeSelectedBase::prepare(
            registry.utility_owner_marker().unwrap(),
            stamp(),
            source,
            epoch,
        )
        .unwrap(),
    )
}
fn input_history(registry: &SnapshotRegistry, raw: &Value) -> Arc<NativeSelectedHistory> {
    Arc::new(
        NativeSelectedHistory::prepare(
            registry.utility_owner_marker().unwrap(),
            stamp(),
            Arc::new(raw["history"].as_array().unwrap().clone()),
        )
        .unwrap(),
    )
}
fn input_target(registry: &SnapshotRegistry, raw: &Value) -> Arc<NativeSelectedTarget> {
    // All these original raw sources have no saved target and an empty readPlan.
    // Validate that boundary explicitly; richer saved-target cases use the unchanged
    // shared parser's existing 348/696/weak source matrix, not fabricated plan rows.
    assert!(raw["savedTarget"].as_array().unwrap().is_empty());
    assert!(raw["shifts"].as_array().unwrap().is_empty());
    let zone = raw["profile"]
        .as_array()
        .unwrap()
        .first()
        .map(|row| json!({"time_zone":row["time_zone"]}))
        .unwrap_or(Value::Null);
    let source = state(
        SourceKind::WorkingTimeTarget,
        &json!({"savedRow":null,"timeZoneRow":zone,"planRows":[]}),
    );
    Arc::new(
        NativeSelectedTarget::prepare(registry.utility_owner_marker().unwrap(), stamp(), &source)
            .unwrap(),
    )
}
fn io<'a>(case: &'a Value, kind: &str, index: usize) -> &'a Value {
    case["input"]["ioCaptures"]
        .as_array()
        .unwrap()
        .iter()
        .find(|io| io["kind"] == kind && io["id"] == index)
        .unwrap()
}
fn reads(
    value: SelectedReads,
    targets: &mut Vec<Option<SelectedTargetRead>>,
    histories: &mut Vec<Option<SelectedHistoryRead>>,
) {
    if let Some(value) = value.target {
        targets.push(Some(value));
    }
    if let Some(value) = value.history {
        histories.push(Some(value));
    }
}
fn compare(
    model: &Model,
    cache: &mut NativeSelectedProfileCache,
    youth: &NativeSelectedYouth,
    epoch: i64,
    expected: &Value,
    label: &str,
) {
    if expected["mounted"] == false {
        assert!(matches!(
            model.snapshot(),
            Err(SelectedControlError::Closed)
        ));
        return;
    }
    let control = model.snapshot().unwrap();
    let actual = cache.observe(&control, epoch, youth).unwrap();
    assert!(actual.is_current().unwrap());
    assert_eq!(
        json!({"profile":actual.profile().unwrap().map(|v|v.as_ref()),"calculationProfile":actual.calculation_profile().unwrap().map(|v|v.as_ref())}),
        expected["profileViews"],
        "{label}"
    );
}
#[test]
fn original_raw_full_load_and_child_sources_produce_complete_retained_provider_roles() {
    let corpus = value_pool::decode(include_str!(
        "../../reference/selected-profile-lifecycle-golden.json"
    ));
    let mut total = 0;
    let mut cases = 0;
    for case in corpus["cases"].as_array().unwrap() {
        if case["input"]["steps"]
            .as_array()
            .unwrap()
            .iter()
            .any(|step| step[0] == "PROFILE_WRITE")
        {
            continue;
        }
        let registry = SnapshotRegistry::default();
        registry
            .reset_for_owner(&OwnerIdentity::new("selected-source", 1).unwrap())
            .unwrap();
        let empty = json!({"history":[]});
        let (mut model, first) = Model::new(
            registry.utility_owner_marker().unwrap(),
            input_history(&registry, &empty),
            true,
        )
        .unwrap();
        let mut history = vec![Some(first)];
        let mut targets = Vec::new();
        let mut calendar = vec![Some(true)];
        let mut cache = NativeSelectedProfileCache::default();
        let youth_row = case["input"]["initialPhysical"]["preferences"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["key"] == "youth_protection_enabled")
            .cloned()
            .unwrap_or(Value::Null);
        let youth = NativeSelectedYouth::prepare(
            registry.utility_owner_marker().unwrap(),
            &state(SourceKind::YouthPreference, &youth_row),
        )
        .unwrap();
        let mut epoch = io(case, "CALENDAR", 0)["epoch"].as_i64().unwrap();
        let frames = case["expected"]["frames"].as_array().unwrap();
        compare(
            &model,
            &mut cache,
            &youth,
            epoch,
            &frames[0],
            case["id"].as_str().unwrap(),
        );
        total += 1;
        for (i, step) in case["input"]["steps"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
        {
            let mounted = frames[i]["mounted"] == true;
            match step[0].as_str().unwrap() {
                "COMPLETE" | "REJECT" => {
                    let reject = step[0] == "REJECT";
                    let index = step[2].as_u64().map(|v| v as usize);
                    match step[1].as_str().unwrap() {
                        "CALENDAR" => {
                            let index = index.unwrap_or_else(|| {
                                calendar.iter().position(Option::is_some).unwrap()
                            });
                            let full = calendar[index].take().unwrap();
                            if full && mounted {
                                let raw = io(case, "CALENDAR", index);
                                reads(
                                    model
                                        .full_snapshot(Some(input_base(
                                            &registry,
                                            &raw["rawAtBegin"],
                                            raw["epoch"].as_i64().unwrap(),
                                            i,
                                        )))
                                        .unwrap(),
                                    &mut targets,
                                    &mut history,
                                );
                            }
                        }
                        "TARGET" => {
                            let index = index.unwrap_or_else(|| {
                                targets.iter().position(Option::is_some).unwrap()
                            });
                            let read = targets[index].take().unwrap();
                            if mounted && model.accepts_target(&read).unwrap() {
                                if reject {
                                    model.reject_target(read).unwrap();
                                } else {
                                    model
                                        .resolve_target(
                                            read,
                                            Some(input_target(
                                                &registry,
                                                &io(case, "TARGET", index)["rawAtBegin"],
                                            )),
                                        )
                                        .unwrap();
                                }
                            }
                        }
                        "HISTORY" => {
                            let index = index.unwrap_or_else(|| {
                                history.iter().position(Option::is_some).unwrap()
                            });
                            let read = history[index].take().unwrap();
                            if mounted && model.accepts_history(&read).unwrap() {
                                if reject {
                                    model.reject_history(read).unwrap();
                                } else {
                                    model
                                        .resolve_history(
                                            read,
                                            input_history(
                                                &registry,
                                                &io(case, "HISTORY", index)["rawAtBegin"],
                                            ),
                                        )
                                        .unwrap();
                                }
                            }
                        }
                        other => panic!("unknown original IO {other}"),
                    }
                }
                "RELOAD" => {
                    model.parent_ready(false).unwrap();
                    calendar.push(Some(true));
                }
                "BACKGROUND" => calendar.push(Some(false)),
                "TARGET_REFRESH" => {
                    if let Some(read) = model.refresh_target().unwrap() {
                        targets.push(Some(read));
                    }
                }
                "HISTORY_RELOAD" => {
                    if let Some(read) = model.reload_history().unwrap() {
                        history.push(Some(read));
                    }
                }
                "HISTORY_WRITE" => {
                    let write = model.begin_history_write().unwrap();
                    if let Some(read) = model.finish_history_write(write).unwrap() {
                        history.push(Some(read));
                    }
                }
                "SHIFT_WRITE" => {}
                "CLOCK" => {
                    epoch = step[1]
                        .as_str()
                        .unwrap()
                        .parse::<jiff::Timestamp>()
                        .unwrap()
                        .as_millisecond()
                }
                "UNMOUNT" => model.unmount().unwrap(),
                other => panic!("unknown original step {other}"),
            }
            compare(
                &model,
                &mut cache,
                &youth,
                epoch,
                &frames[i + 1],
                &format!("{} frame {}", case["id"].as_str().unwrap(), i + 1),
            );
            total += 1;
        }
        cases += 1;
    }
    assert_eq!((cases, total), (14, 102));
}

fn ready_model() -> (SnapshotRegistry, Model, NativeSelectedYouth, i64) {
    let corpus = value_pool::decode(include_str!(
        "../../reference/selected-profile-lifecycle-golden.json"
    ));
    let case = &corpus["cases"][0];
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("selected-source", 1).unwrap())
        .unwrap();
    let epoch = io(case, "CALENDAR", 0)["epoch"].as_i64().unwrap();
    let (mut model, _) = Model::new(
        registry.utility_owner_marker().unwrap(),
        input_history(&registry, &json!({"history":[]})),
        true,
    )
    .unwrap();
    let reads = model
        .full_snapshot(Some(input_base(
            &registry,
            &io(case, "CALENDAR", 0)["rawAtBegin"],
            epoch,
            1,
        )))
        .unwrap();
    model
        .resolve_history(
            reads.history.unwrap(),
            input_history(&registry, &io(case, "HISTORY", 1)["rawAtBegin"]),
        )
        .unwrap();
    model
        .resolve_target(
            reads.target.unwrap(),
            Some(input_target(
                &registry,
                &io(case, "TARGET", 0)["rawAtBegin"],
            )),
        )
        .unwrap();
    let youth = NativeSelectedYouth::prepare(
        registry.utility_owner_marker().unwrap(),
        &state(SourceKind::YouthPreference, &json!({"value":"false"})),
    )
    .unwrap();
    (registry, model, youth, epoch)
}

#[test]
fn clock_alone_keeps_the_original_memo_and_refresh_changes_only_the_provider_role() {
    let (_registry, mut model, youth, epoch) = ready_model();
    let mut cache = NativeSelectedProfileCache::default();
    let control = model.snapshot().unwrap();
    let first = cache.observe(&control, epoch, &youth).unwrap();
    let first_provider = Arc::clone(first.profile().unwrap().unwrap());
    let first_calculation = Arc::clone(first.calculation_profile().unwrap().unwrap());
    let next = cache.observe(&control, epoch + 86_400_000, &youth).unwrap();
    assert!(Arc::ptr_eq(
        next.profile().unwrap().unwrap(),
        &first_provider
    ));
    assert!(Arc::ptr_eq(
        next.calculation_profile().unwrap().unwrap(),
        &first_calculation
    ));
    model.refresh_target().unwrap();
    assert!(!first.is_current().unwrap());
    assert!(matches!(first.profile(), Err(SelectedSourceError::Stale)));
    let changed = cache
        .observe(&model.snapshot().unwrap(), epoch + 86_400_000, &youth)
        .unwrap();
    assert_eq!(changed.profile().unwrap().unwrap()["weeklyMinutes"], 1200);
    assert_eq!(
        changed.calculation_profile().unwrap().unwrap()["weeklyMinutes"],
        2100
    );
}

#[test]
fn foreign_native_sources_and_reset_before_invalid_rows_cannot_publish_profiles() {
    let (_registry, mut model, youth, epoch) = ready_model();
    let foreign = SnapshotRegistry::default();
    foreign
        .reset_for_owner(&OwnerIdentity::new("selected-source", 1).unwrap())
        .unwrap();
    let marker = foreign.utility_owner_marker().unwrap();
    let history = input_history(&foreign, &json!({"history":[]}));
    let read = model.reload_history().unwrap().unwrap();
    model.resolve_history(read, history).unwrap();
    assert!(matches!(
        NativeSelectedProfileCache::default().observe(&model.snapshot().unwrap(), epoch, &youth),
        Err(SelectedSourceError::ForeignSource)
    ));
    foreign
        .reset_for_owner(&OwnerIdentity::new("selected-source", 1).unwrap())
        .unwrap();
    assert!(matches!(
        NativeSelectedHistory::prepare(marker, stamp(), Arc::new(vec![Value::Null])),
        Err(SelectedSourceError::Control(
            SelectedControlError::OwnerChanged
        ))
    ));
}

#[test]
fn null_is_distinct_from_failed_input_and_cache_values_release_on_worker_clear() {
    let (registry, model, youth, epoch) = ready_model();
    let mut empty = begin(10);
    add(&mut empty, SourceKind::WorkProfile, &Value::Null);
    assert!(
        NativeSelectedBase::prepare(
            registry.utility_owner_marker().unwrap(),
            stamp(),
            empty,
            epoch
        )
        .is_ok()
    );
    let mut invalid = begin(11);
    add(&mut invalid, SourceKind::CalendarEntries, &json!([]));
    assert!(matches!(
        NativeSelectedBase::prepare(
            registry.utility_owner_marker().unwrap(),
            stamp(),
            invalid,
            epoch
        ),
        Err(SelectedSourceError::InvalidScope)
    ));
    assert!(matches!(
        NativeSelectedTarget::prepare(
            registry.utility_owner_marker().unwrap(),
            stamp(),
            &SourceState::Loading
        ),
        Err(SelectedSourceError::Unavailable)
    ));
    assert!(
        NativeSelectedHistory::prepare(
            registry.utility_owner_marker().unwrap(),
            stamp(),
            Arc::new(vec![Value::Null; 50_001])
        )
        .is_err()
    );
    let mut cache = NativeSelectedProfileCache::default();
    let view = cache
        .observe(&model.snapshot().unwrap(), epoch, &youth)
        .unwrap();
    let weak = Arc::downgrade(view.profile().unwrap().unwrap());
    drop(view);
    drop(model);
    assert!(weak.upgrade().is_some());
    cache.clear();
    assert!(weak.upgrade().is_none());
}
