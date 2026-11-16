mod common;
#[path = "support/salary_snapshot.rs"]
mod salary_snapshot;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    contract::SourceKind, input::payroll_form_command::PayrollFormCommand, runtime::payroll_form,
};
use luna_engine::{input::finance_rows::RawNetPayTimeline, runtime::payroll_form::setup};
use serde_json::json;
use std::sync::Arc;

#[test]
fn complete_original_settings_screen_and_editor_initialization_are_preserved() {
    let corpus = value_pool::decode(include_str!(
        "../../reference/payroll-setup-source-golden.json"
    ));
    let cases = corpus["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 445);
    for case in cases {
        let input = &case["input"];
        let rows = input["timeline"].as_array().unwrap().iter().map(|saved| json!({
            "month":saved["settings"]["month"],
            "settings_json":serde_json::to_string(&saved["settings"]).unwrap(),
            "revision":saved["revision"],"created_at":saved["createdAt"],"updated_at":saved["updatedAt"]
        })).collect();
        let timeline = RawNetPayTimeline::try_from_rows(Arc::new(rows)).unwrap();
        let month = input["month"].as_str().unwrap();
        let profile = (!input["profile"].is_null()).then_some(&input["profile"]);
        let blocked = input["testMonths"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == month);
        let actual = setup::prepare(month, profile, &timeline, blocked);
        let actual = match actual {
            Ok(value) => json!({"ok":true,"value":value}),
            Err(error) => json!({"ok":false,"name":error.name(),"message":error.message()}),
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}

fn payroll_fixture() -> serde_json::Value {
    value_pool::decode(include_str!("../../reference/payroll-page-golden.json"))["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["args"]["settings"]["version"] == 2)
        .unwrap()
        .clone()
}
fn fail(raw: &mut serde_json::Value, kind: SourceKind) {
    salary_snapshot::set(raw, kind, json!({"state":"FAILED","code":"READ_FAILED"}));
}
fn raw_setup() -> (serde_json::Value, serde_json::Value) {
    let case = payroll_fixture();
    let mut raw = salary_snapshot::raw(&case);
    for kind in [
        SourceKind::CalendarEntries,
        SourceKind::SalaryPaymentPreferences,
        SourceKind::ActualAnnualPayments,
        SourceKind::TariffAnnualClaims,
        SourceKind::LegacyTariffDecisions,
        SourceKind::WorkPatternSettings,
        SourceKind::WorkingTimeTarget,
        SourceKind::YouthPreference,
    ] {
        fail(&mut raw, kind);
    }
    (case, raw)
}
#[test]
fn setup_reads_native_sources_without_calendar_target_payments_or_finance() {
    let (case, raw) = raw_setup();
    let facts = salary_snapshot::facts(raw);
    let corpus = value_pool::decode(include_str!(
        "../../reference/payroll-setup-source-golden.json"
    ));
    let id = format!("payroll-{}", case["id"].as_str().unwrap());
    let expected = &corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id)
        .unwrap()["expected"]["value"];
    let month = case["input"]["month"].as_str().unwrap();
    let actual = payroll_form::calculate(
        &facts,
        &PayrollFormCommand::SetupSource {
            month: month.into(),
        },
    )
    .unwrap();
    common::assert_json_eq(&actual, expected, "native setup source");
    assert!(
        facts.financial_context().is_err(),
        "Finance sources are deliberately unavailable"
    );
}
#[test]
fn test_data_blocking_does_not_read_failed_net_setup_io() {
    let (case, mut raw) = raw_setup();
    let month = case["input"]["month"].as_str().unwrap();
    salary_snapshot::set(
        &mut raw,
        SourceKind::TestMonths,
        json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":[{"month":month}]}}}),
    );
    fail(&mut raw, SourceKind::NetPaySettingsTimeline);
    let facts = salary_snapshot::facts(raw);
    assert_eq!(
        payroll_form::calculate(
            &facts,
            &PayrollFormCommand::SetupSource {
                month: month.into()
            }
        )
        .unwrap(),
        json!({"state":"UNAVAILABLE","code":"TEST_MONTH"})
    );
}
#[test]
fn failed_setup_groups_are_never_promoted_to_default_ready_forms() {
    for kind in [
        SourceKind::WorkProfile,
        SourceKind::RemunerationProfiles,
        SourceKind::TestMonths,
        SourceKind::NetPaySettingsTimeline,
    ] {
        let (case, mut raw) = raw_setup();
        fail(&mut raw, kind);
        let facts = salary_snapshot::facts(raw);
        let result = payroll_form::calculate(
            &facts,
            &PayrollFormCommand::SetupSource {
                month: case["input"]["month"].as_str().unwrap().into(),
            },
        )
        .unwrap();
        assert_eq!(result["state"], "UNAVAILABLE");
        assert_eq!(result["code"], "SOURCE_READ_FAILED");
        assert_eq!(
            result["reason"]["source"],
            serde_json::to_value(kind).unwrap()
        );
    }
}
#[test]
fn setup_wire_accepts_only_a_raw_month_not_sender_selected_profiles_or_ready_settings() {
    for extra in [
        json!({"initial":{}}),
        json!({"ready":true}),
        json!({"profile":{}}),
    ] {
        let mut value = json!({"kind":"SETUP_SOURCE","month":"2026-11"});
        value
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        assert!(serde_json::from_value::<PayrollFormCommand>(value).is_err());
    }
}
