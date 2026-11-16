use luna_engine::{
    calendar::recurrence::CollationRanks,
    compliance::{model::ComplianceError, planning_nights, preparation::PreparedShifts},
};
use serde_json::{Value, json};
fn run(c: &Value) -> Result<Value, ComplianceError> {
    let i = &c["input"];
    let original = i["shifts"].as_array().unwrap();
    let time_zone = i["timeZone"].as_str().unwrap();
    let ranks: CollationRanks = serde_json::from_value(i["collationRanks"].clone()).unwrap();
    let prepared = PreparedShifts::new(original, time_zone, &ranks)?;
    planning_nights::check_planning_nights(prepared.intervals(), original, time_zone, &i["options"])
        .map(Value::Array)
}
#[test]
fn raw_night_episode_recovery_uncertainty_dst_and_history_match_frozen_source() {
    let g: Value =
        serde_json::from_str(include_str!("../../reference/compliance-night-golden.json")).unwrap();
    assert_eq!(
        g["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let cases = g["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 147);
    for c in cases {
        let actual = match run(c) {
            Ok(v) => v,
            Err(e) => json!({"$error":{"name":e.source_error_name(),"message":e.to_string()}}),
        };
        assert_eq!(actual, c["expected"], "{}", c["id"]);
    }
}
