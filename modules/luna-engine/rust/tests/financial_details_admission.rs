use luna_engine::{
    contract::{self, CalculationRequest, ImmutableSnapshot, SourceKind, ValidatedRequest},
    runtime::{JobLane, SnapshotRegistry, jobs::JobScheduler},
};
use serde_json::{Value, json};
#[path = "support/snapshot.rs"]
mod snapshot;
fn bytes(v: &Value) -> Vec<u8> {
    serde_json::to_vec(v).unwrap()
}
fn envelope(command: Value) -> Value {
    json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":command})
}
fn setup() -> (SnapshotRegistry, ImmutableSnapshot) {
    let mut raw = snapshot::raw_snapshot(1, "details-owner", 1);
    raw["sources"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|s| s["kind"] == json!(SourceKind::CalendarEntries))
        .unwrap()["source"] = json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":{"shiftRows":[],"appointmentRows":[],"platformCollationRanks":{}}}}});
    snapshot::seal(&mut raw);
    let s = match contract::parse_request(&bytes(&envelope(
        json!({"kind":"REGISTER_SNAPSHOT","snapshot":raw}),
    )))
    .unwrap()
    {
        ValidatedRequest::RegisterSnapshot(s) => s,
        _ => panic!("snapshot"),
    };
    let r = SnapshotRegistry::default();
    r.register(s.clone()).unwrap();
    (r, s)
}
fn parse(value: Value) -> CalculationRequest {
    match contract::parse_request(&bytes(&envelope(
        json!({"kind":"CALCULATE","request":value}),
    )))
    .unwrap()
    {
        ValidatedRequest::Calculate(r) => *r,
        _ => panic!("request"),
    }
}
fn request(s: &ImmutableSnapshot, revision: u64, locator: Value) -> CalculationRequest {
    let value = json!({"guard":{"snapshot":s.identity(),"requestId":format!("detail-job-{revision}"),"requestRevision":revision},"periods":[{"kind":"MONTH","month":"2026-07"}],"sections":{"time":false,"gross":true,"net":false,"checks":false},"perspective":"EARNED","priority":"INTERACTIVE","financialDetails":{"filter":null,"includeSpecialDutyPay":false,"collation":locator}});
    match contract::parse_request(&bytes(&envelope(
        json!({"kind":"CALCULATE","request":value}),
    )))
    .unwrap()
    {
        ValidatedRequest::Calculate(r) => *r,
        _ => panic!("request"),
    }
}
#[test]
fn ordinary_admission_cannot_treat_host_proof_locator_as_native_ready() {
    let (registry, s) = setup();
    let jobs = JobScheduler::new(registry);
    assert!(
        jobs.admit(
            request(
                &s,
                1,
                json!({"token":1,"digest":"c".repeat(64),"localeKey":"de-DE"})
            ),
            JobLane::Finance
        )
        .is_err(),
        "host locator cannot authorize details"
    );
}

