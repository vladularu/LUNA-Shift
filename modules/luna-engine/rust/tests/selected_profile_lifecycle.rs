#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    contract::OwnerIdentity,
    runtime::{
        SnapshotRegistry,
        calendar_selected::{
            NativeSelectedLifecycle, SelectedControlError, SelectedControlSnapshot,
            SelectedHistoryRead, SelectedReads, SelectedStatus, SelectedTargetRead,
        },
    },
};
use serde_json::Value;
use std::sync::Arc;

fn registry() -> SnapshotRegistry {
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("selected-owner", 1).unwrap())
        .unwrap();
    registry
}
fn status(value: &Value) -> SelectedStatus {
    match value.as_str().unwrap() {
        "loading" => SelectedStatus::Loading,
        "ready" => SelectedStatus::Ready,
        "error" => SelectedStatus::Error,
        other => panic!("unknown original status {other}"),
    }
}
fn save_reads(
    reads: SelectedReads,
    targets: &mut Vec<Option<SelectedTargetRead>>,
    history: &mut Vec<Option<SelectedHistoryRead>>,
) {
    if let Some(read) = reads.target {
        targets.push(Some(read));
    }
    if let Some(read) = reads.history {
        history.push(Some(read));
    }
}
struct Seen {
    base: Option<Arc<usize>>,
    original_base: Value,
    history: Arc<usize>,
    original_history: Value,
    target: Option<Arc<usize>>,
    original_target: Value,
    container: Option<Arc<()>>,
    original_container: Value,
}
fn same<T>(left: Option<&Arc<T>>, right: Option<&Arc<T>>) -> bool {
    match (left, right) {
        (Some(a), Some(b)) => Arc::ptr_eq(a, b),
        (None, None) => true,
        _ => false,
    }
}
fn check_frame(
    model: &NativeSelectedLifecycle<usize, usize, usize>,
    expected: &Value,
    targets: usize,
    histories: usize,
    seen: &mut Vec<Seen>,
    label: &str,
) {
    if expected["mounted"] == false {
        assert!(
            matches!(model.snapshot(), Err(SelectedControlError::Closed)),
            "{label}"
        );
        return;
    }
    let actual = model.snapshot().unwrap();
    assert!(actual.is_current().unwrap(), "{label}");
    assert_eq!(
        actual.parent_ready,
        expected["target"]["ready"].as_bool().unwrap(),
        "{label}"
    );
    assert_eq!(
        actual.target_revision,
        expected["target"]["revision"].as_u64().unwrap(),
        "{label}"
    );
    assert_eq!(
        actual.history_revision,
        expected["history"]["reloadRevision"].as_u64().unwrap(),
        "{label}"
    );
    assert_eq!(
        actual.history_status,
        status(&expected["target"]["historyStatus"]),
        "{label}"
    );
    assert_eq!(
        actual.loaded_target_revision,
        expected["target"]["loaded"]["revision"].as_u64(),
        "{label}"
    );
    assert_eq!(
        actual.loaded_target_status,
        expected["target"]["loaded"]["status"]
            .as_str()
            .map(|_| status(&expected["target"]["loaded"]["status"])),
        "{label}"
    );
    if !expected["profileViews"]["calculationProfile"].is_null() {
        assert_eq!(
            actual.calculation_status,
            Some(status(
                &expected["profileViews"]["calculationProfile"]["workingTimeTarget"]["status"]
            )),
            "{label}"
        );
    }
    let count = |kind| {
        expected["events"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e["kind"] == kind)
            .count()
    };
    assert_eq!(targets, count("TARGET_BEGIN"), "{label}");
    assert_eq!(histories, count("HISTORY_BEGIN"), "{label}");
    let original_base = expected["parent"]["profileRevision"].clone();
    let original_history = expected["history"]["visibleProfilesRevision"].clone();
    let original_target = expected["target"]["loadedSnapshotRevision"].clone();
    let original_container = expected["target"]["loadedContainerRevision"].clone();
    for previous in seen.iter() {
        assert_eq!(
            same(actual.base.as_ref(), previous.base.as_ref()),
            original_base == previous.original_base,
            "base identity {label}"
        );
        assert_eq!(
            Arc::ptr_eq(&actual.history, &previous.history),
            original_history == previous.original_history,
            "history identity {label}"
        );
        assert_eq!(
            same(actual.target.as_ref(), previous.target.as_ref()),
            original_target == previous.original_target,
            "target identity {label}"
        );
        assert_eq!(
            same(
                actual.loaded_target_identity.as_ref(),
                previous.container.as_ref()
            ),
            original_container == previous.original_container,
            "loaded object identity {label}"
        );
    }
    seen.push(Seen {
        base: actual.base,
        original_base,
        history: actual.history,
        original_history,
        target: actual.target,
        original_target,
        container: actual.loaded_target_identity,
        original_container,
    });
}

