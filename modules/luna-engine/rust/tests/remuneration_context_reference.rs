use luna_engine::{
    remuneration::context::{
        annual,
        model::{ContextError, FullNativePackageValidator, NativePackageValidator},
        periods::resolve_month,
        resolve::resolve_context,
        selection, training,
    },
    rules::{PackageIds, RulePackage, RuleResolver},
};
use serde_json::{Value, json};
fn child<'a>(node: &'a mut Value, key: &Value) -> &'a mut Value {
    if node.is_array() {
        let i = key
            .as_u64()
            .map(|v| v as usize)
            .unwrap_or_else(|| key.as_str().unwrap().parse().unwrap());
        &mut node[i]
    } else {
        &mut node[key.as_str().unwrap()]
    }
}

struct UnavailableNativeValidator;
impl NativePackageValidator for UnavailableNativeValidator {
    fn validate(&self, _: &RulePackage) -> Result<bool, ContextError> {
        Err(ContextError::RuleValidationUnavailable)
    }
}
fn project(mut value: Value) -> Value {
    if let Some(map) = value.as_object_mut()
        && let Some(pkg) = map.remove("rulePackage")
    {
        map.insert(
            "rulePackageIdentity".into(),
            json!(format!(
                "{}@{}",
                pkg["packageId"].as_str().unwrap(),
                pkg["versionId"].as_str().unwrap()
            )),
        );
    }
    value
}
#[test]
fn dated_context_without_full_validator_never_claims_ready_for_untranslated_rules() {
    compare_contexts(&UnavailableNativeValidator, true);
}
#[test]
fn dated_context_with_full_native_validator_matches_all_source_cases() {
    compare_contexts(&FullNativePackageValidator, false);
}
fn compare_contexts(validator: &impl NativePackageValidator, expect_barrier: bool) {
    let f: Value = serde_json::from_str(include_str!(
        "../../reference/remuneration-context-golden.json"
    ))
    .unwrap();
    let mut checked = 0;
    let mut waiting = 0;
    let mut failures = vec![];
    for case in f["contextCases"].as_array().unwrap() {
        let key = case["key"].as_str();
        let package = key.map(|k| f["packages"][k].clone());
        let id = package
            .as_ref()
            .and_then(|p| p["packageId"].as_str())
            .unwrap_or("missing")
            .to_owned();
        let resolver = RuleResolver::from_catalog_json(
            json!({"tariff":package.into_iter().collect::<Vec<_>>(),"legal":[],"holiday":[]}),
            PackageIds {
                tariff: id,
                legal: "missing".into(),
                holiday: "missing".into(),
            },
            None,
        )
        .unwrap();
        let input = &case["input"];
        let history = input["history"].as_array().unwrap();
        let result = if case["operation"] == "context" {
            resolve_context(
                input["date"].as_str().unwrap(),
                history,
                &resolver,
                validator,
            )
            .map(|r| project(serde_json::to_value(r).unwrap()))
        } else {
            resolve_month(
                input["month"].as_str().unwrap(),
                history,
                &resolver,
                validator,
            )
            .map(|periods| {
                Value::Array(
                    periods
                        .into_iter()
                        .map(|r| {
                            let mut r = serde_json::to_value(r).unwrap();
                            r["context"] = project(r["context"].take());
                            r
                        })
                        .collect(),
                )
            })
        };
        let actual = match result {
            Err(ContextError::RuleValidationUnavailable) => {
                waiting += 1;
                continue;
            }
            Ok(value) => json!({"value":value}),
            Err(e) => {
                json!({"error":{"name":if matches!(e,ContextError::Employment(_)){"RemunerationProfileError"}else{"Error"},"message":e.to_string()}})
            }
        };
        checked += 1;
        if actual != case["expected"] {
            failures.push(format!(
                "{}\nactual {}\nexpected {}",
                case["id"], actual, case["expected"]
            ));
        }
    }
    assert!(
        checked > 0 && ((expect_barrier && waiting > 0) || (!expect_barrier && waiting == 0)),
        "The complete native validator must compare every case; an unavailable validator must remain fail-closed. checked={checked}, waiting={waiting}, expect_barrier={expect_barrier}"
    );
    assert!(
        failures.is_empty(),
        "{} mismatches ({checked} compared, {waiting} explicitly waiting for native validation)\n{}",
        failures.len(),
        failures
            .iter()
            .take(8)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n\n")
    );
    eprintln!(
        "Native context: {checked} exact cases; {waiting} deliberately blocked; unavailable-validator proof={expect_barrier}"
    );
}
fn apply(value: &Value, patches: &Value) -> Value {
    let mut value = value.clone();
    for patch in patches.as_array().unwrap() {
        let keys = patch["path"].as_array().unwrap();
        let mut node = &mut value;
        for key in &keys[..keys.len() - 1] {
            node = child(node, key);
        }
        let last = keys.last().unwrap();
        let key = last.as_str();
        if patch["op"] == "delete" {
            node.as_object_mut().unwrap().remove(key.unwrap());
        } else if patch["op"] == "append" {
            let list = child(node, last);
            list.as_array_mut().unwrap().push(patch["value"].clone());
        } else {
            *child(node, last) = patch["value"].clone();
        }
    }
    value
}
#[test]
fn tariff_selection_training_and_annual_semantics_match_frozen_source() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../reference/remuneration-context-golden.json"
    ))
    .unwrap();
    assert_eq!(
        fixture["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let mut failures = vec![];
    for case in fixture["cases"].as_array().unwrap() {
        let raw = apply(
            &fixture["packages"][case["key"].as_str().unwrap()],
            &case["patches"],
        );
        let pkg: RulePackage = serde_json::from_value(raw.clone()).unwrap();
        let borrowed =
            luna_engine::remuneration::context::RawTariffValidationPackage::new(&raw).unwrap();
        let output = match case["operation"].as_str().unwrap() {
            "selectionIssues" => {
                serde_json::to_value(selection::tariff_selection_issues(&pkg)).unwrap()
            }
            "trainingIssues" => serde_json::to_value(training::training_pay_issues(&pkg)).unwrap(),
            "annualIssues" => {
                serde_json::to_value(annual::annual_payment_rule_issues(&pkg)).unwrap()
            }
            "selection" => serde_json::to_value(selection::resolve_tariff_selection(
                &pkg,
                case["params"]["variant"].as_str().unwrap(),
                case["params"]["region"].as_str().unwrap(),
            ))
            .unwrap(),
            other => panic!("unknown {other}"),
        };
        let actual = json!({"value":output});
        let borrowed_output = match case["operation"].as_str().unwrap() {
            "selectionIssues" => {
                Some(serde_json::to_value(selection::tariff_selection_issues(&borrowed)).unwrap())
            }
            "trainingIssues" => {
                Some(serde_json::to_value(training::training_pay_issues(&borrowed)).unwrap())
            }
            "annualIssues" => {
                Some(serde_json::to_value(annual::annual_payment_rule_issues(&borrowed)).unwrap())
            }
            _ => None,
        };
        if let Some(output) = borrowed_output {
            assert_eq!(
                json!({"value":output}),
                case["expected"],
                "borrowed raw view {}",
                case["id"]
            );
        }
        if actual != case["expected"] {
            failures.push(format!(
                "{}\nactual {}\nexpected {}",
                case["id"], actual, case["expected"]
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} mismatches\n{}",
        failures.len(),
        failures
            .iter()
            .take(10)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n\n")
    );
}
