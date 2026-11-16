#[path = "support/snapshot.rs"]
mod snapshot;
use luna_engine::{
    contract::{self, CalculationRequest, ImmutableSnapshot, SourceKind, ValidatedRequest},
    runtime::{
        JobLane, SnapshotRegistry,
        facts::{FactError, SnapshotFacts},
        sources::SourceReadError,
    },
};
use serde_json::{Value, json};
use std::sync::Arc;
fn envelope(command: Value) -> Value {
    json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":command})
}
fn parsed(mut raw: Value) -> ImmutableSnapshot {
    snapshot::seal(&mut raw);
    match contract::parse_request(
        &serde_json::to_vec(&envelope(
            json!({"kind":"REGISTER_SNAPSHOT","snapshot":raw}),
        ))
        .unwrap(),
    )
    .unwrap()
    {
        ValidatedRequest::RegisterSnapshot(snapshot) => snapshot,
        _ => panic!("registration expected"),
    }
}
fn ready(data: Value) -> Value {
    json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":data}})
}
fn set(raw: &mut Value, kind: SourceKind, state: Value) {
    let kind = serde_json::to_value(kind).unwrap();
    raw["sources"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|v| v["kind"] == kind)
        .unwrap()["source"] = state;
}
fn profile() -> Value {
    json!({"profileRow":{"federal_state":"NW","holiday_region":"NONE","weekly_minutes":2310,"time_zone":"Europe/Berlin","pay_group":null,"pay_level":null,"tariff_sector":null,"tariff_region":"OTHER","full_time_weekly_minutes":null,"industry":"HEALTHCARE","manual_monthly_gross_cents":null,"regular_rotating_night_work":null,"sunday_holiday_work_eligible":null,"all_employment_work_recorded":null,"display_name":null,"employer_name":null,"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-11-01T00:00:00Z"},"salaryRows":[]})
}
fn sample_raw(revision: u64) -> Value {
    let mut raw = snapshot::raw_snapshot(revision, "owner", 1);
    set(
        &mut raw,
        SourceKind::WorkProfile,
        ready(json!({"kind":"VALUE","value":profile()})),
    );
    set(
        &mut raw,
        SourceKind::WorkPatternSettings,
        ready(json!({"kind":"VALUE","value":[]})),
    );
    set(
        &mut raw,
        SourceKind::YouthPreference,
        ready(json!({"kind":"NULL"})),
    );
    raw
}
fn request(snapshot: &ImmutableSnapshot, checks: bool) -> CalculationRequest {
    let command = json!({"kind":"CALCULATE","request":{"guard":{"snapshot":snapshot.identity(),"requestId":if checks{"checks"}else{"finance"},"requestRevision":1},"periods":[{"kind":"YEAR","year":2026}],"sections":{"time":!checks,"gross":!checks,"net":!checks,"checks":checks},"perspective":"EARNED","priority":"INTERACTIVE"}});
    match contract::parse_request(&serde_json::to_vec(&envelope(command)).unwrap()).unwrap() {
        ValidatedRequest::Calculate(request) => *request,
        _ => panic!("calculation expected"),
    }
}
#[test]
fn independent_facts_are_lazy_and_shared_across_concurrent_workers() {
    let snapshot = parsed(sample_raw(1));
    let facts = Arc::new(SnapshotFacts::new(snapshot.clone()));
    assert!(facts.snapshot().shares_storage_with(&snapshot));
    let workers: Vec<_> = (0..24)
        .map(|_| {
            let facts = facts.clone();
            std::thread::spawn(move || {
                let profile = facts.profile().unwrap().unwrap();
                assert_eq!(profile.core_profile()["weeklyMinutes"], 2310);
                Arc::as_ptr(profile) as usize
            })
        })
        .collect();
    let pointers: Vec<_> = workers.into_iter().map(|w| w.join().unwrap()).collect();
    assert!(pointers.iter().all(|p| *p == pointers[0]));
    assert!(!facts.youth_preference().unwrap());
    let pattern = facts.work_pattern().unwrap();
    assert!(Arc::ptr_eq(pattern, facts.work_pattern().unwrap()));
    // Catalogs were never requested; this does not invalidate the work profile.
    assert!(facts.catalog().is_err());
    assert_eq!(
        Arc::as_ptr(facts.profile().unwrap().unwrap()) as usize,
        pointers[0]
    );
}
#[test]
fn loading_failed_missing_and_successful_null_profiles_remain_distinct() {
    for (state, error) in [
        (json!({"state":"LOADING"}), SourceReadError::Loading),
        (
            json!({"state":"FAILED","code":"READ_FAILED"}),
            SourceReadError::Failed(contract::SourceFailure::ReadFailed),
        ),
        (
            ready(json!({"kind":"MISSING"})),
            SourceReadError::MissingRecord,
        ),
    ] {
        let mut raw = sample_raw(1);
        set(&mut raw, SourceKind::WorkProfile, state);
        let facts = SnapshotFacts::new(parsed(raw));
        assert!(
            matches!(facts.profile(), Err(FactError::Source { kind:SourceKind::WorkProfile, error:actual }) if actual == error)
        );
        assert!(!facts.youth_preference().unwrap());
    }
    let mut raw = sample_raw(1);
    set(
        &mut raw,
        SourceKind::WorkProfile,
        ready(json!({"kind":"NULL"})),
    );
    let facts = SnapshotFacts::new(parsed(raw));
    assert!(facts.profile().unwrap().is_none());
    let mut raw = sample_raw(1);
    set(
        &mut raw,
        SourceKind::YouthPreference,
        json!({"state":"LOADING"}),
    );
    set(
        &mut raw,
        SourceKind::WorkPatternSettings,
        json!({"state":"LOADING"}),
    );
    let facts = SnapshotFacts::new(parsed(raw));
    assert!(facts.youth_preference().is_err());
    assert!(facts.work_pattern().is_err());
    assert!(facts.profile().unwrap().is_some());
}
#[test]
fn raw_salary_drafts_are_preserved_without_fabricating_a_calculation_basis() {
    let mut raw = sample_raw(1);
    let mut profile = profile();
    profile["profileRow"]["manual_monthly_gross_cents"] = json!(0);
    profile["profileRow"]["pay_group"] = json!("P7");
    profile["profileRow"]["pay_level"] = json!(3);
    profile["profileRow"]["tariff_sector"] = json!("BT_K");
    profile["profileRow"]["full_time_weekly_minutes"] = json!(2310);
    set(
        &mut raw,
        SourceKind::WorkProfile,
        ready(json!({"kind":"VALUE","value":profile})),
    );
    let facts = SnapshotFacts::new(parsed(raw));
    let profile = facts.profile().unwrap().unwrap();
    assert_eq!(profile.raw_profile()["manual_monthly_gross_cents"], 0);
    assert_eq!(
        profile.flat_profile()["salaryBasisConflict"]["manualMonthlyGrossCents"],
        0
    );
    assert!(
        profile
            .salary_issues()
            .iter()
            .any(|i| i.code() == "PROFILE_SALARY_CONFLICT")
    );
    assert!(profile.core_profile()["manualMonthlyGrossCents"].is_null());
    assert!(profile.core_profile()["tariff"].is_null());
}
#[test]
fn registry_jobs_share_facts_and_lifecycle_changes_prevent_old_publication() {
    let registry = SnapshotRegistry::default();
    let first = registry.register(parsed(sample_raw(1))).unwrap();
    let finance = registry
        .begin(request(&first, false), JobLane::Finance)
        .unwrap();
    let checks = registry
        .begin(request(&first, true), JobLane::Checks)
        .unwrap();
    assert!(Arc::ptr_eq(finance.facts(), checks.facts()));
    let retained = finance.facts().clone();
    let p = retained.profile().unwrap().unwrap().clone();
    registry.register(parsed(sample_raw(1))).unwrap();
    assert!(registry.is_current(&finance).unwrap());
    let next = registry.register(parsed(sample_raw(2))).unwrap();
    assert!(!registry.is_current(&finance).unwrap());
    assert!(registry.complete(&finance).unwrap().is_none());
    let new_finance = registry
        .begin(request(&next, false), JobLane::Finance)
        .unwrap();
    assert!(!Arc::ptr_eq(new_finance.facts(), &retained));
    assert!(Arc::ptr_eq(&p, retained.profile().unwrap().unwrap()));
    registry.reset().unwrap();
    assert!(registry.complete(&new_finance).unwrap().is_none());
    // In-flight immutable data survives only as its old owned object; it cannot
    // reclaim ownership or publish after reset.
    assert_eq!(p.core_profile()["timeZone"], "Europe/Berlin");
}

