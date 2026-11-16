mod common;
use luna_engine::{
    calendar::recurrence::CollationRanks, input::calendar_rows::PreparedCalendarRows,
    target::profile::project_saved_target_snapshot,
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc};
#[test]
fn target_plan_uses_raw_nine_columns_binary_order_and_one_shared_projection() {
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/input-target-plan-golden.json"
    ))
    .unwrap();
    assert_eq!(data["cases"].as_array().unwrap().len(), 72);
    let mut gaps = 0;
    for case in data["cases"].as_array().unwrap() {
        let raw = Arc::new(case["input"]["shiftRows"].as_array().unwrap().clone());
        let prepared = PreparedCalendarRows::from_rows(Arc::clone(&raw), Arc::new(vec![])).unwrap();
        let ranks: CollationRanks = prepared
            .collation_candidates()
            .iter()
            .enumerate()
            .map(|(i, text)| (text.clone(), i as u32))
            .collect::<BTreeMap<_, _>>()
            .into();
        let group = prepared.into_ranked(&ranks).unwrap();
        let plan = group.target_plan_rows();
        assert!(Arc::ptr_eq(plan, group.target_plan_rows()));
        assert!(Arc::ptr_eq(group.raw_shift_rows(), &raw));
        common::assert_json_eq(
            &json!(plan.as_ref()),
            &case["expectedRows"],
            case["id"].as_str().unwrap(),
        );
        let projected =
            project_saved_target_snapshot(None, case["input"]["timeZone"].as_str(), plan);
        if case["noncanonicalNativeGap"] == true {
            gaps += 1;
            assert!(
                projected.is_err(),
                "recorded strict target-SQL boundary gap"
            );
        } else {
            common::assert_json_eq(
                &projected.unwrap(),
                &case["expectedSnapshot"],
                case["id"].as_str().unwrap(),
            );
        }
    }
    assert_eq!(gaps, 8);
}
