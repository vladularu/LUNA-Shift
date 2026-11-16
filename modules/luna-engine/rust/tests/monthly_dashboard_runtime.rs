mod common;
#[path = "support/salary_snapshot.rs"]
mod salary_snapshot;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    contract::{ReportPeriod, SalaryPerspective, SourceKind},
    runtime::financial_report,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
fn raw(case: &Value) -> Value {
    let source = json!({"input":case["rawInput"],"platformCollationRanks":case["rawInput"]["platformCollationRanks"]});
    let mut raw = salary_snapshot::raw(&source);
    if case["testMonth"] == true {
        salary_snapshot::set(
            &mut raw,
            SourceKind::TestMonths,
            json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":[{"month":case["args"]["month"]}]}}}),
        );
    }
    raw
}
#[test]
fn raw_native_monthly_dashboard_matches_original_ready_and_test_month_props() {
    let reference = value_pool::decode(include_str!(
        "../../reference/monthly-dashboard-golden.json"
    ));
    let mut count = 0;
    let mut dump_cases = Vec::new();
    for case in reference["cases"].as_array().unwrap().iter().filter(|c| {
        c["perspective"] == "PAYOUT"
            && (c["id"].as_str().unwrap().ends_with("-ready") || c["testMonth"] == true)
    }) {
        let facts = salary_snapshot::facts(raw(case));
        let actual = financial_report::gross(
            &facts,
            &ReportPeriod::Month {
                month: case["args"]["month"].as_str().unwrap().into(),
            },
            SalaryPerspective::Payout,
        )
        .unwrap();
        assert_eq!(actual["monthlyDashboard"]["state"], "READY");
        let value = &actual["monthlyDashboard"]["value"];
        for key in ["manualSalary", "salaryReady", "premium", "pay"] {
            common::assert_json_eq(
                &value[key],
                &case["expected"][key],
                &format!("{} {key}", case["id"]),
            );
        }
        assert_eq!(
            value["policy"]["isTestMonth"],
            json!(case["testMonth"] == true)
        );
        if std::env::var_os("LUNA_MONTHLY_DASHBOARD_DUMP").is_some() {
            let earned = financial_report::gross(
                &facts,
                &ReportPeriod::Month {
                    month: case["args"]["month"].as_str().unwrap().into(),
                },
                SalaryPerspective::Earned,
            )
            .unwrap();
            common::assert_json_eq(
                &earned["monthlyDashboard"]["value"]["premium"],
                &case["expected"]["premium"],
                "dump earned premiums remain original",
            );
            dump_cases.push(json!({
                "id":case["id"],
                "expectedOriginalProps":case["expected"],
                "actualEARNEDDomainValue":earned,
                "actualPAYOUTDomainValue":actual,
                "testMonthFlag":case["testMonth"] == true,
            }));
        }
        count += 1;
    }
    assert_eq!(count, 72);
    // This optional test artifact is emitted only after every original comparison
    // above passed; it is never a production source or a hand-edited expectation.
    if let Some(path) = std::env::var_os("LUNA_MONTHLY_DASHBOARD_DUMP") {
        let path = std::path::PathBuf::from(path);
        assert!(path.is_absolute(), "dump path must be absolute");
        let digest = Sha256::digest(include_bytes!(
            "../../reference/monthly-dashboard-golden.json"
        ));
        let fixture_sha = digest
            .iter()
            .map(|n| format!("{n:02x}"))
            .collect::<String>();
        std::fs::write(
            path,
            serde_json::to_vec(&json!({
                "schemaVersion":1,
                "engineVersion":luna_engine::ENGINE_VERSION,
                "SourceFixtureSHA":fixture_sha,
                "cases":dump_cases,
            }))
            .unwrap(),
        )
        .unwrap();
    }
}
#[test]
fn earned_premiums_and_blocked_test_salary_do_not_read_net_or_payment_preferences() {
    let reference = value_pool::decode(include_str!(
        "../../reference/monthly-dashboard-golden.json"
    ));
    let case = reference["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| {
            c["perspective"] == "PAYOUT"
                && c["testMonth"] == true
                && c["expected"]["premium"]["amount"]
                    .as_f64()
                    .is_some_and(|n| n > 0.0)
        })
        .unwrap();
    let mut input = raw(case);
    for kind in [
        SourceKind::NetPaySettingsTimeline,
        SourceKind::SalaryPaymentPreferences,
    ] {
        salary_snapshot::set(
            &mut input,
            kind,
            json!({"state":"FAILED","code":"READ_FAILED"}),
        );
    }
    let facts = salary_snapshot::facts(input);
    let period = ReportPeriod::Month {
        month: case["args"]["month"].as_str().unwrap().into(),
    };
    let earned = financial_report::gross(&facts, &period, SalaryPerspective::Earned).unwrap();
    assert_eq!(earned["monthlyDashboard"]["state"], "READY");
    common::assert_json_eq(
        &earned["monthlyDashboard"]["value"]["premium"],
        &case["expected"]["premium"],
        "earned remains independent",
    );
    assert_eq!(
        earned["monthlyDashboard"]["value"]["kind"],
        "TEST_MONTH_EARNED"
    );
    assert!(earned["monthlyDashboard"]["value"]["pay"]["base"].is_number());
    assert_eq!(
        earned["monthlyDashboard"]["value"]["annualState"]["state"],
        "UNAVAILABLE"
    );
    let paid = financial_report::gross(&facts, &period, SalaryPerspective::Payout).unwrap();
    assert_eq!(paid["legacy"]["state"], "UNAVAILABLE");
    let value = &paid["monthlyDashboard"]["value"];
    assert_eq!(paid["monthlyDashboard"]["state"], "READY");
    assert_eq!(value["kind"], "TEST_MONTH_EARNED");
    for key in ["allowNet", "allowProjection", "allowRecurring"] {
        assert_eq!(value["policy"][key], false);
    }
    assert_eq!(value["annualState"]["state"], "UNAVAILABLE");
    assert!(value["pay"]["annualPaymentPresent"].is_null());
    assert!(value["pay"]["base"].is_number());
}

