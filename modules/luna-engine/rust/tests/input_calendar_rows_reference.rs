mod common;
use luna_engine::{
    calendar::recurrence::{self, CollationRanks},
    input::{InputError, calendar_rows as c},
};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
fn result(value: Result<Value, InputError>) -> Value {
    match value {
        Ok(v) => json!({"value":v}),
        Err(e) => json!({"$error":e.message(),"name":e.name()}),
    }
}
#[test]
fn sql_rows_normalize_sort_and_expand_in_rust_against_original_repository() {
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/input-calendar-rows-golden.json"
    ))
    .unwrap();
    assert_eq!(data["cases"].as_array().unwrap().len(), 422);
    for case in data["cases"].as_array().unwrap() {
        let x = &case["input"];
        let actual = match case["operation"].as_str().unwrap() {
            "mapShift" => result(c::map_shift(x)),
            "mapAppointment" => result(c::map_appointment(x)),
            "mapTemplate" => result(c::map_template(x)),
            "listMonthlyTariffDecisions" => {
                let values = x
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(c::map_tariff_decision)
                    .collect::<Result<Vec<_>, _>>();
                result(values.map(|v| json!(v)))
            }
            "listCalendarEntries" | "expandedStoredRows" => {
                let shifts = Arc::new(x["shiftRows"].as_array().unwrap().clone());
                let appointments = Arc::new(x["appointmentRows"].as_array().unwrap().clone());
                let prepared = c::PreparedCalendarRows::from_rows(
                    Arc::clone(&shifts),
                    Arc::clone(&appointments),
                )
                .unwrap();
                let ranks: CollationRanks =
                    serde_json::from_value(case["platformCollationRanks"].clone()).unwrap();
                let expected_candidates: BTreeSet<String> =
                    serde_json::from_value(case["candidates"].clone()).unwrap();
                if case["operation"] == "listCalendarEntries" {
                    assert_eq!(prepared.collation_candidates(), &expected_candidates);
                    let group = prepared.into_ranked(&ranks).unwrap();
                    assert!(Arc::ptr_eq(group.raw_shift_rows(), &shifts));
                    assert!(Arc::ptr_eq(group.raw_appointment_rows(), &appointments));
                    assert!(Arc::ptr_eq(group.collation(), group.collation()));
                    assert_eq!(
                        recurrence::sort_calendar_entries(
                            group.entries().as_ref().clone(),
                            group.collation(),
                        )
                        .unwrap(),
                        group.entries().as_ref().clone(),
                    );
                    let original_shifts = case["expected"]["value"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .filter(|entry| {
                            entry["kind"] == "SHIFT" && entry.get("deletedAt") == Some(&Value::Null)
                        })
                        .cloned()
                        .collect::<Vec<_>>();
                    assert_eq!(group.active_shifts().as_ref(), &original_shifts);
                    assert!(Arc::ptr_eq(group.active_shifts(), group.active_shifts()));
                    if original_shifts.len() == group.entries().len() {
                        assert!(Arc::ptr_eq(group.active_shifts(), group.entries()));
                    }
                    json!({"value":group.entries().as_ref()})
                } else {
                    let stored_ranks: CollationRanks =
                        serde_json::from_value(case["storedPlatformCollationRanks"].clone())
                            .unwrap();
                    // Source repository order precedes recurrence projection;
                    // later locale-equivalent occurrences retain that order.
                    let stored = prepared.into_ranked(&stored_ranks).unwrap();
                    let expanded = recurrence::prepare_calendar_entries(
                        stored.entries(),
                        x["startDate"].as_str().unwrap(),
                        x["endDate"].as_str().unwrap(),
                    )
                    .unwrap();
                    assert_eq!(
                        recurrence::collation_candidates(&expanded).unwrap(),
                        expected_candidates
                    );
                    assert_eq!(
                        appointments.as_ref(),
                        x["appointmentRows"].as_array().unwrap()
                    );
                    json!({"value":recurrence::sort_calendar_entries(expanded,&ranks).unwrap()})
                }
            }
            op => panic!("unknown {op}"),
        };
        if case["malformedType"] == true {
            assert!(actual.get("$error").is_some());
        } else {
            common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
        }
    }
}

