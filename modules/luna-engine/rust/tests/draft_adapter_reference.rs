use luna_engine::{
    remuneration::{
        base::calculation::SueMonthConfirmation,
        draft_facts::{
            model::ConfirmationKind, month::validate_saved_draft_confirmation,
            premium::validate_saved_annex_a_premium_facts,
        },
        draft_pay::{
            DraftPayError,
            from_work::{AnnexFromWorkInput, calculate_annex_a_time_premiums_from_work},
            saved::{
                SavedAnnexPremiumInput, calculate_saved_annex_a_time_premiums,
                calculate_saved_sue_allowance_position,
            },
        },
    },
    rules::{RulePackage, RuleResolver},
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
fn raw_work_and_saved_annex_sue_cash_adapters_match_source_without_ts_computed_inputs() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/draft-adapter-golden.json")).unwrap();
    assert_eq!(
        data["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let packages: BTreeMap<String, RulePackage> = data["packages"]
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
    let resolvers: BTreeMap<String, RuleResolver> = data["resolverData"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, d)| {
            (
                k.clone(),
                RuleResolver::new(
                    serde_json::from_value(d["catalog"].clone()).unwrap(),
                    serde_json::from_value(d["packageIds"].clone()).unwrap(),
                    if d["historical"].is_null() {
                        None
                    } else {
                        Some(serde_json::from_value(d["historical"].clone()).unwrap())
                    },
                )
                .unwrap(),
            )
        })
        .collect();
    assert!(!resolvers["preview"].is_bundled());
    assert!(!resolvers["equalCustom"].is_bundled());
    let mut failures = vec![];
    let mut checked = 0;
    for case in data["cases"].as_array().unwrap() {
        let raw: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let resolver = &resolvers[case["resolverRef"].as_str().unwrap()];
        let result: Result<Value, DraftPayError> = (|| {
            Ok(match case["operation"].as_str().unwrap() {
                "fromWork" => calculate_annex_a_time_premiums_from_work(
                    &packages["annex"],
                    &AnnexFromWorkInput {
                        month: raw["month"].as_str().unwrap(),
                        variant_id: raw["variantId"].as_str().unwrap(),
                        group_id: raw["groupId"].as_str().unwrap(),
                        full_time_weekly_minutes: raw["fullTimeWeeklyMinutes"].as_f64().unwrap(),
                        full_time_reference_confirmed: raw["fullTimeReferenceConfirmed"]
                            .as_bool()
                            .unwrap(),
                        applicability_confirmed: raw["applicabilityConfirmed"].as_bool().unwrap(),
                        cash_payment_confirmed: raw["cashPaymentConfirmed"].as_bool().unwrap(),
                        local_agreement: raw["localAgreement"].as_str().unwrap(),
                        shifts: raw["shifts"].as_array().unwrap(),
                        pause_details: raw["pauseDetails"].as_array().unwrap(),
                        work_profile: &raw["workProfile"],
                        entries_complete: raw["entriesComplete"].as_bool().unwrap(),
                        day_decisions: raw["dayDecisions"].as_array().unwrap(),
                    },
                    resolver,
                )?,
                "savedAnnex" => {
                    let months = raw["savedMonthConfirmations"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|v| validate_saved_draft_confirmation(v, ConfirmationKind::AnnexA))
                        .collect::<Result<Vec<_>, _>>()?;
                    let facts = raw["savedPremiumFacts"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(validate_saved_annex_a_premium_facts)
                        .collect::<Result<Vec<_>, _>>()?;
                    serde_json::to_value(calculate_saved_annex_a_time_premiums(
                        &SavedAnnexPremiumInput {
                            month: raw["month"].as_str().unwrap(),
                            shifts: raw["shifts"].as_array().unwrap(),
                            work_profile: &raw["workProfile"],
                            history: raw["history"].as_array().unwrap(),
                            saved_month_confirmations: &months,
                            saved_premium_facts: &facts,
                            pause_details: raw["pauseDetails"].as_array().unwrap(),
                            entries_complete: raw["entriesComplete"].as_bool().unwrap(),
                            pause_details_complete: raw["pauseDetailsComplete"].as_bool().unwrap(),
                        },
                        resolver,
                    )?)
                    .unwrap()
                }
                _ => {
                    let saved = raw["saved"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|v| {
                            validate_saved_draft_confirmation(v, ConfirmationKind::SueAllowance)
                        })
                        .collect::<Result<Vec<_>, _>>()?;
                    let base: Option<SueMonthConfirmation> =
                        serde_json::from_value(raw["baseConfirmation"].clone()).unwrap();
                    serde_json::to_value(calculate_saved_sue_allowance_position(
                        raw["month"].as_str().unwrap(),
                        raw["history"].as_array().unwrap(),
                        &saved,
                        base.as_ref(),
                        resolver,
                    )?)
                    .unwrap()
                }
            })
        })();
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
    assert!(checked >= 625);
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
    eprintln!("Raw draft adapters:{checked} exact source outputs/errors");
}