#[test]
fn failed_personal_settings_never_become_known_zero_recurring_or_annual_money() {
    let reference = value_pool::decode(include_str!(
        "../../reference/monthly-dashboard-golden.json"
    ));
    let case = reference["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| {
            c["perspective"] == "PAYOUT"
                && c["id"].as_str().unwrap().ends_with("-ready")
                && c["expected"]["premium"]["amount"]
                    .as_f64()
                    .is_some_and(|n| n > 0.0)
        })
        .unwrap();
    let mut input = raw(case);
    salary_snapshot::set(
        &mut input,
        SourceKind::NetPaySettingsTimeline,
        json!({"state":"FAILED","code":"READ_FAILED"}),
    );
    let facts = salary_snapshot::facts(input);
    let period = ReportPeriod::Month {
        month: case["args"]["month"].as_str().unwrap().into(),
    };
    let paid = financial_report::gross(&facts, &period, SalaryPerspective::Payout).unwrap();
    assert_eq!(paid["legacy"]["state"], "READY");
    assert_eq!(paid["monthlyDashboard"]["state"], "UNAVAILABLE");
    assert_eq!(
        paid["monthlyDashboard"]["reason"]["source"],
        "NET_PAY_SETTINGS_TIMELINE"
    );
    assert!(paid["monthlyDashboard"].get("value").is_none());
    let earned = financial_report::gross(&facts, &period, SalaryPerspective::Earned).unwrap();
    assert_eq!(earned["monthlyDashboard"]["state"], "READY");
    common::assert_json_eq(
        &earned["monthlyDashboard"]["value"]["premium"],
        &case["expected"]["premium"],
        "personal setup cannot mask earned premiums",
    );
}
