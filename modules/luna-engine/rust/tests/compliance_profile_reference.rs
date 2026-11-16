use bigdecimal::BigDecimal;
use luna_engine::{
    calendar::recurrence::CollationRanks,
    compliance::{
        dated::{self, PreparedDatedComplianceSource},
        profile::ComplianceProfile,
    },
    rules::RuleResolver,
};
use serde_json::{Value, json};
use std::str::FromStr;
use std::{collections::BTreeMap, sync::Arc};
fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => {
            BigDecimal::from_str(&a.to_string()).unwrap()
                == BigDecimal::from_str(&b.to_string()).unwrap()
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len() && a.iter().all(|(k, v)| b.get(k).is_some_and(|b| same(v, b)))
        }
        _ => a == b,
    }
}
#[test]
fn complete_monthly_compliance_uses_borrowed_effective_basis_and_original_target_context() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../reference/compliance-profile-golden.json"
    ))
    .unwrap();
    assert_eq!(
        fixture["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let mut resolvers = BTreeMap::new();
    for c in fixture["catalogs"].as_array().unwrap() {
        let id = c["id"].as_str().unwrap();
        resolvers.insert(
            id,
            if id == "bundled" {
                RuleResolver::bundled().unwrap()
            } else {
                RuleResolver::from_catalog_json(
                    c["packages"].clone(),
                    serde_json::from_value(c["selections"].clone()).unwrap(),
                    None,
                )
                .unwrap()
            },
        );
    }
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 869);
    for case in cases {
        let i: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let ranks: CollationRanks = serde_json::from_value(i["collationRanks"].clone()).unwrap();
        let source = PreparedDatedComplianceSource::new(
            Arc::from(i["shifts"].as_array().unwrap().clone()),
            ranks,
        );
        let basis = ComplianceProfile::at(&i["profile"], i["basisDate"].as_str().unwrap()).unwrap();
        let zone = basis.get("timeZone").and_then(Value::as_str).unwrap();
        if let Some(target) = i["profile"].get("workingTimeTarget") {
            assert!(std::ptr::eq(
                target,
                basis.get("workingTimeTarget").unwrap()
            ));
        }
        let mut options = i["options"].clone();
        for key in [
            "federalState",
            "holidayRegion",
            "weeklyMinutes",
            "regularRotatingNightWork",
            "sundayHolidayWorkEligible",
            "allEmploymentWorkRecorded",
        ] {
            if let Some(value) = basis.get(key) {
                options
                    .as_object_mut()
                    .unwrap()
                    .insert(key.into(), value.clone());
            } else {
                options.as_object_mut().unwrap().remove(key);
            }
        }
        let actual = dated::calculate_monthly_compliance_with_basis(
            i["month"].as_str().unwrap(),
            &source,
            zone,
            &options,
            "2026-07-15",
            &resolvers[i["catalogRef"].as_str().unwrap()],
            basis,
        );
        let actual = match actual {
            Ok(v) => v.into_json(),
            Err(e) => json!({"$error":{"name":e.source_error_name(),"message":e.to_string()}}),
        };
        assert!(
            same(&actual, &case["expected"]),
            "{}\nactual {actual}\nexpected {}",
            case["id"],
            case["expected"]
        );
    }
}