#[test]
fn original_provider_children_preserve_status_value_and_identity_lifetimes() {
    let corpus = value_pool::decode(include_str!(
        "../../reference/selected-profile-lifecycle-golden.json"
    ));
    let mut frames = 0;
    for case in corpus["cases"].as_array().unwrap() {
        let registry = registry();
        let (mut model, initial) = NativeSelectedLifecycle::<usize, usize, usize>::new(
            registry.utility_owner_marker().unwrap(),
            Arc::new(0),
            true,
        )
        .unwrap();
        let mut history = vec![Some(initial)];
        let mut targets = Vec::new();
        let mut calendar = vec![Some(true)];
        let mut seen = Vec::new();
        let expected = case["expected"]["frames"].as_array().unwrap();
        check_frame(
            &model,
            &expected[0],
            0,
            1,
            &mut seen,
            case["id"].as_str().unwrap(),
        );
        frames += 1;
        for (i, step) in case["input"]["steps"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
        {
            let mounted = expected[i]["mounted"] == true;
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
                            assert!(!reject);
                            if full && mounted {
                                let reads = model.full_snapshot(Some(Arc::new(i + 1))).unwrap();
                                save_reads(reads, &mut targets, &mut history);
                            }
                        }
                        "TARGET" => {
                            let index = index.unwrap_or_else(|| {
                                targets.iter().position(Option::is_some).unwrap()
                            });
                            let ticket = targets[index].take().unwrap();
                            let result = if reject {
                                model.reject_target(ticket)
                            } else {
                                model.resolve_target(ticket, Some(Arc::new(index + 1)))
                            };
                            if mounted {
                                result.unwrap();
                            } else {
                                assert_eq!(result, Err(SelectedControlError::Closed));
                            }
                        }
                        "HISTORY" => {
                            let index = index.unwrap_or_else(|| {
                                history.iter().position(Option::is_some).unwrap()
                            });
                            let ticket = history[index].take().unwrap();
                            let result = if reject {
                                model.reject_history(ticket)
                            } else {
                                model.resolve_history(ticket, Arc::new(index + 1))
                            };
                            if mounted {
                                result.unwrap();
                            } else {
                                assert_eq!(result, Err(SelectedControlError::Closed));
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
                "PROFILE_WRITE" => {
                    if let Some(read) = model.profile_written(Some(Arc::new(i + 1))).unwrap() {
                        history.push(Some(read));
                    }
                }
                "HISTORY_WRITE" => {
                    let write = model.begin_history_write().unwrap();
                    if let Some(read) = model.finish_history_write(write).unwrap() {
                        history.push(Some(read));
                    }
                }
                "SHIFT_WRITE" | "CLOCK" => {} // Original effect dependencies are unchanged.
                "UNMOUNT" => model.unmount().unwrap(),
                other => panic!("unknown original step {other}"),
            }
            let label = format!("{} frame {}", case["id"].as_str().unwrap(), i + 1);
            check_frame(
                &model,
                &expected[i + 1],
                targets.len(),
                history.len(),
                &mut seen,
                &label,
            );
            frames += 1;
        }
    }
    assert_eq!(frames, 111);
}

#[test]
fn control_snapshots_and_children_are_owner_core_generation_bound() {
    let a = registry();
    let b = registry();
    let (mut state, first) = NativeSelectedLifecycle::<usize, usize, usize>::new(
        a.utility_owner_marker().unwrap(),
        Arc::new(0),
        true,
    )
    .unwrap();
    let (mut other, _) = NativeSelectedLifecycle::<usize, usize, usize>::new(
        b.utility_owner_marker().unwrap(),
        Arc::new(0),
        true,
    )
    .unwrap();
    assert_eq!(
        other.resolve_history(first, Arc::new(1)),
        Err(SelectedControlError::ForeignTicket)
    );
    let before: SelectedControlSnapshot<_, _, _> = state.snapshot().unwrap();
    state.parent_ready(true).unwrap();
    assert!(!before.is_current().unwrap());
    let after = state.snapshot().unwrap();
    a.reset_for_owner(&OwnerIdentity::new("selected-owner", 1).unwrap())
        .unwrap();
    assert!(matches!(
        after.is_current(),
        Err(SelectedControlError::OwnerChanged)
    ));
    assert!(matches!(
        state.snapshot(),
        Err(SelectedControlError::OwnerChanged)
    ));
}

#[test]
fn pending_history_writers_fence_reads_and_only_the_last_writer_reloads() {
    let registry = registry();
    let initial_value = Arc::new(7);
    let (mut model, initial) = NativeSelectedLifecycle::<usize, usize, usize>::new(
        registry.utility_owner_marker().unwrap(),
        Arc::new(0),
        true,
    )
    .unwrap();
    assert!(
        model
            .resolve_history(initial, Arc::clone(&initial_value))
            .unwrap()
    );
    let old_read = model.reload_history().unwrap().unwrap();
    let first = model.begin_history_write().unwrap();
    let second = model.begin_history_write().unwrap();
    assert!(model.reload_history().unwrap().is_none());
    assert!(!model.resolve_history(old_read, Arc::new(99)).unwrap());
    assert!(model.finish_history_write(first).unwrap().is_none());
    let snapshot = model.snapshot().unwrap();
    assert_eq!(snapshot.pending_history_writes, 1);
    assert_eq!(snapshot.history_status, SelectedStatus::Loading);
    assert!(Arc::ptr_eq(&snapshot.history, &initial_value));
    let current = model.finish_history_write(second).unwrap().unwrap();
    assert_eq!(model.snapshot().unwrap().pending_history_writes, 0);
    assert!(model.reject_history(current).unwrap());
    let snapshot = model.snapshot().unwrap();
    assert_eq!(snapshot.history_status, SelectedStatus::Error);
    assert!(Arc::ptr_eq(&snapshot.history, &initial_value));
}

#[test]
fn bounded_writers_and_shared_values_release_without_creating_a_ready_source() {
    let registry = registry();
    let history = Arc::new(vec![0_u8; 50_000]);
    let base = Arc::new(vec![1_u8; 50_000]);
    let weak_history = Arc::downgrade(&history);
    let weak_base = Arc::downgrade(&base);
    let (mut model, _) = NativeSelectedLifecycle::<Vec<u8>, Vec<u8>, ()>::new(
        registry.utility_owner_marker().unwrap(),
        Arc::clone(&history),
        false,
    )
    .unwrap();
    let reads = model.full_snapshot(Some(Arc::clone(&base))).unwrap();
    assert!(reads.target.is_none());
    let mut writers = Vec::new();
    for _ in 0..32 {
        writers.push(model.begin_history_write().unwrap());
    }
    let before = model.snapshot().unwrap();
    assert!(matches!(
        model.begin_history_write(),
        Err(SelectedControlError::Capacity)
    ));
    assert!(
        before.is_current().unwrap(),
        "rejected work does not replace publication"
    );
    assert_eq!(before.pending_history_writes, 32);
    assert_eq!(
        before.calculation_status, None,
        "absent original target loader adds no target status"
    );
    assert!(Arc::ptr_eq(before.base.as_ref().unwrap(), &base));
    assert!(Arc::ptr_eq(&before.history, &history));
    drop(history);
    drop(base);
    drop(model);
    assert!(!before.is_current().unwrap());
    assert!(weak_base.upgrade().is_some());
    assert!(weak_history.upgrade().is_some());
    drop(before);
    assert!(weak_base.upgrade().is_none());
    assert!(weak_history.upgrade().is_none());
    drop(writers); // tickets never retain the large source values
}
