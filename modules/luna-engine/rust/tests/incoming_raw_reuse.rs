#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    calendar::incoming::{
        cache::RetainedIncomingCache, raw_rows::RawIncomingCacheRows,
        raw_source::IncomingSourceError, visible::VisibilityContext,
    },
    contract::ContractError,
};
use serde_json::{Value, json};

fn context() -> VisibilityContext<'static> {
    VisibilityContext {
        user_id: Some("viewer"),
        status: "signedIn",
        presentation_account_id: None,
        observed_epoch_milliseconds: 1_792_929_600_000,
    }
}
#[test]
fn unchanged_large_original_sql_json_reuses_native_field_without_join_or_parse() {
    let source = value_pool::decode(include_str!("../../reference/incoming-rows-golden.json"));
    let case = source["cases"].as_array().unwrap().last().unwrap();
    assert_eq!(case["id"], "large-original-json-chunks");
    let mut rows = case["input"]["rows"].clone();
    let mut cache = RetainedIncomingCache::new();
    let (first, stats) = cache
        .observe_sql("viewer", &serde_json::to_vec(&rows).unwrap(), &context())
        .unwrap();
    assert_eq!(stats.metadata_parses, 1);
    assert_eq!(stats.entries_parses, 1);
    assert_eq!(
        first
            .compatibility_value("Europe/Berlin", context().observed_epoch_milliseconds, None)
            .unwrap()["caches"],
        case["expected"]
    );
    rows[0]["fetched_at"] = Value::String("2026-10-25T12:00:01.000Z".into());
    let (next, stats) = cache
        .observe_sql("viewer", &serde_json::to_vec(&rows).unwrap(), &context())
        .unwrap();
    assert_eq!(stats.metadata_parses, 0);
    assert_eq!(stats.entries_parses, 0);
    assert_eq!(stats.joined_json_fields, 0);
    assert_eq!(stats.field_reuses, 2);
    let value = next
        .compatibility_value("Europe/Berlin", context().observed_epoch_milliseconds, None)
        .unwrap();
    assert_eq!(value["displaySame"], true);
    assert_eq!(value["display"][0]["fetchedAt"], "2026-10-25T12:00:00.000Z");
    assert_eq!(value["caches"][0]["fetchedAt"], "2026-10-25T12:00:01.000Z");
}

fn row(entries: &str) -> Value {
    json!({"account_id":"viewer","calendar_id":"sql-id","metadata_json":"{\"id\":\"calendar\",\"isOwner\":false}","entries_json":entries,"fetched_at":"2026-10-25T12:00:00Z","visible":1,"local_color":null})
}
fn bytes(rows: &[Value]) -> Vec<u8> {
    serde_json::to_vec(rows).unwrap()
}

#[test]
fn all_original_sql_outputs_use_the_same_retention_and_projection_as_the_mapped_path() {
    let source = value_pool::decode(include_str!("../../reference/incoming-rows-golden.json"));
    let mut compared = 0;
    for case in source["cases"].as_array().unwrap() {
        let account = case["input"]["accountId"].as_str().unwrap();
        let raw = serde_json::to_vec(&case["input"]["rows"]).unwrap();
        let mapped = RawIncomingCacheRows::parse(account, &raw).unwrap();
        let mut plain = RetainedIncomingCache::new();
        let expected = plain.observe(mapped.calendars().as_ref().clone(), &context());
        let mut direct = RetainedIncomingCache::new();
        for _ in 0..2 {
            let actual = direct.observe_sql(account, &raw, &context());
            match (&expected, actual) {
                (Ok(expected), Ok((actual, _))) => {
                    // The second observation's identity diagnostics naturally
                    // differ. All mapped values and projected days must match.
                    let expected = expected
                        .compatibility_value(
                            "Europe/Berlin",
                            context().observed_epoch_milliseconds,
                            None,
                        )
                        .unwrap();
                    let actual = actual
                        .compatibility_value(
                            "Europe/Berlin",
                            context().observed_epoch_milliseconds,
                            None,
                        )
                        .unwrap();
                    for key in ["caches", "display", "days"] {
                        assert_eq!(actual[key], expected[key], "{}:{key}", case["id"]);
                    }
                }
                (Err(expected), Err(IncomingSourceError::Projection(actual))) => assert_eq!(
                    format!("{expected:?}"),
                    format!("{actual:?}"),
                    "{}",
                    case["id"]
                ),
                _ => panic!("{}: raw/mapped path differ", case["id"]),
            }
        }
        compared += 1;
    }
    assert_eq!(compared, 129);
}