#[test]
fn saved_targets_and_employment_rows_are_checked_once_without_reading_unrelated_inputs() {
    let mut raw = sample_raw(1);
    let settings_json =
        "{\"version\":1,\"context\":{\"periods\":[],\"days\":[]},\"planBindings\":[]}";
    let target_row = json!({"id":"singleton","settings_json_chunks":[settings_json],"revision":1,"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-11-01T00:00:00Z"});
    set(
        &mut raw,
        SourceKind::WorkingTimeTarget,
        ready(json!({"kind":"VALUE","value":target_row})),
    );
    let history_row = json!({"id":"legacy","effective_from":null,"data_json":"{\"version\":1,\"weeklyMinutes\":2310,\"selection\":{\"kind\":\"unconfigured\"}}","revision":1,"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-11-01T00:00:00Z"});
    set(
        &mut raw,
        SourceKind::RemunerationProfiles,
        ready(json!({"kind":"VALUE","value":[history_row]})),
    );
    let facts = SnapshotFacts::new(parsed(raw));
    let target = facts.saved_target().unwrap().unwrap();
    assert!(Arc::ptr_eq(target, facts.saved_target().unwrap().unwrap()));
    assert_eq!(target.saved()["settings"]["context"]["days"], json!([]));
    let history = facts.employment_history().unwrap();
    assert!(Arc::ptr_eq(history, facts.employment_history().unwrap()));
    assert_eq!(history.profiles()[0]["data"]["weeklyMinutes"], 2310);
    assert!(history.profiles()[0]["effectiveFrom"].is_null());
    assert!(facts.catalog().is_err());
    let mut raw = sample_raw(2);
    set(
        &mut raw,
        SourceKind::WorkingTimeTarget,
        ready(json!({"kind":"NULL"})),
    );
    set(
        &mut raw,
        SourceKind::RemunerationProfiles,
        ready(json!({"kind":"VALUE","value":[]})),
    );
    let facts = SnapshotFacts::new(parsed(raw));
    assert!(facts.saved_target().unwrap().is_none());
    assert!(facts.employment_history().unwrap().profiles().is_empty());
}

