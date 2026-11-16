#[path = "support/snapshot.rs"]
mod snapshot;
use luna_engine::{
    contract::{self, CalculationRequest, ImmutableSnapshot, SourceKind, ValidatedRequest},
    runtime::{JobLane, SnapshotRegistry, dispatch, jobs::JobScheduler},
};
use serde_json::{Value, json};

fn envelope(command: Value) -> Value {
    json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":command})
}
fn set(raw: &mut Value, kind: SourceKind, source: Value) {
    let kind = serde_json::to_value(kind).unwrap();
    raw["sources"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|group| group["kind"] == kind)
        .unwrap()["source"] = source;
}
fn ready(value: Value) -> Value {
    json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":value}})
}
fn raw() -> Value {
    let mut raw = snapshot::raw_snapshot(1, "dispatch", 1);
    let profile = json!({"profileRow":{"federal_state":"NW","holiday_region":"NONE","weekly_minutes":2310,"time_zone":"Europe/Berlin","pay_group":null,"pay_level":null,"tariff_sector":null,"tariff_region":"OTHER","full_time_weekly_minutes":null,"industry":"HEALTHCARE","manual_monthly_gross_cents":400000,"regular_rotating_night_work":null,"sunday_holiday_work_eligible":null,"all_employment_work_recorded":null,"display_name":null,"employer_name":null,"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-11-01T00:00:00Z"},"salaryRows":[]});
    set(
        &mut raw,
        SourceKind::WorkProfile,
        ready(json!({"kind":"VALUE","value":profile})),
    );
    for kind in [
        SourceKind::RemunerationProfiles,
        SourceKind::WorkPatternSettings,
    ] {
        set(&mut raw, kind, ready(json!({"kind":"VALUE","value":[]})));
    }
    for kind in [SourceKind::WorkingTimeTarget, SourceKind::YouthPreference] {
        set(&mut raw, kind, ready(json!({"kind":"NULL"})));
    }
    set(
        &mut raw,
        SourceKind::CalendarEntries,
        ready(
            json!({"kind":"VALUE","value":{"shiftRows":[],"appointmentRows":[],"platformCollationRanks":{}}}),
        ),
    );
    raw["catalogs"]["current"]["selectedPackageIds"] =
        json!({"tariff":["tvoed-vka-bt-k"],"legal":["de-arbzg-care"],"holiday":["de-holidays"]});
    for kind in ["tariff", "legal", "holiday"] {
        raw["catalogs"]["current"][kind] =
            ready(json!({"kind":"VALUE","value":{"mode":"COMPILED_PREVIEW"}}));
    }
    raw
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
fn request(snapshot: &ImmutableSnapshot, revision: u64, periods: Value) -> CalculationRequest {
    let bytes = serde_json::to_vec(&envelope(json!({"kind":"CALCULATE","request":{
        "guard":{"snapshot":snapshot.identity(),"requestId":format!("time-{revision}"),"requestRevision":revision},
        "periods":periods,"sections":{"time":true,"gross":false,"net":false,"checks":false},"perspective":"EARNED","priority":"INTERACTIVE"
    }}))).unwrap();
    match contract::parse_request(&bytes).unwrap() {
        ValidatedRequest::Calculate(request) => *request,
        _ => panic!("calculation expected"),
    }
}
fn setup(raw: Value) -> (SnapshotRegistry, JobScheduler, ImmutableSnapshot) {
    let registry = SnapshotRegistry::default();
    let snapshot = registry.register(parsed(raw)).unwrap();
    let scheduler = JobScheduler::new(registry.clone());
    (registry, scheduler, snapshot)
}
fn month() -> Value {
    json!([{"kind":"MONTH","month":"2026-11"}])
}

fn finance_raw(revision: u64, scope: &str, epoch: u64, gross: i64) -> Value {
    let mut raw = raw();
    raw["identity"]["snapshotRevision"] = json!(revision);
    raw["identity"]["snapshotId"] = json!(format!("snapshot-{revision}"));
    raw["identity"]["ownerScope"] = json!(scope);
    raw["identity"]["ownerEpoch"] = json!(epoch);
    let profile = raw["sources"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|group| group["kind"] == "WORK_PROFILE")
        .unwrap();
    profile["source"]["payload"]["data"]["value"]["profileRow"]["manual_monthly_gross_cents"] =
        json!(gross);
    for kind in [SourceKind::TestMonths, SourceKind::LegacyTariffDecisions] {
        set(&mut raw, kind, ready(json!({"kind":"VALUE","value":[]})));
    }
    raw
}
fn salary(scheduler: &JobScheduler, snapshot: &ImmutableSnapshot) -> (Value, Value) {
    scheduler
        .admit(request(snapshot, 1, month()), JobLane::Finance)
        .unwrap();
    let work = scheduler.next(JobLane::Finance).unwrap().unwrap();
    let owner = work.lease().facts().financial_context().unwrap();
    let mut context = owner.lock().unwrap();
    let pay = serde_json::to_value(context.salary_month("2026-11").unwrap()).unwrap();
    let diagnostics = context.reuse_diagnostics();
    drop(context);
    assert!(work.finish().unwrap().is_some());
    (pay, diagnostics)
}

#[test]
fn registry_reuses_native_money_across_revisions_and_same_owner_reset_without_crossing_namespaces()
{
    let (registry, scheduler, first) = setup(finance_raw(1, "dispatch", 1, 400000));
    let (expected, first_stats) = salary(&scheduler, &first);
    assert_eq!(first_stats["raw"]["crossSnapshotReuseEnabled"], true);
    assert_eq!(first_stats["raw"]["nativePricingPasses"], 1);
    let second = registry
        .register(parsed(finance_raw(2, "dispatch", 1, 400000)))
        .unwrap();
    let (same, second_stats) = salary(&scheduler, &second);
    assert_eq!(same, expected);
    assert_eq!(second_stats["raw"]["nativePricingPasses"], 0);
    registry
        .reset_for_owner(&contract::OwnerIdentity::new("dispatch", 2).unwrap())
        .unwrap();
    let third = registry
        .register(parsed(finance_raw(1, "dispatch", 2, 400000)))
        .unwrap();
    let (same, third_stats) = salary(&scheduler, &third);
    assert_eq!(same, expected);
    assert_eq!(third_stats["raw"]["nativePricingPasses"], 0);
    registry
        .reset_for_owner(&contract::OwnerIdentity::new("other-data-space", 1).unwrap())
        .unwrap();
    let other = registry
        .register(parsed(finance_raw(1, "other-data-space", 1, 400000)))
        .unwrap();
    assert_eq!(
        salary(&scheduler, &other).1["raw"]["nativePricingPasses"],
        1
    );
    let changed = registry
        .register(parsed(finance_raw(2, "other-data-space", 1, 500000)))
        .unwrap();
    let (changed_pay, changed_stats) = salary(&scheduler, &changed);
    assert_ne!(changed_pay, expected);
    assert_eq!(changed_stats["raw"]["nativePricingPasses"], 1);
}

#[test]
fn a_cached_money_core_never_masks_a_new_failed_required_source() {
    let (registry, scheduler, first) = setup(finance_raw(1, "dispatch", 1, 400000));
    salary(&scheduler, &first);
    let mut failed = finance_raw(2, "dispatch", 1, 400000);
    set(
        &mut failed,
        SourceKind::LegacyTariffDecisions,
        json!({"state":"FAILED","code":"READ_FAILED"}),
    );
    let failed = registry.register(parsed(failed)).unwrap();
    scheduler
        .admit(request(&failed, 1, month()), JobLane::Finance)
        .unwrap();
    let work = scheduler.next(JobLane::Finance).unwrap().unwrap();
    assert!(work.lease().facts().financial_context().is_err());
    assert!(work.finish().unwrap().is_some());
}

#[test]
fn checks_dispatch_uses_its_own_shared_source_without_financial_readiness() {
    let mut raw = raw();
    let ranks: serde_json::Map<String, Value> = luna_engine::training::code_candidates()
        .iter()
        .enumerate()
        .map(|(rank, code)| (code.to_string(), json!(rank)))
        .collect();
    let group = raw["sources"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|group| group["kind"] == "CALENDAR_ENTRIES")
        .unwrap();
    group["source"]["payload"]["data"]["value"]["platformCollationRanks"] = Value::Object(ranks);
    let (_, scheduler, snapshot) = setup(raw);
    let mut request = serde_json::to_value(request(&snapshot, 1, month())).unwrap();
    request["sections"] = json!({"time":false,"gross":false,"net":false,"checks":true});
    let request = match contract::parse_request(
        &serde_json::to_vec(&envelope(json!({"kind":"CALCULATE","request":request}))).unwrap(),
    )
    .unwrap()
    {
        ValidatedRequest::Calculate(request) => *request,
        _ => panic!("calculation expected"),
    };
    scheduler.admit(request, JobLane::Checks).unwrap();
    let work = scheduler.next(JobLane::Checks).unwrap().unwrap();
    let first = work.lease().facts().checks_context().unwrap();
    assert!(std::sync::Arc::ptr_eq(
        first,
        work.lease().facts().checks_context().unwrap()
    ));
    let result = serde_json::to_value(dispatch::calculate(&work).unwrap().unwrap()).unwrap();
    assert_eq!(
        result["reports"][0]["sections"]["checks"]["state"], "READY",
        "{result}"
    );
    assert_eq!(
        result["reports"][0]["sections"]["checks"]["value"]["trainingState"]["state"],
        "NOT_REQUESTED"
    );
    for section in ["time", "gross", "net"] {
        assert_eq!(
            result["reports"][0]["sections"][section]["state"],
            "NOT_REQUESTED"
        );
    }
    assert!(work.finish().unwrap().is_some());
}

#[test]
fn independent_native_month_and_year_outputs_retain_request_identity_and_cached_values() {
    // Every unrelated financial/check source is still NOT_REQUESTED.
    let (_, scheduler, snapshot) = setup(raw());
    let periods = json!([{"kind":"MONTH","month":"2026-11"},{"kind":"YEAR","year":2026}]);
    let first = request(&snapshot, 1, periods.clone());
    scheduler.admit(first.clone(), JobLane::Finance).unwrap();
    let work = scheduler.next(JobLane::Finance).unwrap().unwrap();
    let result = dispatch::calculate(&work).unwrap().unwrap();
    assert!(result.matches_request(&first));
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["request"], serde_json::to_value(&first).unwrap());
    assert_eq!(json["reports"][0]["sections"]["time"]["state"], "READY");
    assert_eq!(
        json["reports"][0]["sections"]["time"]["value"]["summary"]["ok"],
        true
    );
    assert_eq!(
        json["reports"][0]["sections"]["time"]["value"]["monthShifts"],
        json!([])
    );
    assert_eq!(
        json["reports"][1]["sections"]["time"]["value"]["actualMinutes"],
        0.0
    );
    for section in ["gross", "net", "checks"] {
        assert_eq!(
            json["reports"][0]["sections"][section]["state"],
            "NOT_REQUESTED"
        );
    }
    let owner = work.lease().facts().time_context().unwrap().clone();
    let counts = {
        let context = owner.lock().unwrap();
        (context.month_computations(), context.annual_computations())
    };
    assert!(work.finish().unwrap().is_some());
    let second = request(&snapshot, 2, periods);
    assert!(!result.matches_request(&second));
    scheduler.admit(second, JobLane::Finance).unwrap();
    let work = scheduler.next(JobLane::Finance).unwrap().unwrap();
    let next = serde_json::to_value(dispatch::calculate(&work).unwrap().unwrap()).unwrap();
    assert_eq!(next["reports"], json["reports"]);
    let context = owner.lock().unwrap();
    assert_eq!(
        (context.month_computations(), context.annual_computations()),
        counts
    );
    assert!(work.finish().unwrap().is_some());
}