#[test]
fn native_proofs_are_field_specific_chunk_boundary_independent_and_cleared_by_plain_inputs() {
    let initial = row("[]");
    let mut state = RetainedIncomingCache::new();
    state
        .observe_sql("viewer", &bytes(std::slice::from_ref(&initial)), &context())
        .unwrap();
    let mut chunked = initial.clone();
    chunked.as_object_mut().unwrap().remove("entries_json");
    chunked["entries_json_chunks"] = json!(["[", "]"]);
    let (_, stats) = state
        .observe_sql("viewer", &bytes(std::slice::from_ref(&chunked)), &context())
        .unwrap();
    assert_eq!(
        (
            stats.field_reuses,
            stats.entries_parses,
            stats.joined_json_fields
        ),
        (2, 0, 0)
    );
    chunked["metadata_json"] =
        json!("{\"id\":\"calendar\",\"isOwner\":false,\"name\":\"changed\"}");
    let (_, stats) = state
        .observe_sql("viewer", &bytes(std::slice::from_ref(&chunked)), &context())
        .unwrap();
    assert_eq!(
        (
            stats.metadata_parses,
            stats.entries_parses,
            stats.field_reuses
        ),
        (1, 0, 1)
    );
    chunked["entries_json_chunks"] = json!(["[", "null", "]"]);
    let (_, stats) = state
        .observe_sql("viewer", &bytes(std::slice::from_ref(&chunked)), &context())
        .unwrap();
    assert_eq!(
        (
            stats.metadata_parses,
            stats.entries_parses,
            stats.field_reuses,
            stats.joined_json_fields
        ),
        (0, 1, 1, 1)
    );
    let mapped =
        RawIncomingCacheRows::parse("viewer", &bytes(std::slice::from_ref(&chunked))).unwrap();
    state
        .observe(mapped.calendars().as_ref().clone(), &context())
        .unwrap();
    let (_, stats) = state
        .observe_sql("viewer", &bytes(&[chunked]), &context())
        .unwrap();
    assert_eq!(
        (
            stats.metadata_parses,
            stats.entries_parses,
            stats.field_reuses
        ),
        (1, 1, 0)
    );
}

#[test]
fn invalid_refreshes_do_not_mutate_native_proofs_or_last_valid_display() {
    let initial = row("[]");
    let mut state = RetainedIncomingCache::new();
    state
        .observe_sql("viewer", &bytes(std::slice::from_ref(&initial)), &context())
        .unwrap();
    for bad in [
        row("[] trailing"),
        row("{\"x\":0,\"x\":1}"),
        row("["),
        {
            let mut bad = initial.clone();
            bad["account_id"] = json!("other");
            bad
        },
        {
            let mut bad = initial.clone();
            bad["entries_json_chunks"] = json!(["[]"]);
            bad
        },
        {
            let mut bad = initial.clone();
            bad["metadata_json"] = json!("null");
            bad
        },
    ] {
        assert!(
            state
                .observe_sql("viewer", &bytes(&[bad]), &context())
                .is_err()
        );
        let (observed, stats) = state
            .observe_sql("viewer", &bytes(std::slice::from_ref(&initial)), &context())
            .unwrap();
        assert_eq!(stats.field_reuses, 2);
        let value = observed
            .compatibility_value("Europe/Berlin", context().observed_epoch_milliseconds, None)
            .unwrap();
        assert_eq!(value["displaySame"], true);
        assert_eq!(value["caches"][0]["calendar"]["id"], "calendar");
    }
}

#[test]
fn reused_decoded_nodes_still_count_against_the_complete_source_budget() {
    let leaf = format!("[{}]", vec!["false"; 500].join(","));
    let text = format!("[{}]", vec![leaf; 2000].join(","));
    let mut large = row("[]");
    large.as_object_mut().unwrap().remove("entries_json");
    large["entries_json_chunks"] = json!(
        text.as_bytes()
            .chunks(65536)
            .map(|chunk| std::str::from_utf8(chunk).unwrap())
            .collect::<Vec<_>>()
    );
    let mut state = RetainedIncomingCache::new();
    state
        .observe_sql("viewer", &bytes(std::slice::from_ref(&large)), &context())
        .unwrap();
    // Both rows would hit the same checked native field owner. Its million
    // decoded nodes must nevertheless be charged for each source occurrence.
    assert!(matches!(
        state.observe_sql(
            "viewer",
            &bytes(&[large.clone(), large.clone()]),
            &context()
        ),
        Err(IncomingSourceError::Input(ContractError::TooManyJsonNodes))
    ));
    let (_, stats) = state
        .observe_sql("viewer", &bytes(&[large]), &context())
        .unwrap();
    assert_eq!(stats.field_reuses, 2);
}
