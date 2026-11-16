#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    report::{ecma_number, export_csv, export_rows::ReportEntry},
    target::MonthlyTarget,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
fn fixture() -> Value {
    value_pool::decode(include_str!("../../reference/export-csv-golden.json"))
}
fn text(value: &Value, key: &str) -> String {
    value[key].as_str().unwrap().to_owned()
}
fn optional_text(value: &Value, key: &str) -> Option<String> {
    value[key].as_str().map(str::to_owned)
}
fn entry(value: &Value) -> ReportEntry {
    ReportEntry {
        date: text(value, "date"),
        title: text(value, "title"),
        kind: text(value, "kind"),
        type_label: text(value, "typeLabel"),
        color: text(value, "color"),
        all_day: value["allDay"].as_bool().unwrap(),
        start_time: optional_text(value, "startTime"),
        end_time: optional_text(value, "endTime"),
        next_day: value["nextDay"].as_bool().unwrap(),
        break_minutes: value["breakMinutes"].as_f64(),
        duration_minutes: value["durationMinutes"].as_f64(),
        credit_minutes: value["creditMinutes"].as_f64(),
    }
}
fn target_json(value: &Value) -> Value {
    let mut value = value.clone();
    for key in [
        "statutoryReductionMinutes",
        "tariffReductionMinutes",
        "roundingMinutes",
    ] {
        value[key] = json!(0);
    }
    value["notices"] = json!([]);
    value["days"] = json!([]);
    for row in value["adjustments"].as_array_mut().unwrap() {
        row["ruleId"] = json!("original-csv-presentation");
        row["sourceUrl"] = json!("https://example.invalid/source");
    }
    value
}
fn target(value: &Value) -> MonthlyTarget {
    serde_json::from_value(target_json(value)).unwrap()
}
#[test]
fn final_csv_bytes_match_every_typed_original_presentation_case() {
    let fixture = fixture();
    let (mut valid, mut display_only) = (0, 0);
    for case in fixture["cases"].as_array().unwrap() {
        if case["nativeTargetDomain"] != true {
            display_only += 1;
            continue;
        }
        let input = &case["input"];
        let entries = input["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(entry)
            .collect::<Vec<_>>();
        let targets = input["workingTimeTargets"]
            .as_array()
            .unwrap()
            .iter()
            .map(target)
            .collect::<Vec<_>>();
        let actual = export_csv::report_to_csv(&entries, &targets, 1024 * 1024)
            .unwrap_or_else(|error| panic!("{}: {error}", case["id"]));
        assert_eq!(actual, case["expected"].as_str().unwrap(), "{}", case["id"]);
        valid += 1;
    }
    assert_eq!((valid, display_only), (326, 6));
}
#[test]
fn exact_binary64_to_fixed_matches_original_javascript_observations() {
    let fixture = fixture();
    let cases = fixture["numeric"].as_array().unwrap();
    assert_eq!(cases.len(), 954);
    for case in cases {
        let bits = u64::from_str_radix(case["bits"].as_str().unwrap(), 16).unwrap();
        let value = f64::from_bits(bits);
        let digits = case["fractionDigits"].as_u64().unwrap() as u32;
        assert_eq!(
            ecma_number::fixed(value, digits).as_deref(),
            case["expected"].as_str(),
            "bits {bits:x}, digits {digits}"
        );
    }
}
#[test]
fn invalid_or_unbounded_output_never_returns_partial_ready_csv() {
    assert!(matches!(
        export_csv::report_to_csv(&[], &[], 0),
        Err(export_csv::CsvError::BudgetExceeded)
    ));
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert!(ecma_number::fixed(value, 2).is_none());
        assert!(ecma_number::string(value).is_none());
    }
    assert!(ecma_number::fixed(1.0, 101).is_none());
}

#[test]
fn display_only_null_or_fractional_target_probes_are_outside_native_target_outputs() {
    let fixture = fixture();
    let mut count = 0;
    for case in fixture["cases"].as_array().unwrap() {
        if case["nativeTargetDomain"] == true {
            continue;
        }
        for target in case["input"]["workingTimeTargets"].as_array().unwrap() {
            assert!(serde_json::from_value::<MonthlyTarget>(target_json(target)).is_err());
        }
        count += 1;
    }
    assert_eq!(count, 6);
}

#[test]
fn fifty_thousand_native_rows_match_original_bytes_under_an_exact_output_budget() {
    let fixture = fixture();
    let large = &fixture["largeCase"];
    let count = large["count"].as_u64().unwrap() as usize;
    assert_eq!(count, 50_000);
    let entries = (0..count)
        .map(|index| {
            let mut value = entry(&large["baseEntry"]);
            value.title = format!("{}{index}", large["titlePrefix"].as_str().unwrap());
            value
        })
        .collect::<Vec<_>>();
    let first_title = entries[0].title.as_ptr();
    let last_title = entries[count - 1].title.as_ptr();
    let budget = large["expectedUtf8Bytes"].as_u64().unwrap() as usize;
    let csv = export_csv::report_to_csv(&entries, &[], budget).unwrap();
    assert_eq!(csv.len(), budget);
    assert_eq!(
        format!("{:x}", Sha256::digest(csv.as_bytes())),
        large["expectedSha256"].as_str().unwrap()
    );
    assert_eq!(entries[0].title.as_ptr(), first_title);
    assert_eq!(entries[count - 1].title.as_ptr(), last_title);
    drop(csv);
    assert!(matches!(
        export_csv::report_to_csv(&entries, &[], budget - 1),
        Err(export_csv::CsvError::BudgetExceeded)
    ));
}
