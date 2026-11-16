mod common;
#[path = "support/salary_snapshot.rs"]
mod salary_snapshot;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    contract::{ReportPeriod, SalaryPerspective, SourceKind},
    runtime::{
        financial_report::{earned_services_page, presentation},
        report::SectionOutput,
        view_composition::ViewCompositionSource,
    },
};
use serde_json::{Value, json};
fn value(output: SectionOutput) -> Value {
    match output {
        SectionOutput::Ready { value } => value,
        _ => panic!("native view not ready: {output:?}"),
    }
}
fn ready(value: Value) -> Value {
    json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":value}}})
}
#[test]
fn original_earned_services_route_policy_matches_every_frozen_jsx_branch() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../reference/earned-services-page-golden.json"
    ))
    .unwrap();
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 36);
    for case in cases {
        let input = &case["input"];
        let actual = earned_services_page::present(
            input["month"].as_str().unwrap(),
            &input["profile"],
            &input["pay"],
            input["blocked"].as_bool().unwrap(),
        )
        .unwrap();
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
#[test]
fn actual_raw_sql_route_matches_original_manual_test_tax_and_future_coverage_states() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/earned-services-raw-golden.json"
    ));
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 108);
    let (mut service_count, mut classified_count, mut night_count) = (0, 0, 0);
    for case in cases {
        let input = &case["input"];
        let expected = &case["expected"];
        let month = input["month"].as_str().unwrap();
        let mut source_case = case.clone();
        source_case["platformCollationRanks"] = input["platformCollationRanks"].clone();
        let mut raw = salary_snapshot::raw(&source_case);
        if input["blocked"] == true {
            salary_snapshot::set(
                &mut raw,
                SourceKind::TestMonths,
                ready(json!([{"month":month}])),
            );
        }
        if input["netStatus"] == "error" {
            salary_snapshot::set(
                &mut raw,
                SourceKind::NetPaySettingsTimeline,
                json!({"state":"FAILED","code":"READ_FAILED"}),
            );
        }
        let facts = salary_snapshot::facts(raw);
        let gross = value(
            ViewCompositionSource::from_facts(&facts)
                .gross(
                    &ReportPeriod::Month {
                        month: month.to_owned(),
                    },
                    SalaryPerspective::Earned,
                )
                .overlay,
        );
        assert_eq!(
            gross["earnedServicesPageUi"]["state"], "READY",
            "{}",
            case["id"]
        );
        let policy = &gross["earnedServicesPageUi"]["value"];
        assert_eq!(policy["kind"], expected["kind"], "{}", case["id"]);
        if expected["kind"] != "SERVICES" {
            assert_eq!(policy["title"], expected["title"], "{}", case["id"]);
            assert_eq!(policy["message"], expected["message"], "{}", case["id"]);
            continue;
        }
        service_count += 1;
        let context = facts.financial_context().unwrap();
        let before = context.lock().unwrap().reuse_diagnostics();
        let details =
            presentation::details(&facts, month, SalaryPerspective::Earned, None, true).unwrap();
        let after = context.lock().unwrap().reuse_diagnostics();
        if input["blocked"] == true || input["netStatus"] == "error" {
            assert_eq!(
                before["raw"]["nativePricingPasses"], after["raw"]["nativePricingPasses"],
                "{}: unavailable personal inputs reuse earned gross without pricing other months",
                case["id"]
            );
            assert_eq!(
                after["nativeNetPasses"], 0,
                "{}: unavailable personal inputs never start native net calculation",
                case["id"]
            );
        }
        if details["netState"]["value"]["status"] == "available" {
            // The first tax calculation may need genuine additional basis
            // months. A warmed details read must reuse that complete evidence.
            let repeated =
                presentation::details(&facts, month, SalaryPerspective::Earned, None, true)
                    .unwrap();
            common::assert_json_eq(&repeated, &details, "stable earned details");
            assert_eq!(
                context.lock().unwrap().reuse_diagnostics(),
                after,
                "{}: warmed earned details repeat no gross or native net pass",
                case["id"]
            );
        }
        common::assert_json_eq(
            &details["serviceSummary"],
            &expected["serviceSummary"],
            case["id"].as_str().unwrap(),
        );
        assert_eq!(details["payAvailable"], true, "{}", case["id"]);
        let tax_notice = if !policy["taxNotice"].is_null() {
            &policy["taxNotice"]
        } else if input["netStatus"] == "error" {
            &policy["taxReadErrorNotice"]
        } else {
            &Value::Null
        };
        assert_eq!(tax_notice, &expected["taxNotice"], "{}", case["id"]);
        let actual_night = gross["monthlyAnalysis"]["pay"]["value"]
            .get("nightCompensatoryMinutes")
            .filter(|n| !n.is_null())
            .cloned()
            .unwrap_or(json!(0));
        common::assert_json_eq(
            &actual_night,
            &expected["nightCompensatoryMinutes"],
            case["id"].as_str().unwrap(),
        );
        if !details["serviceSummary"]["taxFreeCents"].is_null() {
            classified_count += 1;
        }
        if actual_night.as_f64().unwrap() > 0.0 {
            night_count += 1;
        }
        if input["blocked"] == true {
            assert_eq!(
                details["netState"]["reason"]["code"], "TEST_MONTH_NET_DISABLED",
                "{}",
                case["id"]
            );
        }
    }
    assert_eq!(service_count, 60);
    assert_eq!(classified_count, 4);
    assert_eq!(night_count, 4);
}
