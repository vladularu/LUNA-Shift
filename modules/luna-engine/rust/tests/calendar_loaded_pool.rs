#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    calendar::loaded_scope::RawScopeRows,
    contract::OwnerIdentity,
    runtime::{
        SnapshotRegistry,
        calendar_loaded::{
            CalendarLoadTicket, CalendarLoadedPool, LoadedPoolError, LoadedQueryDraft,
            LoadedReadSource, LoadedStart,
        },
    },
};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

fn original_ranks(data: &Value, strings: &[String]) -> Vec<u8> {
    let ranks = data["collationRanks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|pair| (pair[0].as_str().unwrap(), pair[1].as_u64().unwrap()))
        .collect::<BTreeMap<_, _>>();
    let distinct = strings
        .iter()
        .map(|text| ranks[text.as_str()])
        .collect::<BTreeSet<_>>();
    let dense = distinct
        .into_iter()
        .enumerate()
        .map(|(rank, original)| (original, rank as u32))
        .collect::<BTreeMap<_, _>>();
    serde_json::to_vec(
        &strings
            .iter()
            .map(|text| (text.as_str(), dense[&ranks[text.as_str()]]))
            .collect::<BTreeMap<_, _>>(),
    )
    .unwrap()
}

fn fixture() -> Value {
    value_pool::decode(include_str!("../../reference/loaded-scope-golden.json"))
}
fn registry() -> SnapshotRegistry {
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("loaded-owner", 1).unwrap())
        .unwrap();
    registry
}
fn pool(registry: SnapshotRegistry) -> CalendarLoadedPool {
    let pool = CalendarLoadedPool::new(registry);
    pool.bind_locale("original-fixture-Intl").unwrap();
    pool
}
fn first(pool: &CalendarLoadedPool, token: &str) -> CalendarLoadTicket {
    let LoadedStart::Read(ticket) = pool
        .active_month("2026-11", 1_794_744_000_000, token)
        .unwrap()
    else {
        panic!("initial read");
    };
    ticket
}
fn raw(data: &Value) -> Arc<RawScopeRows> {
    let raw = &data["cases"][0]["input"]["initial"];
    RawScopeRows::new(
        Arc::from(raw["shiftRows"].as_array().unwrap().clone()),
        Arc::from(raw["appointmentRows"].as_array().unwrap().clone()),
        Arc::from(raw["templateRows"].as_array().unwrap().clone()),
    )
    .unwrap()
}
fn prepare(
    pool: &CalendarLoadedPool,
    ticket: &CalendarLoadTicket,
    data: &Value,
) -> LoadedQueryDraft {
    let intake = pool.reserve_source(ticket).unwrap();
    pool.prepare_query(intake, raw(data)).unwrap()
}
fn publish(pool: &CalendarLoadedPool, draft: LoadedQueryDraft, data: &Value) -> LoadedReadSource {
    let ranks = original_ranks(data, draft.candidates());
    let draft = pool.finish_query(draft, &ranks).unwrap();
    if draft.has_verified_ranks() {
        pool.finalize_cached(draft).unwrap().source.unwrap()
    } else {
        let ranks = original_ranks(data, draft.candidates());
        pool.finalize(draft, &ranks).unwrap().source.unwrap()
    }
}

