use luna_engine::{
    remuneration::{
        annual::{
            coverage::missing_tariff_annual_claims, tariff::calculate_tariff_annual_payments,
        },
        tariff_annual::{
            claim::validate_tariff_annual_claim,
            saved::{
                validate_actual_tariff_annual_payment, validate_saved_tariff_annual_claim,
                validate_saved_tariff_annual_claims,
            },
            selection::{AnnualTariffSelection, select_annual_tariff},
        },
    },
    rules::{PackageIds, RuleResolver},
};
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn data() -> Value {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/saved-annual-golden.json")).unwrap();
    assert_eq!(
        data["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    data
}
fn resolver(data: &Value, track: &str, ranks: bool) -> RuleResolver {
    let rows: Vec<Value> = data["tracks"][track]["ids"]
        .as_array()
        .unwrap()
        .iter()
        .map(|id| {
            serde_json::from_str(data["packageJson"][id.as_str().unwrap()].as_str().unwrap())
                .unwrap()
        })
        .collect();
    let tariff = rows
        .first()
        .and_then(|r| r["packageId"].as_str())
        .unwrap_or("missing")
        .to_owned();
    let resolver = RuleResolver::from_catalog_json(
        json!({"tariff":rows,"legal":[],"holiday":[]}),
        PackageIds {
            tariff,
            legal: "missing".into(),
            holiday: "missing".into(),
        },
        None,
    )
    .unwrap();
    if ranks {
        resolver.with_collation_ranks(
            serde_json::from_value(data["tracks"][track]["collationRanks"].clone()).unwrap(),
        )
    } else {
        resolver
    }
}
fn error(name: &str, message: String) -> Value {
    json!({"error":{"name":name,"message":message}})
}
fn execute(case: &Value, resolver: &RuleResolver) -> Value {
    let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
    match case["operation"].as_str().unwrap() {
        "validateActual" => match validate_actual_tariff_annual_payment(&input["value"]) {
            Ok(v) => json!({"value":v}),
            Err(e) => error(e.class_name(), e.to_string()),
        },
        "validateSaved" => match validate_saved_tariff_annual_claim(&input["value"]) {
            Ok(v) => json!({"value":v}),
            Err(e) => error(e.class_name(), e.to_string()),
        },
        "validateAll" => match validate_saved_tariff_annual_claims(&input["value"]) {
            Ok(v) => json!({"value":v}),
            Err(e) => error(e.class_name(), e.to_string()),
        },
        "select" => {
            let claim = validate_tariff_annual_claim(&input["claim"]).unwrap();
            match select_annual_tariff(claim.data().year, &claim.data().selection, resolver) {
                Ok(AnnualTariffSelection::Selected {
                    package,
                    rule,
                    versions,
                }) => {
                    json!({"value":{"ok":true,"package":{"packageId":package.package_id,"versionId":package.version_id,"validFrom":package.valid_from,"validTo":package.valid_to},"rule":rule,"versions":versions.iter().map(|p|&p.version_id).collect::<Vec<_>>()}})
                }
                Ok(AnnualTariffSelection::Unavailable { code }) => {
                    json!({"value":{"ok":false,"code":code}})
                }
                Err(e) => error(e.class_name(), e.to_string()),
            }
        }
        operation => {
            let saved = validate_saved_tariff_annual_claims(&input["saved"]).unwrap();
            let result = if operation == "cash" {
                calculate_tariff_annual_payments(input["month"].as_str().unwrap(), &saved, resolver)
            } else {
                missing_tariff_annual_claims(
                    input["month"].as_str().unwrap(),
                    input["history"].as_array().unwrap(),
                    &saved,
                    resolver,
                )
            };
            match result {
                Ok(v) => json!({"value":v}),
                Err(e) => error(e.class_name(), e.to_string()),
            }
        }
    }
}
fn difference(a: &Value, e: &Value, p: &str) -> String {
    match (a, e) {
        (Value::Object(a), Value::Object(e)) => {
            for (k, v) in e {
                if a.get(k) != Some(v) {
                    return difference(a.get(k).unwrap_or(&Value::Null), v, &format!("{p}.{k}"));
                }
            }
            format!("{p}:object keys")
        }
        (Value::Array(a), Value::Array(e)) => {
            for (i, (a, e)) in a.iter().zip(e).enumerate() {
                if a != e {
                    return difference(a, e, &format!("{p}[{i}]"));
                }
            }
            format!("{p}:lengths {} vs {}", a.len(), e.len())
        }
        _ => format!("{p}: actual {a}; expected {e}"),
    }
}
#[test]
fn saved_claim_selection_cash_month_and_missing_coverage_match_raw_source() {
    let data = data();
    let resolvers: BTreeMap<String, RuleResolver> = data["tracks"]
        .as_object()
        .unwrap()
        .keys()
        .map(|name| (name.clone(), resolver(&data, name, true)))
        .collect();
    let mut failures = vec![];
    let mut checked = 0;
    for case in data["cases"].as_array().unwrap() {
        let actual = execute(case, &resolvers[case["track"].as_str().unwrap()]);
        checked += 1;
        if actual != case["expected"] {
            failures.push(format!(
                "{} {}",
                case["id"],
                difference(&actual, &case["expected"], "$")
            ));
        }
    }
    assert!(checked >= 1190, "Saved annual corpus incomplete");
    assert!(
        failures.is_empty(),
        "{} mismatches\n{}",
        failures.len(),
        failures
            .iter()
            .take(20)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n\n")
    );
    eprintln!("Saved annual: {checked} exact source outputs/errors");
}
#[test]
fn annual_version_ties_require_admitted_native_locale_ranks() {
    let data = data();
    let case = data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["operation"] == "select" && case["track"] == "locale-tie-0-tie-1")
        .unwrap();
    let result = execute(
        case,
        &resolver(&data, case["track"].as_str().unwrap(), false),
    );
    assert_eq!(result["error"]["message"], "Missing native collation rank");
    // Locale-equivalent distinct IDs must retain original catalog order in both directions.
    for track in ["locale-tie-6-tie-7", "locale-tie-7-tie-6"] {
        let case = data["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["operation"] == "select" && c["track"] == track)
            .unwrap();
        assert_eq!(
            execute(case, &resolver(&data, track, true)),
            case["expected"]
        );
    }
}
