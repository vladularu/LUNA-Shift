use luna_engine::rules::RuleResolver;
use luna_engine::target::{self, InputStatus, TargetContext, TargetError, TargetProfile};
use serde_json::{Value, json};

fn evaluate(case: &Value, resolver: &RuleResolver) -> Value {
    let input: Value = serde_json::from_str(case["inputJson"].as_str().expect("raw oracle input"))
        .expect("input JSON");
    match case["operation"].as_str().unwrap() {
        "target" => {
            let computation = (|| {
                let profile: TargetProfile = serde_json::from_value(input["profile"].clone())
                    .map_err(|_| TargetError::InvalidInput)?;
                let context: Option<TargetContext> = input
                    .get("context")
                    .map(|context| serde_json::from_value(context.clone()))
                    .transpose()
                    .map_err(|_| TargetError::InvalidInput)?;
                target::calculate_monthly_working_time_target(
                    input["month"].as_str().unwrap(),
                    &profile,
                    resolver,
                    context.as_ref(),
                )
            })();
            match computation {
                Ok(value) => json!({"value":value}),
                Err(error) => {
                    json!({"error":{"name":"WorkingTimeTargetError","message":error.to_string()}})
                }
            }
        }
        "profile" => {
            let status: InputStatus = serde_json::from_value(input["status"].clone()).unwrap();
            let youth_status: InputStatus =
                serde_json::from_value(input["youthProtectionStatus"].clone()).unwrap();
            let value = target::profile::create_working_time_calculation_profile(
                &input["profile"],
                input.get("snapshot").filter(|s| !s.is_null()),
                input["history"].as_array().unwrap(),
                status,
                input["youthProtection"].as_bool(),
                youth_status,
            );
            match value {
                Ok(value) => json!({"value":value}),
                Err(error) => {
                    json!({"error":{"name":"WorkingTimeTargetError","message":error.to_string()}})
                }
            }
        }
        "contextValidation" => match target::validate_saved_target_context(&input["value"]) {
            Ok(value) => json!({"value":value}),
            Err(error) => {
                json!({"error":{"name":"WorkingTimeTargetError","message":error.to_string()}})
            }
        },
        "settingsValidation" => match target::validate_saved_target_settings(&input["value"]) {
            Ok(value) => json!({"value":value}),
            Err(error) => {
                json!({"error":{"name":"WorkingTimeTargetError","message":error.to_string()}})
            }
        },
        "planSignature" => match target::profile::target_plan_day_signature(
            input["timeZone"].as_str(),
            input["shifts"].as_array().unwrap(),
            input["date"].as_str().unwrap(),
            &input["context"],
            input["legacy"].as_bool().unwrap(),
        ) {
            Ok(value) => json!({"value":value}),
            Err(error) => {
                json!({"error":{"name":"WorkingTimeTargetError","message":error.to_string()}})
            }
        },
        "savedSnapshot" => match target::profile::project_saved_target_snapshot(
            input.get("saved").filter(|s| !s.is_null()),
            input["timeZone"].as_str(),
            input["shifts"].as_array().unwrap(),
        ) {
            Ok(value) => json!({"value":value}),
            Err(error) => {
                json!({"error":{"name":"WorkingTimeTargetError","message":error.to_string()}})
            }
        },
        other => panic!("Unknown fixture operation: {other}"),
    }
}

#[test]
fn frozen_target_and_profile_cases_match_exactly() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/target-golden.json")).unwrap();
    assert_eq!(
        fixture["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let resolver = RuleResolver::bundled().unwrap();
    let mut failures = vec![];
    for case in fixture["cases"].as_array().unwrap() {
        let actual = evaluate(case, &resolver);
        // Intentional malformed-input boundary policy: never echo arbitrary Temporal input.
        // The frozen oracle remains unchanged; this case is excluded from valid-output parity.
        if case["id"] == "profile-invalid-history-date" {
            assert_eq!(actual["error"]["name"], "WorkingTimeTargetError");
            assert_eq!(
                actual["error"]["message"],
                TargetError::InvalidInput.to_string()
            );
            continue;
        }
        if actual != case["expected"] {
            failures.push(format!(
                "{}\nactual: {}\nexpected: {}",
                case["id"], actual, case["expected"]
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} failed fixtures:\n{}",
        failures.len(),
        failures
            .iter()
            .take(12)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n\n")
    );
}

#[test]
fn profile_projection_retains_raw_order_sensitive_legacy_branches() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/target-golden.json")).unwrap();
    let resolver = RuleResolver::bundled().unwrap();
    for case in fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["id"].as_str().unwrap().starts_with("object-order-"))
    {
        assert_eq!(
            evaluate(case, &resolver),
            case["expected"],
            "{}",
            case["id"]
        );
    }
}

#[test]
fn ledger_sums_equal_monthly_totals_without_negative_rounding_drift() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/target-golden.json")).unwrap();
    let resolver = RuleResolver::bundled().unwrap();
    for case in fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["operation"] == "target")
    {
        let output = evaluate(case, &resolver);
        let Some(value) = output.get("value") else {
            continue;
        };
        let days = value["days"].as_array().unwrap();
        for field in [
            "baseMinutes",
            "statutoryReductionMinutes",
            "tariffReductionMinutes",
            "roundingMinutes",
        ] {
            let sum: i64 = days.iter().map(|d| d[field].as_i64().unwrap()).sum();
            assert_eq!(
                sum,
                value[field].as_i64().unwrap(),
                "{} {field}",
                case["id"]
            );
        }
        if let Some(target) = value["targetMinutes"].as_i64() {
            assert_eq!(
                days.iter()
                    .map(|d| d["targetMinutes"].as_i64().unwrap())
                    .sum::<i64>(),
                target,
                "{}",
                case["id"]
            );
        }
    }
}

