mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::calendar::incoming::{self, SharedDayWindow};
use serde_json::Value;
use std::sync::Arc;
#[test]
fn complete_original_incoming_calendar_days_match() {
    let corpus = value_pool::decode(include_str!(
        "../../reference/incoming-calendar-golden.json"
    ));
    assert_eq!(
        corpus["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let cases = corpus["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 2186);
    for case in cases {
        let input = &case["input"];
        let window = input
            .get("window")
            .filter(|v| !v.is_null())
            .map(|v| SharedDayWindow {
                start_date: v["startDate"].as_str().unwrap(),
                end_date: v["endDate"].as_str().unwrap(),
            });
        let result = incoming::shared_calendar_days(
            Arc::new(input["calendars"].as_array().unwrap().clone()),
            input["timeZone"].as_str().unwrap(),
            input["now"].as_f64(),
            window.as_ref(),
        );
        let actual =
            serde_json::to_value(result.unwrap_or_else(|error| panic!("{}:{error:?}", case["id"])))
                .unwrap();
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
        let timeline = incoming::timeline_source::IncomingTimelineSource::from_raw(Arc::new(
            input["calendars"].as_array().unwrap().clone(),
        ))
        .unwrap();
        let key = timeline.eligible_key(input["now"].as_f64()).unwrap();
        assert!(key.windows(2).all(|pair| pair[0] < pair[1]));
        let actual = serde_json::to_value(
            timeline
                .project(
                    input["timeZone"].as_str().unwrap(),
                    input["now"].as_f64(),
                    window.as_ref(),
                )
                .unwrap(),
        )
        .unwrap();
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
#[test]
fn source_is_shared_and_invalid_headers_are_not_ready() {
    let empty: Arc<Vec<Value>> = Arc::new(Vec::new());
    assert_eq!(
        serde_json::to_value(incoming::shared_calendar_days(empty, "Factory", None, None).unwrap())
            .unwrap(),
        serde_json::json!([])
    );
    let source = Arc::new(vec![
        serde_json::json!({"visible":true,"calendar":{"id":"foreign","name":"Name","color":"#123456","isOwner":false},
        "fetchedAt":"original-metadata","entries":[{"startsAt":"2026-10-24T19:00:00Z","endsAt":"2026-10-25T06:30:00Z","timeZone":"Europe/Berlin","allDay":false,"originalExtra":{"unchanged":[1,2,3]}}]}),
    ]);
    let weak = Arc::downgrade(&source);
    let view = incoming::shared_calendar_days(source.clone(), "Europe/Berlin", None, None).unwrap();
    assert_eq!(
        Arc::strong_count(&source),
        2,
        "one source owner, not a second entry tree"
    );
    drop(source);
    let value = serde_json::to_value(&view).unwrap();
    assert_eq!(
        value[0][1][0]["entry"]["originalExtra"]["unchanged"],
        serde_json::json!([1, 2, 3])
    );
    assert!(weak.upgrade().is_some());
    drop(view);
    assert!(weak.upgrade().is_none());
    let invalid = Arc::new(vec![
        serde_json::json!({"visible":true,"calendar":null,"entries":[]}),
    ]);
    assert!(incoming::shared_calendar_days(invalid, "Europe/Berlin", None, None).is_err());
    assert!(
        incoming::shared_calendar_days(
            Arc::new(vec![Value::Null; 10001]),
            "Europe/Berlin",
            None,
            None
        )
        .is_err()
    );
}
#[test]
fn fifty_thousand_old_rows_share_one_owner_and_project_no_window_rows() {
    let entry = serde_json::json!({"startsAt":"2026-10-24T19:00:00Z","endsAt":"2026-10-25T06:30:00Z","timeZone":"Europe/Berlin","allDay":false});
    let source = Arc::new(vec![
        serde_json::json!({"visible":true,"calendar":{"id":"foreign","isOwner":false},"entries":vec![entry;50000]}),
    ]);
    let weak = Arc::downgrade(&source);
    let window = SharedDayWindow {
        start_date: "2027-01-01",
        end_date: "2027-02-01",
    };
    let view = incoming::shared_calendar_days(source.clone(), "Europe/Berlin", None, Some(&window))
        .unwrap();
    assert_eq!(Arc::strong_count(&source), 2);
    assert_eq!(serde_json::to_value(&view).unwrap(), serde_json::json!([]));
    drop(source);
    assert!(weak.upgrade().is_some());
    drop(view);
    assert!(weak.upgrade().is_none());
}

#[test]
fn widget_timeline_visibility_key_changes_on_future_fetched_time_and_expiry() {
    use incoming::timeline_source::IncomingTimelineSource;
    let row = |fetched: &str| serde_json::json!({"visible":true,"calendar":{"id":"foreign","isOwner":false},"fetchedAt":fetched,"entries":[]});
    let source = Arc::new(vec![
        row("2026-11-10T10:00:00Z"),
        row("2026-11-11T10:00:00Z"),
    ]);
    let at = |value: &str| value.parse::<jiff::Timestamp>().unwrap().as_millisecond() as f64;
    let prepared = IncomingTimelineSource::from_raw(source.clone()).unwrap();
    assert_eq!(
        prepared
            .eligible_key(Some(at("2026-11-10T10:00:00Z")))
            .unwrap(),
        vec![0]
    );
    assert_eq!(
        prepared
            .eligible_key(Some(at("2026-11-11T09:59:59.999Z")))
            .unwrap(),
        vec![0]
    );
    assert_eq!(
        prepared
            .eligible_key(Some(at("2026-11-11T10:00:00Z")))
            .unwrap(),
        vec![1]
    );
    assert_eq!(
        prepared.eligible_key(Some(f64::NAN)).unwrap(),
        Vec::<usize>::new()
    );
    assert_eq!(Arc::strong_count(&source), 2);
}
