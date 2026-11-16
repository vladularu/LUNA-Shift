mod common;
#[path = "support/salary_snapshot.rs"]
mod salary_snapshot;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::runtime::payroll_form::source::{
    PayrollSetupSubmit, PayrollSource, PayrollSourceMode, PayrollSourceOpen,
};
use serde_json::json;
use std::collections::BTreeMap;
use std::sync::Arc;
#[test]
fn original_form_submit_and_effective_month_guards_use_the_opening_native_source() {
    let payroll = value_pool::decode(include_str!("../../reference/payroll-page-golden.json"));
    let submits = value_pool::decode(include_str!(
        "../../reference/payroll-source-submit-golden.json"
    ));
    let mut sources = BTreeMap::new();
    let mut count = 0;
    for case in submits["cases"].as_array().unwrap() {
        let id = case["sourceId"].as_str().unwrap();
        let source = sources.entry(id.to_owned()).or_insert_with(|| {
            let original = payroll["cases"]
                .as_array()
                .unwrap()
                .iter()
                .find(|c| c["id"] == id)
                .unwrap();
            let facts = salary_snapshot::facts(salary_snapshot::raw(original));
            match PayrollSource::open(
                &facts,
                original["input"]["month"].as_str().unwrap(),
                PayrollSourceMode::Setup,
            )
            .unwrap()
            {
                PayrollSourceOpen::Ready(source) => source,
                _ => panic!("genuine setup source unavailable: {id}"),
            }
        });
        let input: PayrollSetupSubmit = serde_json::from_value(case["submit"].clone()).unwrap();
        let actual = match source.prepare_setup(&input) {
            Ok(settings) => json!({"ok":true,"settings":settings.settings()}),
            Err(error) => json!({"ok":false,"name":error.name(),"message":error.message()}),
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
        count += 1;
    }
    assert_eq!(sources.len(), 293);
    assert_eq!(count, 1483);
}
#[test]
fn raw_setup_wire_does_not_accept_initial_settings_or_sender_selected_source_month() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/payroll-source-submit-golden.json"
    ));
    let raw = &fixture["cases"][0]["submit"];
    for (key, value) in [
        ("initial", json!({})),
        ("month", json!("2040-01")),
        ("ready", json!(true)),
    ] {
        let mut altered = raw.clone();
        altered[key] = value;
        assert!(serde_json::from_value::<PayrollSetupSubmit>(altered).is_err());
    }
    assert!(serde_json::from_value::<PayrollSourceMode>(json!("READY")).is_err());
}
fn positive_case() -> serde_json::Value {
    let payroll = value_pool::decode(include_str!("../../reference/payroll-page-golden.json"));
    payroll["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "services-ready-2026-11-PAYOUT-false")
        .unwrap()
        .clone()
}
fn ready(open: PayrollSourceOpen) -> PayrollSource {
    match open {
        PayrollSourceOpen::Ready(source) => source,
        other => panic!("unexpected opening {other:?}"),
    }
}
#[test]
fn annual_uses_only_true_finance_seed_and_sources_do_not_keep_facts_alive() {
    use luna_engine::{
        input::payroll_form_command::PayrollFormCommand,
        runtime::{financial_report, payroll_form},
    };
    let case = positive_case();
    let month = case["input"]["month"].as_str().unwrap();
    let facts = Arc::new(salary_snapshot::facts(salary_snapshot::raw(&case)));
    assert!(matches!(
        PayrollSource::open(&facts, month, PayrollSourceMode::Annual).unwrap(),
        PayrollSourceOpen::NeedsFinance
    ));
    let page = financial_report::payroll::calculate(&facts, month).unwrap();
    common::assert_json_eq(
        &page,
        &case["expected"],
        "original money unchanged by source opening",
    );
    let annual = ready(PayrollSource::open(&facts, month, PayrollSourceMode::Annual).unwrap());
    let setup = ready(PayrollSource::open(&facts, month, PayrollSourceMode::Setup).unwrap());
    let timing = ready(PayrollSource::open(&facts, month, PayrollSourceMode::Timing).unwrap());
    let annual_view = payroll_form::calculate(
        &facts,
        &PayrollFormCommand::AnnualEditor {
            month: month.into(),
        },
    )
    .unwrap();
    common::assert_json_eq(annual.view(), &annual_view, "genuine native source editor");
    common::assert_json_eq(
        timing.view(),
        &json!({"state":"READY","month":month,"timing":case["expected"]["timing"]}),
        "original timing view",
    );
    let raw_form = annual.view()["seed"]["form"].clone();
    let expected = payroll_form::calculate(
        &facts,
        &PayrollFormCommand::AnnualSave {
            month: month.into(),
            form: raw_form.clone(),
        },
    )
    .unwrap();
    let weak = Arc::downgrade(&facts);
    drop(facts);
    assert!(
        weak.upgrade().is_none(),
        "resource must not pin raw plans/snapshot facts"
    );
    let actual = match annual.prepare_annual(&raw_form).unwrap() {
        Some(settings) => json!({"state":"DRAFT","settings":settings.settings()}),
        None => json!({"state":"NO_CHANGE"}),
    };
    common::assert_json_eq(
        &actual,
        &expected,
        "same native save survives dropping facts",
    );
    assert!(setup.prepare_annual(&raw_form).is_err());
    for source in [annual, setup, timing] {
        assert!(
            source
                .retained_bytes()
                .is_some_and(|n| n > 0 && n < 256 * 1024)
        );
    }
}
#[test]
fn fifty_thousand_unused_raw_calendar_rows_are_not_retained_by_setup_or_timing_sources() {
    use luna_engine::contract::SourceKind;
    let case = positive_case();
    let month = case["input"]["month"].as_str().unwrap();
    let mut raw = salary_snapshot::raw(&case);
    let template = &case["input"]["shiftRows"][0];
    let rows = (0..50000)
        .map(|i| {
            let mut row = template.clone();
            row["id"] = json!(format!("retention-{i:05}"));
            row
        })
        .collect::<Vec<_>>();
    salary_snapshot::set(
        &mut raw,
        SourceKind::CalendarEntries,
        json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":{"shiftRows":rows,"appointmentRows":[],"platformCollationRanks":{}}}}}),
    );
    // Domain/calendar-rank admission is deliberately not requested by either
    // form; the immutable raw SQL payload is still a large retained allocation.
    let facts = Arc::new(salary_snapshot::facts(raw));
    let weak = Arc::downgrade(&facts);
    let setup = ready(PayrollSource::open(&facts, month, PayrollSourceMode::Setup).unwrap());
    let timing = ready(PayrollSource::open(&facts, month, PayrollSourceMode::Timing).unwrap());
    drop(facts);
    assert!(weak.upgrade().is_none());
    for source in [setup, timing] {
        assert!(source.retained_bytes().is_some_and(|n| n < 64 * 1024));
        assert_eq!(source.view()["state"], "READY");
    }
}
#[test]
fn timing_is_independent_of_failed_profile_net_calendar_and_target_groups() {
    use luna_engine::contract::SourceKind;
    let case = positive_case();
    let month = case["input"]["month"].as_str().unwrap();
    let mut raw = salary_snapshot::raw(&case);
    for kind in [
        SourceKind::WorkProfile,
        SourceKind::RemunerationProfiles,
        SourceKind::NetPaySettingsTimeline,
        SourceKind::CalendarEntries,
        SourceKind::WorkingTimeTarget,
        SourceKind::YouthPreference,
    ] {
        salary_snapshot::set(
            &mut raw,
            kind,
            json!({"state":"FAILED","code":"READ_FAILED"}),
        );
    }
    let facts = salary_snapshot::facts(raw);
    let source = ready(PayrollSource::open(&facts, month, PayrollSourceMode::Timing).unwrap());
    common::assert_json_eq(
        source.view(),
        &json!({"state":"READY","month":month,"timing":case["expected"]["timing"]}),
        "only genuine preference source is read",
    );
    assert!(facts.financial_context().is_err());
}