fn prepare(
    pool: &luna_engine::runtime::financial_collation::FinancialCollationPool,
    s: &ImmutableSnapshot,
    channel: &str,
    revision: u64,
) -> Value {
    let mut header = envelope(json!({}));
    header.as_object_mut().unwrap().remove("command");
    header["guard"] = json!({"ownerScope":"details-owner","ownerEpoch":1,"requestId":channel,"draftRevision":revision,"snapshot":s.identity()});
    header["intent"] = json!({"month":"2026-07","perspective":"EARNED","filter":null,"includeSpecialDutyPay":false});
    header["localeKey"] = json!("de-DE");
    serde_json::from_slice(
        &pool
            .prepare(&bytes(&header))
            .unwrap()
            .serialize_current()
            .unwrap(),
    )
    .unwrap()
}
fn ready(
    pool: &luna_engine::runtime::financial_collation::FinancialCollationPool,
    s: &ImmutableSnapshot,
    channel: &str,
) -> Value {
    let prepared = prepare(pool, s, channel, 1);
    let cached = prepared["cachedVerifiedRanks"].as_bool().unwrap();
    let raw = if cached {
        Vec::new()
    } else {
        let mut ranks = std::collections::BTreeMap::new();
        let mut after = Value::Null;
        loop {
            let page:Value=serde_json::from_slice(&pool.candidates(&bytes(&json!({"draftId":prepared["draftId"],"candidateDigest":prepared["candidateDigest"],"after":after,"limit":1024}))).unwrap().serialize_current().unwrap()).unwrap();
            for text in page["page"]["candidates"].as_array().unwrap() {
                let rank = ranks.len();
                ranks.insert(text.as_str().unwrap().to_owned(), rank);
            }
            after = page["page"]["nextAfter"].clone();
            if after.is_null() {
                break;
            }
        }
        serde_json::to_vec(&ranks).unwrap()
    };
    let done:Value=serde_json::from_slice(&pool.finalize(&bytes(&json!({"draftId":prepared["draftId"],"candidateDigest":prepared["candidateDigest"],"reuseCached":cached})),&raw).unwrap().serialize_current().unwrap()).unwrap();
    json!({"token":done["token"],"digest":done["digest"],"localeKey":"de-DE"})
}
#[test]
fn native_producer_proof_pins_admission_and_uses_exact_scope_and_registry() {
    use luna_engine::runtime::{RegistryError, financial_collation::FinancialCollationPool};
    let (registry, s) = setup();
    let pool = FinancialCollationPool::new(registry.clone());
    let locator = ready(&pool, &s, "salary-channel");
    let req = request(&s, 1, locator);
    let proof = pool.admission_for_request(&req).unwrap();
    let (other, _) = setup();
    assert!(matches!(
        other.reserve_with_financial_details(req.clone(), JobLane::Finance, proof.clone()),
        Err(RegistryError::InvalidFinancialProof)
    ));
    assert!(matches!(
        registry.reserve_with_financial_details(req.clone(), JobLane::Checks, proof.clone()),
        Err(RegistryError::InvalidLane)
    ));
    let jobs = JobScheduler::new(registry.clone());
    let id = jobs.admit_financial_details(req.clone(), &pool).unwrap();
    let weak = std::sync::Arc::downgrade(&proof);
    drop(proof);
    for i in 0..12 {
        ready(&pool, &s, &format!("idle-{i}"));
    } // native queue pin survives idle8 LRU
    let proof = weak.upgrade().expect("pending job retained native proof");
    let retained = pool.admission_for_request(&req).unwrap();
    assert!(std::sync::Arc::ptr_eq(&proof, &retained));
    drop(retained);
    let work = jobs.next(JobLane::Finance).unwrap().unwrap();
    assert_eq!(work.id(), id);
    assert!(std::sync::Arc::ptr_eq(
        work.lease().financial_details().unwrap(),
        &proof
    ));
    assert!(work.is_current().unwrap());
    let permit = work.finish().unwrap().unwrap();
    assert!(std::sync::Arc::ptr_eq(
        permit.financial_details().unwrap(),
        &proof
    ));
    registry.reset().unwrap();
    assert!(!permit.financial_details().unwrap().is_current().unwrap());
}
#[test]
fn every_detail_selector_and_original_scope_must_match_native_retention() {
    use luna_engine::runtime::financial_collation::FinancialCollationPool;
    let (registry, s) = setup();
    let pool = FinancialCollationPool::new(registry.clone());
    let locator = ready(&pool, &s, "scope");
    let req = request(&s, 1, locator);
    let base = serde_json::to_value(&req).unwrap();
    for i in 0..9 {
        let mut v = base.clone();
        match i {
            0 => v["financialDetails"]["collation"]["token"] = json!(9_000_000),
            1 => v["financialDetails"]["collation"]["digest"] = json!("a".repeat(64)),
            2 => v["financialDetails"]["collation"]["localeKey"] = json!("fr-FR"),
            3 => v["financialDetails"]["filter"] = json!("NIGHT"),
            4 => v["financialDetails"]["includeSpecialDutyPay"] = json!(true),
            5 => v["periods"][0]["month"] = json!("2026-08"),
            6 => v["perspective"] = json!("PAYOUT"),
            7 => v["guard"]["snapshot"]["snapshotRevision"] = json!(2),
            _ => v["guard"]["snapshot"]["ownerScope"] = json!("other-owner"),
        };
        assert!(pool.admission_for_request(&parse(v)).is_err(), "scope {i}");
    }
    assert!(pool.admission_for_request(&req).is_ok());
    assert_eq!(registry.stats().unwrap().writer_slots, 0);
}
#[test]
fn new_draft_or_owner_reset_cancels_queued_and_running_details() {
    use luna_engine::runtime::financial_collation::FinancialCollationPool;
    for running in [false, true] {
        for reset in [false, true] {
            let (registry, s) = setup();
            let pool = FinancialCollationPool::new(registry.clone());
            let locator = ready(&pool, &s, "draft");
            let jobs = JobScheduler::new(registry.clone());
            jobs.admit_financial_details(request(&s, 1, locator), &pool)
                .unwrap();
            let work = if running {
                jobs.next(JobLane::Finance).unwrap()
            } else {
                None
            };
            if reset {
                registry
                    .reset_for_owner(&contract::OwnerIdentity::new("details-owner", 1).unwrap())
                    .unwrap();
            } else {
                prepare(&pool, &s, "draft", 2);
            }
            if let Some(work) = work {
                assert!(!work.is_current().unwrap());
                assert!(work.finish().unwrap().is_none());
            } else {
                assert!(jobs.next(JobLane::Finance).unwrap().is_none());
            }
        }
    }
}
#[test]
fn detail_only_writer_is_independent_of_existing_gross_and_checks_slots() {
    use luna_engine::runtime::financial_collation::FinancialCollationPool;
    let (registry, s) = setup();
    let pool = FinancialCollationPool::new(registry.clone());
    let locator = ready(&pool, &s, "independent");
    let req = request(&s, 1, locator);
    let mut ordinary = serde_json::to_value(&req).unwrap();
    ordinary.as_object_mut().unwrap().remove("financialDetails");
    ordinary["guard"]["requestRevision"] = json!(50);
    ordinary["guard"]["requestId"] = json!("gross");
    let ordinary = registry.begin(parse(ordinary), JobLane::Finance).unwrap();
    let mut checks = serde_json::to_value(&req).unwrap();
    checks.as_object_mut().unwrap().remove("financialDetails");
    checks["sections"]["gross"] = json!(false);
    checks["sections"]["checks"] = json!(true);
    let checks = registry.begin(parse(checks), JobLane::Checks).unwrap();
    let mut detail = serde_json::to_value(&req).unwrap();
    detail["sections"]["gross"] = json!(false);
    let jobs = JobScheduler::new(registry.clone());
    jobs.admit_financial_details(parse(detail), &pool).unwrap();
    let work = jobs.next(JobLane::Finance).unwrap().unwrap();
    assert!(registry.is_current(&ordinary).unwrap());
    assert!(work.is_current().unwrap());
    assert!(work.finish().unwrap().is_some());
    assert!(registry.is_current(&ordinary).unwrap());
    assert!(registry.is_current(&checks).unwrap());
}