#[test]
fn source_availability_never_becomes_successful_empty_time_data() {
    for (source, code) in [
        (json!({"state":"NOT_REQUESTED"}), "SOURCE_NOT_REQUESTED"),
        (json!({"state":"LOADING"}), "SOURCE_LOADING"),
        (
            json!({"state":"FAILED","code":"READ_FAILED"}),
            "SOURCE_READ_FAILED",
        ),
        (ready(json!({"kind":"MISSING"})), "SOURCE_MISSING"),
        (ready(json!({"kind":"NULL"})), "SOURCE_NULL"),
    ] {
        let mut raw = raw();
        set(&mut raw, SourceKind::CalendarEntries, source);
        let (_, scheduler, snapshot) = setup(raw);
        scheduler
            .admit(request(&snapshot, 1, month()), JobLane::Finance)
            .unwrap();
        let work = scheduler.next(JobLane::Finance).unwrap().unwrap();
        let result = serde_json::to_value(dispatch::calculate(&work).unwrap().unwrap()).unwrap();
        let time = &result["reports"][0]["sections"]["time"];
        assert_eq!(time["state"], "UNAVAILABLE");
        assert_eq!(time["reason"]["code"], code);
        assert_eq!(time["reason"]["source"], "CALENDAR_ENTRIES");
        assert!(time.get("value").is_none());
    }
}

