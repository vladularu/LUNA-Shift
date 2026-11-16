mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    pay::{month::MonthPayError, pattern::WorkPatternSettings},
    report::tariff_assessment,
    rules::RuleResolver,
};
use serde_json::json;

#[test]
fn original_screen_callback_including_family_and_dated_selector_roles() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/tariff-assessment-screen-golden.json"
    ));
    assert_eq!(
        fixture["baselineDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let bundled = RuleResolver::bundled().unwrap();
    let preview = luna_engine::runtime::catalog::compiled_preview().unwrap();
    let empty=RuleResolver::new(serde_json::from_value(json!({"tariff":[],"legal":[],"holiday":[]})).unwrap(),serde_json::from_value(json!({"tariff":"tvoed-p-vka-legacy","legal":"de-arbzg-care-legacy","holiday":"de-holidays-legacy"})).unwrap(),None).unwrap();
    let catalogs = fixture["catalogs"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(id, spec)| {
            (
                id.clone(),
                RuleResolver::new(
                    serde_json::from_value(spec["catalog"].clone()).unwrap(),
                    serde_json::from_value(spec["packageIds"].clone()).unwrap(),
                    None,
                )
                .unwrap(),
            )
        })
        .collect::<std::collections::BTreeMap<_, _>>();
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 2764);
    for case in cases {
        let input = &case["input"];
        let resolver = match input["resolver"].as_str().unwrap() {
            "BUNDLED" => &bundled,
            "COMPILED_PREVIEW" => preview.resolver(),
            "EMPTY" => &empty,
            id => catalogs.get(id).unwrap(),
        };
        let settings: WorkPatternSettings =
            serde_json::from_value(input["settings"].clone()).unwrap();
        let actual = match tariff_assessment::calculate(
            input["month"].as_str().unwrap(),
            input["entries"].as_array().unwrap(),
            &input["profile"],
            &settings,
            input.get("decision").filter(|d| !d.is_null()),
            resolver,
        ) {
            Ok(value) => value,
            Err(error) => {
                json!({"$error":{"name":if matches!(error,MonthPayError::Employment(_)){"RemunerationProfileError"}else{"Error"},"message":error.to_string()}})
            }
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