#[test]
fn raw_calendar_fact_matches_the_original_repository_and_is_shared() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../reference/input-calendar-rows-golden.json"
    ))
    .unwrap();
    let mut compared = 0;
    for case in corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["operation"] == "listCalendarEntries")
    {
        let mut raw = sample_raw(1);
        let input = &case["input"];
        set(
            &mut raw,
            SourceKind::CalendarEntries,
            ready(json!({"kind":"VALUE","value":{
                "shiftRows":input["shiftRows"],"appointmentRows":input["appointmentRows"],
                "platformCollationRanks":case["platformCollationRanks"]
            }})),
        );
        let facts = SnapshotFacts::new(parsed(raw));
        let calendar = facts.calendar().unwrap();
        assert_eq!(
            calendar.entries().as_ref(),
            case["expected"]["value"].as_array().unwrap(),
            "{}",
            case["id"]
        );
        assert!(Arc::ptr_eq(calendar, facts.calendar().unwrap()));
        // Unrelated catalog and target reads have not become calendar gates.
        assert!(facts.catalog().is_err());
        compared += 1;
    }
    assert!(compared >= 10);
}

#[test]
fn calendar_preflight_cannot_expose_unsorted_entries_or_admit_derived_values() {
    use luna_engine::runtime::calendar_source::PreparedCalendarSource;
    let corpus: Value = serde_json::from_str(include_str!(
        "../../reference/input-calendar-rows-golden.json"
    ))
    .unwrap();
    let case = corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| {
            c["operation"] == "listCalendarEntries"
                && !c["input"]["shiftRows"].as_array().unwrap().is_empty()
        })
        .unwrap();
    let mut value = json!({"shiftRows":case["input"]["shiftRows"],"appointmentRows":case["input"]["appointmentRows"],"platformCollationRanks":{}});
    let prepared = PreparedCalendarSource::try_from_value(&value).unwrap();
    assert!(!prepared.collation_candidates().is_empty());
    assert!(prepared.into_ready().is_err());
    value["platformCollationRanks"] = case["platformCollationRanks"].clone();
    assert!(
        PreparedCalendarSource::try_from_value(&value)
            .unwrap()
            .into_ready()
            .is_ok()
    );
    value["entries"] = case["expected"]["value"].clone();
    assert!(PreparedCalendarSource::try_from_value(&value).is_err());
    assert!(PreparedCalendarSource::try_from_value(&case["expected"]["value"]).is_err());
}

#[test]
fn successful_empty_calendar_and_decisions_do_not_mask_failed_or_null_reads() {
    let mut raw = sample_raw(1);
    set(
        &mut raw,
        SourceKind::CalendarEntries,
        ready(
            json!({"kind":"VALUE","value":{"shiftRows":[],"appointmentRows":[],"platformCollationRanks":{}}}),
        ),
    );
    set(
        &mut raw,
        SourceKind::LegacyTariffDecisions,
        ready(json!({"kind":"VALUE","value":[]})),
    );
    let facts = SnapshotFacts::new(parsed(raw));
    assert!(facts.calendar().unwrap().entries().is_empty());
    assert!(facts.tariff_decisions().unwrap().decisions().is_empty());
    assert!(Arc::ptr_eq(
        facts.tariff_decisions().unwrap(),
        facts.tariff_decisions().unwrap()
    ));
    for state in [
        json!({"state":"LOADING"}),
        json!({"state":"FAILED","code":"READ_FAILED"}),
        ready(json!({"kind":"NULL"})),
    ] {
        let mut raw = sample_raw(2);
        set(&mut raw, SourceKind::CalendarEntries, state.clone());
        set(&mut raw, SourceKind::LegacyTariffDecisions, state);
        let facts = SnapshotFacts::new(parsed(raw));
        assert!(facts.calendar().is_err());
        assert!(facts.tariff_decisions().is_err());
        assert!(facts.profile().unwrap().is_some());
    }
}

