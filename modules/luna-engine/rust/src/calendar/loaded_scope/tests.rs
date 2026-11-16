use super::*;
use crate::calendar::recurrence::CollationRanks;
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc};

fn corpus() -> Value {
    crate::test_value_pool::decode(include_str!(
        "../../../../reference/loaded-scope-golden.json"
    ))
}
fn ranks(data: &Value) -> CollationRanks {
    CollationRanks::from(
        data["collationRanks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|pair| {
                (
                    pair[0].as_str().unwrap().to_owned(),
                    pair[1].as_u64().unwrap() as u32,
                )
            })
            .collect::<BTreeMap<_, _>>(),
    )
}
#[test]
fn original_loaded_scope_raw_sql_selection_precedes_mapping_and_recurrence() {
    let data = corpus();
    let ranks = ranks(&data);
    let mut reads = 0;
    for case in data["cases"].as_array().unwrap() {
        for capture in case["input"]["captures"].as_array().unwrap() {
            let raw = &capture["rawSource"];
            let source = RawScopeRows::new(
                Arc::from(raw["shiftRows"].as_array().unwrap().clone()),
                Arc::from(raw["appointmentRows"].as_array().unwrap().clone()),
                Arc::from(raw["templateRows"].as_array().unwrap().clone()),
            )
            .unwrap();
            let range = CalendarLoadRange {
                start_date: capture["range"]["startDate"].as_str().unwrap().to_owned(),
                end_date: capture["range"]["endDate"].as_str().unwrap().to_owned(),
            };
            let observed = case["expected"]["frames"]
                .as_array()
                .unwrap()
                .iter()
                .flat_map(|frame| frame["io"].as_array().unwrap())
                .find(|job| job["id"] == capture["id"] && !job["result"].is_null())
                .unwrap();
            // No SQL rows for a deliberately failed IO callback. It is not a
            // malformed raw-source normalization result.
            if capture["queries"].as_array().unwrap().is_empty() {
                continue;
            }
            let native = source
                .prepare(&range)
                .and_then(|draft| draft.finish(&ranks));
            if observed["result"]["ok"] == true {
                let native = native.unwrap();
                assert_eq!(
                    json!(
                        native
                            .entries()
                            .iter()
                            .map(|entry| entry.value())
                            .collect::<Vec<_>>()
                    ),
                    observed["result"]["value"],
                    "{} query {}",
                    case["id"],
                    capture["id"]
                );
            } else {
                assert!(
                    native.is_err(),
                    "{} selected invalid row must fail",
                    case["id"]
                );
            }
            reads += 1;
        }
    }
    assert_eq!(reads, 81);
}