#[test]
fn owner_core_source_locale_and_consumed_io_tickets_are_fenced_independently() {
    let data = fixture();
    let registry = registry();
    let pool = pool(registry.clone());
    let ticket = first(&pool, "rows-1");
    let other = CalendarLoadedPool::new(registry.clone());
    other.bind_locale("original-fixture-Intl").unwrap();
    first(&other, "rows-1");
    assert!(matches!(
        other.reserve_source(&ticket),
        Err(LoadedPoolError::ScopeMismatch)
    ));
    let draft = prepare(&pool, &ticket, &data);
    assert!(matches!(
        pool.reserve_source(&ticket),
        Err(LoadedPoolError::Replay)
    ));
    pool.source_changed("rows-2").unwrap();
    let ranks = original_ranks(&data, draft.candidates());
    assert!(matches!(
        pool.finish_query(draft, &ranks),
        Err(LoadedPoolError::Stale)
    ));
    assert!(pool.snapshot().unwrap().source.is_none());
    let LoadedStart::Read(ticket) = pool.reload(false, 1_794_744_000_000, "rows-2").unwrap() else {
        panic!();
    };
    let draft = prepare(&pool, &ticket, &data);
    pool.bind_locale("different-platform-probe").unwrap();
    let ranks = original_ranks(&data, draft.candidates());
    assert!(matches!(
        pool.finish_query(draft, &ranks),
        Err(LoadedPoolError::Stale)
    ));
    pool.bind_locale("original-fixture-Intl").unwrap();
    let LoadedStart::Read(ticket) = pool.reload(false, 1_794_744_000_000, "rows-2").unwrap() else {
        panic!();
    };
    let draft = prepare(&pool, &ticket, &data);
    registry
        .reset_for_owner(&OwnerIdentity::new("loaded-owner", 1).unwrap())
        .unwrap();
    let ranks = original_ranks(&data, draft.candidates());
    assert!(matches!(
        pool.finish_query(draft, &ranks),
        Err(LoadedPoolError::ScopeMismatch | LoadedPoolError::OwnerChanged)
    ));
}

#[test]
fn captured_submission_keeps_original_entries_across_scope_and_source_changes() {
    let data = fixture();
    let registry = registry();
    let pool = pool(registry.clone());
    let report = registry.preparation_marker().unwrap();
    let source = publish(&pool, prepare(&pool, &first(&pool, "rows-1"), &data), &data);
    let captured = source.pin_submission(7).unwrap();
    let old = captured.entries_for_write(7).unwrap().entries()[0].clone();
    assert!(source.shares_owner(&registry.utility_owner_marker().unwrap()));
    assert!(
        report.is_current().unwrap(),
        "loaded reads never replace report preparation"
    );
    pool.active_month("2038-06", 1_794_744_000_000, "rows-1")
        .unwrap();
    assert!(!source.is_current().unwrap());
    assert!(Arc::ptr_eq(
        &old,
        &captured.entries_for_write(7).unwrap().entries()[0]
    ));
    pool.source_changed("own-first-template-commit").unwrap();
    assert!(
        captured.is_current_for_write(7).unwrap(),
        "a live scope rebase must not replace captured entries"
    );
    assert!(!captured.is_current_for_write(8).unwrap());
    captured.retire();
    assert!(!captured.is_current_for_write(7).unwrap());
    let source = publish(
        &pool,
        prepare(
            &pool,
            &{
                let LoadedStart::Read(ticket) =
                    pool.reload(false, 1_794_744_000_000, "rows-next").unwrap()
                else {
                    panic!();
                };
                ticket
            },
            &data,
        ),
        &data,
    );
    let captured = source.pin_submission(9).unwrap();
    registry
        .reset_for_owner(&OwnerIdentity::new("loaded-owner", 1).unwrap())
        .unwrap();
    assert!(!source.is_current().unwrap());
    assert!(!captured.is_current_for_write(9).unwrap());
}

#[test]
fn complete_membership_numeric_duplicates_and_phase_digests_are_native() {
    let data = fixture();
    let pool = pool(registry());
    let draft = prepare(&pool, &first(&pool, "rows-1"), &data);
    assert!(!draft.candidates().is_empty());
    let query_digest = draft.candidate_digest().to_owned();
    assert!(matches!(
        pool.finish_query(draft, b"{}"),
        Err(LoadedPoolError::InvalidRanks)
    ));
    let LoadedStart::Read(ticket) = pool.reload(false, 1_794_744_000_000, "rows-1").unwrap() else {
        panic!();
    };
    let draft = prepare(&pool, &ticket, &data);
    let ranks = original_ranks(&data, draft.candidates());
    let draft = pool.finish_query(draft, &ranks).unwrap();
    assert_ne!(draft.candidate_digest(), query_digest);
    assert_eq!(draft.locale_key(), "original-fixture-Intl");
    let mut map: Value =
        serde_json::from_slice(&original_ranks(&data, draft.candidates())).unwrap();
    let key = draft.candidates()[0].clone();
    map[&key] = json!(0.5);
    assert!(matches!(
        pool.finalize(draft, &serde_json::to_vec(&map).unwrap()),
        Err(LoadedPoolError::InvalidRanks)
    ));
    let LoadedStart::Read(ticket) = pool.reload(false, 1_794_744_000_000, "rows-1").unwrap() else {
        panic!();
    };
    let draft = prepare(&pool, &ticket, &data);
    let mut ranks = original_ranks(&data, draft.candidates());
    ranks.pop();
    ranks.extend_from_slice(
        format!(
            ",{}:0}}",
            serde_json::to_string(&draft.candidates()[0]).unwrap()
        )
        .as_bytes(),
    );
    assert!(matches!(
        pool.finish_query(draft, &ranks),
        Err(LoadedPoolError::InvalidRanks)
    ));
}

