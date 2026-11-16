#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    contract::{ContractError, OwnerIdentity},
    runtime::{
        SnapshotRegistry,
        calendar_loaded::{
            CalendarLoadedPool, LoadedPoolError, LoadedStart, MAX_LOADED_SOURCE_BYTES,
        },
    },
};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
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

fn start() -> (
    CalendarLoadedPool,
    luna_engine::runtime::calendar_loaded::CalendarLoadTicket,
) {
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("loaded-owner", 1).unwrap())
        .unwrap();
    let pool = CalendarLoadedPool::new(registry);
    pool.bind_locale("original-fixture-Intl").unwrap();
    let LoadedStart::Read(ticket) = pool
        .active_month("2026-11", 1_794_744_000_000, "rows-1")
        .unwrap()
    else {
        panic!();
    };
    (pool, ticket)
}
fn rejected(raw: &[u8]) -> LoadedPoolError {
    let (pool, ticket) = start();
    let intake = pool.reserve_source(&ticket).unwrap();
    let error = pool
        .prepare_query_json(intake, raw)
        .err()
        .expect("raw body rejected");
    assert_eq!(
        pool.retained_raw_sources(),
        0,
        "failed raw intake releases its reservation"
    );
    assert!(pool.snapshot().unwrap().source.is_none());
    error
}
#[test]
fn raw_shape_duplicates_trailing_bytes_and_ready_arrays_do_not_become_sources() {
    for raw in [
        b"[]".as_slice(),
        b"{}",
        br#"{"entries":[],"platformCollationRanks":{}}"#,
        br#"{"shiftRows":[],"appointmentRows":[]}"#,
        br#"{"shiftRows":[],"appointmentRows":[],"templateRows":[],"ready":true}"#,
        br#"{"shiftRows":[null],"appointmentRows":[],"templateRows":[]}"#,
        br#"{"shiftRows":[],"appointmentRows":[],"templateRows":{}}"#,
    ] {
        assert!(matches!(
            rejected(raw),
            LoadedPoolError::Input(ContractError::MalformedEnvelope)
        ));
    }
    for raw in [
        br#"{"shiftRows":[],"shiftRows":[],"appointmentRows":[],"templateRows":[]}"#.as_slice(),
        br#"{"shiftRows":[{"id":"first","id":"second"}],"appointmentRows":[],"templateRows":[]}"#,
    ] {
        assert!(matches!(
            rejected(raw),
            LoadedPoolError::Input(ContractError::DuplicateJsonKey)
        ));
    }
    for raw in [
        b"{\"shiftRows\":[],\"appointmentRows\":[],\"templateRows\":[]}\0suffix".as_slice(),
        b"\xff",
    ] {
        assert!(matches!(
            rejected(raw),
            LoadedPoolError::Input(ContractError::InvalidJson)
        ));
    }
}

#[test]
fn original_domain_byte_string_depth_collection_and_node_limits_remain_strict() {
    assert!(matches!(
        rejected(&vec![b'x'; MAX_LOADED_SOURCE_BYTES + 1]),
        LoadedPoolError::Input(ContractError::InputTooLarge)
    ));
    let body=serde_json::to_vec(&json!({"shiftRows":[{"unselected":"x".repeat(300_001)}],"appointmentRows":[],"templateRows":[]})).unwrap();
    assert!(matches!(
        rejected(&body),
        LoadedPoolError::Input(ContractError::StringTooLarge)
    ));
    let deep = format!(
        "{{\"shiftRows\":[],\"appointmentRows\":[],\"templateRows\":{}null{}}}",
        "[".repeat(60),
        "]".repeat(60)
    );
    assert!(matches!(
        rejected(deep.as_bytes()),
        LoadedPoolError::Input(ContractError::JsonTooDeep)
    ));
    let body = format!(
        "{{\"shiftRows\":[{}{{}}],\"appointmentRows\":[],\"templateRows\":[]}}",
        "{},".repeat(100_000)
    );
    assert!(matches!(
        rejected(body.as_bytes()),
        LoadedPoolError::Input(ContractError::CollectionTooLarge)
    ));
    let row = format!("{{\"opaque\":[{}null]}}", "null,".repeat(39));
    let body = format!(
        "{{\"shiftRows\":[{}],\"appointmentRows\":[],\"templateRows\":[]}}",
        std::iter::repeat_n(row.as_str(), 50_000)
            .collect::<Vec<_>>()
            .join(",")
    );
    assert!(body.len() < MAX_LOADED_SOURCE_BYTES);
    assert!(matches!(
        rejected(body.as_bytes()),
        LoadedPoolError::Input(ContractError::TooManyJsonNodes)
    ));
    let body = format!(
        "{{\"shiftRows\":[{}{{}}],\"appointmentRows\":[],\"templateRows\":[]}}",
        "{},".repeat(50_000)
    );
    assert!(matches!(
        rejected(body.as_bytes()),
        LoadedPoolError::Capacity
    ));
}

