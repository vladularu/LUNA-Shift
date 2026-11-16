mod common;
use luna_engine::input::{InputError, annual_rows as a};
use serde_json::{Value, json};
use std::sync::Arc;
fn result(value: Result<Value, InputError>) -> Value {
    match value {
        Ok(value) => json!({"value":value}),
        Err(error) => json!({"error":{"name":error.name(),"message":error.to_string()}}),
    }
}
#[test]
fn original_annual_sql_mappers_and_repository_lists_match_native_facts() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/annual-rows-golden.json")).unwrap();
    assert_eq!(data["cases"].as_array().unwrap().len(), 285);
    for case in data["cases"].as_array().unwrap() {
        let input = &case["input"];
        let actual = result(match case["operation"].as_str().unwrap() {
            "own.map" => a::map_actual_annual_payment_row(input),
            "tariff.map" => a::map_tariff_annual_claim_row(input),
            "own.list" => a::RawActualAnnualPayments::try_from_rows(Arc::new(
                input.as_array().unwrap().clone(),
            ))
            .map(|rows| json!(rows.saved().as_ref())),
            "tariff.list" => {
                a::RawTariffAnnualClaims::try_from_rows(Arc::new(input.as_array().unwrap().clone()))
                    .map(|rows| json!(rows.saved().as_ref()))
            }
            operation => panic!("unknown operation {operation}"),
        });
        if case["safeBoundary"] == true {
            assert!(actual.get("error").is_some());
            assert!(!actual.to_string().contains("private"));
        } else {
            common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
        }
    }
}

#[test]
fn opaque_saved_annual_facts_keep_original_rows_and_cross_year_cash_confirmations() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/annual-rows-golden.json")).unwrap();
    let case = data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["operation"] == "own.list" && c["input"].as_array().unwrap().len() == 3)
        .unwrap();
    let mut rows = case["input"].as_array().unwrap().clone();
    rows[0]["revoked"] = json!(1);
    let rows = Arc::new(rows);
    let facts = a::RawActualAnnualPayments::try_from_rows(Arc::clone(&rows)).unwrap();
    assert!(Arc::ptr_eq(facts.raw_rows(), &rows));
    assert_eq!(facts.saved().len(), 3);
    assert_eq!(facts.active_payments().len(), 2);
    assert!(
        facts
            .active_payments()
            .iter()
            .any(|p| p["entitlementYear"] == 2025 && p["payoutMonth"] == "2027-01")
    );
    let case = data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["operation"] == "tariff.list" && c["input"].as_array().unwrap().len() == 3)
        .unwrap();
    let rows = Arc::new(case["input"].as_array().unwrap().clone());
    let facts = a::RawTariffAnnualClaims::try_from_rows(Arc::clone(&rows)).unwrap();
    assert!(Arc::ptr_eq(facts.raw_rows(), &rows));
    assert_eq!(facts.validated().records().len(), 3);
    assert_eq!(
        serde_json::to_value(facts.validated()).unwrap(),
        json!(facts.saved().as_ref())
    );
    let mut injected = rows.as_ref().clone();
    injected[0]["complete"] = json!(true);
    assert!(a::RawTariffAnnualClaims::try_from_rows(Arc::new(injected)).is_err());
    assert!(a::RawActualAnnualPayments::try_from_rows(Arc::new(vec![Value::Null; 4097])).is_err());
}

#[test]
fn original_annual_json_text_chunks_preserve_source_values_and_reject_ambiguity() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/annual-rows-golden.json")).unwrap();
    for (op, column, mapper) in [
        (
            "own.map",
            "payment_json",
            a::map_actual_annual_payment_row as fn(&Value) -> Result<Value, InputError>,
        ),
        ("tariff.map", "claim_json", a::map_tariff_annual_claim_row),
    ] {
        let case = data["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["operation"] == op && c["expected"]["value"].is_object())
            .unwrap();
        let mut row = case["input"].clone();
        let mut text = row
            .as_object_mut()
            .unwrap()
            .remove(column)
            .unwrap()
            .as_str()
            .unwrap()
            .to_owned();
        // Original JSON permits insignificant whitespace. This exercises a
        // large transport text without inventing different business facts.
        text.push_str(&" ".repeat(350_000));
        let chunks = text
            .chars()
            .collect::<Vec<_>>()
            .chunks(20_000)
            .map(|c| c.iter().collect::<String>())
            .collect::<Vec<_>>();
        row[format!("{column}_chunks")] = json!(chunks);
        assert_eq!(mapper(&row).unwrap(), case["expected"]["value"]);
        row[column] = json!("{}");
        assert!(mapper(&row).is_err());
    }
}
