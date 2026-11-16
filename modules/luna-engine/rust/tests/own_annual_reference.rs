use luna_engine::{
    remuneration::annual::{
        actual::validate_actual_own_annual_payments, own::calculate_own_annual_payments,
    },
    rules::{PackageIds, RuleResolver},
};
use serde_json::{Value, json};
#[test]
fn own_annual_candidates_and_actual_payment_facts_match_unchanged_source() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/own-annual-golden.json")).unwrap();
    assert_eq!(
        data["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let resolver = RuleResolver::from_catalog_json(
        json!({"tariff":[],"legal":[],"holiday":[]}),
        PackageIds {
            tariff: "missing".into(),
            legal: "missing".into(),
            holiday: "missing".into(),
        },
        None,
    )
    .unwrap();
    let mut failures = vec![];
    let mut checked = 0;
    for case in data["cases"].as_array().unwrap() {
        let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let empty = json!([]);
        let result = if case["operation"] == "validate" {
            validate_actual_own_annual_payments(&input["value"])
                .map(|v| serde_json::to_value(v).unwrap())
        } else {
            calculate_own_annual_payments(
                input["month"].as_str().unwrap(),
                input["history"].as_array().unwrap(),
                input.get("actualPayments").unwrap_or(&empty),
                &resolver,
            )
            .map(|v| serde_json::to_value(v).unwrap())
        };
        let actual = match result {
            Ok(value) => json!({"value":value}),
            Err(error) => json!({"error":{"name":error.class_name(),"message":error.to_string()}}),
        };
        checked += 1;
        if actual != case["expected"] && failures.len() < 12 {
            failures.push(format!(
                "{}\nactual {actual}\nexpected {}\ninput {}",
                case["id"], case["expected"], case["inputJson"]
            ));
        }
    }
    assert!(checked >= 1200, "Own annual corpus is incomplete");
    assert!(
        failures.is_empty(),
        "{} mismatches\n{}",
        failures.len(),
        failures.join("\n\n")
    );
    eprintln!("Own annual: {checked} exact native results/errors from raw facts");
}
