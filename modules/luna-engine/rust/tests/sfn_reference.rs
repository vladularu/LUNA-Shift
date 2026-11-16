use luna_engine::net::{
    CalculationMode,
    sfn::{calculate_monthly_net_pay_with_sfn, classify_sfn_payroll_2026},
};
use luna_engine::rules::{PackageIds, RuleResolver};
use serde_json::Value;

fn resolver(reference: &Value) -> RuleResolver {
    let catalog = reference["catalogs"]
        .as_array()
        .expect("catalogs")
        .iter()
        .find(|catalog| catalog["id"] == "bundled")
        .expect("bundled frozen catalog");
    RuleResolver::from_catalog_json(
        catalog["packages"].clone(),
        PackageIds {
            tariff: "tvoed-p-vka-legacy".into(),
            legal: "de-arbzg-care-legacy".into(),
            holiday: "de-holidays-legacy".into(),
        },
        None,
    )
    .expect("valid frozen catalog")
}

#[test]
fn combined_sfn_and_net_match_every_frozen_full_output() {
    let reference: Value =
        serde_json::from_str(include_str!("../../reference/cases.json")).expect("frozen oracle");
    let resolver = resolver(&reference);
    let mut count = 0;
    for case in reference["cases"].as_array().expect("cases") {
        if case["operation"] != "net.calculateMonthlyNetPayWithSfn" {
            continue;
        }
        let actual = calculate_monthly_net_pay_with_sfn(&case["input"]["input"], &resolver)
            .expect("bounded payroll");
        assert_eq!(actual, case["expected"], "{}", case["id"]);
        count += 1;
    }
    assert_eq!(count, 2);
}

#[test]
fn minute_caps_dst_regions_breaks_and_categories_match_frozen_ts() {
    let frozen: Value =
        serde_json::from_str(include_str!("../../reference/cases.json")).expect("catalog facts");
    let reference: Value =
        serde_json::from_str(include_str!("../../reference/sfn-2026-golden.json"))
            .expect("SFN golden");
    let ranks = serde_json::from_value(reference["collationRanks"].clone())
        .expect("locale ranks from original rule names");
    let bundled = resolver(&frozen).with_collation_ranks(ranks);
    let empty = RuleResolver::from_catalog_json(
        serde_json::json!({"tariff":[],"legal":[],"holiday":[]}),
        PackageIds {
            tariff: "unused".into(),
            legal: "unused".into(),
            holiday: "unused".into(),
        },
        None,
    )
    .expect("empty resolver");
    let cases = reference["cases"].as_array().expect("cases");
    assert_eq!(cases.len(), 447);
    for case in cases {
        let resolver = if case["catalog"] == "empty" {
            &empty
        } else {
            &bundled
        };
        let mode = if case["mode"] == "FORECAST" {
            CalculationMode::Forecast
        } else {
            CalculationMode::Verified
        };
        let actual = if case["operation"] == "combined" {
            calculate_monthly_net_pay_with_sfn(&case["input"], resolver)
                .expect("bounded combined payroll")
        } else {
            classify_sfn_payroll_2026(&case["input"], resolver, mode).expect("valid catalog")
        };
        assert_eq!(actual, case["expected"], "{}", case["id"]);
    }
}
