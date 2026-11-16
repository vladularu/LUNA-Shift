use luna_engine::{
    remuneration::draft_facts::{
        DraftFactsError,
        model::ConfirmationKind,
        month::is_current_confirmation,
        prepared::DraftConfirmationOwner,
        resolve::{resolve_saved_annex_a_month_confirmation, resolve_saved_sue_month_confirmation},
    },
    rules::{PackageIds, RuleResolver},
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc};
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
fn strict_saved_annex_sue_facts_and_native_month_resolution_match_source() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/draft-facts-golden.json")).unwrap();
    assert_eq!(
        data["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let mut resolvers: BTreeMap<String, RuleResolver> = data["packages"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(key, p)| {
            let p: Value = serde_json::from_str(p.as_str().unwrap()).unwrap();
            let tariff = p["packageId"].as_str().unwrap().into();
            (
                key.clone(),
                RuleResolver::from_catalog_json(
                    json!({"tariff":[p],"legal":[],"holiday":[]}),
                    PackageIds {
                        tariff,
                        legal: "missing".into(),
                        holiday: "missing".into(),
                    },
                    None,
                )
                .unwrap(),
            )
        })
        .collect();
    resolvers.insert(
        "missing".into(),
        RuleResolver::from_catalog_json(
            json!({"tariff":[],"legal":[],"holiday":[]}),
            PackageIds {
                tariff: "missing".into(),
                legal: "missing".into(),
                holiday: "missing".into(),
            },
            None,
        )
        .unwrap(),
    );
    let mut failures = vec![];
    let mut checked = 0;
    let mut safe_rejections = 0;
    for case in data["cases"].as_array().unwrap() {
        let raw: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let kind = match case["family"].as_str().unwrap() {
            "annex" => ConfirmationKind::AnnexA,
            "sue" => ConfirmationKind::SueMonth,
            _ => ConfirmationKind::SueAllowance,
        };
        let result: Result<Value, DraftFactsError> = (|| {
            Ok(match case["operation"].as_str().unwrap() {
                "validate" => {
                    let owner =
                        DraftConfirmationOwner::new(kind, Arc::new(vec![raw["value"].clone()]))?;
                    serde_json::to_value(&owner.views()[0]).unwrap()
                }
                "current" => {
                    let owner =
                        DraftConfirmationOwner::new(kind, Arc::new(vec![raw["value"].clone()]))?;
                    json!(is_current_confirmation(
                        &owner.views()[0],
                        &raw["profile"],
                        raw["version"].as_str().unwrap()
                    )?)
                }
                _ => {
                    let owner = DraftConfirmationOwner::new(
                        kind,
                        Arc::new(raw["saved"].as_array().unwrap().clone()),
                    )?;
                    let saved = owner.views();
                    let month = raw["month"].as_str().unwrap();
                    let history = raw["history"].as_array().unwrap();
                    let resolver = &resolvers[case["key"].as_str().unwrap()];
                    if kind == ConfirmationKind::AnnexA {
                        serde_json::to_value(resolve_saved_annex_a_month_confirmation(
                            month, history, &saved, resolver,
                        )?)
                        .unwrap()
                    } else {
                        serde_json::to_value(resolve_saved_sue_month_confirmation(
                            month, history, &saved, resolver,
                        )?)
                        .unwrap()
                    }
                }
            })
        })();
        if case["expected"]["error"]["name"] == "TypeError" {
            assert!(
                matches!(result, Err(DraftFactsError::InvalidProfile)),
                "{} malformed profile must be safely rejected",
                case["id"]
            );
            safe_rejections += 1;
            continue;
        }
        let actual = match result {
            Ok(v) => json!({"value":v}),
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
    assert!(checked >= 1400);
    assert_eq!(safe_rejections, 3);
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
        "Draft facts: {checked} exact source results, {safe_rejections} safe malformed-profile rejections"
    );
}
