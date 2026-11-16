use luna_engine::rules::{
    validation::ValidationError,
    validation_tariff::{self, annex, avrdd, caritas, caritas_annual, drk, tdl},
};
use serde_json::Value;
fn child<'a>(v: &'a mut Value, key: &Value) -> &'a mut Value {
    if v.is_array() {
        let i = key
            .as_u64()
            .map(|n| n as usize)
            .unwrap_or_else(|| key.as_str().unwrap().parse().unwrap());
        &mut v[i]
    } else {
        &mut v[key.as_str().unwrap()]
    }
}
fn patched(mut value: Value, patches: &Value) -> Value {
    for p in patches.as_array().unwrap() {
        let keys = p["path"].as_array().unwrap();
        let mut parent = &mut value;
        for key in &keys[..keys.len() - 1] {
            parent = child(parent, key);
        }
        let key = keys.last().unwrap();
        if p["op"] == "delete" {
            parent
                .as_object_mut()
                .unwrap()
                .remove(key.as_str().unwrap());
        } else {
            let target = child(parent, key);
            match p["op"].as_str() {
                Some("append") => target.as_array_mut().unwrap().push(p["value"].clone()),
                Some("pop") => {
                    target.as_array_mut().unwrap().pop();
                }
                Some("reverse") => target.as_array_mut().unwrap().reverse(),
                _ => *target = p["value"].clone(),
            }
        }
    }
    value
}
fn calculate(
    operation: &str,
    value: &Value,
) -> Vec<luna_engine::rules::validation::ValidationIssue> {
    match operation {
        "tvl" => tdl::tvl_kr_issues(value),
        "tval" => tdl::tval_training_issues(value),
        "annex" => annex::tvoed_annex_a_issues(value),
        "sue" => annex::tvoed_sue_issues(value),
        "drk" => drk::drk_table_issues(value),
        "drkTraining" => drk::drk_training_table_issues(value),
        "avrdd" => avrdd::avrdd_issues(value),
        "caritasAnnual" => caritas_annual::caritas_annual_payment_issues(value),
        "caritasTable" => caritas::caritas_table_issues(value),
        "caritasCare" => caritas::caritas_care_issues(value),
        "family" => validation_tariff::family_tariff_issues(value).unwrap(),
        op => panic!("unknown {op}"),
    }
}
struct Fixture {
    value: Value,
    packages: std::collections::BTreeMap<String, Value>,
}
fn fixture() -> &'static Fixture {
    static FIXTURE: std::sync::OnceLock<Fixture> = std::sync::OnceLock::new();
    FIXTURE.get_or_init(|| {
        let f: Value =
            serde_json::from_str(include_str!("../../reference/tariff-family-golden.json"))
                .unwrap();
        assert_eq!(
            f["sourceDigest"],
            "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
        );
        let packages: std::collections::BTreeMap<String, Value> = f["packageJson"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(k, v)| {
                (
                    k.clone(),
                    serde_json::from_str(v.as_str().unwrap()).unwrap(),
                )
            })
            .collect();
        Fixture { value: f, packages }
    })
}
fn assert_failures(failures: Vec<String>) {
    assert!(
        failures.is_empty(),
        "{} mismatches\n{}",
        failures.len(),
        failures
            .iter()
            .take(16)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n\n")
    );
}
fn compare_cases(collection: &str) {
    let fixture = fixture();
    let f = &fixture.value;
    let packages = &fixture.packages;
    let mut failures = vec![];
    for case in f[collection].as_array().unwrap() {
        let patches: Value = serde_json::from_str(case["patchesJson"].as_str().unwrap()).unwrap();
        let value = patched(packages[case["key"].as_str().unwrap()].clone(), &patches);
        let issues = calculate(case["operation"].as_str().unwrap(), &value);
        let actual = serde_json::json!({"value":issues});
        if actual != case["expected"] {
            failures.push(format!(
                "{} {}\nactual {}\nexpected {}\npatches {}",
                case["id"], case["key"], actual, case["expected"], patches
            ));
        }
        if let Some(key) = case.get("fullExpectedKey") {
            let expected = f["fullValidationResults"]
                .get(key.as_str().unwrap())
                .unwrap();
            let issues = luna_engine::rules::validation::validate_rule_package(&value).unwrap();
            let actual = serde_json::json!({"ok":issues.is_empty(),"issues":issues});
            if &actual != expected {
                failures.push(format!(
                    "full pipeline {} {}\nactual {actual}\nexpected {expected}\npatches {patches}",
                    case["id"], case["key"]
                ));
            }
        }
    }
    assert_failures(failures);
}
#[test]
fn translated_tariff_family_helpers_match_full_source_diagnostics() {
    compare_cases("cases");
}
#[test]
fn ordered_tariff_family_and_full_validation_pipeline_match_source() {
    compare_cases("dispatcherCases");
}
#[test]
fn integer_decimal_lexemes_match_source_number_semantics() {
    let f = &fixture().value;
    let mut failures = vec![];
    for row in f["numericLexemes"].as_array().unwrap() {
        let value: Value = serde_json::from_str(row["packageJson"].as_str().unwrap()).unwrap();
        for (operation, expected) in row["expected"].as_object().unwrap() {
            let actual = serde_json::to_value(calculate(operation, &value)).unwrap();
            if &actual != expected {
                failures.push(format!(
                    "numeric lexemes {} {operation}\nactual {actual}\nexpected {expected}",
                    row["key"]
                ));
            }
        }
        let issues = luna_engine::rules::validation::validate_rule_package(&value).unwrap();
        let actual = serde_json::json!({"ok":issues.is_empty(),"issues":issues});
        let expected = &f["fullValidationResults"][row["fullExpectedKey"].as_str().unwrap()];
        if &actual != expected {
            failures.push(format!(
                "numeric full pipeline {}\nactual {actual}\nexpected {expected}",
                row["key"]
            ));
        }
    }
    assert_failures(failures);
}
#[test]
fn incomplete_raw_package_cannot_grant_family_validation() {
    assert_eq!(
        validation_tariff::family_tariff_issues(&serde_json::json!({})).unwrap_err(),
        ValidationError::SemanticValidationUnavailable
    );
}
