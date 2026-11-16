mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::calendar::incoming::{
    SharedDayWindow,
    visible::{PreparedIncomingCalendars, VisibilityContext},
};
use serde_json::{Value, json};
use std::sync::Arc;

#[test]
fn actual_original_runtime_visibility_then_incoming_projection_match() {
    let corpus = value_pool::decode(include_str!("../../reference/incoming-visible-golden.json"));
    assert_eq!(corpus["cases"].as_array().unwrap().len(), 867);
    for case in corpus["cases"].as_array().unwrap() {
        let input = &case["input"];
        let epoch = input["observedEpochMilliseconds"].as_i64().unwrap();
        let context = &input["context"];
        let prepared = PreparedIncomingCalendars::prepare(
            Arc::new(input["calendars"].as_array().unwrap().clone()),
            &VisibilityContext {
                user_id: context["user"]["id"].as_str(),
                status: context["status"].as_str().unwrap(),
                presentation_account_id: context["presentationAccountId"].as_str(),
                observed_epoch_milliseconds: epoch,
            },
        )
        .unwrap_or_else(|error| panic!("{}: {error:?}", case["id"]));
        common::assert_json_eq(
            &serde_json::to_value(prepared.selected_indices()).unwrap(),
            &case["expected"]["selected"],
            case["id"].as_str().unwrap(),
        );
        let window = input
            .get("window")
            .filter(|value| !value.is_null())
            .map(|value| SharedDayWindow {
                start_date: value["startDate"].as_str().unwrap(),
                end_date: value["endDate"].as_str().unwrap(),
            });
        let value = prepared
            .project(input["timeZone"].as_str().unwrap(), epoch, window.as_ref())
            .unwrap();
        common::assert_json_eq(
            &serde_json::to_value(value).unwrap(),
            &case["expected"]["days"],
            case["id"].as_str().unwrap(),
        );
    }
}

fn source(fetched_at: &str) -> Arc<Vec<Value>> {
    Arc::new(vec![json!({
        "accountId":"viewer","visible":true,"calendar":{"id":"foreign","isOwner":false},
        "fetchedAt":fetched_at,"entries":[]
    })])
}
fn context(epoch: i64) -> VisibilityContext<'static> {
    VisibilityContext {
        user_id: Some("viewer"),
        status: "signedIn",
        presentation_account_id: None,
        observed_epoch_milliseconds: epoch,
    }
}
#[test]
fn native_cache_expiry_bounds_both_expiration_and_future_activation() {
    let epoch = 1_792_929_600_000;
    let prepared =
        PreparedIncomingCalendars::prepare(source("2026-10-24T12:00:00.001Z"), &context(epoch))
            .unwrap();
    assert_eq!(prepared.selected_indices(), &[0]);
    assert_eq!(prepared.valid_until_epoch_milliseconds(), Some(epoch + 1));
    assert!(prepared.is_fresh_at(epoch));
    assert!(!prepared.is_fresh_at(epoch + 1));
    assert!(!prepared.is_fresh_at(epoch - 1));
    assert!(prepared.project("Europe/Berlin", epoch + 1, None).is_err());
    let future =
        PreparedIncomingCalendars::prepare(source("2026-10-25T12:05:00.001Z"), &context(epoch))
            .unwrap();
    assert!(future.selected_indices().is_empty());
    assert_eq!(future.valid_until_epoch_milliseconds(), Some(epoch + 1));
    assert!(!future.is_fresh_at(epoch + 1));
    let original_after =
        PreparedIncomingCalendars::prepare(source("2026-10-25T12:05:00.001Z"), &context(epoch + 1))
            .unwrap();
    assert_eq!(original_after.selected_indices(), &[0]);
}

#[test]
fn fifty_thousand_entries_retain_one_immutable_source_without_a_filtered_tree() {
    let mut value = source("2026-10-25T11:00:00Z")[0].clone();
    value["entries"] = json!(vec![
        json!({"startsAt":"2026-10-24T19:00:00Z","endsAt":"2026-10-25T06:00:00Z","allDay":false,"timeZone":"Europe/Berlin"});
        50000
    ]);
    let source = Arc::new(vec![value]);
    let weak = Arc::downgrade(&source);
    let prepared =
        PreparedIncomingCalendars::prepare(source.clone(), &context(1_792_929_600_000)).unwrap();
    assert_eq!(Arc::strong_count(&source), 2);
    let window = SharedDayWindow {
        start_date: "2027-01-01",
        end_date: "2027-02-01",
    };
    let view = prepared
        .project("Europe/Berlin", 1_792_929_600_000, Some(&window))
        .unwrap();
    assert_eq!(serde_json::to_value(&view).unwrap(), json!([]));
    assert_eq!(Arc::strong_count(&source), 3);
    drop(source);
    drop(prepared);
    assert!(weak.upgrade().is_some());
    drop(view);
    assert!(weak.upgrade().is_none());
}