#[test]
fn financial_profile_uses_explicit_snapshot_date_and_only_profile_history_sources() {
    let mut raw = sample_raw(1);
    set(
        &mut raw,
        SourceKind::RemunerationProfiles,
        ready(json!({"kind":"VALUE","value":[]})),
    );
    for kind in [
        SourceKind::CalendarEntries,
        SourceKind::WorkingTimeTarget,
        SourceKind::YouthPreference,
    ] {
        set(&mut raw, kind, json!({"state":"LOADING"}));
    }
    let facts = SnapshotFacts::new(parsed(raw));
    let financial = facts.financial_profile().unwrap().unwrap();
    assert!(financial.get("workingTimeTarget").is_none());
    assert_eq!(financial["employmentTimeline"], json!([]));
    assert!(Arc::ptr_eq(
        financial,
        facts.financial_profile().unwrap().unwrap()
    ));
    assert!(
        facts.calendar().is_err()
            && facts.saved_target().is_err()
            && facts.youth_preference().is_err()
    );
    let mut raw = sample_raw(2);
    set(
        &mut raw,
        SourceKind::WorkProfile,
        ready(json!({"kind":"NULL"})),
    );
    set(
        &mut raw,
        SourceKind::RemunerationProfiles,
        json!({"state":"FAILED","code":"READ_FAILED"}),
    );
    assert!(
        SnapshotFacts::new(parsed(raw))
            .financial_profile()
            .unwrap()
            .is_none()
    );
}

#[test]
fn native_calculation_profile_binds_the_whole_saved_plan_once_and_preserves_unknown_youth() {
    let mut raw = sample_raw(1);
    set(
        &mut raw,
        SourceKind::RemunerationProfiles,
        ready(json!({"kind":"VALUE","value":[]})),
    );
    set(
        &mut raw,
        SourceKind::WorkingTimeTarget,
        ready(json!({"kind":"NULL"})),
    );
    set(
        &mut raw,
        SourceKind::CalendarEntries,
        ready(
            json!({"kind":"VALUE","value":{"shiftRows":[],"appointmentRows":[],"platformCollationRanks":{}}}),
        ),
    );
    set(
        &mut raw,
        SourceKind::YouthPreference,
        json!({"state":"LOADING"}),
    );
    let facts = SnapshotFacts::new(parsed(raw));
    let profile = facts.calculation_profile().unwrap().unwrap();
    assert_eq!(profile["workingTimeTarget"]["status"], "ready");
    assert_eq!(
        profile["workingTimeTarget"]["youthProtectionStatus"],
        "loading"
    );
    assert!(profile["workingTimeTarget"]["youthProtection"].is_null());
    assert!(Arc::ptr_eq(
        profile,
        facts.calculation_profile().unwrap().unwrap()
    ));
    assert_eq!(profile["employmentTimeline"], json!([]));
    let prepared = facts.prepared_targets().unwrap().unwrap();
    assert!(Arc::ptr_eq(
        prepared,
        facts.prepared_targets().unwrap().unwrap()
    ));
    assert!(std::ptr::eq(prepared.profile(), profile.as_ref()));
    assert_eq!(prepared.stats().input_parses, 0);
    assert!(
        facts
            .financial_profile()
            .unwrap()
            .unwrap()
            .get("workingTimeTarget")
            .is_none()
    );
    // A year-window read cannot masquerade as the complete plan used by source
    // revision signatures and stale-date detection.
    let mut raw = sample_raw(2);
    set(
        &mut raw,
        SourceKind::RemunerationProfiles,
        ready(json!({"kind":"VALUE","value":[]})),
    );
    set(
        &mut raw,
        SourceKind::WorkingTimeTarget,
        ready(json!({"kind":"NULL"})),
    );
    let mut partial = ready(
        json!({"kind":"VALUE","value":{"shiftRows":[],"appointmentRows":[],"platformCollationRanks":{}}}),
    );
    partial["coverage"] =
        json!({"kind":"DATE_RANGES","ranges":[{"start":"2026-01-01","end":"2026-12-31"}]});
    set(&mut raw, SourceKind::CalendarEntries, partial);
    let facts = SnapshotFacts::new(parsed(raw));
    assert!(facts.calculation_profile().is_err());
    assert!(facts.financial_profile().unwrap().is_some());
}

#[test]
fn owner_fence_detaches_large_input_ownership_until_worker_disposal() {
    let registry = SnapshotRegistry::default();
    let first = registry.register(parsed(sample_raw(1))).unwrap();
    let lease = registry
        .begin(request(&first, false), JobLane::Finance)
        .unwrap();
    let weak = Arc::downgrade(lease.facts());
    drop(lease);
    registry
        .reset_for_owner(&contract::OwnerIdentity::new("next-owner", 2).unwrap())
        .unwrap();
    assert!(registry.snapshot(first.identity()).is_err());
    assert!(
        registry
            .begin(request(&first, false), JobLane::Finance)
            .is_err()
    );
    assert!(
        weak.upgrade().is_some(),
        "Tiny control fence must only detach large source ownership"
    );
    registry.reset().unwrap();
    assert!(
        weak.upgrade().is_some(),
        "Repeated fence must retain the same single retired owner"
    );
    assert!(registry.collect_retired().unwrap());
    assert!(weak.upgrade().is_none());
    assert!(!registry.collect_retired().unwrap());
    registry
        .reset_for_owner(&contract::OwnerIdentity::new("owner", 1).unwrap())
        .unwrap();
    let next = registry.register(parsed(sample_raw(2))).unwrap();
    // A delayed cleanup from the previous account cannot delete new data.
    assert!(!registry.collect_retired().unwrap());
    assert!(registry.snapshot(next.identity()).is_ok());
}

