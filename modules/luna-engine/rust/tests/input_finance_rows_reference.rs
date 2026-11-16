mod common;
use luna_engine::input::{InputError, finance_rows as f};
use serde_json::{Value, json};
use std::sync::Arc;
fn result(value: Result<Value, InputError>) -> Value {
    match value {
        Ok(v) => json!({"value":v}),
        Err(e) => json!({"$error":e.message(),"name":e.name()}),
    }
}
#[test]
fn original_finance_row_metadata_json_defaults_and_sql_timeline_match() {
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/input-finance-rows-golden.json"
    ))
    .unwrap();
    assert_eq!(data["cases"].as_array().unwrap().len(), 296);
    for case in data["cases"].as_array().unwrap() {
        let x = &case["input"];
        let value = match case["operation"].as_str().unwrap() {
            "mapNetPayProfileRow" => f::map_net_pay_profile_row(x),
            "timeline" => {
                f::RawNetPayTimeline::try_from_rows(Arc::new(x.as_array().unwrap().clone()))
                    .map(|v| json!(v.timeline().as_ref()))
            }
            "applicable" => {
                f::RawNetPayTimeline::try_from_rows(Arc::new(x["rows"].as_array().unwrap().clone()))
                    .and_then(|v| {
                        v.resolve(x["month"].as_str().unwrap())
                            .map(|saved| json!({"timeline":v.timeline().as_ref(),"saved":saved}))
                    })
            }
            "paymentPreferences" => f::RawSalaryPaymentPreferences::try_from_row(if x.is_null() {
                None
            } else {
                Some(Arc::new(x.clone()))
            })
            .map(|v| json!(v.preferences().as_ref())),
            "testMonths" => {
                f::RawTestMonths::try_from_rows(Arc::new(x.as_array().unwrap().clone()))
                    .map(|v| json!(v.ordered_months()))
            }
            op => panic!("unknown {op}"),
        };
        if case["engineDiagnostic"] == true || case["nativeMalformed"] == true {
            assert!(value.is_err(), "safe rejection {}", case["id"]);
        } else {
            common::assert_json_eq(
                &result(value),
                &case["expected"],
                case["id"].as_str().unwrap(),
            );
        }
    }
}
#[test]
fn opaque_finance_groups_keep_raw_arcs_and_reject_ambiguous_or_derived_rows() {
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/input-finance-rows-golden.json"
    ))
    .unwrap();
    let row = data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["operation"] == "mapNetPayProfileRow" && c["expected"].get("value").is_some())
        .unwrap()["input"]
        .clone();
    let raw = Arc::new(vec![row.clone()]);
    let timeline = f::RawNetPayTimeline::try_from_rows(Arc::clone(&raw)).unwrap();
    assert!(Arc::ptr_eq(timeline.raw_rows(), &raw));
    assert!(f::RawNetPayTimeline::try_from_rows(Arc::new(vec![row.clone(), row.clone()])).is_err());
    for field in ["ready", "calculatedNetCents", "data_json"] {
        let mut injected = row.clone();
        injected[field] = json!(true);
        assert!(f::RawNetPayTimeline::try_from_rows(Arc::new(vec![injected])).is_err());
    }
    let empty = f::RawNetPayTimeline::try_from_rows(Arc::new(vec![])).unwrap();
    assert!(empty.timeline().is_empty());
    assert!(empty.resolve("2026-07").unwrap().is_null());
    let absent = f::RawSalaryPaymentPreferences::try_from_row(None).unwrap();
    assert!(absent.raw_row().is_none());
    assert_eq!(
        absent.preferences()["socialInsuranceAttribution"],
        "UNKNOWN"
    );
    assert!(
        absent.preferences()["periods"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let preference_row =
        Arc::new(json!({"value":"{\"version\":1,\"periods\":[],\"reviewedEmptyMonths\":[]}"}));
    let present =
        f::RawSalaryPaymentPreferences::try_from_row(Some(Arc::clone(&preference_row))).unwrap();
    assert!(Arc::ptr_eq(present.raw_row().unwrap(), &preference_row));
    assert!(
        f::RawSalaryPaymentPreferences::try_from_row(Some(Arc::new(
            json!({"value":"null","ready":true})
        )))
        .is_err()
    );
    let months = Arc::new(vec![json!({"month":"2026-07"}), json!({"month":"2026-01"})]);
    let known = f::RawTestMonths::try_from_rows(Arc::clone(&months)).unwrap();
    assert!(Arc::ptr_eq(known.raw_rows(), &months));
    assert_eq!(known.ordered_months(), &["2026-01", "2026-07"]);
    assert!(known.months().contains("2026-07"));
    assert!(f::RawTestMonths::try_from_rows(Arc::new(vec![Value::Null])).is_err());
}