#[test]
fn raw_reservations_and_retained_owners_are_bounded_and_released_on_worker_collection() {
    let data = fixture();
    let pool = pool(registry());
    let mut sources = Vec::new();
    let mut raws = Vec::new();
    for index in 0..4 {
        let token = format!("rows-{index}");
        let ticket = if index == 0 {
            first(&pool, &token)
        } else {
            let LoadedStart::Read(ticket) = pool.reload(false, 1_794_744_000_000, &token).unwrap()
            else {
                panic!();
            };
            ticket
        };
        let intake = pool.reserve_source(&ticket).unwrap();
        assert!(matches!(
            pool.reserve_source(&ticket),
            Err(LoadedPoolError::Busy)
        ));
        let owner = raw(&data);
        let draft = pool.prepare_query(intake, owner.clone()).unwrap();
        raws.push(owner);
        sources.push(publish(&pool, draft, &data));
    }
    assert_eq!(pool.retained_raw_sources(), 4);
    assert!(pool.reserved_source_wire_bytes() <= 64 * 1024 * 1024);
    let LoadedStart::Read(ticket) = pool.reload(false, 1_794_744_000_000, "rows-4").unwrap() else {
        panic!();
    };
    assert!(matches!(
        pool.reserve_source(&ticket),
        Err(LoadedPoolError::Capacity)
    ));
    drop(sources);
    drop(raws);
    pool.collect_retired().unwrap();
    assert_eq!(
        pool.retained_raw_sources(),
        1,
        "only current policy entries retain their physical source"
    );
    let intake = pool.reserve_source(&ticket).unwrap();
    drop(intake);
    assert_eq!(pool.retained_raw_sources(), 1);
}

#[test]
fn source_failures_keep_original_status_without_minting_an_empty_ready_source() {
    use luna_engine::calendar::loaded_scope::ScopeLoadFailure;
    let pool = pool(registry());
    let ticket = first(&pool, "rows-1");
    let draft = pool
        .prepare_failure(&ticket, ScopeLoadFailure::Calendar)
        .unwrap();
    assert!(draft.candidates().is_empty());
    let result = pool.finalize(draft, b"{}").unwrap();
    assert!(result.is_current().unwrap());
    assert!(result.status.ready);
    assert!(
        result
            .status
            .error
            .unwrap()
            .contains("LOAD_CALENDAR_FAILED")
    );
    assert!(result.source.is_none());
}

#[test]
fn final_reconcile_union_includes_retained_entries_and_never_merges_query_rank_maps() {
    let data = fixture();
    let pool = pool(registry());
    let source = publish(&pool, prepare(&pool, &first(&pool, "rows-1"), &data), &data);
    let retained = source
        .entries()
        .unwrap()
        .entries()
        .iter()
        .find(|row| row.get("kind").and_then(Value::as_str) == Some("SHIFT"))
        .unwrap()
        .get("id")
        .unwrap()
        .as_str()
        .unwrap()
        .to_owned();
    let LoadedStart::Read(ticket) = pool
        .active_month("2020-06", 1_794_744_000_000, "rows-1")
        .unwrap()
    else {
        panic!();
    };
    let query = prepare(&pool, &ticket, &data);
    assert!(!query.candidates().contains(&retained));
    let query_values = query.candidates().to_vec();
    let ranks = original_ranks(&data, &query_values);
    let completion = pool.finish_query(query, &ranks).unwrap();
    assert!(!completion.has_verified_ranks());
    assert!(completion.candidates().contains(&retained));
    assert!(completion.candidates().len() > query_values.len());
    assert!(
        matches!(
            pool.finalize(completion, &ranks),
            Err(LoadedPoolError::InvalidRanks)
        ),
        "query ranks are not a final-union proof"
    );
    assert!(pool.abort_load(&ticket).unwrap());
    assert!(!pool.abort_load(&ticket).unwrap());
}

