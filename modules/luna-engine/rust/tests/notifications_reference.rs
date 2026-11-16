mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::calendar::notifications::{NotificationSource, NotificationStep};
use serde_json::{Value, json};

#[test]
fn original_notification_requests_and_persistence_order_are_exact() {
    compare(
        include_str!("../../reference/notifications-golden.json"),
        904,
        11932,
        false,
    );
}
#[test]
fn original_legacy_gap_fold_skipped_day_and_elapsed_offsets_are_exact() {
    compare(
        include_str!("../../reference/notifications-edges-golden.json"),
        82,
        62,
        false,
    );
}
#[test]
fn integral_native_number_tokens_preserve_all_original_notification_results() {
    compare(
        include_str!("../../reference/notifications-golden.json"),
        904,
        11932,
        true,
    );
}
fn compare(fixture: &str, count: usize, requests_count: usize, float_tokens: bool) {
    let mut source = value_pool::decode(fixture);
    if float_tokens {
        for c in source["cases"].as_array_mut().unwrap() {
            let entry = &mut c["input"]["entry"];
            for (field, key) in [("notification", "amount"), ("recurrence", "interval")] {
                if let Some(number) = entry[field][key].as_f64() {
                    entry[field][key] = json!(number);
                }
            }
        }
    }
    let cases = source["cases"].as_array().unwrap();
    assert_eq!(cases.len(), count);
    let mut compared_requests = 0;
    for c in cases {
        let i = &c["input"];
        let source = NotificationSource::from_entry(&i["entry"]).unwrap();
        let mut clock = i["observedEpochMilliseconds"].as_i64().unwrap();
        let mut requests = Vec::new();
        let mut writes = vec![json!([])]; // Original cancellation precedes permission/plan.
        if source.needs_permission() && i["permissionGranted"] == true {
            let mut cursor = source.plan(i["timeZone"].as_str().unwrap(), clock).unwrap();
            let mut schedules = Vec::new();
            loop {
                match cursor.step(clock).unwrap() {
                    NotificationStep::Finished => break,
                    NotificationStep::Skipped => (),
                    NotificationStep::Schedule(candidate) => {
                        let id = format!("notification-{}", schedules.len() + 1);
                        requests.push(json!({
                            "id":id,"clockEpochMilliseconds":clock,
                            "scheduledEpochMilliseconds":candidate.epoch_milliseconds(),
                            "type":"date","content":candidate.content(),
                            "soundIsUndefined":!candidate.is_alarm()
                        }));
                        schedules.push(json!({"occurrenceDate":candidate.occurrence_date(),
                            "notificationId":id}));
                        clock += i["advanceAfterScheduleMilliseconds"].as_i64().unwrap();
                    }
                }
            }
            writes.push(Value::Array(schedules));
        }
        compared_requests += requests.len();
        common::assert_json_eq(
            &json!({"requests":requests,"writes":writes,"error":null}),
            &c["expected"],
            c["id"].as_str().unwrap(),
        );
    }
    assert_eq!(compared_requests, requests_count);
}
