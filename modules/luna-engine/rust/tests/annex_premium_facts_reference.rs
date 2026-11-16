use luna_engine::remuneration::draft_facts::{
    DraftFactsError,
    premium::{is_current_premium_facts, shift_binding},
    prepared::AnnexPremiumOwner,
};
use serde_json::{Value, json};
use std::sync::Arc;
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
fn strict_annex_premium_evidence_content_binding_and_freshness_match_source() {
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/annex-premium-facts-golden.json"
    ))
    .unwrap();
    assert_eq!(
        data["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let mut failures = vec![];
    let mut checked = 0;
    let mut rejected = 0;
    for case in data["cases"].as_array().unwrap() {
        let raw: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let result: Result<Value, DraftFactsError> = (|| {
            Ok(match case["operation"].as_str().unwrap() {
                "binding" => json!(shift_binding(
                    &raw["shift"],
                    raw["timeZone"].as_str().unwrap()
                )?),
                "current" => {
                    let owner = AnnexPremiumOwner::new(Arc::new(vec![raw["value"].clone()]))?;
                    json!(is_current_premium_facts(
                        &owner.views()[0],
                        &raw["profile"],
                        raw["version"].as_str().unwrap()
                    )?)
                }
                _ => {
                    let owner = AnnexPremiumOwner::new(Arc::new(vec![raw["value"].clone()]))?;
                    serde_json::to_value(&owner.views()[0]).unwrap()
                }
            })
        })();
        if case["expected"]["error"]["name"] == "TypeError" {
            assert!(
                matches!(result, Err(DraftFactsError::InvalidProfile)),
                "{} must safely reject malformed profile",
                case["id"]
            );
            rejected += 1;
            continue;
        }
        let actual = match result {
            Ok(value) => json!({"value":value}),
            Err(e) => json!({"error":{"name":e.class_name(),"message":e.to_string()}}),
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
    assert!(checked >= 680);
    assert_eq!(rejected, 1);
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
    eprintln!(
        "Annex premium evidence: {checked} exact source results, {rejected} safe malformed-profile rejection"
    );
}
