use luna_engine::{calendar::recurrence::CollationRanks, compliance::presentation::rule_groups};
use serde_json::Value;
#[path = "support/value_pool.rs"]
mod value_pool;
#[test]
fn full_original_rule_groups_use_default_ids_and_explicit_german_titles() {
    let data = value_pool::decode(include_str!(
        "../../reference/check-rule-groups-golden.json"
    ));
    let cases = data["cases"].as_array().unwrap();
    assert!(cases.len() > 60);
    for case in cases {
        let issues: Vec<Value> = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let default: CollationRanks = serde_json::from_value(case["defaultRanks"].clone()).unwrap();
        let german: CollationRanks = serde_json::from_value(case["germanRanks"].clone()).unwrap();
        let draft = rule_groups::RuleGroupDraft::prepare(&issues, &default).unwrap();
        let candidates = draft.title_candidates();
        assert!(
            candidates
                .iter()
                .all(|title| case["germanRanks"].get(title).is_some())
        );
        let actual = draft
            .finish(&rule_groups::GermanTitleRanks::from_explicit_de_de(german))
            .unwrap();
        assert_eq!(actual, case["expected"], "{}", case["id"]);
    }
}

#[test]
fn missing_default_and_german_ranks_have_distinct_typed_failures() {
    let data = value_pool::decode(include_str!(
        "../../reference/check-rule-groups-golden.json"
    ));
    let case = &data["cases"][1];
    let issues: Vec<Value> = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
    assert!(matches!(
        rule_groups::RuleGroupDraft::prepare(&issues, &CollationRanks::default()),
        Err(rule_groups::RuleGroupError::MissingDefaultCollation)
    ));
    let default: CollationRanks = serde_json::from_value(case["defaultRanks"].clone()).unwrap();
    let draft = rule_groups::RuleGroupDraft::prepare(&issues, &default).unwrap();
    assert!(matches!(
        draft.finish(&rule_groups::GermanTitleRanks::from_explicit_de_de(
            CollationRanks::default()
        )),
        Err(rule_groups::RuleGroupError::MissingGermanCollation)
    ));
    let german: CollationRanks = serde_json::from_value(case["germanRanks"].clone()).unwrap();
    assert_eq!(
        rule_groups::group(
            &issues,
            &default,
            &rule_groups::GermanTitleRanks::from_explicit_de_de(german)
        )
        .unwrap(),
        case["expected"]
    );
}
