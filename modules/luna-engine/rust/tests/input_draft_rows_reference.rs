mod common;
use luna_engine::input::{InputError, draft_rows as d};
use serde_json::{Value, json};
use std::sync::Arc;
fn data() -> Value {
    serde_json::from_str(include_str!("../../reference/draft-rows-golden.json")).unwrap()
}
fn kind(value: &Value) -> d::DraftRowsKind {
    match value.as_str().unwrap() {
        "annex" => d::DraftRowsKind::AnnexAMonth,
        "premium" => d::DraftRowsKind::AnnexAPremium,
        "sue" => d::DraftRowsKind::SueMonth,
        "sueAllowance" => d::DraftRowsKind::SueAllowance,
        "tvl" => d::DraftRowsKind::TvlShiftWork,
        "drkEmployee" => d::DraftRowsKind::DrkEmployee,
        "drkTraining" => d::DraftRowsKind::DrkTraining,
        "caritasMonth" => d::DraftRowsKind::CaritasMonth,
        "caritasWork" => d::DraftRowsKind::CaritasWorkDay,
        "caritasOvertime" => d::DraftRowsKind::CaritasOvertime,
        _ => panic!("unknown kind"),
    }
}
fn result(value: Result<Value, InputError>) -> Value {
    match value {
        Ok(value) => json!({"value":value}),
        Err(e) => json!({"error":{"name":e.name(),"message":e.message()}}),
    }
}
#[test]
fn original_saved_tariff_sql_mappers_lists_and_chunks_match_native_facts() {
    let data = data();
    assert_eq!(data["cases"].as_array().unwrap().len(), 3052);
    for case in data["cases"].as_array().unwrap() {
        let input = &case["input"];
        let kind = kind(&case["kind"]);
        let actual = result(if case["operation"] == "list" {
            d::RawDraftRows::try_from_rows(kind, Arc::new(input.as_array().unwrap().clone()))
                .map(|r| json!(r.saved().as_ref()))
        } else {
            d::map_draft_evidence_row(kind, input)
        });
        if case["safeBoundary"] == true {
            assert!(actual.get("error").is_some(), "{}", case["id"]);
            assert!(!actual.to_string().contains("private"));
        } else {
            common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
        }
    }
}
#[test]
fn raw_draft_owners_preserve_content_bindings_and_reject_injected_ready_flags() {
    let data = data();
    for name in [
        "annex",
        "premium",
        "sue",
        "sueAllowance",
        "tvl",
        "drkEmployee",
        "drkTraining",
        "caritasMonth",
        "caritasWork",
        "caritasOvertime",
    ] {
        let case = data["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| {
                c["kind"] == name && c["operation"] == "map" && c["expected"]["value"].is_object()
            })
            .unwrap();
        let kind = kind(&case["kind"]);
        let raw = Arc::new(vec![case["input"].clone()]);
        let prepared = d::RawDraftRows::try_from_rows(kind, raw.clone()).unwrap();
        assert!(Arc::ptr_eq(&raw, prepared.raw_rows()));
        assert_eq!(prepared.saved()[0], case["expected"]["value"]);
        assert_eq!(prepared.kind(), kind);
        let mut invalid = raw[0].clone();
        invalid["ready"] = json!(true);
        assert!(d::map_draft_evidence_row(kind, &invalid).is_err());
    }
}