#[test]
fn payroll_history_keeps_unjoined_rows_and_binary_sql_order_separate_from_display() {
    let reference: Value = serde_json::from_str(include_str!(
        "../../reference/input-calendar-rows-golden.json"
    ))
    .unwrap();
    let base = reference["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["operation"] == "mapShift" && case["expected"].get("value").is_some())
        .unwrap()["input"]
        .clone();
    let mut rows = vec![];
    for (id, time) in [("z", "06:00"), ("ä", "05:00"), ("a", "07:00")] {
        let mut row = base.clone();
        row["id"] = json!(id);
        row["date"] = json!("2026-06-01");
        row["start_time"] = json!(time);
        row["end_time"] = json!("16:00");
        row["deleted_at"] = Value::Null;
        rows.push(row);
    }
    let mut deleted = rows[0].clone();
    deleted["id"] = json!("0-deleted");
    deleted["deleted_at"] = json!("2026-06-02T00:00:00Z");
    rows.push(deleted);
    let prepared =
        c::PreparedCalendarRows::from_rows(Arc::new(rows.clone()), Arc::new(vec![])).unwrap();
    // Deliberately equal platform ranks exercise stable display ties; payroll must
    // independently use SQLite BINARY order, never this separate platform input.
    let ranks = prepared
        .collation_candidates()
        .iter()
        .map(|candidate| (candidate.clone(), 0))
        .collect::<BTreeMap<String, u32>>();
    let calendar = prepared.into_ranked(&CollationRanks::from(ranks)).unwrap();
    let actual = calendar.payroll_shifts().unwrap();
    let expected = ["a", "z", "ä"]
        .iter()
        .map(|id| c::map_shift(rows.iter().find(|row| row["id"] == *id).unwrap()).unwrap())
        .collect::<Vec<_>>();
    assert_eq!(actual.as_ref(), &expected);
    assert!(Arc::ptr_eq(actual, calendar.payroll_shifts().unwrap()));
    assert_ne!(calendar.active_shifts().as_ref(), actual.as_ref());
}
#[test]
fn checked_empty_groups_and_raw_metadata_never_turn_missing_ranks_into_ready() {
    let empty = Arc::new(vec![]);
    let group = c::RawCalendarEntries::try_from_rows(
        Arc::clone(&empty),
        Arc::clone(&empty),
        &CollationRanks::from(BTreeMap::new()),
    )
    .unwrap();
    assert!(group.entries().is_empty());
    assert!(Arc::ptr_eq(group.raw_shift_rows(), &empty));
    assert!(c::RawMonthlyTariffDecisions::try_from_rows(Arc::new(vec![json!({"month":"2026-07","allowance_status":"NONE","revision":1,"confirmed_at":"2026-01-01T00:00Z","updated_at":"2026-07-01T00:00Z","ready":true})])).is_err());
}
#[test]
fn checked_rows_reject_sender_flags_bad_sql_metadata_and_duplicate_records() {
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/input-calendar-rows-golden.json"
    ))
    .unwrap();
    let base = data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["operation"] == "mapShift")
        .unwrap()["input"]
        .clone();
    for (key, value) in [
        ("ready", json!(true)),
        ("kind", json!("SHIFT")),
        ("workingTimeTarget", Value::Null),
        ("occurrenceDate", json!("2026-07-01")),
        ("all_day", json!(2)),
        ("alarm_enabled", json!(2)),
        ("break_minutes", json!(-1)),
        ("revision", json!(0)),
        ("revision", json!(9007199254740992_u64)),
        ("created_at", json!("invalid")),
        ("updated_at", Value::Null),
        ("deleted_at", json!("invalid")),
        ("template_id", json!(true)),
        ("id", json!("  ")),
    ] {
        let mut row = base.clone();
        row[key] = value;
        assert!(
            c::PreparedCalendarRows::from_rows(Arc::new(vec![row]), Arc::new(vec![])).is_err(),
            "rejected {key}"
        );
    }
    assert!(
        c::PreparedCalendarRows::from_rows(
            Arc::new(vec![base.clone(), base.clone()]),
            Arc::new(vec![])
        )
        .is_err()
    );
    assert!(
        c::PreparedCalendarRows::from_rows(Arc::new(vec![Value::Null; 50001]), Arc::new(vec![]))
            .is_err()
    );
    let mut next = base.clone();
    next["id"] = json!("next");
    let prepared =
        c::PreparedCalendarRows::from_rows(Arc::new(vec![base, next]), Arc::new(vec![])).unwrap();
    assert!(
        prepared.into_ranked(&CollationRanks::default()).is_err(),
        "no byte-order fallback when platform facts are missing"
    );
}
#[test]
fn monthly_sql_order_and_original_arc_are_preserved_without_duplicate_month_winners() {
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/input-calendar-rows-golden.json"
    ))
    .unwrap();
    let source = data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .rev()
        .find(|c| {
            c["operation"] == "listMonthlyTariffDecisions"
                && c["input"].as_array().is_some_and(|a| a.len() > 1)
        })
        .unwrap();
    let mut rows = source["input"].as_array().unwrap().clone();
    rows.reverse();
    let raw = Arc::new(rows);
    let group = c::RawMonthlyTariffDecisions::try_from_rows(Arc::clone(&raw)).unwrap();
    assert!(Arc::ptr_eq(group.raw_rows(), &raw));
    common::assert_json_eq(
        &json!(group.decisions().as_ref()),
        &source["expected"]["value"],
        "original ORDER BY month",
    );
    assert!(
        c::RawMonthlyTariffDecisions::try_from_rows(Arc::new(vec![raw[0].clone(), raw[0].clone()]))
            .is_err()
    );
    let mut too_large = raw[0].clone();
    too_large["revision"] = json!(9007199254740992_u64);
    assert!(c::RawMonthlyTariffDecisions::try_from_rows(Arc::new(vec![too_large])).is_err());
}