#[test]
fn a_finished_calculation_is_not_a_publication_permit_after_newer_input_arrives() {
    let (_, scheduler, snapshot) = setup(raw());
    scheduler
        .admit(request(&snapshot, 1, month()), JobLane::Finance)
        .unwrap();
    let work = scheduler.next(JobLane::Finance).unwrap().unwrap();
    assert!(dispatch::calculate(&work).unwrap().is_some());
    scheduler
        .admit(request(&snapshot, 2, month()), JobLane::Finance)
        .unwrap();
    assert!(work.finish().unwrap().is_none());
    let work = scheduler.next(JobLane::Finance).unwrap().unwrap();
    assert!(dispatch::calculate(&work).unwrap().is_some());
    assert!(work.finish().unwrap().is_some());
}

#[test]
fn cancellation_and_same_owner_reset_discard_native_results() {
    for reset in [false, true] {
        let (registry, scheduler, snapshot) = setup(raw());
        let id = scheduler
            .admit(request(&snapshot, 1, month()), JobLane::Finance)
            .unwrap();
        let work = scheduler.next(JobLane::Finance).unwrap().unwrap();
        let owner = work.lease().facts().time_context().unwrap().clone();
        let held = owner.lock().unwrap();
        std::thread::scope(|scope| {
            let calculation = scope.spawn(|| dispatch::calculate(&work));
            if reset {
                registry
                    .reset_for_owner(&contract::OwnerIdentity::new("dispatch", 1).unwrap())
                    .unwrap();
            } else {
                assert!(scheduler.cancel(id).unwrap());
            }
            drop(held);
            assert!(calculation.join().unwrap().unwrap().is_none());
        });
        assert!(work.finish().unwrap().is_none());
    }
}