#[test]
fn legacy_binding_upgrade_uses_external_modern_signature_and_never_reconfirms_stale_days() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/target-golden.json")).unwrap();
    let cases = fixture["cases"].as_array().unwrap();
    let signature_case = cases
        .iter()
        .find(|c| c["id"] == "signature-false-none-Europe/Berlin")
        .unwrap();
    let expected_signature = &signature_case["expected"]["value"];
    let saved_case = cases
        .iter()
        .find(|c| c["id"] == "saved-snapshot-1-false")
        .unwrap();
    let input: Value = serde_json::from_str(saved_case["inputJson"].as_str().unwrap()).unwrap();
    let proposed = target::profile::propose_unchanged_target_bindings(
        &input["saved"],
        input["timeZone"].as_str(),
        input["shifts"].as_array().unwrap(),
    )
    .unwrap()
    .unwrap();
    assert_eq!(
        &proposed["planBindings"][0]["signature"],
        expected_signature
    );
    assert_eq!(proposed["context"], input["saved"]["settings"]["context"]);
    let changed = cases
        .iter()
        .find(|c| c["id"] == "saved-snapshot-1-true")
        .unwrap();
    let input: Value = serde_json::from_str(changed["inputJson"].as_str().unwrap()).unwrap();
    assert!(
        target::profile::propose_unchanged_target_bindings(
            &input["saved"],
            input["timeZone"].as_str(),
            input["shifts"].as_array().unwrap()
        )
        .unwrap()
        .is_none()
    );
}

#[test]
fn modern_evidence_ignores_revision_only_metadata_and_retains_empty_context_distinction() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/target-golden.json")).unwrap();
    let cases = fixture["cases"].as_array().unwrap();
    let case = cases
        .iter()
        .find(|c| c["id"] == "saved-snapshot-9-false")
        .unwrap();
    let mut input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
    input["shifts"][0]["revision"] = json!(99);
    input["shifts"][0]["updated_at"] = json!("2026-11-13T00:00:00Z");
    let snapshot = target::profile::project_saved_target_snapshot(
        Some(&input["saved"]),
        input["timeZone"].as_str(),
        input["shifts"].as_array().unwrap(),
    )
    .unwrap();
    assert_eq!(snapshot["staleDates"], json!([]));
    assert_eq!(snapshot["context"], case["expected"]["value"]["context"]);
    let absent = target::profile::project_saved_target_snapshot(None, None, &[]).unwrap();
    assert!(absent.get("context").is_none());
    assert_eq!(absent["saved"], Value::Null);
}

#[test]
fn required_nullable_confirmation_is_not_missing_confirmation() {
    let valid = json!({"kind":"TVUK_NURSING","version":"2025-01-01","scopeConfirmed":null,"accountRuleConfirmed":null});
    assert!(serde_json::from_value::<target::TargetTariff>(valid.clone()).is_ok());
    for key in ["scopeConfirmed", "accountRuleConfirmed"] {
        let mut missing = valid.clone();
        missing.as_object_mut().unwrap().remove(key);
        assert!(serde_json::from_value::<target::TargetTariff>(missing).is_err());
    }
    let missing = json!({"kind":"ROTATING_FIVE_IN_SEVEN","monthlyReference":"WEEKDAYS_ONE_FIFTH"});
    assert!(serde_json::from_value::<target::WorkModel>(missing).is_err());
}
