mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    contract::{self, OwnerIdentity, SourceState},
    runtime::{
        SnapshotRegistry,
        calendar_window::{CalendarWindowPool, Completion},
    },
};
use serde_json::{Value, json};
fn bytes(v: &Value) -> Vec<u8> {
    serde_json::to_vec(v).unwrap()
}
fn ready(v: &Value) -> SourceState {
    let data = if v.is_null() {
        json!({"kind":"NULL"})
    } else {
        json!({"kind":"VALUE","value":v})
    };
    serde_json::from_value(json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":data}})).unwrap()
}
fn read(c: &Completion) -> Value {
    serde_json::from_slice(&c.serialize_current().unwrap()).unwrap()
}
fn page(pool: &CalendarWindowPool, id: &Value, view: &str) -> Vec<Value> {
    let mut result = Vec::new();
    let mut after = Value::Null;
    loop {
        let c = pool
            .read(&bytes(
                &json!({"resourceId":id,"view":view,"after":after,"limit":3}),
            ))
            .unwrap();
        let reply = read(&c);
        result.extend(reply["page"]["items"].as_array().unwrap().iter().cloned());
        after = reply["page"]["nextAfter"].clone();
        if after.is_null() {
            assert_eq!(
                result.len() as u64,
                reply["page"]["total"].as_u64().unwrap()
            );
            return result;
        }
    }
}
#[test]
fn original_row_labels_details_and_day_previews_are_paged_from_real_rows_and_clock() {
    let corpus = value_pool::decode(include_str!(
        "../../reference/calendar-window-display-golden.json"
    ));
    assert_eq!(corpus["cases"].as_array().unwrap().len(), 239);
    for (case_number, case) in corpus["cases"].as_array().unwrap().iter().enumerate() {
        let input = &case["input"];
        let registry = SnapshotRegistry::default();
        registry
            .reset_for_owner(&OwnerIdentity::new("display-owner", 1).unwrap())
            .unwrap();
        let marker = registry
            .start_calendar_rows(&registry.calendar_rows_marker().unwrap(), 1)
            .unwrap();
        // Raw SQL source admission is unranked, just like the production reader.
        // Original comparison ranks are applied only to the actual window below.
        let mut raw_rows = input["rows"].clone();
        raw_rows["platformCollationRanks"] = json!({});
        let rows = registry
            .register_calendar_rows(&marker, 1, &ready(&raw_rows))
            .unwrap();
        let marker = registry
            .start_calendar_clock(&registry.calendar_clock_marker().unwrap(), 1)
            .unwrap();
        let clock = registry
            .register_calendar_clock(
                &marker,
                1,
                &ready(&input["clock"]["profile"]),
                &ready(&input["clock"]["historyRows"]),
                input["clock"]["observedEpochMilliseconds"]
                    .as_i64()
                    .unwrap(),
            )
            .unwrap();
        let pool = CalendarWindowPool::new(registry.clone());
        let nav = &input["query"]["navigation"];
        let q = json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,
          "calculationContractVersion":contract::CONTRACT_VERSION,
          "guard":{"ownerScope":"display-owner","ownerEpoch":1,"requestId":"display","draftRevision":1},
          "source":{"kind":"CALENDAR_ONLY","identity":rows},"spec":input["query"]["spec"],
          "options":{"showAppointments":input["query"]["showAppointments"],"showShifts":input["query"]["showShifts"]},
          "localeKey":"original-default","presentation":{"clockIdentity":clock,
          "observedEpochMilliseconds":input["clock"]["observedEpochMilliseconds"],"anchorMonth":nav["anchorMonth"],
          "selectedDate":nav["selectedDate"],"before":0,"after":0,"entries":input["display"]}});
        let prepared = read(&pool.prepare(&bytes(&q)).unwrap());
        if case_number == 0 {
            for entry_options in [
                Value::Null,
                json!({"ready":true}),
                {
                    let mut v = input["display"].clone();
                    v["rowCapacity"] = json!(129);
                    v
                },
                {
                    let mut v = input["display"].clone();
                    v["labelMode"] = json!("DERIVED");
                    v
                },
                {
                    let mut v = input["display"].clone();
                    v["showShiftTimes"] = json!(1);
                    v
                },
            ] {
                let mut invalid = q.clone();
                invalid["presentation"]["entries"] = entry_options;
                assert!(contract::calendar_window::parse_prepare(&bytes(&invalid)).is_err());
            }
        }
        assert_eq!(
            prepared["state"], "CALENDAR_WINDOW_PREPARED",
            "{}: {prepared}",
            case["id"]
        );
        let id = &prepared["resourceId"];
        let candidates=read(&pool.candidates(&bytes(&json!({"resourceId":id,"candidateDigest":prepared["candidateDigest"],"limit":1024}))).unwrap());
        assert!(candidates["page"]["nextAfter"].is_null());
        let mut ranks = serde_json::Map::new();
        for text in candidates["page"]["candidates"].as_array().unwrap() {
            let text = text.as_str().unwrap();
            let rank = case["ranks"]
                .get(text)
                .unwrap_or_else(|| panic!("Missing original rank: {text}"));
            ranks.insert(text.to_owned(), rank.clone());
        }
        let raw_ranks = bytes(&Value::Object(ranks));
        pool.finalize(
            &bytes(&json!({"resourceId":id,"candidateDigest":prepared["candidateDigest"]})),
            &raw_ranks,
        )
        .unwrap();
        common::assert_json_eq(
            &json!(page(&pool, id, "ENTRY_PRESENTATIONS")),
            &case["expected"]["rows"],
            case["id"].as_str().unwrap(),
        );
        if case_number == 0 {
            let mut legacy = q.clone();
            legacy["presentation"]
                .as_object_mut()
                .unwrap()
                .remove("entries");
            legacy["guard"]["requestId"] = json!("legacy-no-display");
            let old = read(&pool.prepare(&bytes(&legacy)).unwrap());
            assert!(old["scope"]["presentation"].get("entries").is_none());
            pool.finalize(&bytes(&json!({"resourceId":old["resourceId"],"candidateDigest":old["candidateDigest"]})),&raw_ranks).unwrap();
            for selector in ["ENTRY_PRESENTATIONS", "DATE_PREVIEWS"] {
                assert!(
                    pool.read(&bytes(
                        &json!({"resourceId":old["resourceId"],"view":selector,"limit":1})
                    ))
                    .is_err()
                );
            }
            assert_eq!(pool.stats().unwrap().source_indices, 1);
        }
        common::assert_json_eq(
            &json!(page(&pool, id, "DATE_PREVIEWS")),
            &case["expected"]["previews"],
            case["id"].as_str().unwrap(),
        );
        let completion = pool
            .read(&bytes(
                &json!({"resourceId":id,"view":"ENTRY_PRESENTATIONS","limit":1}),
            ))
            .unwrap();
        registry
            .start_calendar_clock(&registry.calendar_clock_marker().unwrap(), 2)
            .unwrap();
        assert!(!completion.is_current().unwrap());
        assert!(completion.serialize_current().is_err());
    }
}
