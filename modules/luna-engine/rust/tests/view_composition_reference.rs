mod common;
#[path = "support/snapshot.rs"]
mod snapshot;
use luna_engine::{
    contract::{
        self, ImmutableSnapshot, ReportPeriod, SalaryPerspective, SourceKind, ValidatedRequest,
    },
    report::financial::{FinancialSnapshotInput, source::FinancialContext},
    rules::RuleResolver,
    runtime::{
        facts::SnapshotFacts, report::SectionOutput, view_composition::ViewCompositionSource,
    },
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, sync::Arc};
fn ready(v: Value) -> Value {
    json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":v}}})
}
fn set(out: &mut Value, kind: SourceKind, value: Value) {
    let k = json!(kind);
    out["sources"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|v| v["kind"] == k)
        .unwrap()["source"] = value;
}
fn raw(i: &Value) -> Value {
    let mut out = snapshot::raw_snapshot(1, "view-fixture", 1);
    out["referenceDate"] = i["referenceDate"].clone();
    for (kind, key) in [
        (SourceKind::WorkProfile, "profile"),
        (SourceKind::RemunerationProfiles, "historyRows"),
        (SourceKind::WorkPatternSettings, "patternRows"),
    ] {
        set(&mut out, kind, ready(i[key].clone()));
    }
    set(
        &mut out,
        SourceKind::CalendarEntries,
        ready(
            json!({"shiftRows":i["shiftRows"],"appointmentRows":[],"platformCollationRanks":i["platformCollationRanks"]}),
        ),
    );
    let mut target = i["targetRow"].clone();
    if target.is_null() {
        set(
            &mut out,
            SourceKind::WorkingTimeTarget,
            json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"NULL"}}}),
        );
    } else {
        let value = target
            .as_object_mut()
            .unwrap()
            .remove("settings_json")
            .unwrap();
        target["settings_json_chunks"] = json!([value]);
        set(&mut out, SourceKind::WorkingTimeTarget, ready(target));
    }
    set(
        &mut out,
        SourceKind::YouthPreference,
        ready(json!({"value":if i["youthProtection"]==true{"true"}else{"false"}})),
    );
    if i["trainingRequested"] == true {
        for (kind, key) in [
            (SourceKind::TrainingProfiles, "trainingProfileRows"),
            (SourceKind::TrainingShiftDetails, "trainingDetailRows"),
        ] {
            set(&mut out, kind, ready(i[key].clone()));
        }
    }
    for kind in [
        SourceKind::LegacyTariffDecisions,
        SourceKind::TestMonths,
        SourceKind::ActualAnnualPayments,
        SourceKind::TariffAnnualClaims,
    ] {
        set(&mut out, kind, ready(json!([])));
    }
    if i["annualPaymentsRequested"] == true {
        let timeline=i["netTimeline"].as_array().unwrap().iter().map(|r|json!({"month":r["settings"]["month"],"settings_json":serde_json::to_string(&r["settings"]).unwrap(),"revision":r["revision"],"created_at":r["createdAt"],"updated_at":r["updatedAt"]})).collect::<Vec<_>>();
        set(
            &mut out,
            SourceKind::NetPaySettingsTimeline,
            ready(json!(timeline)),
        );
    }
    out["catalogs"]["current"]["selectedPackageIds"] = json!({"tariff":["tvoed-p-vka-legacy"],"legal":["de-arbzg-care-legacy"],"holiday":["de-holidays-legacy"]});
    for kind in ["tariff", "legal", "holiday"] {
        out["catalogs"]["current"][kind] = ready(json!({"mode":"COMPILED_LEGACY"}));
    }
    out
}
fn facts(mut raw: Value) -> SnapshotFacts {
    snapshot::seal(&mut raw);
    let envelope = json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"REGISTER_SNAPSHOT","snapshot":raw}});
    let snapshot: ImmutableSnapshot =
        match contract::parse_request(&serde_json::to_vec(&envelope).unwrap()).unwrap() {
            ValidatedRequest::RegisterSnapshot(s) => s,
            _ => panic!("snapshot expected"),
        };
    SnapshotFacts::new(snapshot)
}
fn value(output: SectionOutput, path: &str) -> Value {
    match output {
        SectionOutput::Ready { value } => value,
        _ => panic!("{path} expected ready, got {output:?}"),
    }
}
// Exactly the structural operation the thin host adapter may perform. No sums,
// counts, monetary rounding or calculated input is supplied to the engine.
fn join(mut base: Value, overlays: &[Value], field: &str) -> Value {
    for overlay in overlays {
        let fields = &overlay[field];
        for (key, v) in fields.as_object().expect("native fields") {
            if key == "months" {
                for row in v.as_array().unwrap() {
                    let month = row["month"].as_str().unwrap();
                    let destination = base["months"]
                        .as_array_mut()
                        .unwrap()
                        .iter_mut()
                        .find(|m| m["month"] == month)
                        .unwrap();
                    for (k, v) in row.as_object().unwrap() {
                        destination[k] = v.clone();
                    }
                }
            } else {
                base[key] = v.clone();
            }
        }
    }
    base
}
fn corpus() -> Value {
    serde_json::from_str(include_str!("../../reference/view-composition-golden.json")).unwrap()
}
#[test]
fn annual_salary_ui_matches_original_test_month_protection_without_host_financial_work() {
    let corpus: Value =
        serde_json::from_str(include_str!("../../reference/annual-salary-ui-golden.json")).unwrap();
    let cases = corpus["cases"].as_array().unwrap();
    let (display_cases, details_cases) = {
        #[path = "support/value_pool.rs"]
        mod display_pool;
        (
            display_pool::decode(include_str!(
                "../../reference/annual-financial-display-golden.json"
            )),
            display_pool::decode(include_str!(
                "../../reference/annual-financial-details-golden.json"
            )),
        )
    };
    assert_eq!(cases.len(), 78);
    let mut dump = Vec::new();
    for case in cases {
        let input = &case["input"];
        let id = case["id"].as_str().unwrap();
        let period: ReportPeriod = serde_json::from_value(input["period"].clone()).unwrap();
        let mut source = raw(input);
        set(
            &mut source,
            SourceKind::TestMonths,
            ready(input["testMonthRows"].clone()),
        );
        let facts = facts(source);
        let views = ViewCompositionSource::from_facts(&facts);
        let time = views.time(&period);
        let core = value(time.core.unwrap(), id);
        let time = value(time.overlay, id);
        let checks = value(views.checks(&period).overlay, id);
        let gross = value(views.gross(&period, SalaryPerspective::Earned).overlay, id);
        assert_eq!(
            gross["annualSalaryPolicy"]["allowAnnualPayments"], case["allowAnnualPayments"],
            "{id}"
        );
        assert_eq!(gross["annualSalaryUiReport"]["state"], "READY", "{id}");
        let expected_display = display_cases["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|case| case["kind"] == "GROSS" && case["id"] == id)
            .unwrap();
        assert_eq!(gross["annualFinancialOverview"]["state"], "READY", "{id}");
        common::assert_json_eq(
            &gross["annualFinancialOverview"]["value"],
            &expected_display["expected"],
            id,
        );
        let expected_details = &details_cases["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|case| case["id"] == format!("raw-{id}"))
            .unwrap()["expected"];
        for part in ["salary", "premium", "pending"] {
            assert_eq!(
                gross["annualFinancialDetails"][part]["state"], "READY",
                "{id}"
            );
            common::assert_json_eq(
                &gross["annualFinancialDetails"][part]["value"],
                &expected_details[part],
                id,
            );
        }
        let actual = join(
            core.clone(),
            &[
                time.clone(),
                json!({"annualReport":gross["annualSalaryUiReport"]["value"]}),
                checks.clone(),
            ],
            "annualReport",
        );
        common::assert_json_eq(&actual, &case["expected"]["annualReport"], id);
        dump.push(json!({"id":id,"year":input["period"]["year"],"expected":case["expected"]["annualReport"],"actual":{"core":core,"time":time,"gross":gross,"checks":checks}}));
    }
    if let Some(path) = std::env::var_os("LUNA_ANNUAL_SALARY_UI_DUMP") {
        let path = std::path::PathBuf::from(path);
        assert!(path.is_absolute());
        assert_eq!(
            path.file_name().and_then(|name| name.to_str()),
            Some("annual-salary-ui-native-dump.json")
        );
        let document = json!({"schemaVersion":1,"engineVersion":luna_engine::ENGINE_VERSION,"sourceDigest":corpus["sourceDigest"],"fixtureSha256":format!("{:x}",Sha256::digest(include_bytes!("../../reference/annual-salary-ui-golden.json"))),"cases":dump});
        let bytes = serde_json::to_vec(&document).unwrap();
        assert!(bytes.len() < 16 * 1024 * 1024);
        std::fs::write(path, bytes).unwrap();
    }
}
#[test]
fn failed_annual_supplement_keeps_base_premium_details_and_reuses_native_year_pricing() {
    let corpus: Value =
        serde_json::from_str(include_str!("../../reference/annual-salary-ui-golden.json")).unwrap();
    let case = &corpus["cases"][0];
    let period: ReportPeriod = serde_json::from_value(case["input"]["period"].clone()).unwrap();
    let mut source = raw(&case["input"]);
    set(
        &mut source,
        SourceKind::NetPaySettingsTimeline,
        json!({"state":"FAILED","code":"READ_FAILED"}),
    );
    let facts = facts(source);
    let views = ViewCompositionSource::from_facts(&facts);
    let first = value(
        views.gross(&period, SalaryPerspective::Earned).overlay,
        "failed supplement",
    );
    assert_eq!(
        first["annualFinancialDetails"]["salary"]["state"],
        "UNAVAILABLE"
    );
    for part in ["premium", "pending"] {
        assert_eq!(first["annualFinancialDetails"][part]["state"], "READY");
    }
    let context = facts.financial_context().unwrap();
    let before = context.lock().unwrap().reuse_diagnostics();
    let repeated = value(
        views.gross(&period, SalaryPerspective::Earned).overlay,
        "repeat failed supplement",
    );
    common::assert_json_eq(
        &repeated,
        &first,
        "independent annual display readiness is stable",
    );
    assert_eq!(context.lock().unwrap().reuse_diagnostics(), before);
}

#[test]
fn original_full_month_and_year_reports_are_recreated_by_owned_native_fields_only() {
    let b = corpus();
    let dump_path = std::env::var_os("LUNA_VIEW_COMPOSITION_DUMP").map(std::path::PathBuf::from);
    if let Some(path) = &dump_path {
        assert!(path.is_absolute(), "test dump path must be absolute");
        assert_eq!(
            path.file_name().and_then(|v| v.to_str()),
            Some("view-composition-native-dump.json")
        );
    }
    let mut dump = Vec::<Value>::new();
    assert_eq!(b["cases"].as_array().unwrap().len(), 70);
    for case in b["cases"].as_array().unwrap() {
        let facts = facts(raw(&case["input"]));
        let source = ViewCompositionSource::from_facts(&facts);
        let period: ReportPeriod = serde_json::from_value(case["input"]["period"].clone()).unwrap();
        let time = source.time(&period);
        let gross = source.gross(&period, SalaryPerspective::Earned);
        let checks = source.checks(&period);
        let id = case["id"].as_str().unwrap();
        let actual_dump=dump_path.as_ref().map(|_|json!({"core":time.core,"time":time.overlay,"gross":gross.overlay,"checks":checks.overlay,"net":source.net(&period,SalaryPerspective::Earned).overlay}));
        let time_overlay = value(time.overlay, id);
        let gross_overlay = value(gross.overlay, id);
        let checks_overlay = value(checks.overlay, id);
        let actual = if matches!(period, ReportPeriod::Month { .. }) {
            join(json!({}), &[time_overlay, gross_overlay], "monthlyAnalysis")
        } else {
            let core = value(time.core.expect("core offered"), id);
            common::assert_json_eq(&core, &case["expected"]["core"], &format!("{id}.core"));
            join(
                core,
                &[time_overlay, gross_overlay, checks_overlay],
                "annualReport",
            )
        };
        common::assert_json_eq(
            &actual,
            if matches!(period, ReportPeriod::Month { .. }) {
                &case["expected"]["monthlyAnalysis"]
            } else {
                &case["expected"]["annualReport"]
            },
            id,
        );
        if let Some(actual) = actual_dump {
            dump.push(json!({"id":id,"period":period,"originalExpected":case["expected"],"actual":actual}));
        }
    }
    if let Some(path) = dump_path {
        let fixture_sha = format!(
            "{:x}",
            Sha256::digest(include_bytes!(
                "../../reference/view-composition-golden.json"
            ))
        );
        let bytes=serde_json::to_vec(&json!({"schemaVersion":1,"fixtureSha256":fixture_sha,"sourceDigest":b["sourceDigest"],"caseCount":dump.len(),"cases":dump})).unwrap();
        assert!(bytes.len() <= 16 * 1024 * 1024, "bounded test-only UI dump");
        std::fs::write(path, bytes).unwrap();
    }
}
#[test]
fn original_failed_pay_keeps_the_typed_rule_cause_across_native_financial_source() {
    let b = corpus();
    let case = &b["failures"][0];
    let facts = facts(raw(&case["input"]));
    let profile = Arc::clone(facts.financial_profile().unwrap().unwrap());
    let entries = Arc::clone(facts.calendar().unwrap().entries());
    let resolver = Arc::new(
        RuleResolver::from_catalog_json(
            case["input"]["catalog"].clone(),
            serde_json::from_value(case["input"]["packageIds"].clone()).unwrap(),
            None,
        )
        .unwrap(),
    );
    let pattern = facts.work_pattern().unwrap().settings();
    let tests = BTreeSet::new();
    let input = FinancialSnapshotInput {
        profile: &profile,
        entries: &entries,
        tariff_decisions: &[],
        work_pattern_settings: pattern,
        test_months: &tests,
    };
    let mut context = FinancialContext::new_shared(&input, resolver).unwrap();
    let month = case["input"]["period"]["month"].as_str().unwrap();
    let error = context.salary_month(month).unwrap_err();
    let cause = error
        .rule_failure_details()
        .expect("the actual original rule cause must survive, not merely a bool/message");
    common::assert_json_eq(
        &json!(cause),
        &case["expected"]["failure"],
        "failed-pay-cause",
    );
}

#[test]
fn time_gross_checks_and_provisional_core_keep_independent_source_states() {
    let b = corpus();
    let input = &b["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "month-p9-h0-plan0-trainingtrue")
        .unwrap()["input"];
    let period: ReportPeriod = serde_json::from_value(input["period"].clone()).unwrap();
    let mut source = raw(input);
    for kind in [
        SourceKind::NetPaySettingsTimeline,
        SourceKind::SalaryPaymentPreferences,
        SourceKind::TrainingProfiles,
        SourceKind::TrainingShiftDetails,
    ] {
        set(
            &mut source,
            kind,
            json!({"state":"FAILED","code":"READ_FAILED"}),
        );
    }
    let source = facts(source);
    let views = ViewCompositionSource::from_facts(&source);
    assert!(matches!(
        views.time(&period).output,
        SectionOutput::Ready { .. }
    ));
    let gross = value(
        views.gross(&period, SalaryPerspective::Earned).overlay,
        "gross independent",
    );
    assert_eq!(gross["monthlyAnalysis"]["pay"]["ok"], true);
    let checks = value(views.checks(&period).overlay, "partial checks");
    assert_eq!(checks["trainingState"]["state"], "UNAVAILABLE");
    assert_eq!(
        checks["monthlyCompliance"]["value"]["trainingComplete"],
        false
    );
    assert!(matches!(
        views.net(&period, SalaryPerspective::Earned).output,
        SectionOutput::Unavailable { .. }
    ));
    let mut invalid_target = raw(input);
    set(
        &mut invalid_target,
        SourceKind::WorkingTimeTarget,
        ready(json!({"settings_json_chunks":["not JSON"]})),
    );
    set(
        &mut invalid_target,
        SourceKind::YouthPreference,
        json!({"state":"FAILED","code":"READ_FAILED"}),
    );
    let source = facts(invalid_target);
    let views = ViewCompositionSource::from_facts(&source);
    assert!(matches!(views.core_year(2026), SectionOutput::Ready { .. }));
    assert!(matches!(
        views.gross(&period, SalaryPerspective::Earned).overlay,
        SectionOutput::Ready { .. }
    ));
    let time = views.time(&ReportPeriod::Year { year: 2026 });
    assert!(matches!(time.output, SectionOutput::Unavailable { .. }));
    assert!(matches!(time.core, Some(SectionOutput::Ready { .. })));
}

#[test]
fn core_and_legal_indexes_are_snapshot_owned_retained_and_bounded() {
    let b = corpus();
    let input = &b["cases"][0]["input"];
    let first = facts(raw(input));
    let view = ViewCompositionSource::from_facts(&first);
    assert!(matches!(view.core_year(2026), SectionOutput::Ready { .. }));
    assert!(matches!(view.core_year(2026), SectionOutput::Ready { .. }));
    assert_eq!(view.preparation_stats().unwrap().core_computations, 1);
    let period: ReportPeriod = serde_json::from_value(input["period"].clone()).unwrap();
    for _ in 0..2 {
        assert!(matches!(
            view.time(&period).overlay,
            SectionOutput::Ready { .. }
        ));
    }
    assert_eq!(view.preparation_stats().unwrap().legal_index_builds, 1);
    for year in 2010..2017 {
        assert!(matches!(view.core_year(year), SectionOutput::Ready { .. }));
    }
    assert_eq!(view.preparation_stats().unwrap().cached_core_years, 3);
    let other = facts(raw(input));
    let other_view = ViewCompositionSource::from_facts(&other);
    assert_eq!(other_view.preparation_stats().unwrap().core_computations, 0);
    assert!(matches!(
        other_view.core_year(2026),
        SectionOutput::Ready { .. }
    ));
    assert_eq!(other_view.preparation_stats().unwrap().core_computations, 1);
    assert_eq!(view.preparation_stats().unwrap().core_computations, 8);
}

#[test]
fn original_payload_stays_identical_and_ui_presentation_reuses_native_pricing() {
    use luna_engine::runtime::financial_report;
    let b = corpus();
    let input = &b["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "month-p9-h0-plan0-trainingfalse")
        .unwrap()["input"];
    let source = facts(raw(input));
    let period: ReportPeriod = serde_json::from_value(input["period"].clone()).unwrap();
    let original = financial_report::gross(&source, &period, SalaryPerspective::Earned).unwrap();
    let before = source
        .financial_context()
        .unwrap()
        .lock()
        .unwrap()
        .reuse_diagnostics();
    let presentation =
        ViewCompositionSource::from_facts(&source).gross(&period, SalaryPerspective::Earned);
    let after = source
        .financial_context()
        .unwrap()
        .lock()
        .unwrap()
        .reuse_diagnostics();
    common::assert_json_eq(
        &value(presentation.output, "original"),
        &original,
        "S5originalunchanged",
    );
    assert_eq!(
        before["raw"]["nativePricingPasses"],
        after["raw"]["nativePricingPasses"]
    );
}

#[test]
fn native_month_display_reuses_original_monthly_output_without_additional_core_work() {
    let expected: Value =
        serde_json::from_str(include_str!("../../reference/time-display-golden.json")).unwrap();
    let original = corpus();
    let mut count = 0;
    for case in original["cases"].as_array().unwrap() {
        let period: ReportPeriod = serde_json::from_value(case["input"]["period"].clone()).unwrap();
        if !matches!(period, ReportPeriod::Month { .. }) {
            continue;
        }
        let facts = facts(raw(&case["input"]));
        let source = ViewCompositionSource::from_facts(&facts);
        let before = source.preparation_stats().unwrap();
        let overlay = value(source.time(&period).overlay, "time display");
        let id = format!("original-month-{}", case["id"].as_str().unwrap());
        let expected = expected["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["id"] == id)
            .expect("complete original display");
        let display = &overlay["worktimeDisplay"];
        assert_eq!(display["state"], "READY", "{id}");
        let mut actual = display["value"].clone();
        let dashboard = actual
            .as_object_mut()
            .unwrap()
            .remove("dashboardCard")
            .expect("native dashboard card");
        common::assert_json_eq(&actual, &expected["expected"], &id);
        let dashboard_cases: Value = serde_json::from_str(include_str!(
            "../../reference/month-time-display-golden.json"
        ))
        .unwrap();
        let dashboard_expected = dashboard_cases["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["id"] == id)
            .unwrap();
        common::assert_json_eq(
            &dashboard,
            &dashboard_expected["expected"],
            &format!("{id}.dashboard"),
        );
        let after = source.preparation_stats().unwrap();
        assert_eq!(before.core_computations, after.core_computations);
        count += 1;
    }
    assert!(count >= 30, "real raw-source monthly corpus");
}

#[test]
fn original_annual_display_is_reused_from_private_completed_and_core_reports() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../reference/annual-time-display-golden.json"
    ))
    .unwrap();
    let modern: Value =
        serde_json::from_str(include_str!("../../reference/annual-salary-ui-golden.json")).unwrap();
    let mut count = 0;
    let dump_path = std::env::var_os("LUNA_ANNUAL_TIME_DISPLAY_DUMP").map(std::path::PathBuf::from);
    if let Some(path) = &dump_path {
        assert!(path.is_absolute());
        assert_eq!(
            path.file_name().and_then(|v| v.to_str()),
            Some("annual-time-display-native-dump.json")
        );
    }
    let mut dump = Vec::new();
    for (file, original) in [
        ("view-composition-golden.json", corpus()),
        ("annual-salary-ui-golden.json", modern),
    ] {
        for case in original["cases"].as_array().unwrap() {
            let period: ReportPeriod =
                serde_json::from_value(case["input"]["period"].clone()).unwrap();
            if !matches!(period, ReportPeriod::Year { .. }) {
                continue;
            }
            let mut input = raw(&case["input"]);
            if let Some(test_months) = case["input"].get("testMonthRows") {
                set(
                    &mut input,
                    SourceKind::TestMonths,
                    ready(test_months.clone()),
                );
            }
            let facts = facts(input);
            let source = ViewCompositionSource::from_facts(&facts);
            let presentation = source.time(&period);
            let overlays = value(presentation.overlay, "year time display");
            for (key, kind, pending) in [
                ("complete", "full", false),
                ("partial", "full", true),
                ("core", "core", true),
            ] {
                let id = format!("{file}:{}:{kind}:{pending}", case["id"].as_str().unwrap());
                let expected = fixture["cases"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|item| item["id"] == id)
                    .unwrap();
                let frame = &overlays["annualTimeDisplay"][key];
                assert_eq!(frame["state"], "READY", "{id}");
                common::assert_json_eq(&frame["value"], &expected["expected"], &id);
            }
            let before = source.preparation_stats().unwrap();
            source.time(&period);
            let after = source.preparation_stats().unwrap();
            assert_eq!(before.core_computations, after.core_computations);
            assert_eq!(before.legal_index_builds, after.legal_index_builds);
            if dump_path.is_some() {
                dump.push(json!({"id":case["id"],"sourceFixture":file,"actual":overlays["annualTimeDisplay"]}));
            }
            count += 1;
        }
    }
    assert_eq!(
        count, 104,
        "26 legacy + 78 modern full original year inputs"
    );
    if let Some(path) = dump_path {
        let bytes=serde_json::to_vec(&json!({"schemaVersion":1,"sourceDigest":corpus()["sourceDigest"],"originalFixtureSha256":format!("{:x}",Sha256::digest(include_bytes!("../../reference/annual-time-display-golden.json"))),"caseCount":dump.len(),"cases":dump})).unwrap();
        assert!(bytes.len() <= 16 * 1024 * 1024);
        std::fs::write(path, bytes).unwrap();
    }
}

#[test]
fn failed_time_keeps_known_core_display_without_inventing_ready_target() {
    let original = corpus();
    let input = &original["cases"][0]["input"];
    let mut broken = raw(input);
    set(
        &mut broken,
        SourceKind::WorkingTimeTarget,
        ready(json!({"settings_json_chunks":["not JSON"]})),
    );
    let facts = facts(broken);
    let source = ViewCompositionSource::from_facts(&facts);
    let result = source.time(&ReportPeriod::Year { year: 2026 });
    assert!(matches!(result.output, SectionOutput::Unavailable { .. }));
    let overlay = value(result.overlay, "independent known core display");
    assert_eq!(overlay["legacyState"]["state"], "UNAVAILABLE");
    assert_eq!(
        overlay["annualTimeDisplay"]["complete"]["state"],
        "UNAVAILABLE"
    );
    assert_eq!(
        overlay["annualTimeDisplay"]["partial"]["state"],
        "UNAVAILABLE"
    );
    assert_eq!(overlay["annualTimeDisplay"]["core"]["state"], "READY");
    assert_eq!(
        overlay["annualTimeDisplay"]["core"]["value"]["overview"]["card"]["target"],
        "Wird berechnet"
    );
}
