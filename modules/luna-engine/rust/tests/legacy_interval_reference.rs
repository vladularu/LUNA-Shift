use luna_engine::{
    pay::legacy_interval::{self, IntervalError, TimePremiumInterval},
    rules::{PackageIds, RuleResolver},
};
use serde_json::{Value, json};
#[test]
fn full_interval_cash_and_single_pass_evidence_match_frozen_source() {
    let f: Value =
        serde_json::from_str(include_str!("../../reference/legacy-interval-golden.json")).unwrap();
    assert_eq!(
        f["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let mut resolvers = std::collections::BTreeMap::new();
    for (id, spec) in f["resolvers"].as_object().unwrap() {
        let resolver = if spec["bundled"] == true {
            RuleResolver::bundled().unwrap()
        } else {
            RuleResolver::from_catalog_json(
                spec["catalog"].clone(),
                serde_json::from_value::<PackageIds>(spec["packageIds"].clone()).unwrap(),
                None,
            )
            .unwrap()
        };
        resolvers.insert(id.clone(), resolver);
    }
    let mut failures = vec![];
    for case in f["cases"].as_array().unwrap() {
        let i: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let resolver = resolvers
            .get(i["resolver"].as_str().unwrap_or("bundled"))
            .unwrap();
        let interval: TimePremiumInterval = serde_json::from_value(i["interval"].clone()).unwrap();
        let value = if i["capture"] == true {
            legacy_interval::calculate_time_premium_interval_with_evidence(&i["shift"],&i["profile"],resolver,&interval,i["requestedPackage"].as_str()).map(|r|json!({"breakdown":r.breakdown,"counted":r.classified.counted.iter().map(|m|json!({"ruleId":m.rule_id,"epochMilliseconds":m.epoch_milliseconds})).collect::<Vec<_>>()}))
        } else {
            legacy_interval::calculate_time_premium_interval(
                &i["shift"],
                &i["profile"],
                resolver,
                &interval,
                i["requestedPackage"].as_str(),
            )
            .map(|r| serde_json::to_value(r).unwrap())
        };
        let actual = match value {
            Ok(value) => json!({"value":value}),
            Err(e) => {
                let mut value = json!({"error":{"name":if matches!(e,IntervalError::MissingRate){"PremiumRuleDataError"}else if e.rule_failure().is_some(){"RuleResolutionError"}else{"Error"},"message":e.to_string()}});
                if let Some(f) = e.rule_failure() {
                    value["error"]["failure"] = serde_json::to_value(f).unwrap();
                }
                value
            }
        };
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
            .take(12)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n\n")
    );
}