#[test]
fn details_share_the_existing_finance_worker_while_checks_remain_independent() {
    use luna_engine::runtime::financial_collation::FinancialCollationPool;
    let (registry, s) = setup();
    let pool = FinancialCollationPool::new(registry.clone());
    let locator = ready(&pool, &s, "one-finance");
    let base = request(&s, 1, locator);
    let mut gross = serde_json::to_value(&base).unwrap();
    gross.as_object_mut().unwrap().remove("financialDetails");
    gross["guard"]["requestId"] = json!("gross-running");
    let jobs = JobScheduler::new(registry);
    jobs.admit(parse(gross), JobLane::Finance).unwrap();
    let held = jobs.next(JobLane::Finance).unwrap().unwrap();
    let mut detail = serde_json::to_value(&base).unwrap();
    detail["sections"]["gross"] = json!(false);
    let detail_id = jobs.admit_financial_details(parse(detail), &pool).unwrap();
    let mut checks = serde_json::to_value(&base).unwrap();
    checks.as_object_mut().unwrap().remove("financialDetails");
    checks["sections"]["gross"] = json!(false);
    checks["sections"]["checks"] = json!(true);
    checks["guard"]["requestId"] = json!("checks-running");
    jobs.admit(parse(checks), JobLane::Checks).unwrap();
    let checking = jobs.next(JobLane::Checks).unwrap().unwrap();
    assert!(jobs.next(JobLane::Finance).unwrap().is_none());
    assert!(jobs.next(JobLane::Checks).unwrap().is_none());
    assert!(held.is_current().unwrap());
    assert!(checking.finish().unwrap().is_some());
    assert!(held.finish().unwrap().is_some());
    let details = jobs.next(JobLane::Finance).unwrap().unwrap();
    assert_eq!(details.id(), detail_id);
    assert!(details.lease().financial_details().is_some());
    assert!(jobs.next(JobLane::Checks).unwrap().is_none());
    assert!(details.finish().unwrap().is_some());
    assert_eq!(jobs.counts().unwrap(), (0, 0));
}