#[test]
fn successful_empty_finance_rows_and_absent_preference_are_not_failed_reads() {
    let mut raw = sample_raw(1);
    set(
        &mut raw,
        SourceKind::NetPaySettingsTimeline,
        ready(json!({"kind":"VALUE","value":[]})),
    );
    set(
        &mut raw,
        SourceKind::TestMonths,
        ready(json!({"kind":"VALUE","value":[]})),
    );
    set(
        &mut raw,
        SourceKind::SalaryPaymentPreferences,
        ready(json!({"kind":"NULL"})),
    );
    let facts = SnapshotFacts::new(parsed(raw));
    let timeline = facts.net_settings().unwrap();
    assert!(timeline.timeline().is_empty());
    assert!(Arc::ptr_eq(timeline, facts.net_settings().unwrap()));
    assert!(facts.test_months().unwrap().months().is_empty());
    assert!(facts.salary_preferences().unwrap().raw_row().is_none());
    let defaults = facts.salary_preferences().unwrap().preferences().clone();
    assert!(!defaults.is_null());
    for state in [
        json!({"state":"LOADING"}),
        json!({"state":"FAILED","code":"READ_FAILED"}),
        ready(json!({"kind":"MISSING"})),
    ] {
        let mut raw = sample_raw(2);
        for kind in [
            SourceKind::NetPaySettingsTimeline,
            SourceKind::TestMonths,
            SourceKind::SalaryPaymentPreferences,
        ] {
            set(&mut raw, kind, state.clone());
        }
        let facts = SnapshotFacts::new(parsed(raw));
        assert!(
            facts.net_settings().is_err()
                && facts.test_months().is_err()
                && facts.salary_preferences().is_err()
        );
        assert!(facts.profile().unwrap().is_some());
    }
    let mut raw = sample_raw(3);
    for kind in [SourceKind::NetPaySettingsTimeline, SourceKind::TestMonths] {
        set(&mut raw, kind, ready(json!({"kind":"NULL"})));
    }
    let facts = SnapshotFacts::new(parsed(raw));
    assert!(facts.net_settings().is_err() && facts.test_months().is_err());
}

#[test]
fn raw_sql_to_shared_salary_context_does_not_wait_for_tax_setup_or_target_checks() {
    let mut raw = sample_raw(1);
    let mut stored = profile();
    stored["profileRow"]["manual_monthly_gross_cents"] = json!(400000);
    set(
        &mut raw,
        SourceKind::WorkProfile,
        ready(json!({"kind":"VALUE","value":stored})),
    );
    for kind in [
        SourceKind::RemunerationProfiles,
        SourceKind::LegacyTariffDecisions,
        SourceKind::TestMonths,
    ] {
        set(&mut raw, kind, ready(json!({"kind":"VALUE","value":[]})));
    }
    set(
        &mut raw,
        SourceKind::CalendarEntries,
        ready(
            json!({"kind":"VALUE","value":{"shiftRows":[],"appointmentRows":[],"platformCollationRanks":{}}}),
        ),
    );
    for kind in [
        SourceKind::WorkingTimeTarget,
        SourceKind::YouthPreference,
        SourceKind::NetPaySettingsTimeline,
        SourceKind::SalaryPaymentPreferences,
    ] {
        set(
            &mut raw,
            kind,
            json!({"state":"FAILED","code":"READ_FAILED"}),
        );
    }
    raw["catalogs"]["current"]["selectedPackageIds"] =
        json!({"tariff":["tvoed-vka-bt-k"],"legal":["de-arbzg-care"],"holiday":["de-holidays"]});
    for kind in ["tariff", "legal", "holiday"] {
        raw["catalogs"]["current"][kind] =
            ready(json!({"kind":"VALUE","value":{"mode":"COMPILED_PREVIEW"}}));
    }
    let facts = SnapshotFacts::new(parsed(raw));
    let first = facts.financial_context().unwrap();
    assert!(Arc::ptr_eq(first, facts.financial_context().unwrap()));
    let salary = first.lock().unwrap().salary_month("2026-11").unwrap();
    let result = serde_json::to_value(salary).unwrap();
    assert_eq!(result["pay"]["estimatedGrossAmount"], 4000.0);
    assert!(facts.net_settings().is_err() && facts.salary_preferences().is_err());
    assert!(facts.calculation_profile().is_err());
}

fn assessed_raw() -> Value {
    let mut raw = sample_raw(1);
    let mut stored = profile();
    stored["profileRow"]["manual_monthly_gross_cents"] = json!(400000);
    set(
        &mut raw,
        SourceKind::WorkProfile,
        ready(json!({"kind":"VALUE","value":stored})),
    );
    for kind in [
        SourceKind::RemunerationProfiles,
        SourceKind::LegacyTariffDecisions,
        SourceKind::ActualAnnualPayments,
        SourceKind::TariffAnnualClaims,
    ] {
        set(&mut raw, kind, ready(json!({"kind":"VALUE","value":[]})));
    }
    set(
        &mut raw,
        SourceKind::CalendarEntries,
        ready(
            json!({"kind":"VALUE","value":{"shiftRows":[],"appointmentRows":[],"platformCollationRanks":{}}}),
        ),
    );
    for kind in [
        SourceKind::WorkingTimeTarget,
        SourceKind::YouthPreference,
        SourceKind::NetPaySettingsTimeline,
        SourceKind::SalaryPaymentPreferences,
        SourceKind::TestMonths,
        SourceKind::DrkEmployeeMonthConfirmations,
        SourceKind::DrkTrainingMonthConfirmations,
    ] {
        set(
            &mut raw,
            kind,
            json!({"state":"FAILED","code":"READ_FAILED"}),
        );
    }
    raw["catalogs"]["current"]["selectedPackageIds"] =
        json!({"tariff":["tvoed-vka-bt-k"],"legal":["de-arbzg-care"],"holiday":["de-holidays"]});
    for kind in ["tariff", "legal", "holiday"] {
        raw["catalogs"]["current"][kind] =
            ready(json!({"kind":"VALUE","value":{"mode":"COMPILED_PREVIEW"}}));
    }
    raw
}