fn raw_source(raw: &Value) -> Arc<RawScopeRows> {
    RawScopeRows::new(
        Arc::from(raw["shiftRows"].as_array().unwrap().clone()),
        Arc::from(raw["appointmentRows"].as_array().unwrap().clone()),
        Arc::from(raw["templateRows"].as_array().unwrap().clone()),
    )
    .unwrap()
}
fn failure(kind: &str) -> ScopeLoadFailure {
    match kind {
        "PROFILE" => ScopeLoadFailure::Profile,
        "TEMPLATES" => ScopeLoadFailure::Templates,
        "CALENDAR" => ScopeLoadFailure::Calendar,
        "TARIFF" => ScopeLoadFailure::TariffDecisions,
        "PATTERN" => ScopeLoadFailure::WorkPattern,
        _ => panic!("unknown raw IO failure"),
    }
}
struct Job {
    load: u64,
    entries: Option<ScopeEntries>,
    ended: bool,
}
struct Replay<'a> {
    case: &'a Value,
    ranks: &'a CollationRanks,
    scope: CalendarLoadedScope,
    jobs: Vec<Job>,
    failure: Option<String>,
    epoch: i64,
    writes: usize,
}
impl Replay<'_> {
    fn started(&mut self, start: ScopeLoadStart) {
        let ScopeLoadStart::Read {
            load,
            range,
            full_snapshot,
            ..
        } = start
        else {
            return;
        };
        let capture = &self.case["input"]["captures"][self.jobs.len()];
        assert_eq!(
            json!(range),
            capture["range"],
            "{} source native query window",
            self.case["id"]
        );
        let entries = if capture["queries"].as_array().unwrap().is_empty() {
            None
        } else {
            raw_source(&capture["rawSource"])
                .prepare(&range)
                .and_then(|draft| draft.finish(self.ranks))
                .ok()
        };
        let mut ended = false;
        if let Some(kind) = self.failure.as_deref() {
            if full_snapshot && kind != "CALENDAR" {
                self.scope
                    .complete(load, Err(failure(kind)), None, self.ranks)
                    .unwrap();
                ended = true;
                self.failure = None;
            } else if kind == "CALENDAR" {
                self.failure = None;
            }
        }
        self.jobs.push(Job {
            load,
            entries,
            ended,
        });
    }
    fn compare(&self, index: usize) {
        let frame = &self.case["expected"]["frames"][index];
        let values = self
            .scope
            .entries()
            .entries()
            .iter()
            .map(|entry| entry.value())
            .collect::<Vec<_>>();
        assert_eq!(
            json!(&values),
            frame["entries"],
            "{} frame{index} original current entries",
            self.case["id"]
        );
        let actual = serde_json::to_value(self.scope.status()).unwrap();
        for key in ["ready", "error", "calendarRange"] {
            assert_eq!(
                actual[key], frame["public"][key],
                "{} frame{index} public {key}",
                self.case["id"]
            );
        }
        let observed = json!({"activeYear":self.scope.active_year,"range":self.scope.range,"rangeKey":self.scope.range.as_ref().map(CalendarLoadRange::key),"loadedKey":self.scope.loaded_key,"calendarRange":self.scope.calendar_range,"retainedRanges":self.scope.retained,"retained":self.scope.retained,"initialized":self.scope.initialized,"sequence":self.scope.sequence,"deleted":self.scope.deleted.iter().map(|(kind,id)|format!("{kind}:{id}")).collect::<Vec<_>>(),"currentEntries":values});
        for (key, value) in observed.as_object().unwrap() {
            // JS Set insertion order is checked as a set, not invented lexical
            // presentation. The deleted keys are internal policy only.
            if key == "deleted" {
                let mut expected = frame["internal"][key]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_str().unwrap())
                    .collect::<Vec<_>>();
                expected.sort();
                assert_eq!(
                    value,
                    &json!(expected),
                    "{} frame{index} deletion set",
                    self.case["id"]
                );
            } else {
                assert_eq!(
                    value, &frame["internal"][key],
                    "{} frame{index} original internal {key}",
                    self.case["id"]
                );
            }
        }
        let notification=self.scope.notification_refresh.as_ref().map(|(generation,zone)|json!({"timeZone":zone,"isCurrent":*generation==self.scope.sequence}));
        assert_eq!(
            json!(notification),
            frame["public"]["notificationRefresh"],
            "{} frame{index} refresh lifetime",
            self.case["id"]
        );
        // This test-only projection may clone Values; the production policy
        // retains Arc handles. Existing recurrence is compared after selection.
        for day in frame["days"].as_array().unwrap() {
            let date = day["date"].as_str().unwrap();
            let native = crate::calendar::recurrence::expand_calendar_entries(
                &values.iter().map(|v| (*v).clone()).collect::<Vec<_>>(),
                date,
                date,
                self.ranks,
            );
            assert_eq!(
                json!(native.unwrap()),
                day["entries"],
                "{} frame{index} date{date}",
                self.case["id"]
            );
        }
    }
}
#[test]
fn original_loaded_scope_all_stateful_react_sql_local_write_trajectories() {
    let data = corpus();
    let ranks = ranks(&data);
    let mut frames = 0;
    for case in data["cases"].as_array().unwrap() {
        let mut replay = Replay {
            case,
            ranks: &ranks,
            scope: CalendarLoadedScope::default(),
            jobs: Vec::new(),
            failure: case["input"]["initialIoFailure"]
                .as_str()
                .map(str::to_owned),
            epoch: case["input"]["observedEpochMilliseconds"].as_i64().unwrap(),
            writes: 0,
        };
        let start = replay
            .scope
            .active_month(case["input"]["activeMonth"].as_str().unwrap(), replay.epoch)
            .unwrap();
        replay.started(start);
        replay.compare(0);
        frames += 1;
        for (index, step) in case["input"]["steps"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
        {
            let frame = &case["expected"]["frames"][index + 1];
            match step["kind"].as_str().unwrap() {
                "MONTH" => {
                    let start = replay
                        .scope
                        .active_month(step["value"].as_str().unwrap(), replay.epoch)
                        .unwrap();
                    replay.started(start);
                }
                "CLOCK" => replay.epoch = step["value"].as_i64().unwrap(),
                "RELOAD" | "BACKGROUND" => {
                    let start = replay
                        .scope
                        .reload(step["kind"] == "BACKGROUND", replay.epoch)
                        .unwrap();
                    replay.started(start);
                }
                "FAIL_NEXT" => replay.failure = Some(step["group"].as_str().unwrap().to_owned()),
                "UNMOUNT" => replay.scope.unmount().unwrap(),
                "COMPLETE" => {
                    let id = step["id"]
                        .as_u64()
                        .map(|id| id as usize)
                        .unwrap_or_else(|| {
                            frame["io"]
                                .as_array()
                                .unwrap()
                                .iter()
                                .position(|job| {
                                    job["status"] == "COMPLETED"
                                        && case["expected"]["frames"][index]["io"]
                                            [job["id"].as_u64().unwrap() as usize]["status"]
                                            != "COMPLETED"
                                })
                                .unwrap()
                        });
                    let job = &mut replay.jobs[id];
                    if !job.ended {
                        replay
                            .scope
                            .complete(
                                job.load,
                                job.entries.clone().ok_or(ScopeLoadFailure::Calendar),
                                None,
                                &ranks,
                            )
                            .unwrap();
                        job.ended = true;
                    }
                }
                "SAVE_SHIFT" | "SAVE_APPOINTMENT" | "DELETE" => {
                    let observed = &frame["writes"][replay.writes];
                    replay.writes += 1;
                    if observed["result"]["ok"] == true {
                        let deleted = step["kind"] == "DELETE";
                        let kind = if deleted {
                            observed["rawInput"]["kind"].as_str().unwrap()
                        } else if step["kind"] == "SAVE_SHIFT" {
                            "SHIFT"
                        } else {
                            "APPOINTMENT"
                        };
                        // Only the raw SQLite postimage + raw allocated/existing
                        // ID feed the native mapper. Original normalized Ready
                        // output is never deserialized into the native book.
                        let id = if deleted {
                            &observed["rawInput"]["id"]
                        } else {
                            &observed["result"]["value"]["id"]
                        };
                        let field = if kind == "SHIFT" {
                            "shiftRows"
                        } else {
                            "appointmentRows"
                        };
                        let row = observed["physical"][field]
                            .as_array()
                            .unwrap()
                            .iter()
                            .find(|row| row["id"] == *id)
                            .unwrap();
                        let entry =
                            ScopeEntry::from_write_row(kind, Arc::new(row.clone())).unwrap();
                        if deleted {
                            replay.scope.publish_delete(&entry);
                        } else {
                            replay.scope.publish_write(entry, &ranks).unwrap();
                        }
                    }
                }
                "TEMPLATE" | "DELETE_TEMPLATE" => {}
                other => panic!("unknown raw original event {other}"),
            }
            replay.compare(index + 1);
            frames += 1;
        }
        assert_eq!(
            replay.jobs.len(),
            case["input"]["captures"].as_array().unwrap().len(),
            "{} no extra native SQL requests",
            case["id"]
        );
    }
    assert_eq!(frames, 214);
}

#[test]
fn loaded_scope_rejects_limits_unknown_intents_and_rank_failures_without_partial_publication() {
    let data = corpus();
    let ranks = ranks(&data);
    let raw = &data["cases"][0]["input"]["initial"];
    assert!(matches!(
        RawScopeRows::new(
            Arc::from(vec![Value::Null; 50_001]),
            Arc::from([]),
            Arc::from([])
        ),
        Err(ScopeError::Capacity)
    ));
    assert!(matches!(
        RawScopeRows::new(
            Arc::from([json!({"date":"1700-01-01","ignored":"x".repeat(16_515_073)})]),
            Arc::from([]),
            Arc::from([])
        ),
        Err(ScopeError::Capacity)
    ));
    let epoch = 1_794_744_000_000;
    let mut scope = CalendarLoadedScope::default();
    let ScopeLoadStart::Read { load, range, .. } = scope.active_month("2026-11", epoch).unwrap()
    else {
        panic!("initial read");
    };
    let book = raw_source(raw)
        .prepare(&range)
        .unwrap()
        .finish(&ranks)
        .unwrap();
    scope.complete(load, Ok(book), None, &ranks).unwrap();
    let current = scope.entries.clone();
    let status = json!(scope.status());
    let generation = scope.generation();
    for month in ["", "2026", "2026-00", "2026-13", "2026-1", "2026-11junk"] {
        assert!(scope.active_month(month, epoch).is_err());
    }
    assert!(scope.active_month("2020-06", i64::MAX).is_err());
    assert!(
        scope
            .complete(999, Ok(ScopeEntries::default()), None, &ranks)
            .is_err()
    );
    assert_eq!(scope.generation(), generation);
    assert_eq!(json!(scope.status()), status);
    assert!(Arc::ptr_eq(&scope.entries.0, &current.0));
    let source = raw_source(raw);
    assert!(
        source
            .prepare(&range)
            .unwrap()
            .finish(&CollationRanks::default())
            .is_err()
    );
    let saved = ScopeEntry::from_write_row("SHIFT", Arc::new(raw["shiftRows"][0].clone())).unwrap();
    assert!(
        scope
            .publish_write(saved, &CollationRanks::default())
            .is_err()
    );
    assert!(Arc::ptr_eq(&scope.entries.0, &current.0));
    let ScopeLoadStart::Read { load, range, .. } = scope.active_month("2020-06", epoch).unwrap()
    else {
        panic!("next window");
    };
    let next = source.prepare(&range).unwrap().finish(&ranks).unwrap();
    let status = json!(scope.status());
    assert!(
        scope
            .complete(load, Ok(next.clone()), None, &CollationRanks::default())
            .is_err()
    );
    assert!(Arc::ptr_eq(&scope.entries.0, &current.0));
    assert_eq!(json!(scope.status()), status);
    scope.complete(load, Ok(next), None, &ranks).unwrap();
    scope.sequence = u64::MAX - 1;
    let range = scope.range.clone();
    assert!(matches!(
        scope.active_month("2038-06", epoch),
        Err(ScopeError::Capacity)
    ));
    assert_eq!(scope.sequence, u64::MAX - 1);
    assert_eq!(scope.range, range);
}

#[test]
fn loaded_scope_fifty_thousand_raw_rows_share_entry_and_baseline_owners_then_release() {
    let data = corpus();
    let ranks = ranks(&data);
    let raw = &data["cases"][0]["input"]["initial"];
    let mut old = raw["appointmentRows"][0].clone();
    old["date"] = json!("1900-01-01");
    old["title"] = json!("a");
    old["created_at"] = json!("i");
    old["updated_at"] = json!("i");
    old["recurrence_frequency"] = Value::Null;
    old["recurrence_interval"] = Value::Null;
    let appointments = (0..49_999)
        .map(|index| {
            let mut row = old.clone();
            row["id"] = json!(format!("a{index}"));
            row
        })
        .collect::<Vec<_>>();
    let shifts = Arc::<[Value]>::from([raw["shiftRows"][0].clone()]);
    let appointments = Arc::<[Value]>::from(appointments);
    let source = RawScopeRows::new(shifts.clone(), appointments.clone(), Arc::from([])).unwrap();
    let weak = Arc::downgrade(&source);
    let mut scope = CalendarLoadedScope::default();
    let ScopeLoadStart::Read { load, range, .. } =
        scope.active_month("2026-11", 1_794_744_000_000).unwrap()
    else {
        panic!("initial read");
    };
    let draft = source.prepare(&range).unwrap();
    assert_eq!(
        Arc::strong_count(&appointments),
        2,
        "raw arrays are shared, not cloned"
    );
    let book = draft.finish(&ranks).unwrap();
    assert_eq!(
        book.entries().len(),
        1,
        "non-series rows outside SQL range must not normalize"
    );
    let selected = book.entries()[0].clone();
    scope.complete(load, Ok(book), None, &ranks).unwrap();
    let current = scope.entries.0.clone();
    let ScopeLoadStart::Read { load, .. } = scope.reload(false, 1_794_744_000_000).unwrap() else {
        panic!("foreground reload");
    };
    assert!(Arc::ptr_eq(&scope.entries.0, &current));
    assert!(Arc::ptr_eq(&scope.entries.entries()[0], &selected));
    drop(source);
    assert!(
        weak.upgrade().is_some(),
        "selected entry retains exact raw source owner"
    );
    scope
        .complete(load, Ok(ScopeEntries::default()), None, &ranks)
        .unwrap();
    drop(current);
    assert!(
        weak.upgrade().is_some(),
        "borrowed selected entry independently retains owner"
    );
    drop(selected);
    assert!(
        weak.upgrade().is_none(),
        "obsolete raw source released after last native entry reference"
    );
    assert_eq!(Arc::strong_count(&appointments), 1);
    assert_eq!(Arc::strong_count(&shifts), 1);
}

#[test]
fn loaded_scope_completion_preflight_uses_final_native_union_and_rejects_foreign_or_changed_state()
{
    let data = corpus();
    let ranks = ranks(&data);
    let raw = &data["cases"][0]["input"]["initial"];
    let source = raw_source(raw);
    let mut scope = CalendarLoadedScope::default();
    let epoch = 1_794_744_000_000;
    let ScopeLoadStart::Read { load, range, .. } = scope.active_month("2026-11", epoch).unwrap()
    else {
        panic!();
    };
    let initial = source.prepare(&range).unwrap().finish(&ranks).unwrap();
    scope
        .complete(load, Ok(initial.clone()), None, &ranks)
        .unwrap();
    let retained_id = raw["shiftRows"][0]["id"].as_str().unwrap();
    let ScopeLoadStart::Read { load, range, .. } = scope.active_month("2020-06", epoch).unwrap()
    else {
        panic!();
    };
    let query = source.prepare(&range).unwrap();
    assert!(!query.collation_candidates().contains(retained_id));
    let loaded = query.finish(&ranks).unwrap();
    let local = data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "local/range-reconcile")
        .unwrap();
    let write = local["expected"]["frames"]
        .as_array()
        .unwrap()
        .iter()
        .find_map(|frame| frame["writes"].as_array().unwrap().first())
        .unwrap();
    let row = write["physical"]["shiftRows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == write["rawInput"]["id"])
        .unwrap();
    let own = ScopeEntry::from_write_row("SHIFT", Arc::new(row.clone())).unwrap();
    scope.publish_write(own.clone(), &ranks).unwrap();
    let draft = scope
        .prepare_completion(load, Ok(loaded.clone()), None)
        .unwrap();
    assert!(draft.needs_sort());
    assert!(draft.collation_candidates().contains(retained_id));
    assert!(
        draft
            .collation_candidates()
            .contains(own.value()["title"].as_str().unwrap())
    );
    let mut foreign = CalendarLoadedScope::default();
    let ScopeLoadStart::Read { load: other, .. } = foreign.active_month("2026-11", epoch).unwrap()
    else {
        panic!();
    };
    foreign.complete(other, Ok(initial), None, &ranks).unwrap();
    foreign.active_month("2020-06", epoch).unwrap();
    foreign.entries = scope.entries.clone();
    assert_eq!(foreign.sequence, scope.sequence);
    assert!(
        matches!(
            foreign.finish_completion(draft, &ranks),
            Err(ScopeError::StaleDraft)
        ),
        "same numeric generation/current book is not same native policy owner"
    );
    let draft = scope
        .prepare_completion(load, Ok(loaded.clone()), None)
        .unwrap();
    scope.publish_write(own, &ranks).unwrap();
    assert!(
        matches!(
            scope.finish_completion(draft, &ranks),
            Err(ScopeError::StaleDraft)
        ),
        "local write invalidates precomputed membership even without load-generation change"
    );
    let draft = scope.prepare_completion(load, Ok(loaded), None).unwrap();
    scope.finish_completion(draft, &ranks).unwrap();
    assert!(
        scope
            .entries()
            .entries()
            .iter()
            .any(|entry| entry.value()["title"] == row["title"])
    );
}
