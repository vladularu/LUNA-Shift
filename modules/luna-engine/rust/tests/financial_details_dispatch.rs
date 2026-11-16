mod common;
#[path = "support/salary_snapshot.rs"]
mod salary_snapshot;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    contract::{self, CalculationRequest, ImmutableSnapshot, ValidatedRequest},
    runtime::{
        JobLane, SnapshotRegistry, dispatch, financial_collation::FinancialCollationPool,
        jobs::JobScheduler,
    },
};
use serde_json::{Value, json};
fn bytes(v: &Value) -> Vec<u8> {
    serde_json::to_vec(v).unwrap()
}
fn envelope(command: Value) -> Value {
    json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":command})
}
fn setup(case: &Value) -> (SnapshotRegistry, FinancialCollationPool, ImmutableSnapshot) {
    let s = salary_snapshot::facts(salary_snapshot::raw(case))
        .snapshot()
        .clone();
    let registry = SnapshotRegistry::default();
    registry.register(s.clone()).unwrap();
    let pool = FinancialCollationPool::new(registry.clone());
    (registry, pool, s)
}
fn prepare(pool: &FinancialCollationPool, s: &ImmutableSnapshot, case: &Value) -> Value {
    let input = &case["input"];
    let mut header = envelope(json!({}));
    header.as_object_mut().unwrap().remove("command");
    header["guard"] = json!({"ownerScope":s.identity().owner_scope(),"ownerEpoch":s.identity().owner_epoch(),"requestId":"source-details","draftRevision":1,"snapshot":s.identity()});
    header["intent"] = json!({"month":input["month"],"perspective":input["perspective"],"filter":input["filter"],"includeSpecialDutyPay":input["includeSpecialDutyPay"]});
    header["localeKey"] = json!("node-source-locale-v1");
    serde_json::from_slice(
        &pool
            .prepare(&bytes(&header))
            .unwrap()
            .serialize_current()
            .unwrap(),
    )
    .unwrap()
}
fn candidates(pool: &FinancialCollationPool, p: &Value) -> Vec<Value> {
    let mut strings = vec![];
    let mut after = Value::Null;
    loop {
        let page:Value=serde_json::from_slice(&pool.candidates(&bytes(&json!({"draftId":p["draftId"],"candidateDigest":p["candidateDigest"],"after":after,"limit":1024}))).unwrap().serialize_current().unwrap()).unwrap();
        strings.extend(
            page["page"]["candidates"]
                .as_array()
                .unwrap()
                .iter()
                .cloned(),
        );
        after = page["page"]["nextAfter"].clone();
        if after.is_null() {
            return strings;
        }
    }
}
fn original_platform_rank_subset(
    pool: &FinancialCollationPool,
    prepared: &Value,
    source: &Value,
) -> Value {
    // The oracle's real Node.localeCompare order is authoritative. Restrict and
    // densify its integer equivalence classes; never compare strings in Rust.
    let mut ordered = candidates(pool, prepared)
        .into_iter()
        .map(|candidate| {
            let rank = source[candidate.as_str().unwrap()]
                .as_u64()
                .expect("original platform order must cover every native comparison string");
            (candidate, rank)
        })
        .collect::<Vec<_>>();
    ordered.sort_by_key(|(_, rank)| *rank);
    let mut result = serde_json::Map::new();
    let mut previous = None;
    let mut ordinal = 0;
    for (candidate, rank) in ordered {
        if previous.is_some_and(|old| old != rank) {
            ordinal += 1;
        }
        result.insert(candidate.as_str().unwrap().to_owned(), json!(ordinal));
        previous = Some(rank);
    }
    Value::Object(result)
}
#[test]
#[ignore = "explicit fixture generation: native structural strings only; no money expectation"]
fn capture_pure_native_candidate_boundary() {
    let path =
        std::env::var("LUNA_FINANCIAL_CANDIDATE_CAPTURE").expect("explicit external artifact path");
    let original = value_pool::decode(include_str!(
        "../../reference/financial-candidates-golden.json"
    ));
    let mut cases = vec![];
    for case in original["cases"].as_array().unwrap() {
        let (_, pool, s) = setup(case);
        let p = prepare(&pool, &s, case);
        cases.push(json!({"id":case["id"],"candidates":candidates(&pool,&p)}));
    }
    std::fs::write(
        path,
        serde_json::to_vec(&json!({"sourceDigest":original["sourceDigest"],"cases":cases}))
            .unwrap(),
    )
    .unwrap();
}
fn request(s: &ImmutableSnapshot, case: &Value, receipt: &Value) -> CalculationRequest {
    let i = &case["input"];
    let value = json!({"guard":{"snapshot":s.identity(),"requestId":"details-dispatch","requestRevision":1},"periods":[{"kind":"MONTH","month":i["month"]}],"sections":{"time":false,"gross":false,"net":false,"checks":false},"perspective":i["perspective"],"priority":"INTERACTIVE","financialDetails":{"filter":i["filter"],"includeSpecialDutyPay":i["includeSpecialDutyPay"],"collation":{"token":receipt["token"],"digest":receipt["digest"],"localeKey":"node-source-locale-v1"}}});
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
fn original_complete_salary_outputs_flow_through_checked_finance_details_jobs() {
    let original = value_pool::decode(include_str!(
        "../../reference/financial-candidates-golden.json"
    ));
    let ranks: Value = serde_json::from_str(include_str!(
        "../../reference/financial-details-collation-golden.json"
    ))
    .unwrap();
    let mut count = 0;
    let panels: Value = serde_json::from_str(include_str!(
        "../../reference/premium-deduction-display-golden.json"
    ))
    .unwrap();
    let ready: Value =
        serde_json::from_str(include_str!("../../reference/service-ready-golden.json")).unwrap();
    let display: Value =
        serde_json::from_str(include_str!("../../reference/service-display-golden.json")).unwrap();
    for case in original["cases"]
        .as_array()
        .unwrap()
        .iter()
        .chain(ready["cases"].as_array().unwrap())
    {
        let (registry, pool, s) = setup(case);
        let p = prepare(&pool, &s, case);
        let rank_case = ranks["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["id"] == case["id"]);
        let rank_value = rank_case.map(|r| r["ranks"].clone()).unwrap_or_else(|| {
            original_platform_rank_subset(&pool, &p, &case["platformCollationRanks"])
        });
        let receipt:Value=serde_json::from_slice(&pool.finalize(&bytes(&json!({"draftId":p["draftId"],"candidateDigest":p["candidateDigest"],"reuseCached":false})),&bytes(&rank_value)).unwrap().serialize_current().unwrap()).unwrap();
        let jobs = JobScheduler::new(registry.clone());
        jobs.admit_financial_details(request(&s, case, &receipt), &pool)
            .unwrap();
        assert!(jobs.next(JobLane::Checks).unwrap().is_none());
        let work = jobs.next(JobLane::Finance).unwrap().unwrap();
        let computed = dispatch::calculate(&work).unwrap().unwrap();
        assert!(computed.financial_details_is_current().unwrap());
        assert!(std::sync::Arc::ptr_eq(
            computed.financial_details_proof().unwrap(),
            work.lease().financial_details().unwrap()
        ));
        let actual = serde_json::to_value(&computed).unwrap();
        assert!(actual.get("financialDetailsProof").is_none());
        assert!(computed.matches_request(work.lease().request()));
        assert_eq!(
            actual["request"]["financialDetails"],
            json!({"filter":case["input"]["filter"],"includeSpecialDutyPay":case["input"]["includeSpecialDutyPay"]})
        );
        assert_eq!(
            actual["reports"][0]["sections"]["financialDetails"]["state"],
            "READY"
        );
        common::assert_json_eq(
            &actual["reports"][0]["sections"]["financialDetails"]["value"],
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
        let expected_display = case.get("expectedPresentation").unwrap_or_else(|| {
            &display["cases"]
                .as_array()
                .unwrap()
                .iter()
                .find(|item| item["id"] == case["id"])
                .unwrap()["expected"]
        });
        assert_eq!(
            actual["reports"][0]["views"]["financialDetails"]["state"],
            "READY"
        );
        let mut expected_display = expected_display.clone();
        let extra = panels["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["id"] == case["id"])
            .unwrap();
        for (key, value) in extra["expected"].as_object().unwrap() {
            expected_display[key] = value.clone();
        }
        common::assert_json_eq(
            &actual["reports"][0]["views"]["financialDetails"]["value"],
            &expected_display,
            case["id"].as_str().unwrap(),
        );
        let permit = work.finish().unwrap().unwrap();
        assert!(std::sync::Arc::ptr_eq(
            computed.financial_details_proof().unwrap(),
            permit.financial_details().unwrap()
        ));
        if count == 0 {
            registry.reset().unwrap();
            assert!(!computed.financial_details_is_current().unwrap());
            assert!(!permit.financial_details().unwrap().is_current().unwrap());
        }
        count += 1;
    }
    assert_eq!(count, 268);
}

#[test]
fn service_display_dates_preserve_original_next_day_and_year_boundary_labels() {
    let source: Value =
        serde_json::from_str(include_str!("../../reference/service-display-golden.json")).unwrap();
    for case in source["boundary"].as_array().unwrap() {
        let actual =
            luna_engine::runtime::financial_report::service_display::row_display(&case["row"])
                .unwrap();
        common::assert_json_eq(
            &actual,
            &case["expected"],
            case["row"]["id"].as_str().unwrap(),
        );
    }
    for case in source["filteredRows"].as_array().unwrap() {
        let actual = case["rows"]
            .as_array()
            .unwrap()
            .iter()
            .map(luna_engine::runtime::financial_report::service_display::row_display)
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        common::assert_json_eq(
            &json!(actual),
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
    }
}

#[test]
fn no_intent_report_section_bytes_keep_the_original_four_section_shape() {
    use luna_engine::runtime::{dispatch::ReportSections, report::SectionOutput};
    let sections = ReportSections {
        time: SectionOutput::NotRequested {},
        gross: SectionOutput::NotRequested {},
        net: SectionOutput::NotRequested {},
        checks: SectionOutput::NotRequested {},
        financial_details: None,
        export_report: None,
        checks_details: None,
    };
    assert_eq!(
        serde_json::to_string(&sections).unwrap(),
        r#"{"time":{"state":"NOT_REQUESTED"},"gross":{"state":"NOT_REQUESTED"},"net":{"state":"NOT_REQUESTED"},"checks":{"state":"NOT_REQUESTED"}}"#
    );
}

#[test]
fn repeated_detail_jobs_share_native_financial_context_without_repricing() {
    let original = value_pool::decode(include_str!(
        "../../reference/financial-candidates-golden.json"
    ));
    let ranks: Value = serde_json::from_str(include_str!(
        "../../reference/financial-details-collation-golden.json"
    ))
    .unwrap();
    let cases = original["cases"].as_array().unwrap();
    let gross = cases
        .iter()
        .find(|c| {
            c["expected"]["payAvailable"] == json!(true)
                && c["expected"]["serviceSummary"]["totalCents"]
                    .as_f64()
                    .is_some_and(|v| v > 0.0)
        })
        .expect("positive tariff case");
    let net = cases
        .iter()
        .find(|c| !c["expected"]["deductions"].is_null())
        .expect("available manual net case");
    for case in [gross, net] {
        let (registry, pool, s) = setup(case);
        let p = prepare(&pool, &s, case);
        let rank_case = ranks["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["id"] == case["id"])
            .unwrap();
        let receipt:Value=serde_json::from_slice(&pool.finalize(&bytes(&json!({"draftId":p["draftId"],"candidateDigest":p["candidateDigest"],"reuseCached":false})),&bytes(&rank_case["ranks"])).unwrap().serialize_current().unwrap()).unwrap();
        let jobs = JobScheduler::new(registry);
        let req = request(&s, case, &receipt);
        let mut next = serde_json::to_value(&req).unwrap();
        jobs.admit_financial_details(req, &pool).unwrap();
        let work = jobs.next(JobLane::Finance).unwrap().unwrap();
        let first = dispatch::calculate(&work).unwrap().unwrap();
        let facts = work.lease().facts().clone();
        let context = facts.financial_context().unwrap().clone();
        let before = context.lock().unwrap().reuse_diagnostics();
        assert!(work.finish().unwrap().is_some());
        next["guard"]["requestRevision"] = json!(2);
        let req = match contract::parse_request(&bytes(&envelope(
            json!({"kind":"CALCULATE","request":next}),
        )))
        .unwrap()
        {
            ValidatedRequest::Calculate(r) => *r,
            _ => panic!("request"),
        };
        jobs.admit_financial_details(req, &pool).unwrap();
        let work = jobs.next(JobLane::Finance).unwrap().unwrap();
        let second = dispatch::calculate(&work).unwrap().unwrap();
        assert!(std::sync::Arc::ptr_eq(
            &context,
            work.lease().facts().financial_context().unwrap()
        ));
        let after = context.lock().unwrap().reuse_diagnostics();
        for key in ["raw", "actual", "annual"] {
            assert_eq!(before[key], after[key], "no repeated finance pass: {key}");
        }
        // Immutable native monetary evidence is reused. Unavailable net admission
        // is deliberately rechecked by the existing net cache policy.
        if case["expected"]["netState"]["value"]["status"] == "available" {
            assert_eq!(before["nativeNetPasses"], after["nativeNetPasses"]);
        }
        assert_eq!(
            serde_json::to_value(&first).unwrap()["reports"],
            serde_json::to_value(&second).unwrap()["reports"]
        );
        assert!(work.finish().unwrap().is_some());
    }
}