#[test]
fn abandoned_io_generations_do_not_retain_old_raw_baselines_after_replacement() {
    let data = fixture();
    let pool = pool(registry());
    let ticket = first(&pool, "rows-1");
    let intake = pool.reserve_source(&ticket).unwrap();
    let old = raw(&data);
    let weak = Arc::downgrade(&old);
    let draft = pool.prepare_query(intake, old).unwrap();
    let source = publish(&pool, draft, &data);
    drop(source);
    let mut latest = None;
    for _ in 0..32 {
        let LoadedStart::Read(ticket) = pool.reload(false, 1_794_744_000_000, "rows-1").unwrap()
        else {
            panic!();
        };
        latest = Some(ticket);
    }
    assert!(
        weak.upgrade().is_some(),
        "current known entries remain while loading"
    );
    let source = publish(&pool, prepare(&pool, &latest.unwrap(), &data), &data);
    assert!(source.is_current().unwrap());
    assert!(
        weak.upgrade().is_none(),
        "obsolete pending baselines must be discarded on their preparation worker"
    );
    pool.collect_retired().unwrap();
    assert_eq!(pool.retained_raw_sources(), 1);
}

#[test]
fn exact_native_rank_reuse_skips_a_second_map_without_bypassing_source_fences() {
    let data = fixture();
    let pool = pool(registry());
    let ticket = first(&pool, "rows-1");
    let query = prepare(&pool, &ticket, &data);
    let ranks = original_ranks(&data, query.candidates());
    let completion = pool.finish_query(query, &ranks).unwrap();
    assert!(completion.has_verified_ranks());
    let source = pool.finalize_cached(completion).unwrap().source.unwrap();
    assert!(source.is_current().unwrap());
    let LoadedStart::Read(ticket) = pool.reload(false, 1_794_744_000_000, "rows-1").unwrap() else {
        panic!();
    };
    let query = prepare(&pool, &ticket, &data);
    let ranks = original_ranks(&data, query.candidates());
    let completion = pool.finish_query(query, &ranks).unwrap();
    assert!(completion.has_verified_ranks());
    pool.source_changed("rows-2").unwrap();
    assert!(matches!(
        pool.finalize_cached(completion),
        Err(LoadedPoolError::Stale)
    ));
}

