mod common;
#[path = "support/export_time_snapshot.rs"]
mod export_snapshot;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::runtime::export_report::NativeTimeExportSource;
#[test]
fn actual_working_time_provider_export_caller_profiles_and_final_csv_match() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/export-provider-join-golden.json"
    ));
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 374);
    let mut ready = 0;
    let mut error = 0;
    let mut disabled = 0;
    for case in cases {
        let input = &case["input"];
        let facts =
            export_snapshot::raw_facts(&input["rawSource"], &case["platformCollationRanks"]);
        let source = NativeTimeExportSource::from_facts(&facts);
        if case["expected"]["state"] == "DISABLED" {
            assert!(source.is_err(), "{}", case["id"]);
            disabled += 1;
            continue;
        }
        let source = source.unwrap_or_else(|e| panic!("{}: {e}", case["id"]));
        // Full profile comparison is essential: some wrong time-zone bases
        // happen to leave this sample's day view unchanged.
        common::assert_json_eq(
            source.profile_for_reference(),
            &case["expected"]["profile"],
            case["id"].as_str().unwrap(),
        );
        let ranks = serde_json::from_value(case["platformCollationRanks"].clone()).unwrap();
        let result = source.document(input["period"].as_str().unwrap(), &ranks);
        if case["expected"]["state"] == "ERROR" {
            assert!(result.is_err(), "{} must not be Ready", case["id"]);
            error += 1;
            continue;
        }
        let result = result.unwrap_or_else(|e| panic!("{}: {e}", case["id"]));
        common::assert_json_eq(
            &serde_json::to_value(result.entries()).unwrap(),
            &case["expected"]["entries"],
            case["id"].as_str().unwrap(),
        );
        common::assert_json_eq(
            &serde_json::to_value(result.targets()).unwrap(),
            &case["expected"]["targets"],
            case["id"].as_str().unwrap(),
        );
        assert_eq!(
            result.to_csv(16 * 1024 * 1024).unwrap(),
            case["expected"]["csv"].as_str().unwrap(),
            "{}",
            case["id"]
        );
        ready += 1;
    }
    assert_eq!((ready, error, disabled), (344, 24, 6));
}
