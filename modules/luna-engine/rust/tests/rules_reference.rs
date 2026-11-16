use luna_engine::rules::holidays::{self, HolidayError};
use luna_engine::rules::{
    HistoricalCatalog, PackageIds, RuleResolutionFailure, RuleResolver, is_valid_date,
};
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn resolution<T: Serialize>(result: Result<T, RuleResolutionFailure>) -> Value {
    match result {
        Ok(value) => json!({"ok":true,"value":value}),
        Err(error) => json!({"ok":false,"error":error}),
    }
}
fn holiday_result<T: Serialize>(result: Result<T, HolidayError>) -> Value {
    match result {
        Ok(value) => serde_json::to_value(value).unwrap(),
        Err(HolidayError::Resolution(error)) => json!({"$resolution":error}),
        Err(error) => panic!("Unexpected error {error}"),
    }
}
fn map_value(map: BTreeMap<String, holidays::PublicHoliday>) -> Value {
    json!({"$type":"Map","entries":map.into_iter().collect::<Vec<_>>()})
}

#[test]
fn every_rule_selection_and_holiday_output_matches_frozen_source() {
    let reference: Value =
        serde_json::from_str(include_str!("../../reference/rules-golden.json")).unwrap();
    assert_eq!(
        reference["baselineDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let mut resolvers = BTreeMap::new();
    for data in reference["resolvers"].as_array().unwrap() {
        let ids: PackageIds = serde_json::from_value(data["packageIds"].clone()).unwrap();
        let historical: Option<HistoricalCatalog> = data
            .get("historical")
            .map(|v| serde_json::from_value(v.clone()).unwrap());
        let ranks = serde_json::from_value(data["collationRanks"].clone()).unwrap();
        let resolver = RuleResolver::from_catalog_json(data["catalog"].clone(), ids, historical)
            .unwrap()
            .with_collation_ranks(ranks);
        resolvers.insert(data["id"].as_str().unwrap(), resolver);
    }
    let cases = reference["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 409);
    for case in cases {
        let input = &case["input"];
        let resolver = input
            .get("resolver")
            .and_then(Value::as_str)
            .map(|id| resolvers.get(id).unwrap());
        let string = |key: &str| input[key].as_str().unwrap();
        let actual = match case["operation"].as_str().unwrap() {
            "rules.resolveHoliday" => resolution(resolver.unwrap().resolve_holiday(string("date"))),
            "rules.resolveLegal" => resolution(resolver.unwrap().resolve_legal(string("date"))),
            "rules.resolveTariff" => {
                resolution(resolver.unwrap().resolve_tariff(string("date"), None))
            }
            "rules.annualTariffCandidates" => json!(resolver.unwrap().annual_tariff_candidates(
                string("packageId"),
                input["year"].as_i64().unwrap() as i32
            )),
            "rules.tariffPackageIds" => json!(resolver.unwrap().tariff_package_ids()),
            "rules.simpleTariffData" => json!(resolver.unwrap().simple_tariff_data()),
            "rules.validDate" => json!(is_valid_date(string("date"))),
            "holidays.easter" => holiday_result(holidays::easter_sunday(
                input["year"].as_i64().unwrap() as i32,
            )),
            "holidays.public" => holiday_result(holidays::get_public_holidays(
                input["year"].as_i64().unwrap() as i32,
                string("state"),
                string("region"),
                resolver.unwrap(),
            )),
            "holidays.resolveMonth" => {
                let result = holidays::resolve_holiday_map_for_month(
                    string("month"),
                    string("state"),
                    string("region"),
                    resolver.unwrap(),
                )
                .unwrap();
                json!({"status":result.status,"holidays":map_value(result.holidays),"failure":result.failure})
            }
            unknown => panic!("Unknown operation {unknown}"),
        };
        assert_eq!(actual, case["expected"], "{}", case["id"]);
    }
}

#[test]
fn bundled_catalog_is_identical_and_compatible() {
    let resolver = RuleResolver::bundled().unwrap();
    assert!(resolver.resolve_holiday("2026-12-25").is_ok());
    assert!(resolver.resolve_tariff("2026-12-25", None).is_ok());
    let manifest = json!({"schemaVersion":2,"legacyTariffPackageId":"legacy","tracks":[{"kind":"TARIFF","packageId":"legacy"},{"kind":"TARIFF","packageId":"other"},{"kind":"LEGAL","packageId":"law"},{"kind":"HOLIDAY","packageId":"holiday"}]});
    assert_eq!(
        RuleResolver::package_ids_from_manifest(&manifest)
            .unwrap()
            .tariff,
        "legacy"
    );
    let mut ambiguous = manifest.clone();
    ambiguous["tracks"]
        .as_array_mut()
        .unwrap()
        .push(json!({"kind":"LEGAL","packageId":"another-law"}));
    assert!(RuleResolver::package_ids_from_manifest(&ambiguous).is_err());
}
