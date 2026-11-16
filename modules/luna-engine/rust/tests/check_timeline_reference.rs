use luna_engine::{
    calendar::recurrence::CollationRanks,
    compliance::presentation::{dates, timeline},
};
use serde_json::Value;
#[path = "support/value_pool.rs"]
mod value_pool;
#[test]
fn complete_original_rest_series_and_civil_labels_match() {
    let data = value_pool::decode(include_str!("../../reference/check-timeline-golden.json"));
    let cases = data["cases"].as_array().unwrap();
    assert!(cases.len() > 360);
    for case in cases {
        let input = &case["input"];
        let actual = match case["operation"].as_str().unwrap() {
            "timeline" => {
                let ranks: CollationRanks =
                    serde_json::from_value(case["collationRanks"].clone()).unwrap();
                let mut shifts = input["shifts"].as_array().unwrap().clone();
                if let Some(count) = input["unrelatedCount"].as_u64() {
                    for index in 0..count {
                        let mut row = shifts[0].clone();
                        row["id"] = serde_json::json!(format!("unrelated-{index}"));
                        shifts.push(row);
                    }
                }
                let source = timeline::TimelineSource::new(&shifts);
                let result = source
                    .prepare(&input["issue"], input["timeZone"].as_str().unwrap(), &ranks)
                    .unwrap();
                if input["unrelatedCount"].as_u64() == Some(50_000) {
                    assert_eq!(result["related"].as_array().unwrap().len(), 2);
                    assert!(serde_json::to_vec(&result).unwrap().len() < 16_384);
                    assert_eq!(
                        source
                            .prepare(&input["issue"], input["timeZone"].as_str().unwrap(), &ranks)
                            .unwrap(),
                        result
                    );
                }
                result
            }
            "date" => dates::labels(input["date"].as_str().unwrap()),
            "period" => dates::period(
                input["from"].as_str().unwrap(),
                input["until"].as_str().unwrap(),
            ),
            other => panic!("Unknown operation {other}"),
        };
        assert_eq!(actual, case["expected"], "{}", case["id"]);
    }
}

#[test]
fn missing_collation_and_invalid_issue_shape_never_produce_ready_timelines() {
    let data = value_pool::decode(include_str!("../../reference/check-timeline-golden.json"));
    let input = &data["cases"][0]["input"];
    assert!(
        timeline::prepare(
            &input["issue"],
            input["shifts"].as_array().unwrap(),
            "Europe/Berlin",
            &CollationRanks::default()
        )
        .is_err()
    );
    assert!(
        timeline::prepare(
            &Value::Null,
            &[],
            "Europe/Berlin",
            &CollationRanks::default()
        )
        .is_err()
    );
}
