use luna_engine::{
    remuneration::tariff_annual::{
        TariffAnnualError, basis::tariff_annual_basis, claim::validate_tariff_annual_claim,
        eligibility::tariff_annual_eligibility, model::AnnualCalculationRule,
        payment::calculate_tariff_annual_claim,
    },
    rules::RulePackage,
};
use serde_json::{Value, json};
use std::collections::BTreeMap;
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
            format!("{p}:lengths {} vs{}", a.len(), e.len())
        }
        _ => format!("{p}:actual {a}; expected {e}"),
    }
}
#[test]
fn checked_tariff_annual_claim_eligibility_bigint_basis_and_amount_match_source() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/tariff-annual-golden.json")).unwrap();
    assert_eq!(
        data["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let packages: BTreeMap<String, RulePackage> = data["packageJson"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, p)| {
            (
                k.clone(),
                serde_json::from_str(p.as_str().unwrap()).unwrap(),
            )
        })
        .collect();
    let mut failures = vec![];
    let mut checked = 0;
    for case in data["cases"].as_array().unwrap() {
        let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let result: Result<Value, TariffAnnualError> = (|| {
            if case["operation"] == "estimate" {
                return calculate_tariff_annual_claim(
                    &packages[case["key"].as_str().unwrap()],
                    &input["claim"],
                )
                .map(|r| serde_json::to_value(r).unwrap());
            }
            let claim = validate_tariff_annual_claim(&input["claim"])?;
            if case["operation"] == "validate" {
                return Ok(serde_json::to_value(claim).unwrap());
            }
            let rule = AnnualCalculationRule::from_json(&input["rule"])?;
            let eligibility = tariff_annual_eligibility(&claim, &rule)?;
            if case["operation"] == "eligibility" {
                return Ok(serde_json::to_value(eligibility).unwrap());
            }
            let result = tariff_annual_basis(&claim, &rule, &eligibility)?;
            let basis=result.basis.map(|b|json!({"numerator":b.numerator.to_string(),"denominator":b.denominator.to_string(),"method":b.method,"months":b.months}));
            Ok(json!({"basis":basis,"missing":result.missing}))
        })();
        let actual = match result {
            Ok(v) => json!({"value":v}),
            Err(error) => json!({"error":{"name":error.class_name(),"message":error.to_string()}}),
        };
        checked += 1;
        if actual != case["expected"] {
            failures.push(format!(
                "{} {}",
                case["id"],
                difference(&actual, &case["expected"], "$")
            ));
        }
    }
    assert!(checked >= 13_000, "Tariff annual core corpus is incomplete");
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
    eprintln!("Tariff annual core:{checked} exact raw source outputs/errors");
}