#[test]
fn fifty_thousand_physical_rows_and_their_quota_live_through_borrowed_windows_only_once() {
    use luna_engine::calendar::window::{CalendarSourceIndex, WindowOptions, WindowSpec};
    let data = fixture();
    let pool = pool(registry());
    let ticket = first(&pool, "rows-1");
    let intake = pool.reserve_source(&ticket).unwrap();
    let raw = &data["cases"][0]["input"]["initial"];
    let mut appointment = raw["appointmentRows"][0].clone();
    appointment["date"] = json!("1900-01-01");
    appointment["title"] = json!("a");
    appointment["created_at"] = json!("i");
    appointment["updated_at"] = json!("i");
    appointment["recurrence_frequency"] = Value::Null;
    appointment["recurrence_interval"] = Value::Null;
    let appointments = (0..49_999)
        .map(|i| {
            let mut row = appointment.clone();
            row["id"] = json!(format!("a{i}"));
            row
        })
        .collect::<Vec<_>>();
    let owner = RawScopeRows::new(
        Arc::from([raw["shiftRows"][0].clone()]),
        Arc::from(appointments),
        Arc::from([]),
    )
    .unwrap();
    let weak = Arc::downgrade(&owner);
    let draft = pool.prepare_query(intake, owner).unwrap();
    let ranks = serde_json::to_vec(
        &draft
            .candidates()
            .iter()
            .enumerate()
            .map(|(rank, key)| (key, rank as u32))
            .collect::<BTreeMap<_, _>>(),
    )
    .unwrap();
    let draft = pool.finish_query(draft, &ranks).unwrap();
    let ranks = serde_json::to_vec(
        &draft
            .candidates()
            .iter()
            .enumerate()
            .map(|(rank, key)| (key, rank as u32))
            .collect::<BTreeMap<_, _>>(),
    )
    .unwrap();
    let source = pool.finalize(draft, &ranks).unwrap().source.unwrap();
    assert_eq!(source.entries().unwrap().entries().len(), 1);
    assert_eq!(pool.retained_raw_sources(), 1);
    let date = source.entries().unwrap().entries()[0]
        .get("date")
        .unwrap()
        .as_str()
        .unwrap()
        .to_owned();
    let base = source.entries().unwrap().entries()[0].base_value() as *const Value;
    let index = CalendarSourceIndex::from_entry_source(source.clone()).unwrap();
    let prepared = index.prepare(&WindowSpec::Day { date }).unwrap();
    let ranks = luna_engine::calendar::recurrence::CollationRanks::from(
        prepared
            .candidates()
            .iter()
            .enumerate()
            .map(|(rank, key)| (key.clone(), rank as u32))
            .collect::<BTreeMap<_, _>>(),
    );
    let window = prepared
        .finalize(&ranks)
        .unwrap()
        .index(WindowOptions {
            show_shifts: true,
            show_appointments: true,
        })
        .unwrap();
    assert_eq!(
        base,
        window.window().entry(0).unwrap().original() as *const Value
    );
    drop(source);
    drop(index);
    drop(pool);
    assert!(weak.upgrade().is_some());
    assert!(
        !window.window().entry_source().is_current().unwrap(),
        "disposed native pool cannot publish its retained display tree"
    );
    drop(window);
    assert!(weak.upgrade().is_none());
}
#[test]
fn original_raw_query_selections_pass_independent_query_and_final_union_admissions() {
    let data = value_pool::decode(include_str!("../../reference/loaded-scope-golden.json"));
    let mut ready = 0;
    for case in data["cases"].as_array().unwrap() {
        for capture in case["input"]["captures"].as_array().unwrap() {
            if capture["queries"].as_array().unwrap().is_empty() {
                continue;
            }
            let observed = case["expected"]["frames"]
                .as_array()
                .unwrap()
                .iter()
                .flat_map(|frame| frame["io"].as_array().unwrap())
                .find(|job| job["id"] == capture["id"] && !job["result"].is_null())
                .unwrap();
            if observed["result"]["ok"] != true {
                continue;
            }
            let registry = SnapshotRegistry::default();
            registry
                .reset_for_owner(&OwnerIdentity::new("loaded-owner", 1).unwrap())
                .unwrap();
            let pool = CalendarLoadedPool::new(registry);
            pool.bind_locale("original-fixture-Intl").unwrap();
            let year = capture["range"]["startDate"].as_str().unwrap()[..4]
                .parse::<i32>()
                .unwrap()
                + 1;
            let LoadedStart::Read(ticket) = pool
                .active_month(
                    &format!("{year:04}-01"),
                    1_794_744_000_000,
                    "calendar-rows-1",
                )
                .unwrap()
            else {
                panic!("initial native read");
            };
            assert_eq!(ticket.range().start_date, capture["range"]["startDate"]);
            assert_eq!(ticket.range().end_date, capture["range"]["endDate"]);
            // Reservation precedes physical source creation/decoding.
            let intake = pool.reserve_source(&ticket).unwrap();
            let raw = &capture["rawSource"];
            let raw = RawScopeRows::new(
                Arc::from(raw["shiftRows"].as_array().unwrap().clone()),
                Arc::from(raw["appointmentRows"].as_array().unwrap().clone()),
                Arc::from(raw["templateRows"].as_array().unwrap().clone()),
            )
            .unwrap();
            let draft = pool.prepare_query(intake, raw).unwrap();
            let ranks = original_ranks(&data, draft.candidates());
            let draft = pool.finish_query(draft, &ranks).unwrap();
            let ranks = original_ranks(&data, draft.candidates());
            let result = pool.finalize(draft, &ranks).unwrap();
            assert!(result.status.ready);
            let source = result.source.unwrap();
            let actual = serde_json::to_value(
                source
                    .entries()
                    .unwrap()
                    .entries()
                    .iter()
                    .map(|entry| entry.as_ref())
                    .collect::<Vec<_>>(),
            )
            .unwrap();
            assert_eq!(
                actual, observed["result"]["value"],
                "{} query {}",
                case["id"], capture["id"]
            );
            ready += 1;
        }
    }
    assert_eq!(ready, 77);
}
