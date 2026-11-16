use luna_engine::{
    calendar::recurrence::CollationRanks,
    compliance::presentation::{context, duty},
};
use serde_json::{Value, json};
#[path = "support/value_pool.rs"]
mod value_pool;
#[test]
fn complete_original_duty_grids_and_grouped_detail_contexts_match() {
    let data = value_pool::decode(include_str!(
        "../../reference/check-duty-context-golden.json"
    ));
    assert!(data["cases"].as_array().unwrap().len() > 165);
    for case in data["cases"].as_array().unwrap() {
        let input = &case["input"];
        let ranks: CollationRanks = serde_json::from_value(case["collationRanks"].clone()).unwrap();
        let mut shifts = input["shifts"].as_array().unwrap().clone();
        if let Some(count) = input["unrelatedCount"].as_u64() {
            for index in 0..count {
                let mut shift = shifts[0].clone();
                shift["id"] = json!(format!("unrelated-{index}"));
                shifts.push(shift);
            }
        }
        let actual = match case["operation"].as_str().unwrap() {
            "duty" => duty::prepare(
                &shifts,
                input
                    .get("dates")
                    .and_then(|v| v.as_array())
                    .map(Vec::as_slice),
                &ranks,
            ),
            "affected" => duty::affected(&shifts, input.get("weekendPeriod"), &ranks),
            "context" => context::prepare(
                &input["issue"],
                input["relatedIssues"].as_array().map_or(&[], Vec::as_slice),
                &shifts,
                input["timeZone"].as_str().unwrap(),
                &ranks,
            ),
            op => panic!("unknown operation {op}"),
        }
        .unwrap();
        assert_eq!(actual, case["expected"], "{}", case["id"]);
        if input["unrelatedCount"] == 50_000 {
            let source = context::DetailSource::new(&shifts);
            assert_eq!(
                source
                    .prepare(
                        &input["issue"],
                        input["relatedIssues"].as_array().unwrap(),
                        input["timeZone"].as_str().unwrap(),
                        &ranks
                    )
                    .unwrap(),
                actual
            );
            assert_eq!(actual["allRelated"].as_array().unwrap().len(), 2);
            assert!(serde_json::to_vec(&actual).unwrap().len() < 32_768);
        }
    }
}

#[test]
fn absent_display_and_missing_collation_remain_distinct() {
    assert_eq!(
        duty::prepare(&[], None, &CollationRanks::default()).unwrap(),
        Value::Null
    );
    let data = value_pool::decode(include_str!(
        "../../reference/check-duty-context-golden.json"
    ));
    let case = &data["cases"][2];
    let shifts = case["input"]["shifts"].as_array().unwrap();
    assert!(duty::prepare(shifts, None, &CollationRanks::default()).is_err());
    assert!(
        context::prepare(
            &Value::Null,
            &[],
            &[],
            "Europe/Berlin",
            &CollationRanks::default()
        )
        .is_err()
    );
}
