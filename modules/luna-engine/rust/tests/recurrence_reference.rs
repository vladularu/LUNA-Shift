use luna_engine::EngineError;
use luna_engine::calendar::recurrence::{
    CollationRanks, expand_appointment_series, expand_calendar_entries,
};
use serde_json::{Value, json};
mod common;

fn bundle() -> Value {
    serde_json::from_str(include_str!("../../reference/recurrence-golden.json"))
        .expect("frozen Build 52 recurrence reference")
}

fn run(case: &Value) -> Result<Value, EngineError> {
    let input = &case["input"];
    let start = input["startDate"].as_str().expect("fixture range start");
    let end = input["endDate"].as_str().expect("fixture range end");
    let result = match case["operation"].as_str().expect("operation") {
        "calendar.expandAppointmentSeries" => {
            expand_appointment_series(&input["appointment"], start, end)?
        }
        "calendar.expandCalendarEntries" => {
            let collation: CollationRanks = serde_json::from_value(input["collationRanks"].clone())
                .expect("fixture locale equivalence ranks");
            expand_calendar_entries(
                input["entries"].as_array().expect("entries"),
                start,
                end,
                &collation,
            )?
        }
        other => panic!("unknown fixture operation {other}"),
    };
    Ok(Value::Array(result))
}

#[test]
fn every_frozen_recurrence_result_matches_in_full() {
    let reference = bundle();
    assert_eq!(
        reference["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let cases = reference["cases"].as_array().expect("cases");
    assert_eq!(
        cases.len(),
        38,
        "Reference coverage must not silently shrink"
    );
    for case in cases {
        assert_eq!(
            run(case).unwrap_or_else(|error| panic!("{}: {error}", case["id"])),
            case["expected"],
            "{}",
            case["id"]
        );
    }
}
#[test]
fn integral_native_number_tokens_preserve_every_original_series_and_calendar() {
    let mut reference = bundle();
    fn native_numbers(v: &mut Value) {
        if let Some(number) = v
            .get("recurrence")
            .and_then(|r| r.get("interval"))
            .and_then(Value::as_f64)
        {
            v["recurrence"]["interval"] = json!(number);
        }
        match v {
            Value::Object(o) => o.values_mut().for_each(native_numbers),
            Value::Array(a) => a.iter_mut().for_each(native_numbers),
            _ => (),
        }
    }
    for c in reference["cases"].as_array_mut().unwrap() {
        native_numbers(&mut c["input"]);
        common::assert_json_eq(&run(c).unwrap(), &c["expected"], c["id"].as_str().unwrap());
    }
}

#[test]
fn missing_locale_rank_is_rejected_instead_of_byte_sorted() {
    let reference = bundle();
    let case = reference["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["id"] == "calendar-title-host-collation")
        .unwrap();
    let input = &case["input"];
    let mut ranks = input["collationRanks"].clone();
    ranks.as_object_mut().unwrap().remove("ä");
    let ranks = serde_json::from_value(ranks).unwrap();
    assert_eq!(
        expand_calendar_entries(
            input["entries"].as_array().unwrap(),
            "2026-09-01",
            "2026-09-30",
            &ranks
        ),
        Err(EngineError::InvalidCollation)
    );
}

#[test]
fn invalid_dates_and_fractional_intervals_return_errors_without_panicking() {
    let reference = bundle();
    let mut appointment = reference["cases"][0]["input"]["appointment"].clone();
    assert_eq!(
        expand_appointment_series(&appointment, "2026-02-30", "2026-09-30"),
        Err(EngineError::InvalidDate)
    );
    appointment["recurrence"]["interval"] = json!(1.5);
    assert_eq!(
        expand_appointment_series(&appointment, "2026-09-01", "2026-09-30"),
        Err(EngineError::InvalidRecurrence)
    );
    appointment["recurrence"]["interval"] = json!(i64::MAX);
    assert_eq!(
        expand_appointment_series(&appointment, "2026-09-01", "2026-09-30"),
        Err(EngineError::Overflow)
    );
}