#[test]
fn native_assessed_book_is_shared_and_unrelated_io_does_not_block_month_reuse() {
    use luna_engine::report::financial::assessed::AssessedMonthProvider;
    let facts = Arc::new(SnapshotFacts::new(parsed(assessed_raw())));
    let workers: Vec<_> = (0..16)
        .map(|_| {
            let facts = Arc::clone(&facts);
            std::thread::spawn(move || Arc::as_ptr(facts.assessed_book().unwrap()) as usize)
        })
        .collect();
    let owners: Vec<_> = workers.into_iter().map(|w| w.join().unwrap()).collect();
    assert!(owners.iter().all(|owner| *owner == owners[0]));
    let book = facts.assessed_book().unwrap();
    assert_eq!(book.cache_stats().unwrap().calculations, 0);
    let first = book.session().assessed_month("2026-11").unwrap();
    let count = book.cache_stats().unwrap().calculations;
    let second = book.session().assessed_month("2026-11").unwrap();
    assert_eq!(
        serde_json::to_value(first).unwrap(),
        serde_json::to_value(second).unwrap()
    );
    assert_eq!(book.cache_stats().unwrap().calculations, count);
    assert_eq!(book.cache_stats().unwrap().hits, 1);
    assert!(facts.test_months().is_err());
    assert!(facts.net_settings().is_err());
    assert!(facts.calculation_profile().is_err());
}

#[test]
fn assessed_cash_io_states_survive_raw_snapshot_admission_and_never_publish_zero_pay() {
    use luna_engine::report::financial::assessed::AssessedMonthProvider;
    for kind in [
        SourceKind::ActualAnnualPayments,
        SourceKind::TariffAnnualClaims,
    ] {
        for state in [
            json!({"state":"NOT_REQUESTED"}),
            json!({"state":"LOADING"}),
            json!({"state":"FAILED","code":"READ_FAILED"}),
            ready(json!({"kind":"MISSING"})),
            ready(json!({"kind":"NULL"})),
            ready(json!({"kind":"VALUE","value":[{}]})),
        ] {
            let mut raw = assessed_raw();
            set(&mut raw, kind, state);
            let facts = SnapshotFacts::new(parsed(raw));
            let book = facts.assessed_book().unwrap();
            assert!(book.session().assessed_month("2026-11").is_err());
            assert_eq!(book.cache_stats().unwrap().calculations, 0);
            assert_eq!(book.cache_stats().unwrap().entries, 0);
        }
    }
}

#[test]
fn assessed_structural_sources_must_be_successful_before_book_construction() {
    for kind in [
        SourceKind::WorkProfile,
        SourceKind::CalendarEntries,
        SourceKind::RemunerationProfiles,
        SourceKind::WorkPatternSettings,
        SourceKind::LegacyTariffDecisions,
    ] {
        let mut raw = assessed_raw();
        set(&mut raw, kind, json!({"state":"LOADING"}));
        let facts = SnapshotFacts::new(parsed(raw));
        assert!(facts.assessed_book().is_err());
        // A failed construction cannot become a ready empty book on retry.
        assert!(facts.assessed_book().is_err());
    }
}

#[test]
fn native_time_reports_share_profile_and_calendar_owners_without_salary_readiness() {
    let mut raw = assessed_raw();
    set(
        &mut raw,
        SourceKind::WorkingTimeTarget,
        ready(json!({"kind":"NULL"})),
    );
    for kind in [
        SourceKind::ActualAnnualPayments,
        SourceKind::TariffAnnualClaims,
        SourceKind::LegacyTariffDecisions,
        SourceKind::ScopedAllowanceDecisions,
        SourceKind::PaidAbsences,
    ] {
        set(
            &mut raw,
            kind,
            json!({"state":"FAILED","code":"READ_FAILED"}),
        );
    }
    let facts = SnapshotFacts::new(parsed(raw));
    assert!(facts.assessed_book().is_err());
    let owner = facts.time_context().unwrap();
    assert!(Arc::ptr_eq(owner, facts.time_context().unwrap()));
    let mut time = owner.lock().unwrap();
    let first = time.annual_shared(2026).unwrap();
    assert_eq!(first["actualMinutes"], 0.0);
    assert!(Arc::ptr_eq(&first, &time.annual_shared(2026).unwrap()));
    assert_eq!(time.annual_computations(), 1);
    assert!(facts.net_settings().is_err());
}