#[test]
fn stale_native_intakes_are_refused_before_even_invalid_raw_json_is_decoded() {
    let (pool, ticket) = start();
    let intake = pool.reserve_source(&ticket).unwrap();
    pool.source_changed("rows-2").unwrap();
    assert!(matches!(
        pool.prepare_query_json(intake, b"not JSON"),
        Err(LoadedPoolError::Stale)
    ));
    assert_eq!(pool.retained_raw_sources(), 0);
}

#[test]
fn full_snapshot_and_background_are_native_io_intents_without_profile_ready_claims() {
    let data = value_pool::decode(include_str!("../../reference/loaded-scope-golden.json"));
    let (pool, ticket) = start();
    assert!(ticket.full_snapshot());
    assert!(!ticket.background());
    let intake = pool.reserve_source(&ticket).unwrap();
    let body = serde_json::to_vec(&data["cases"][0]["input"]["initial"]).unwrap();
    let query = pool.prepare_query_json(intake, &body).unwrap();
    let ranks = original_ranks(&data, query.candidates());
    pool.finalize_cached(pool.finish_query(query, &ranks).unwrap())
        .unwrap();
    let LoadedStart::Read(ticket) = pool
        .active_month("2038-06", 1_794_744_000_000, "rows-1")
        .unwrap()
    else {
        panic!();
    };
    assert!(!ticket.full_snapshot());
    assert!(!ticket.background());
    pool.abort_load(&ticket).unwrap();
    let LoadedStart::Read(ticket) = pool.reload(true, 1_794_744_000_000, "rows-1").unwrap() else {
        panic!();
    };
    assert!(ticket.full_snapshot());
    assert!(ticket.background());
}

#[test]
fn stored_json_integral_lexemes_keep_original_sql_number_semantics() {
    let data = value_pool::decode(include_str!("../../reference/loaded-scope-golden.json"));
    let case = &data["cases"][0];
    let capture = &case["input"]["captures"][0];
    let original = serde_json::to_string(&capture["rawSource"]).unwrap();
    let body = original
        .replace("\"revision\":1,", "\"revision\":1e0,")
        .replace("\"all_day\":0,", "\"all_day\":-0.0,");
    assert_ne!(body, original);
    let (pool, ticket) = start();
    let intake = pool.reserve_source(&ticket).unwrap();
    let draft = pool.prepare_query_json(intake, body.as_bytes()).unwrap();
    let ranks = original_ranks(&data, draft.candidates());
    let source = pool
        .finalize_cached(pool.finish_query(draft, &ranks).unwrap())
        .unwrap()
        .source
        .unwrap();
    let observed = case["expected"]["frames"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|frame| frame["io"].as_array().unwrap())
        .find(|job| job["id"] == capture["id"] && !job["result"].is_null())
        .unwrap();
    assert_eq!(
        serde_json::to_value(
            source
                .entries()
                .unwrap()
                .entries()
                .iter()
                .map(|entry| entry.as_ref())
                .collect::<Vec<_>>()
        )
        .unwrap(),
        observed["result"]["value"]
    );
}
#[test]
fn original_raw_sql_bodies_are_decoded_once_before_native_query_and_union_admission() {
    let data = value_pool::decode(include_str!("../../reference/loaded-scope-golden.json"));
    let mut ready = 0;
    let mut invalid = 0;
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
                panic!();
            };
            let intake = pool.reserve_source(&ticket).unwrap();
            let body = serde_json::to_vec(&capture["rawSource"]).unwrap();
            let draft = pool.prepare_query_json(intake, &body);
            if observed["result"]["ok"] != true {
                assert!(draft.is_err());
                invalid += 1;
                continue;
            }
            let draft = draft.unwrap();
            let ranks = original_ranks(&data, draft.candidates());
            let completion = pool.finish_query(draft, &ranks).unwrap();
            let source = pool.finalize_cached(completion).unwrap().source.unwrap();
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
    assert_eq!((ready, invalid), (77, 4));
}
