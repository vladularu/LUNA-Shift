use luna_engine::compliance::checks::{self, CheckCounts};
use serde_json::Value;
fn counts(value: &Value) -> CheckCounts {
    CheckCounts {
        critical_count: value["criticalCount"].as_u64().unwrap(),
        warning_count: value["warningCount"].as_u64().unwrap(),
        info_count: value["infoCount"].as_u64().unwrap(),
        prerequisite_count: value["prerequisiteCount"].as_u64(),
        tariff_prerequisite_count: value["tariffPrerequisiteCount"].as_u64(),
        scope_count: value["scopeCount"].as_u64(),
    }
}
#[test]
fn native_taxonomy_counts_and_complete_report_reprojections_match_original_source() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/check-display-golden.json")).unwrap();
    assert_eq!(
        fixture["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let cases = fixture["cases"].as_array().unwrap();
    assert!(cases.len() > 1000);
    for case in cases {
        let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let actual = match case["operation"].as_str().unwrap() {
            "count" => {
                serde_json::to_value(checks::count_checks(input["issues"].as_array().unwrap()))
                    .unwrap()
            }
            "classify" => {
                serde_json::to_value(checks::classify_checks(input["issues"].as_array().unwrap()))
                    .unwrap()
            }
            "visible" => checks::select_visible_compliance(
                &input["report"],
                input["showPlanning"].as_bool().unwrap(),
            )
            .unwrap(),
            "annual" => checks::select_annual_check_display(
                &input["report"],
                input["showPlanning"].as_bool().unwrap(),
            )
            .unwrap(),
            "limited" => Value::Bool(checks::is_check_limited(&counts(&input["counts"]))),
            "add" => serde_json::to_value(
                checks::add_check_counts(&counts(&input["a"]), &counts(&input["b"])).unwrap(),
            )
            .unwrap(),
            other => panic!("Unknown reference operation {other}"),
        };
        assert_eq!(actual, case["expected"], "{}", case["id"]);
    }
}