#[test]
fn annual_sql_facts_require_successful_complete_reads_and_share_native_validation() {
    let kinds = [
        SourceKind::ActualAnnualPayments,
        SourceKind::TariffAnnualClaims,
    ];
    let mut raw = sample_raw(1);
    for kind in kinds {
        set(&mut raw, kind, ready(json!({"kind":"VALUE","value":[]})));
    }
    let facts = SnapshotFacts::new(parsed(raw));
    let actual = facts.actual_annual_payments().unwrap();
    let tariff = facts.tariff_annual_claims().unwrap();
    assert!(actual.active_payments().is_empty() && tariff.validated().records().is_empty());
    assert!(Arc::ptr_eq(actual, facts.actual_annual_payments().unwrap()));
    assert!(Arc::ptr_eq(tariff, facts.tariff_annual_claims().unwrap()));
    for state in [
        json!({"state":"LOADING"}),
        json!({"state":"FAILED","code":"READ_FAILED"}),
        ready(json!({"kind":"MISSING"})),
        ready(json!({"kind":"NULL"})),
        ready(json!({"kind":"VALUE","value":[{"completeGross":true}]})),
    ] {
        let mut raw = sample_raw(2);
        for kind in kinds {
            set(&mut raw, kind, state.clone());
        }
        let facts = SnapshotFacts::new(parsed(raw));
        assert!(facts.actual_annual_payments().is_err());
        assert!(facts.tariff_annual_claims().is_err());
        assert!(facts.profile().unwrap().is_some());
    }
    let mut raw = sample_raw(3);
    for kind in kinds {
        let mut partial = ready(json!({"kind":"VALUE","value":[]}));
        partial["coverage"] =
            json!({"kind":"DATE_RANGES","ranges":[{"start":"2026-01-01","end":"2026-12-31"}]});
        set(&mut raw, kind, partial);
    }
    let facts = SnapshotFacts::new(parsed(raw));
    assert!(facts.actual_annual_payments().is_err() && facts.tariff_annual_claims().is_err());
}

#[test]
fn training_sql_success_requires_raw_rows_and_does_not_depend_on_youth_preference() {
    let mut raw = sample_raw(1);
    let kinds = [
        SourceKind::TrainingProfiles,
        SourceKind::TrainingShiftDetails,
    ];
    for kind in kinds {
        set(&mut raw, kind, ready(json!({"kind":"VALUE","value":[]})));
    }
    set(
        &mut raw,
        SourceKind::YouthPreference,
        json!({"state":"FAILED","code":"READ_FAILED"}),
    );
    let facts = SnapshotFacts::new(parsed(raw));
    let training = facts.training_profiles().unwrap();
    assert!(training.prepared().unwrap().profiles().is_empty());
    assert!(facts.training_details().unwrap().saved().is_empty());
    assert!(Arc::ptr_eq(training, facts.training_profiles().unwrap()));
    assert!(facts.youth_preference().is_err());
    for state in [
        json!({"state":"LOADING"}),
        json!({"state":"FAILED","code":"READ_FAILED"}),
        ready(json!({"kind":"NULL"})),
        ready(json!({"kind":"VALUE","value":{"profiles":[],"details":[]}})),
    ] {
        let mut raw = sample_raw(2);
        for kind in kinds {
            set(&mut raw, kind, state.clone());
        }
        let facts = SnapshotFacts::new(parsed(raw));
        assert!(facts.training_profiles().is_err() && facts.training_details().is_err());
        assert!(facts.profile().unwrap().is_some());
    }
    let mut raw = sample_raw(3);
    set(
        &mut raw,
        SourceKind::TrainingProfiles,
        ready(json!({"kind":"VALUE","value":[]})),
    );
    set(
        &mut raw,
        SourceKind::TrainingShiftDetails,
        json!({"state":"FAILED","code":"READ_FAILED"}),
    );
    let facts = SnapshotFacts::new(parsed(raw));
    assert!(facts.training_profiles().is_ok() && facts.training_details().is_err());
    let mut raw = sample_raw(4);
    set(
        &mut raw,
        SourceKind::TrainingShiftDetails,
        ready(json!({"kind":"VALUE","value":[]})),
    );
    set(
        &mut raw,
        SourceKind::AnnexAPauseDetails,
        json!({"state":"FAILED","code":"READ_FAILED"}),
    );
    let facts = SnapshotFacts::new(parsed(raw));
    assert!(facts.training_details().is_ok());
    assert!(facts.annex_pause_details().is_err());
    let mut raw = sample_raw(5);
    set(
        &mut raw,
        SourceKind::AnnexAPauseDetails,
        ready(json!({"kind":"VALUE","value":[]})),
    );
    let facts = SnapshotFacts::new(parsed(raw));
    assert!(facts.annex_pause_details().unwrap().saved().is_empty());
}