#[test]
fn full_queue_preserves_existing_detail_writer_and_evicted_receipt_requires_preparation() {
    use luna_engine::runtime::{
        financial_collation::{FinancialCollationPool, FinancialPoolError},
        jobs::{FinancialDetailsAdmissionError, JobError, MAX_PENDING_JOBS},
    };
    let (registry, s) = setup();
    let pool = FinancialCollationPool::new(registry.clone());
    let locator = ready(&pool, &s, "accepted-detail");
    let mut req = serde_json::to_value(request(&s, 1, locator)).unwrap();
    req["sections"]["gross"] = json!(false);
    let req = parse(req);
    let proof = pool.admission_for_request(&req).unwrap();
    let held = registry
        .acquire(
            registry
                .reserve_with_financial_details(req.clone(), JobLane::Finance, proof)
                .unwrap(),
        )
        .unwrap();
    let jobs = JobScheduler::new(registry.clone());
    for i in 0..MAX_PENDING_JOBS {
        let mut ordinary = serde_json::to_value(&req).unwrap();
        ordinary.as_object_mut().unwrap().remove("financialDetails");
        ordinary["sections"]["gross"] = json!(true);
        ordinary["periods"][0]["month"] = json!(format!("2026-{:02}", i + 1));
        ordinary["guard"]["requestId"] = json!(format!("ordinary-{i}"));
        jobs.admit(parse(ordinary), JobLane::Finance).unwrap();
    }
    let mut next = serde_json::to_value(&req).unwrap();
    next["guard"]["requestRevision"] = json!(2);
    assert_eq!(
        jobs.admit_financial_details(parse(next), &pool),
        Err(FinancialDetailsAdmissionError::Job(JobError::Capacity))
    );
    assert!(registry.is_current(&held).unwrap());
    let (registry, s) = setup();
    let pool = FinancialCollationPool::new(registry.clone());
    let locator = ready(&pool, &s, "idle-old");
    let req = request(&s, 1, locator);
    for i in 0..9 {
        ready(&pool, &s, &format!("idle-new-{i}"));
    }
    let jobs = JobScheduler::new(registry);
    assert_eq!(
        jobs.admit_financial_details(req, &pool),
        Err(FinancialDetailsAdmissionError::Pool(
            FinancialPoolError::UnknownProof
        ))
    );
    assert_eq!(jobs.counts().unwrap(), (0, 0));
}
