mod common;
#[path = "support/snapshot.rs"]
mod snapshot;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    contract::{
        self, ImmutableSnapshot, ReportPeriod, SalaryPerspective, SourceKind, ValidatedRequest,
    },
    runtime::{
        facts::SnapshotFacts, report::SectionOutput, view_composition::ViewCompositionSource,
    },
};
use serde_json::{Value, json};
use std::sync::Arc;
fn native_book(
    f: &SnapshotFacts,
    resolver: Arc<luna_engine::rules::RuleResolver>,
    pause_ready: bool,
) -> luna_engine::report::financial::assessed_source::AssessedSourceBook {
    use luna_engine::{
        input::draft_rows::DraftRowsKind,
        remuneration::{
            base::prepared::PaidAbsenceIndex,
            draft_facts::{
                model::ConfirmationKind,
                prepared::{AnnexPremiumOwner, DraftConfirmationOwner},
            },
            overtime::prepared::OvertimeAllocationIndex,
        },
        report::financial::assessed_source::{
            AssessedSourceBook,
            input::{AssessedSourceInput, Evidence},
        },
    };
    let confirm = |rows, kind| {
        Evidence::Ready(Arc::new(
            DraftConfirmationOwner::new(kind, Arc::clone(f.draft_evidence(rows).unwrap().saved()))
                .unwrap(),
        ))
    };
    AssessedSourceBook::new(AssessedSourceInput {
        work_profile: Arc::clone(f.financial_profile().unwrap().unwrap()),
        active_shifts: Arc::clone(f.calendar().unwrap().active_shifts()),
        history: Arc::clone(f.employment_history().unwrap().profiles()),
        resolver,
        settings: f.work_pattern().unwrap().settings().clone(),
        legacy_decisions: Arc::clone(f.tariff_decisions().unwrap().decisions()),
        scoped_decisions: Evidence::Ready(Arc::clone(f.scoped_allowances().unwrap())),
        paid_absences: Evidence::Ready(Arc::new(
            PaidAbsenceIndex::new(Arc::clone(f.paid_absences().unwrap().saved())).unwrap(),
        )),
        overtime_allocations: Evidence::Ready(Arc::new(
            OvertimeAllocationIndex::new(Arc::clone(f.overtime_allocations().unwrap().saved()))
                .unwrap(),
        )),
        actual_annual_payments: Evidence::Ready(Arc::clone(f.actual_annual_payments().unwrap())),
        tariff_annual_claims: Evidence::Ready(Arc::clone(f.tariff_annual_claims().unwrap())),
        tvl_shift_work: Evidence::Ready(Arc::clone(
            f.draft_evidence(DraftRowsKind::TvlShiftWork).unwrap(),
        )),
        annex_month: confirm(DraftRowsKind::AnnexAMonth, ConfirmationKind::AnnexA),
        annex_premium: Evidence::Ready(Arc::new(
            AnnexPremiumOwner::new(Arc::clone(
                f.draft_evidence(DraftRowsKind::AnnexAPremium)
                    .unwrap()
                    .saved(),
            ))
            .unwrap(),
        )),
        sue_month: confirm(DraftRowsKind::SueMonth, ConfirmationKind::SueMonth),
        sue_allowance: confirm(DraftRowsKind::SueAllowance, ConfirmationKind::SueAllowance),
        pause_details: if pause_ready {
            Evidence::Ready(Arc::clone(f.annex_pause_details().unwrap()))
        } else {
            Evidence::NotRequested
        },
    })
    .unwrap()
}
fn corpus() -> Value {
    value_pool::decode(include_str!("../../reference/dated-view-golden.json"))
}
fn ready(value: Value) -> Value {
    json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":value}}})
}
fn set(out: &mut Value, kind: SourceKind, state: Value) {
    out["sources"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|s| s["kind"] == json!(kind))
        .unwrap()["source"] = state;
}
fn raw(i: &Value, catalog: &Value) -> Value {
    let mut out = snapshot::raw_snapshot(1, "dated-view", 1);
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
    set(
        &mut out,
        SourceKind::WorkingTimeTarget,
        json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"NULL"}}}),
    );
    set(
        &mut out,
        SourceKind::YouthPreference,
        ready(json!({"value":"false"})),
    );
    set(
        &mut out,
        SourceKind::LegacyTariffDecisions,
        ready(json!([])),
    );
    set(&mut out, SourceKind::TestMonths, ready(json!([])));
    for (kind, key) in [
        (SourceKind::ActualAnnualPayments, "annual"),
        (SourceKind::TariffAnnualClaims, "claims"),
        (SourceKind::ScopedAllowanceDecisions, "scoped"),
        (SourceKind::TvlShiftWork, "tvl"),
        (SourceKind::AnnexAMonthConfirmations, "annex"),
        (SourceKind::AnnexAPremiumFacts, "premium"),
        (SourceKind::SueMonthConfirmations, "sue"),
        (SourceKind::SueAllowanceConfirmations, "sueAllowance"),
    ] {
        set(&mut out, kind, ready(i["rows"][key].clone()));
    }
    if i["pauseComplete"] == true {
        set(
            &mut out,
            SourceKind::AnnexAPauseDetails,
            ready(i["rows"]["pause"].clone()),
        );
    }
    let paid=i["paidAbsences"].as_array().unwrap().iter().map(|v|json!({"shift_id":v["shiftId"],"shift_revision":v["shiftRevision"],"shift_date":v["shiftDate"],"shift_updated_at":v["shiftUpdatedAt"],"time_zone":v["timeZone"],"paid_minutes":v["paidMinutes"],"revision":v["revision"],"confirmed_at":v["confirmedAt"],"updated_at":v["updatedAt"]})).collect::<Vec<_>>();
    set(&mut out, SourceKind::PaidAbsences, ready(json!(paid)));
    let overtime=i["overtimeAllocations"].as_array().unwrap().iter().map(|v|json!({"shift_id":v["shiftId"],"shift_revision":v["shiftRevision"],"time_zone":v["timeZone"],"allocations_json":serde_json::to_string(&v["allocations"]).unwrap(),"revision":v["revision"],"confirmed_at":v["confirmedAt"],"updated_at":v["updatedAt"]})).collect::<Vec<_>>();
    set(
        &mut out,
        SourceKind::OvertimeAllocations,
        ready(json!(overtime)),
    );
    for kind in ["tariff", "legal", "holiday"] {
        out["catalogs"]["current"][kind] = ready(catalog["rawSource"]["parts"][kind].clone());
        out["catalogs"]["current"]["selectedPackageIds"][kind] =
            json!([catalog["rawSource"]["packageIds"][kind]]);
    }
    out
}
fn facts(mut raw: Value) -> SnapshotFacts {
    snapshot::seal(&mut raw);
    let e = json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"REGISTER_SNAPSHOT","snapshot":raw}});
    let s: ImmutableSnapshot =
        match contract::parse_request(&serde_json::to_vec(&e).unwrap()).unwrap() {
            ValidatedRequest::RegisterSnapshot(s) => s,
            _ => panic!("snapshot"),
        };
    SnapshotFacts::new(s)
}
fn value(v: SectionOutput) -> Value {
    match v {
        SectionOutput::Ready { value } => value,
        v => panic!("native ready expected: {v:?}"),
    }
}
fn join(mut base: Value, overlay: &Value) -> Value {
    for (k, v) in overlay.as_object().unwrap() {
        if k == "months" {
            for row in v.as_array().unwrap() {
                let month = &row["month"];
                let target = base["months"]
                    .as_array_mut()
                    .unwrap()
                    .iter_mut()
                    .find(|v| v["month"] == *month)
                    .unwrap();
                for (k, v) in row.as_object().unwrap() {
                    target[k] = v.clone();
                }
            }
        } else {
            base[k] = v.clone();
        }
    }
    base
}
#[test]
fn full_original_dated_reports_retain_assessed_results_without_legacy_salary_fallback() {
    let b = corpus();
    assert!(b["cases"].as_array().unwrap().len() >= 15);
    for case in b["cases"].as_array().unwrap() {
        if b["catalogs"][case["track"].as_str().unwrap()]["origin"] != "preview" {
            continue;
        }
        let id = case["id"].as_str().unwrap();
        let facts = facts(raw(
            &case["input"],
            &b["catalogs"][case["track"].as_str().unwrap()],
        ));
        facts
            .catalog()
            .unwrap_or_else(|e| panic!("{id} catalog: {e:?}"));
        let source = ViewCompositionSource::from_facts(&facts);
        let period: ReportPeriod = serde_json::from_value(case["input"]["period"].clone()).unwrap();
        let time = source.time(&period);
        let checks = source.checks(&period);
        let gross = source.gross(&period, SalaryPerspective::Earned);
        let gross = value(gross.overlay);
        assert_eq!(
            gross["datedAnnualReport"]["state"], "READY",
            "{id}: {gross}"
        );
        let mut actual = value(time.core.unwrap());
        actual = join(actual, &value(time.overlay)["annualReport"]);
        actual = join(actual, &value(checks.overlay)["annualReport"]);
        actual = join(actual, &gross["datedAnnualReport"]["value"]);
        common::assert_json_eq(&actual, &case["expected"]["annualReport"], id);
        let month = ReportPeriod::Month {
            month: case["month"].as_str().unwrap().into(),
        };
        let monthly = value(source.gross(&month, SalaryPerspective::Earned).overlay);
        assert_eq!(
            monthly["datedMonthlyRemuneration"]["state"], "READY",
            "{id} monthly {monthly}"
        );
        common::assert_json_eq(
            &monthly["datedMonthlyRemuneration"]["value"],
            &case["expected"]["monthlyRemuneration"],
            &format!("{id}.monthly"),
        );
    }
}
#[test]
fn positive_draft_views_use_the_same_native_projection_without_relaxing_signed_catalog_admission() {
    use luna_engine::{
        compliance::annual::{AnnualComplianceSource, calculate_annual_compliance},
        report::{
            financial::assessed::{
                AssessedMonthProvider, AssessedReportStatus, annual_assessed_financial_report,
            },
            time::TimeReportContext,
            view::dated,
        },
        rules::RuleResolver,
    };
    let b = corpus();
    let mut checked = 0;
    for case in b["cases"].as_array().unwrap() {
        let catalog = &b["catalogs"][case["track"].as_str().unwrap()];
        if catalog["origin"] == "preview" {
            continue;
        }
        let id = case["id"].as_str().unwrap();
        let facts = facts(raw(&case["input"], catalog));
        assert!(
            facts.catalog().is_err(),
            "draft catalogs cannot bypass production admission"
        );
        let resolver = Arc::new(
            RuleResolver::new(
                serde_json::from_str(catalog["catalogJson"].as_str().unwrap()).unwrap(),
                serde_json::from_value(catalog["packageIds"].clone()).unwrap(),
                catalog["historicalJson"]
                    .as_str()
                    .map(|v| serde_json::from_str(v).unwrap()),
            )
            .unwrap()
            .with_collation_ranks(
                serde_json::from_value(
                    catalog["rawSource"]["parts"]["tariff"]["collationRanks"].clone(),
                )
                .unwrap(),
            ),
        );
        let book = native_book(
            &facts,
            Arc::clone(&resolver),
            case["input"]["pauseComplete"] == true,
        );
        let year = 2026;
        let assessed = annual_assessed_financial_report(
            year,
            AssessedReportStatus::Ready,
            &mut book.session(),
        )
        .unwrap();
        let profile = Arc::clone(facts.calculation_profile().unwrap().unwrap());
        let calendar = facts.calendar().unwrap();
        let mut time = TimeReportContext::with_shared_collation(
            Arc::clone(&profile),
            Arc::clone(facts.prepared_targets().unwrap().unwrap()),
            Arc::clone(calendar.entries()),
            Arc::clone(&resolver),
            Arc::clone(calendar.collation()),
        )
        .unwrap();
        let checks = AnnualComplianceSource::with_shared_collation(
            calendar
                .entries()
                .iter()
                .cloned()
                .collect::<Vec<_>>()
                .into(),
            Arc::clone(&profile),
            resolver,
            Arc::clone(calendar.collation()),
            case["input"]["referenceDate"].as_str().unwrap().into(),
            false,
        )
        .unwrap();
        let checks = calculate_annual_compliance(year, &checks, None, calendar.collation())
            .unwrap()
            .into_json();
        let mut actual = time.annual_shared(year).unwrap().as_ref().clone();
        actual = join(actual, &checks);
        actual = join(actual, &dated::annual(&profile, year, &assessed).unwrap());
        common::assert_json_eq(&actual, &case["expected"]["annualReport"], id);
        let monthly = book
            .session()
            .assessed_month(case["month"].as_str().unwrap())
            .unwrap()
            .unwrap();
        common::assert_json_eq(
            &json!(monthly),
            &case["expected"]["monthlyRemuneration"],
            &format!("{id}.monthly"),
        );
        let count = book.cache_stats().unwrap().calculations;
        let _ = annual_assessed_financial_report(
            year,
            AssessedReportStatus::Ready,
            &mut book.session(),
        )
        .unwrap();
        assert_eq!(
            book.cache_stats().unwrap().calculations,
            count,
            "dated views must not price cached months again"
        );
        checked += 1;
    }
    assert!(checked >= 15);
}
fn check_subset(report: &Value) -> Value {
    let mut out = json!({});
    for key in [
        "year",
        "criticalCount",
        "warningCount",
        "infoCount",
        "planningCount",
        "prerequisiteCount",
        "tariffPrerequisiteCount",
        "scopeCount",
        "complianceCoverageComplete",
    ] {
        if let Some(v) = report.get(key) {
            out[key] = v.clone();
        }
    }
    out["months"] = json!(
        report["months"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| {
                let mut out = json!({});
                for key in [
                    "month",
                    "criticalCount",
                    "warningCount",
                    "infoCount",
                    "planningCount",
                    "prerequisiteCount",
                    "tariffPrerequisiteCount",
                    "scopeCount",
                    "checkCounts",
                    "complianceComplete",
                    "trainingTimeDays",
                ] {
                    if let Some(v) = m.get(key) {
                        out[key] = v.clone();
                    }
                }
                out
            })
            .collect::<Vec<_>>()
    );
    out
}
#[test]
fn native_planning_display_variants_preserve_original_counts_without_salary_dependencies() {
    let b = corpus();
    for case in b["cases"].as_array().unwrap() {
        let catalog = &b["catalogs"][case["track"].as_str().unwrap()];
        if catalog["origin"] != "preview" {
            continue;
        }
        let facts = facts(raw(&case["input"], catalog));
        let v = value(
            ViewCompositionSource::from_facts(&facts)
                .checks(&ReportPeriod::Year { year: 2026 })
                .overlay,
        );
        for (field, expected) in [
            ("planningVisibleAnnualReport", "planningVisible"),
            ("planningHiddenAnnualReport", "planningHidden"),
        ] {
            assert_eq!(v[field]["state"], "READY", "{} {field}", case["id"]);
            common::assert_json_eq(
                &v[field]["value"],
                &check_subset(&case["expected"][expected]),
                &format!("{}.{}", case["id"], field),
            );
        }
    }
}
#[test]
fn native_month_planning_display_preserves_complete_original_computations() {
    let b = corpus();
    for case in b["cases"].as_array().unwrap() {
        let catalog = &b["catalogs"][case["track"].as_str().unwrap()];
        if catalog["origin"] != "preview" {
            continue;
        }
        let facts = facts(raw(&case["input"], catalog));
        let period = ReportPeriod::Month {
            month: case["month"].as_str().unwrap().into(),
        };
        let v = value(
            ViewCompositionSource::from_facts(&facts)
                .checks(&period)
                .overlay,
        );
        for (field, expected) in [
            ("planningVisibleMonthlyCompliance", "planningVisibleMonth"),
            ("planningHiddenMonthlyCompliance", "planningHiddenMonth"),
        ] {
            assert_eq!(v[field]["state"], "READY", "{} {field}", case["id"]);
            common::assert_json_eq(
                &v[field]["value"],
                &case["expected"][expected],
                &format!("{}.{}", case["id"], field),
            );
        }
    }
}
#[test]
fn dated_availability_and_native_reuse_do_not_depend_on_net_setup_or_legacy_amounts() {
    let b = corpus();
    let case = b["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| {
            b["catalogs"][c["track"].as_str().unwrap()]["origin"] == "preview"
                && c["expected"]["annualReport"]["remuneration"]["knownSubtotalCents"]
                    .as_i64()
                    .is_some_and(|v| v > 0)
        })
        .unwrap();
    let catalog = &b["catalogs"][case["track"].as_str().unwrap()];
    let input = raw(&case["input"], catalog);
    let period = ReportPeriod::Year { year: 2026 };
    let f = facts(input.clone());
    let source = ViewCompositionSource::from_facts(&f);
    let a = value(source.gross(&period, SalaryPerspective::Earned).overlay);
    let count = f
        .assessed_book()
        .unwrap()
        .cache_stats()
        .unwrap()
        .calculations;
    let again = value(source.gross(&period, SalaryPerspective::Earned).overlay);
    assert_eq!(a["datedAnnualReport"], again["datedAnnualReport"]);
    assert_eq!(
        f.assessed_book()
            .unwrap()
            .cache_stats()
            .unwrap()
            .calculations,
        count
    );
    let mut missing_net = input.clone();
    set(
        &mut missing_net,
        SourceKind::NetPaySettingsTimeline,
        json!({"state":"FAILED","code":"READ_FAILED"}),
    );
    let f = facts(missing_net);
    let result = value(
        ViewCompositionSource::from_facts(&f)
            .gross(&period, SalaryPerspective::Earned)
            .overlay,
    );
    assert_eq!(result["datedAnnualReport"], a["datedAnnualReport"]);
    for (state, code) in [
        (json!({"state":"LOADING"}), "SOURCE_LOADING"),
        (
            json!({"state":"FAILED","code":"READ_FAILED"}),
            "SOURCE_READ_FAILED",
        ),
    ] {
        let mut broken = input.clone();
        set(&mut broken, SourceKind::RemunerationProfiles, state);
        let f = facts(broken);
        let result = value(
            ViewCompositionSource::from_facts(&f)
                .gross(&period, SalaryPerspective::Earned)
                .overlay,
        );
        assert_eq!(result["datedAnnualReport"]["state"], "UNAVAILABLE");
        assert_eq!(result["datedAnnualReport"]["reason"]["code"], code);
        assert_eq!(
            result["datedAnnualReport"]["reason"]["source"],
            "REMUNERATION_PROFILES"
        );
    }
    let mut empty = input;
    set(
        &mut empty,
        SourceKind::RemunerationProfiles,
        ready(json!([])),
    );
    let f = facts(empty);
    let result = value(
        ViewCompositionSource::from_facts(&f)
            .gross(&period, SalaryPerspective::Earned)
            .overlay,
    );
    let dated = &result["datedAnnualReport"]["value"];
    assert_eq!(dated["availablePayMonthCount"], 0);
    assert_eq!(dated["remuneration"]["hasKnownAmounts"], false);
    assert_eq!(dated["remuneration"]["estimatedGrossCents"], Value::Null);
    assert_eq!(dated["remuneration"]["completeMonthCount"], 0);
}
