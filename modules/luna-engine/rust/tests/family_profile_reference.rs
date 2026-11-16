use luna_engine::pay::families::profile::*;
use serde_json::{Value, json};

#[test]
fn strict_family_selections_levels_and_missing_metadata_match_frozen_ts() {
    let reference: Value =
        serde_json::from_str(include_str!("../../reference/family-profile-golden.json"))
            .expect("frozen family profile facts");
    let cases = reference["cases"].as_array().expect("cases");
    assert_eq!(cases.len(), 1054);
    for case in cases {
        let input = &case["input"];
        let result = match case["operation"].as_str().expect("family") {
            "VKA" => require_vka_e_tariff(input),
            "TRAINING" => require_nursing_training_tariff(input),
            "TVL" => require_tvl_kr_salary_tariff(input),
            "TVL_BASE" => require_tvl_kr_tariff(input),
            "TVH" => require_tvh_kr_tariff(input),
            "TVUK" => require_tvuk_nursing_tariff(input),
            "TVAL" => require_tval_pflege_tariff(input),
            other => panic!("unknown family {other}"),
        };
        let actual = match result {
            Ok(value) => value.unwrap_or(Value::Null),
            Err(error) => json!({"$error":error.to_string()}),
        };
        assert_eq!(actual, case["expected"], "{}", case["id"]);
    }
    for row in reference["levels"].as_array().expect("levels") {
        let group = row["group"].as_str().expect("group");
        let actual = match row["operation"].as_str().expect("family") {
            "VKA" => json!(e_pay_levels(group)),
            "TVL" => json!(tvl_kr_levels_for_group(group)),
            "TVH" => json!(tvh_kr_levels_for_group(group)),
            "TVUK" => json!(tvuk_levels_for_group(group)),
            other => panic!("unknown levels {other}"),
        };
        assert_eq!(actual, row["expected"], "{row}");
    }
    for row in reference["fullTime"].as_array().expect("fulltime") {
        assert_eq!(
            json!(tariff_full_time_weekly_minutes(
                row["sector"].as_str().expect("sector"),
                row["region"].as_str().expect("region")
            )),
            row["expected"]
        );
    }
    for (name, groups) in [
        ("VKA", VKA_E_GROUPS),
        ("TVL", TVL_KR_GROUPS),
        ("TVH", TVH_KR_GROUPS),
        ("TVUK", TVUK_NURSING_GROUPS),
    ] {
        assert_eq!(json!(groups), reference["groups"][name]);
    }
}
