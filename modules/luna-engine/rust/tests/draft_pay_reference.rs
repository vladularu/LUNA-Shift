use luna_engine::{
    remuneration::draft_pay::{
        annex::{AnnexPremiumInput, calculate_annex_a_time_premiums},
        sue::{SueAllowanceInput, calculate_sue_draft_allowance},
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
            format!("{p}: lengths {} vs {}", a.len(), e.len())
        }
        _ => format!("{p}: actual {a}; expected {e}"),
    }
}
#[test]
fn isolated_annex_premiums_and_sue_allowance_cash_match_frozen_source() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/draft-pay-golden.json")).unwrap();
    assert_eq!(
        data["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let packages: BTreeMap<String, RulePackage> = data["packageJson"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(key, p)| {
            (
                key.clone(),
                serde_json::from_str(p.as_str().unwrap()).unwrap(),
            )
        })
        .collect();
    let mut failures = vec![];
    let mut checked = 0;
    for case in data["cases"].as_array().unwrap() {
        let raw: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let pkg = &packages[case["key"].as_str().unwrap()];
        let result = if case["operation"] == "annex" {
            calculate_annex_a_time_premiums(
                pkg,
                &AnnexPremiumInput {
                    month: raw["month"].as_str().unwrap(),
                    variant_id: raw["variantId"].as_str().unwrap(),
                    group_id: raw["groupId"].as_str().unwrap(),
                    full_time_weekly_minutes: raw["fullTimeWeeklyMinutes"].as_f64().unwrap(),
                    full_time_reference_confirmed: raw["fullTimeReferenceConfirmed"]
                        .as_bool()
                        .unwrap(),
                    applicability_confirmed: raw["applicabilityConfirmed"].as_bool().unwrap(),
                    work_data_complete: raw["workDataComplete"].as_bool().unwrap(),
                    cash_payment_confirmed: raw["cashPaymentConfirmed"].as_bool().unwrap(),
                    local_agreement: raw["localAgreement"].as_str().unwrap(),
                    worked_slices: raw["workedSlices"].as_array().unwrap(),
                },
            )
            .map(|v| serde_json::to_value(v).unwrap())
        } else {
            let input: SueAllowanceInput = serde_json::from_value(raw).unwrap();
            calculate_sue_draft_allowance(pkg, &input).map(|v| serde_json::to_value(v).unwrap())
        };
        let actual = match result {
            Ok(value) => json!({"value":value}),
            Err(e) => json!({"error":{"name":"Error","message":e.to_string()}}),
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
    assert!(checked >= 6300);
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
    eprintln!("Draft cash components:{checked} exact source outputs/errors");
}
