use luna_engine::compliance::planning_weekends::check_planning_weekends;
use serde_json::{Value, json};
#[test]
fn full_raw_weekend_assessments_and_findings_match_frozen_typescript() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../reference/compliance-weekend-golden.json"
    ))
    .unwrap();
    assert_eq!(
        fixture["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 171);
    for case in cases {
        let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let actual = match check_planning_weekends(
            input["month"].as_str().unwrap(),
            input["shifts"].as_array().unwrap(),
            input["timeZone"].as_str().unwrap(),
            &input["options"],
        ) {
            Ok(v) => v,
            Err(e) => json!({"$error":{"name":e.source_error_name(),"message":e.to_string()}}),
        };
        assert_eq!(actual, case["expected"], "{}", case["id"]);
    }
}
