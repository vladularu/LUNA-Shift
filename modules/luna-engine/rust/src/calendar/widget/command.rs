//! Direct stateless calls for the existing widget IO controller.
use super::{WidgetClock, WidgetRowOptions};
use crate::calendar::recurrence::CollationRanks;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{collections::BTreeSet, sync::Arc};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClockInput {
    observed_epoch_milliseconds: i64,
    time_zone: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EntriesInput {
    entries: Vec<Value>,
    shared_calendars: Vec<Value>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Options {
    show_shifts: bool,
    show_appointments: bool,
    show_shift_times: bool,
    show_shift_duration: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TimelineInput {
    observed_epoch_milliseconds: i64,
    time_zone: String,
    entries: Vec<Value>,
    shared_calendars: Vec<Value>,
    platform_collation_ranks: CollationRanks,
    options: Options,
    has_profile: bool,
}
pub(crate) fn execute(kind: &str, body: &[u8]) -> Result<Value, &'static str> {
    let invalid = || "INVALID_WIDGET_INPUT";
    match kind {
        "WIDGET_CLOCK" => {
            let input: ClockInput = serde_json::from_slice(body).map_err(|_| invalid())?;
            let clock =
                WidgetClock::from_epoch(input.observed_epoch_milliseconds, &input.time_zone)
                    .map_err(|_| invalid())?;
            Ok(json!({"range":clock.entry_range().map_err(|_|invalid())?,
                "nextMidnight":clock.next_midnight().map_err(|_|invalid())?}))
        }
        "WIDGET_CANDIDATES" => {
            let input: EntriesInput = serde_json::from_slice(body).map_err(|_| invalid())?;
            if input.entries.len() > 100_000 || input.shared_calendars.len() > 10_000 {
                return Err("WIDGET_LIMIT");
            }
            let mut strings = BTreeSet::from([String::new()]);
            for entry in &input.entries {
                for field in ["date", "startTime", "createdAt", "title", "id"] {
                    if let Some(value) = entry.get(field).and_then(Value::as_str) {
                        strings.insert(value.to_owned());
                    }
                }
            }
            for calendar in &input.shared_calendars {
                if let Some(id) = calendar
                    .get("calendar")
                    .and_then(|v| v.get("id"))
                    .and_then(Value::as_str)
                {
                    strings.insert(id.to_owned());
                }
                if let Some(entries) = calendar.get("entries").and_then(Value::as_array) {
                    for entry in entries {
                        if let Some(id) = entry.get("id").and_then(Value::as_str) {
                            strings.insert(id.to_owned());
                        }
                        if strings.len() > 100_000 {
                            return Err("WIDGET_LIMIT");
                        }
                    }
                }
            }
            if strings.len() > 100_000 {
                return Err("WIDGET_LIMIT");
            }
            Ok(json!(strings))
        }
        "WIDGET_TIMELINE" => {
            let input: TimelineInput = serde_json::from_slice(body).map_err(|_| invalid())?;
            let clock =
                WidgetClock::from_epoch(input.observed_epoch_milliseconds, &input.time_zone)
                    .map_err(|_| invalid())?;
            let options = input.options;
            serde_json::to_value(
                clock
                    .business_timeline(
                        &input.entries,
                        &input.platform_collation_ranks,
                        Arc::new(input.shared_calendars),
                        WidgetRowOptions {
                            show_shifts: options.show_shifts,
                            show_appointments: options.show_appointments,
                            show_shift_times: options.show_shift_times,
                            show_shift_duration: options.show_shift_duration,
                        },
                        input.has_profile,
                    )
                    .map_err(|_| invalid())?,
            )
            .map_err(|_| "WIDGET_LIMIT")
        }
        _ => Err("INVALID_WIDGET_COMMAND"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn direct_commands_preserve_original_widget_clock_and_full_timeline_frames() {
        let corpus = crate::test_value_pool::decode(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../reference/widget-golden.json"
        )));
        let locale: Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../reference/widget-platform-ranks.json"
        )))
        .unwrap();
        let mut dumped = Vec::new();
        for case in corpus["cases"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|c| c["operation"] == "widget.timeline")
        {
            let input = &case["input"];
            let display = &input["display"];
            let facts = locale["cases"]
                .as_array()
                .unwrap()
                .iter()
                .find(|c| c["id"] == case["id"])
                .unwrap();
            let shared = input
                .get("sharedCalendars")
                .cloned()
                .unwrap_or_else(|| json!([]));
            let candidates = execute(
                "WIDGET_CANDIDATES",
                &serde_json::to_vec(&json!({"entries":input["entries"],"sharedCalendars":shared}))
                    .unwrap(),
            )
            .unwrap();
            for candidate in candidates.as_array().unwrap() {
                assert!(
                    facts["ranks"].get(candidate.as_str().unwrap()).is_some(),
                    "{}:{candidate}",
                    case["id"]
                );
            }
            let body = json!({"entries":input["entries"],"sharedCalendars":shared,
                "observedEpochMilliseconds":input["observedEpochMilliseconds"],"timeZone":input["timeZone"],
                "hasProfile":input["hasProfile"],"platformCollationRanks":facts["ranks"],
                "options":{"showShifts":display.get("showShifts").and_then(Value::as_bool).unwrap_or(true),
                    "showAppointments":display.get("showAppointments").and_then(Value::as_bool)!=Some(false),
                    "showShiftTimes":display.get("showShiftTimes").and_then(Value::as_bool).unwrap_or(true),
                    "showShiftDuration":display.get("showShiftDuration").and_then(Value::as_bool).unwrap_or(false)}});
            let frames = execute("WIDGET_TIMELINE", &serde_json::to_vec(&body).unwrap()).unwrap();
            assert_eq!(
                frames.as_array().unwrap().len(),
                case["expected"].as_array().unwrap().len(),
                "{}",
                case["id"]
            );
            for (actual, expected) in frames
                .as_array()
                .unwrap()
                .iter()
                .zip(case["expected"].as_array().unwrap())
            {
                assert_eq!(
                    actual["observedEpochMilliseconds"],
                    expected["observedEpochMilliseconds"]
                );
                for field in ["todayDate", "month", "monthTitle", "state"] {
                    assert_eq!(
                        actual[field], expected["props"][field],
                        "{}:{field}",
                        case["id"]
                    );
                }
            }
            dumped.push(json!({"id":case["id"],"frames":frames}));
        }
        assert_eq!(dumped.len(), 92);
        if let Ok(path) = std::env::var("LUNA_WIDGET_COMMAND_NATIVE_OUTPUT") {
            use std::io::Write;
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
                .unwrap();
            file.write_all(&serde_json::to_vec(&dumped).unwrap())
                .unwrap();
        }
        let clocks: Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../reference/widget-clock-golden.json"
        )))
        .unwrap();
        for case in clocks["cases"].as_array().unwrap() {
            assert_eq!(
                execute("WIDGET_CLOCK", &serde_json::to_vec(&case["input"]).unwrap()).unwrap(),
                case["expected"],
                "{}",
                case["id"]
            );
        }
    }
    #[test]
    fn malformed_widget_commands_do_not_fabricate_a_ready_timeline() {
        assert_eq!(
            execute(
                "WIDGET_CLOCK",
                br#"{"observedEpochMilliseconds":0,"timeZone":"Europe/Unknown"}"#
            ),
            Err("INVALID_WIDGET_INPUT")
        );
        assert_eq!(
            execute("WIDGET_TIMELINE", b"{}"),
            Err("INVALID_WIDGET_INPUT")
        );
        assert_eq!(execute("UNKNOWN", b"{}"), Err("INVALID_WIDGET_COMMAND"));
    }
}
