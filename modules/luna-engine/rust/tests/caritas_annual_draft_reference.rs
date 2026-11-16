mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    remuneration::{caritas::annual, context::model::FullNativePackageValidator},
    rules::{RulePackage, RuleResolver},
};
use serde_json::json;
#[test]
fn caritas_draft_selector_and_cash_months_match_original() {
    let data = value_pool::decode(include_str!(
        "../../reference/caritas-annual-draft-golden.json"
    ));
    let packages: std::collections::BTreeMap<String, RulePackage> =
        serde_json::from_value(data["packages"].clone()).unwrap();
    let bundled = RuleResolver::bundled().unwrap();
    let ranks: std::collections::BTreeMap<String, u32> =
        serde_json::from_value(data["collationRanks"].clone()).unwrap();
    let mut resolvers = std::collections::BTreeMap::new();
    for (name, catalog) in data["catalogs"].as_object().unwrap() {
        resolvers.insert(
            name.as_str(),
            RuleResolver::new(
                serde_json::from_value(catalog.clone()).unwrap(),
                bundled.default_package_ids().clone(),
                None,
            )
            .unwrap()
            .with_collation_ranks(ranks.clone()),
        );
    }
    for name in ["preview", "equalCustom"] {
        resolvers.insert(
            name,
            RuleResolver::new(
                serde_json::from_value(data["resolverData"]["catalog"].clone()).unwrap(),
                serde_json::from_value(data["resolverData"]["packageIds"].clone()).unwrap(),
                Some(serde_json::from_value(data["resolverData"]["historical"].clone()).unwrap()),
            )
            .unwrap()
            .with_collation_ranks(ranks.clone()),
        );
    }
    resolvers.insert("bundled", bundled);
    let cases = data["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 1392);
    for case in cases {
        let input = &case["input"];
        let resolver = &resolvers[input["resolverRef"].as_str().unwrap_or("full")];
        let value = match case["operation"].as_str().unwrap() {
            "draft" => annual::draft_claim(
                &packages[input["packageRef"].as_str().unwrap()],
                &input["claim"],
                &FullNativePackageValidator,
            )
            .unwrap(),
            "resolver" => {
                annual::draft_from_resolver(resolver, &input["claim"], &FullNativePackageValidator)
                    .unwrap()
            }
            "select" => {
                match annual::select_draft(&input["claim"], resolver, &FullNativePackageValidator)
                    .unwrap()
                {
                    annual::DraftSelection::Selected { package, versions } => {
                        json!({"ok":true,"package":package,"versions":versions})
                    }
                    annual::DraftSelection::Unavailable { code } => json!({"ok":false,"code":code}),
                }
            }
            "payout" => {
                if let Ok(checked) = luna_engine::remuneration::tariff_annual::saved::validate_saved_tariff_annual_claims(&input["claims"]) {
                    let actual = annual::payout_month_checked(input["month"].as_str().unwrap(), &checked, resolver, &FullNativePackageValidator).unwrap();
                    common::assert_json_eq(&json!({"value": actual}), &case["expected"], case["id"].as_str().unwrap());
                }
                annual::payout_month(
                    input["month"].as_str().unwrap(),
                    &input["claims"],
                    resolver,
                    &FullNativePackageValidator,
                )
                .unwrap()
            }
            _ => panic!("unknown operation"),
        };
        common::assert_json_eq(
            &json!({"value":value}),
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
    }
}

#[test]
fn tied_draft_versions_require_explicit_platform_collation_ranks() {
    let data = value_pool::decode(include_str!(
        "../../reference/caritas-annual-draft-golden.json"
    ));
    let bundled = RuleResolver::bundled().unwrap();
    let resolver = RuleResolver::new(
        serde_json::from_value(data["catalogs"]["sameTerms"].clone()).unwrap(),
        bundled.default_package_ids().clone(),
        None,
    )
    .unwrap();
    let case = data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["operation"] == "select" && case["input"]["resolverRef"] == "sameTerms")
        .unwrap();
    assert_eq!(case["expected"]["value"]["ok"], true);
    assert!(matches!(
        annual::select_draft(
            &case["input"]["claim"],
            &resolver,
            &FullNativePackageValidator
        ),
        Err(luna_engine::remuneration::tariff_annual::TariffAnnualError::InvalidCollation)
    ));
}
