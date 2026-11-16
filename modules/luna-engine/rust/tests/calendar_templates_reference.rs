mod common;
use luna_engine::runtime::calendar_source::PreparedCalendarSource;
use serde_json::{Value, json};
#[test]
fn native_display_join_and_unjoined_payroll_rows_match_original_sql_repositories() {
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/calendar-templates-golden.json"
    ))
    .unwrap();
    assert_eq!(data["cases"].as_array().unwrap().len(), 72);
    for case in data["cases"].as_array().unwrap() {
        let prepared = PreparedCalendarSource::try_from_value(&case["input"])
            .unwrap_or_else(|e| panic!("{}: {e:?}", case["id"]));
        let candidates = prepared
            .collation_candidates()
            .iter()
            .cloned()
            .collect::<Vec<_>>();
        common::assert_json_eq(
            &json!(candidates),
            &case["candidates"],
            case["id"].as_str().unwrap(),
        );
        let calendar = prepared.into_ready().unwrap();
        common::assert_json_eq(
            &json!(calendar.entries().as_ref()),
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
        assert_eq!(
            calendar.raw_shift_rows().as_ref(),
            case["input"]["shiftRows"].as_array().unwrap()
        );
        let finance = match calendar.payroll_shifts() {
            Ok(value) => json!({"value":value.as_ref()}),
            Err(error) => json!({"error":{"name":error.name(),"message":error.message()}}),
        };
        common::assert_json_eq(&finance, &case["finance"], case["id"].as_str().unwrap());
    }
}
#[test]
fn unknown_template_fields_and_duplicate_lookup_ids_are_rejected() {
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/calendar-templates-golden.json"
    ))
    .unwrap();
    let input = &data["cases"][0]["input"];
    let mut unknown = input.clone();
    unknown["templateRows"][0]["computedReady"] = json!(true);
    assert!(PreparedCalendarSource::try_from_value(&unknown).is_err());
    let mut duplicate = input.clone();
    let first = duplicate["templateRows"][0].clone();
    duplicate["templateRows"]
        .as_array_mut()
        .unwrap()
        .push(first);
    assert!(PreparedCalendarSource::try_from_value(&duplicate).is_err());
}
