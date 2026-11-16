use luna_engine::remuneration::{
    Presence, RemunerationError, care, own_config,
    profile::{self, Selection},
};
use serde_json::{Value, json};
fn evaluate(case: &Value) -> Value {
    let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
    let v = &input["value"];
    let result: Result<Value, RemunerationError> = match case["operation"].as_str().unwrap() {
        "profile" => profile::validate_profile(v).map(|r| serde_json::to_value(r).unwrap()),
        "own" => {
            own_config::validate_own_configuration(v).map(|r| serde_json::to_value(r).unwrap())
        }
        "tvlCare" => care::validate_tvl_care(v).map(|r| serde_json::to_value(r).unwrap()),
        "tvalCare" => care::validate_tval_care(v).map(|r| serde_json::to_value(r).unwrap()),
        "legacy" => profile::remuneration_from_legacy(v).map(|r| serde_json::to_value(r).unwrap()),
        other => panic!("unknown operation {other}"),
    };
    match result {
        Ok(value) => json!({"value":value}),
        Err(error) => json!({"error":{"name":error.class_name(),"message":error.to_string()}}),
    }
}
#[test]
fn complete_dated_profile_and_own_configuration_match_frozen_source() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../reference/remuneration-profile-golden.json"
    ))
    .unwrap();
    assert_eq!(
        fixture["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let failures: Vec<_> = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|case| {
            let actual = evaluate(case);
            (actual != case["expected"]).then(|| {
                format!(
                    "{}\nactual {}\nexpected {}",
                    case["id"], actual, case["expected"]
                )
            })
        })
        .collect();
    assert!(
        failures.is_empty(),
        "{} failed\n{}",
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
fn care_missing_unknown_and_confirmed_none_remain_distinct() {
    let v = json!({"paidEntitlement":null,"nursing":null,"instructor":null,"clinical":null,"leadershipAnnexFNumber":null,"burnCare":null});
    let missing = care::validate_tvl_care(&v).unwrap().unwrap();
    assert!(matches!(missing.function_duty, Presence::Missing));
    assert!(
        serde_json::to_value(&missing)
            .unwrap()
            .get("functionDuty")
            .is_none()
    );
    let mut explicit = v.clone();
    explicit["functionDuty"] = Value::Null;
    assert!(matches!(
        care::validate_tvl_care(&explicit)
            .unwrap()
            .unwrap()
            .function_duty,
        Presence::Null
    ));
    explicit["functionDuty"] = json!("NONE");
    assert!(matches!(
        care::validate_tvl_care(&explicit)
            .unwrap()
            .unwrap()
            .function_duty,
        Presence::Value(care::FunctionDuty::None)
    ));
    let p = profile::validate_profile(
        &json!({"version":1,"weeklyMinutes":2310,"selection":{"kind":"unconfigured"}}),
    )
    .unwrap();
    assert!(matches!(p.selection(), Selection::Unconfigured));
}
