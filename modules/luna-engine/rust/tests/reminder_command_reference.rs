mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::calendar::notifications::command::ReminderCommand;
use serde_json::{Value, json};
#[test]
fn actual_reminder_utility_commands_keep_all_original_notification_requests() {
    let mut compared = 0;
    for fixture in [
        include_str!("../../reference/notifications-golden.json"),
        include_str!("../../reference/notifications-edges-golden.json"),
    ] {
        let source = value_pool::decode(fixture);
        for c in source["cases"].as_array().unwrap() {
            let i = &c["input"];
            let intent = ReminderCommand::Describe {
                entry: i["entry"].clone(),
            }
            .execute()
            .unwrap();
            let mut requests = Vec::new();
            let mut writes = vec![json!([])];
            let mut schedules = Vec::new();
            let opening = i["observedEpochMilliseconds"].as_i64().unwrap();
            let mut now = opening;
            let mut position = 0;
            if intent["needsPermission"] == true && i["permissionGranted"] == true {
                loop {
                    let result = ReminderCommand::Step {
                        entry: i["entry"].clone(),
                        time_zone: i["timeZone"].as_str().unwrap().into(),
                        opening_epoch_milliseconds: opening,
                        position,
                        observed_epoch_milliseconds: now,
                    }
                    .execute()
                    .unwrap();
                    if result["state"] == "FINISHED" {
                        break;
                    }
                    position = result["nextPosition"].as_u64().unwrap() as u32;
                    if result["state"] == "SKIPPED" {
                        continue;
                    }
                    assert_eq!(result["state"], "SCHEDULE");
                    let n = &result["candidate"];
                    let id = format!("notification-{}", schedules.len() + 1);
                    requests.push(json!({"id":id,"clockEpochMilliseconds":now,"scheduledEpochMilliseconds":n["epochMilliseconds"],"type":"date","content":n["content"],"soundIsUndefined":n["isAlarm"]!=true}));
                    schedules
                        .push(json!({"occurrenceDate":n["occurrenceDate"],"notificationId":id}));
                    now += i["advanceAfterScheduleMilliseconds"].as_i64().unwrap();
                }
                writes.push(Value::Array(schedules));
            }
            common::assert_json_eq(
                &json!({"requests":requests,"writes":writes,"error":null}),
                &c["expected"],
                c["id"].as_str().unwrap(),
            );
            compared += 1;
        }
    }
    assert_eq!(compared, 986);
}
