mod common;
use luna_engine::{
    remuneration::caritas::{work_facts, work_slices},
    rules::{RuleResolver, RuleResolverCatalog},
};
use serde_json::{Value, json};

#[test]
fn caritas_raw_pause_slices_and_explicit_work_facts_match_original() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/caritas-work-golden.json")).unwrap();
    let bundled = RuleResolver::bundled().unwrap();
    let empty = RuleResolver::new(
        serde_json::from_value::<RuleResolverCatalog>(json!({"tariff":[],"legal":[],"holiday":[]}))
            .unwrap(),
        serde_json::from_value(json!({"tariff":"none","legal":"none","holiday":"none"})).unwrap(),
        None,
    )
    .unwrap();
    let preview = RuleResolver::new(
        serde_json::from_value(data["resolverData"]["catalog"].clone()).unwrap(),
        serde_json::from_value(data["resolverData"]["packageIds"].clone()).unwrap(),
        Some(serde_json::from_value(data["resolverData"]["historical"].clone()).unwrap()),
    )
    .unwrap();
    let equal_custom = RuleResolver::new(
        serde_json::from_value(data["resolverData"]["catalog"].clone()).unwrap(),
        serde_json::from_value(data["resolverData"]["packageIds"].clone()).unwrap(),
        Some(serde_json::from_value(data["resolverData"]["historical"].clone()).unwrap()),
    )
    .unwrap();
    assert_eq!(data["cases"].as_array().unwrap().len(), 522);
    for case in data["cases"].as_array().unwrap() {
        let input = &case["input"];
        let result = match case["operation"].as_str().unwrap() {
            "shift" => work_slices::derive_work_slices(
                &input["shift"],
                input.get("details").filter(|v| !v.is_null()),
                input["timeZone"].as_str().unwrap(),
            ),
            "month" => work_slices::derive_month_work_slices(
                input["month"].as_str().unwrap(),
                input["shifts"].as_array().unwrap(),
                input["details"].as_array().unwrap(),
                input["timeZone"].as_str().unwrap(),
                input["entriesComplete"].as_bool().unwrap(),
            ),
            "facts" => work_facts::derive_work_facts(
                &data["packages"][input["packageRef"].as_str().unwrap()],
                input["slices"].as_array().unwrap(),
                input["decisions"].as_array().unwrap(),
                input["federalState"].as_str().unwrap(),
                input["holidayRegion"].as_str().unwrap(),
                match input["resolverRef"].as_str() {
                    Some("empty") => &empty,
                    Some("preview") => &preview,
                    Some("equalCustom") => &equal_custom,
                    _ => &bundled,
                },
            )
            .unwrap(),
            _ => panic!("unknown operation"),
        };
        common::assert_json_eq(
            &json!({"value":result}),
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
    }
}
