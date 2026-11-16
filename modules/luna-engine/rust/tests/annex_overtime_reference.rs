#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    remuneration::draft_pay::overtime::{AnnexOvertimeInput, calculate_annex_a_overtime},
    rules::RulePackage,
};
use serde_json::json;
use std::collections::BTreeMap;
#[test]
fn confirmed_annex_draft_overtime_matches_full_frozen_source_outputs() {
    let data = value_pool::decode(include_str!("../../reference/annex-overtime-golden.json"));
    assert_eq!(
        data["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let packages: BTreeMap<String, RulePackage> = data["packageJson"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(key, raw)| {
            (
                key.clone(),
                serde_json::from_str(raw.as_str().unwrap()).unwrap(),
            )
        })
        .collect();
    for case in data["cases"].as_array().unwrap() {
        let input: AnnexOvertimeInput =
            serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let result = calculate_annex_a_overtime(&packages[case["key"].as_str().unwrap()], &input);
        let actual = match result {
            Ok(value) => json!({"value":value}),
            Err(e) => json!({"error":{"name":"Error","message":e.to_string()}}),
        };
        assert_eq!(actual, case["expected"], "{}", case["id"]);
    }
    assert_eq!(data["cases"].as_array().unwrap().len(), 6563);
}