#[test]
fn remuneration_sql_sources_are_independent_checked_once_and_never_default_failed_reads() {
    let kinds = [
        SourceKind::PaidAbsences,
        SourceKind::OvertimeAllocations,
        SourceKind::ScopedAllowanceDecisions,
    ];
    let mut raw = sample_raw(1);
    for kind in kinds {
        set(&mut raw, kind, ready(json!({"kind":"VALUE","value":[]})));
    }
    let facts = SnapshotFacts::new(parsed(raw));
    let paid = facts.paid_absences().unwrap();
    let overtime = facts.overtime_allocations().unwrap();
    let allowances = facts.scoped_allowances().unwrap();
    assert!(
        paid.saved().is_empty() && overtime.saved().is_empty() && allowances.saved().is_empty()
    );
    assert!(Arc::ptr_eq(paid, facts.paid_absences().unwrap()));
    assert!(Arc::ptr_eq(overtime, facts.overtime_allocations().unwrap()));
    assert!(Arc::ptr_eq(allowances, facts.scoped_allowances().unwrap()));
    assert_eq!(
        allowances.allowance_month("2026-11").unwrap()["revision"],
        0
    );
    for state in [
        json!({"state":"LOADING"}),
        json!({"state":"FAILED","code":"READ_FAILED"}),
        ready(json!({"kind":"NULL"})),
    ] {
        let mut raw = sample_raw(2);
        for kind in kinds {
            set(&mut raw, kind, state.clone());
        }
        let facts = SnapshotFacts::new(parsed(raw));
        assert!(
            facts.paid_absences().is_err()
                && facts.overtime_allocations().is_err()
                && facts.scoped_allowances().is_err()
        );
        assert!(facts.profile().unwrap().is_some());
    }
}

#[test]
fn large_training_profile_original_utf8_chunks_cross_the_real_snapshot_boundary() {
    let oracle: Value =
        serde_json::from_str(include_str!("../../reference/training-rows-golden.json")).unwrap();
    let case = oracle["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "large-profile-chunked")
        .unwrap();
    let row = &case["input"];
    assert!(
        row["data_json_chunks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().len())
            .sum::<usize>()
            > 300_000
    );
    let mut raw = sample_raw(1);
    set(
        &mut raw,
        SourceKind::TrainingProfiles,
        ready(json!({"kind":"VALUE","value":[row]})),
    );
    let facts = SnapshotFacts::new(parsed(raw));
    let profiles = facts.training_profiles().unwrap();
    assert_eq!(profiles.saved()[0], case["expected"]["value"]);
    let selected = profiles
        .prepared()
        .unwrap()
        .for_date("2026-12-01")
        .unwrap()
        .unwrap();
    assert_eq!(
        selected["data"]["youth"]["blockTrainingShiftIds"]
            .as_array()
            .unwrap()
            .len(),
        400
    );
    assert!(Arc::ptr_eq(profiles, facts.training_profiles().unwrap()));
    let mut invalid = row.clone();
    invalid["data_json_chunks"] = json!(["x".repeat(65_537)]);
    assert!(luna_engine::input::training_rows::map_training_profile_row(&invalid).is_err());
}

#[test]
fn draft_sql_fact_sources_are_independent_and_loading_is_not_an_empty_confirmation() {
    use luna_engine::input::draft_rows::DraftRowsKind as K;
    let kinds = [
        (SourceKind::AnnexAMonthConfirmations, K::AnnexAMonth),
        (SourceKind::AnnexAPremiumFacts, K::AnnexAPremium),
        (SourceKind::SueMonthConfirmations, K::SueMonth),
        (SourceKind::SueAllowanceConfirmations, K::SueAllowance),
        (SourceKind::TvlShiftWork, K::TvlShiftWork),
        (SourceKind::DrkEmployeeMonthConfirmations, K::DrkEmployee),
        (SourceKind::DrkTrainingMonthConfirmations, K::DrkTraining),
        (SourceKind::CaritasMonthFacts, K::CaritasMonth),
        (SourceKind::CaritasWorkDays, K::CaritasWorkDay),
        (SourceKind::CaritasOvertimeConfirmations, K::CaritasOvertime),
    ];
    let mut raw = sample_raw(1);
    for (source, _) in kinds {
        set(&mut raw, source, ready(json!({"kind":"VALUE","value":[]})));
    }
    let facts = SnapshotFacts::new(parsed(raw));
    for (_, kind) in kinds {
        let rows = facts.draft_evidence(kind).unwrap();
        assert!(rows.saved().is_empty());
        assert_eq!(rows.kind(), kind);
        assert!(Arc::ptr_eq(rows, facts.draft_evidence(kind).unwrap()));
    }
    for (source, kind) in kinds {
        for state in [
            json!({"state":"LOADING"}),
            json!({"state":"FAILED","code":"READ_FAILED"}),
            ready(json!({"kind":"NULL"})),
        ] {
            let mut raw = sample_raw(2);
            for (other, _) in kinds {
                set(&mut raw, other, ready(json!({"kind":"VALUE","value":[]})));
            }
            set(&mut raw, source, state);
            let facts = SnapshotFacts::new(parsed(raw));
            assert!(facts.draft_evidence(kind).is_err());
            for (other, other_kind) in kinds {
                if other != source {
                    assert!(facts.draft_evidence(other_kind).is_ok());
                }
            }
            assert!(facts.profile().unwrap().is_some());
        }
    }
}
