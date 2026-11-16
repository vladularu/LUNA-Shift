use luna_engine::{
    calendar::recurrence::CollationRanks,
    compliance::presentation::{groups, identity, tariff_evidence},
};
use serde_json::Value;
#[path = "support/value_pool.rs"]
mod value_pool;
#[test]
fn full_original_display_groups_placement_and_identity_match() {
    let data = value_pool::decode(include_str!("../../reference/check-groups-golden.json"));
    let cases = data["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 368);
    for case in cases {
        let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let ranks: CollationRanks = serde_json::from_value(case["ranks"].clone()).unwrap();
        let actual = match case["operation"].as_str().unwrap() {
            "groups" => {
                let issues = input["issues"].as_array().unwrap();
                let base = groups::base_collation_candidates(issues).unwrap();
                let raw: std::collections::BTreeMap<String, u32> =
                    serde_json::from_value(case["ranks"].clone()).unwrap();
                let base_ranks = CollationRanks::from(
                    raw.iter()
                        .filter(|(key, _)| base.contains(*key))
                        .map(|(key, value)| (key.clone(), *value))
                        .collect::<std::collections::BTreeMap<_, _>>(),
                );
                let draft = groups::GroupDraft::prepare(
                    issues,
                    input["shifts"].as_array().unwrap(),
                    input["timeZone"].as_str(),
                    &base_ranks,
                )
                .unwrap();
                let candidates = draft.collation_candidates().unwrap();
                assert!(
                    candidates.iter().all(|value| raw.contains_key(value)),
                    "{} candidates",
                    case["id"]
                );
                let display_ranks = CollationRanks::from(
                    raw.into_iter()
                        .filter(|(key, _)| candidates.contains(key))
                        .collect::<std::collections::BTreeMap<_, _>>(),
                );
                draft.finish(&display_ranks).unwrap()
            }
            "planning" => groups::planning(
                input["issues"].as_array().unwrap(),
                input["shifts"].as_array().unwrap(),
                &ranks,
            )
            .unwrap(),
            "projection" => groups::projection(&input).unwrap(),
            "evidence" => Value::Bool(tariff_evidence::valid(
                &input["value"],
                input["rule"].as_str(),
            )),
            "identity" => Value::String(identity::stringify(&input).unwrap()),
            other => panic!("Unknown operation {other}"),
        };
        assert_eq!(actual, case["expected"], "{}", case["id"]);
    }
}

#[test]
fn native_group_draft_rejects_missing_ranks_without_fabricating_an_empty_ready_result() {
    let data = value_pool::decode(include_str!("../../reference/check-groups-golden.json"));
    let case=data["cases"].as_array().unwrap().iter().find(|case|case["operation"]=="groups"&&serde_json::from_str::<Value>(case["inputJson"].as_str().unwrap()).unwrap()["issues"].as_array().unwrap().len()==1).unwrap();
    let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
    let issues = input["issues"].as_array().unwrap();
    let shifts = input["shifts"].as_array().unwrap();
    assert!(matches!(
        groups::GroupDraft::prepare(
            issues,
            shifts,
            input["timeZone"].as_str(),
            &CollationRanks::default()
        ),
        Err(groups::GroupError::MissingCollation)
    ));
    let ranks: CollationRanks = serde_json::from_value(case["ranks"].clone()).unwrap();
    let draft =
        groups::GroupDraft::prepare(issues, shifts, input["timeZone"].as_str(), &ranks).unwrap();
    assert!(matches!(
        draft.finish(&CollationRanks::default()),
        Err(groups::GroupError::MissingCollation)
    ));
    assert_eq!(
        groups::group(issues, shifts, input["timeZone"].as_str(), &ranks).unwrap(),
        case["expected"]
    );
    assert_eq!(
        groups::group(&[], &[], None, &CollationRanks::default()).unwrap(),
        serde_json::json!([])
    );
}
