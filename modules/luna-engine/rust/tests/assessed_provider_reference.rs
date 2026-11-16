#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    input::{
        annual_rows::{RawActualAnnualPayments, RawTariffAnnualClaims},
        draft_rows::{DraftRowsKind, RawDraftRows},
        remuneration_rows::{RawRemunerationRows, RemunerationRowsKind},
        training_rows::RawShiftTraining,
    },
    remuneration::{
        base::prepared::PaidAbsenceIndex,
        draft_facts::{
            model::ConfirmationKind,
            prepared::{AnnexPremiumOwner, DraftConfirmationOwner},
        },
        overtime::prepared::OvertimeAllocationIndex,
    },
    report::financial::{
        assessed::{AssessedMonthProvider, AssessedReportStatus, annual_assessed_financial_report},
        assessed_source::{
            AssessedSourceBook,
            input::{AssessedSourceInput, Evidence, EvidenceKind, EvidenceState},
        },
    },
    rules::RuleResolver,
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc};
#[test]
fn independent_equal_snapshots_reuse_native_assessed_results_without_pricing_again() {
    use luna_engine::report::financial::{
        assessed_source::SharedAssessedReuseCache, fingerprint::StableFinancialDataSpace,
    };
    let data = data();
    let resolvers = resolvers(&data);
    let case = data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["year"] == 2026)
        .unwrap();
    let cache = Arc::new(SharedAssessedReuseCache::new());
    let make = || {
        AssessedSourceBook::new_with_reuse(
            make_input(
                serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap(),
                Arc::clone(&resolvers[case["track"].as_str().unwrap()]),
            ),
            StableFinancialDataSpace::new("luna:internal:offline:assessed-fixture").unwrap(),
            Arc::clone(&cache),
        )
        .unwrap()
    };
    let first = make();
    let a =
        annual_assessed_financial_report(2026, AssessedReportStatus::Ready, &mut first.session())
            .unwrap();
    let second = make();
    let b =
        annual_assessed_financial_report(2026, AssessedReportStatus::Ready, &mut second.session())
            .unwrap();
    assert_eq!(
        serde_json::to_value(a).unwrap(),
        serde_json::to_value(b).unwrap()
    );
    assert!(first.cache_stats().unwrap().calculations > 0);
    assert_eq!(
        second.cache_stats().unwrap().calculations,
        0,
        "equal native source snapshots must reuse completed money"
    );
    assert!(cache.stats().unwrap().hits > 0);
}
#[test]
fn shared_cache_keeps_all_198_frozen_native_years_source_identical() {
    use luna_engine::report::financial::{
        assessed_source::SharedAssessedReuseCache, fingerprint::StableFinancialDataSpace,
    };
    let data = data();
    let resolvers = resolvers(&data);
    let cache = Arc::new(SharedAssessedReuseCache::new());
    for case in data["cases"].as_array().unwrap() {
        let input = make_input(
            serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap(),
            Arc::clone(&resolvers[case["track"].as_str().unwrap()]),
        );
        let book = AssessedSourceBook::new_with_reuse(
            input,
            StableFinancialDataSpace::new("luna:internal:offline:whole-source").unwrap(),
            Arc::clone(&cache),
        )
        .unwrap();
        let actual = match annual_assessed_financial_report(
            case["year"].as_i64().unwrap() as i32,
            AssessedReportStatus::Ready,
            &mut book.session(),
        ) {
            Ok(v) => json!({"value":v}),
            Err(e) => json!({"error":{"name":"Error","message":e.to_string()}}),
        };
        assert_eq!(actual, case["expected"], "shared source {}", case["id"]);
    }
    assert!(cache.stats().unwrap().entries <= 48);
    assert!(cache.stats().unwrap().retained_serialized_bytes <= 16 * 1024 * 1024);
}
#[test]
fn one_duty_end_time_update_reuses_original_unaffected_month_windows() {
    use luna_engine::report::financial::{
        assessed_source::SharedAssessedReuseCache, fingerprint::StableFinancialDataSpace,
    };
    let data = value_pool::decode(include_str!("../../reference/assessed-reuse-golden.json"));
    let resolvers = resolvers(&data);
    let cases = data["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 32);
    for case in cases {
        let cache = Arc::new(SharedAssessedReuseCache::new());
        let make = |key: &str| {
            AssessedSourceBook::new_with_reuse(
                make_input(
                    serde_json::from_str(case[key].as_str().unwrap()).unwrap(),
                    Arc::clone(&resolvers[case["track"].as_str().unwrap()]),
                ),
                StableFinancialDataSpace::new("luna:internal:offline:duty-mutation").unwrap(),
                Arc::clone(&cache),
            )
            .unwrap()
        };
        let before = make("inputJson");
        let actual = annual_assessed_financial_report(
            2026,
            AssessedReportStatus::Ready,
            &mut before.session(),
        )
        .unwrap();
        assert_eq!(
            json!({"value":actual}),
            case["expectedBefore"],
            "before {}",
            case["id"]
        );
        let changed = make("changedJson");
        let actual = match annual_assessed_financial_report(
            2026,
            AssessedReportStatus::Ready,
            &mut changed.session(),
        ) {
            Ok(v) => json!({"value":v}),
            Err(e) => json!({"error":{"name":"Error","message":e.to_string()}}),
        };
        assert_eq!(actual, case["expectedAfter"], "changed {}", case["id"]);
        let allowed = case["allowedDirtyMonths"].as_array().unwrap().len() as u64;
        assert!(
            changed.cache_stats().unwrap().calculations <= allowed,
            "{} recomputed {} months, source windows {:?}",
            case["id"],
            changed.cache_stats().unwrap().calculations,
            case["allowedDirtyMonths"]
        );
        assert!(
            cache.stats().unwrap().hits > 0,
            "unchanged months must actually reuse {}",
            case["id"]
        );
    }
}
#[test]
fn assessed_reuse_scope_and_large_target_owner_isolation() {
    use luna_engine::report::financial::{
        assessed_source::SharedAssessedReuseCache, fingerprint::StableFinancialDataSpace,
    };
    let data = data();
    let resolvers = resolvers(&data);
    let case = data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["year"] == 2026)
        .unwrap();
    let cache = Arc::new(SharedAssessedReuseCache::new());
    let input = || {
        make_input(
            serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap(),
            Arc::clone(&resolvers[case["track"].as_str().unwrap()]),
        )
    };
    let baseline = AssessedSourceBook::new_with_reuse(
        input(),
        StableFinancialDataSpace::new("luna:internal:offline:first-db").unwrap(),
        Arc::clone(&cache),
    )
    .unwrap();
    let before = annual_assessed_financial_report(
        2026,
        AssessedReportStatus::Ready,
        &mut baseline.session(),
    )
    .unwrap();
    let before = serde_json::to_value(before).unwrap();
    let foreign = AssessedSourceBook::new_with_reuse(
        input(),
        StableFinancialDataSpace::new("luna:internal:offline:second-db").unwrap(),
        Arc::clone(&cache),
    )
    .unwrap();
    let other =
        annual_assessed_financial_report(2026, AssessedReportStatus::Ready, &mut foreign.session())
            .unwrap();
    assert_eq!(serde_json::to_value(other).unwrap(), before);
    assert_eq!(
        foreign.cache_stats().unwrap().calculations,
        12,
        "different data spaces cannot borrow the first account's money"
    );
    let mut large = input();
    Arc::make_mut(&mut large.work_profile)["workingTimeTarget"] =
        json!({"facts":vec![json!({"minutes":480,"id":"target-fact"});50000]});
    let weak = Arc::downgrade(&large.work_profile);
    let target = AssessedSourceBook::new_with_reuse(
        large,
        StableFinancialDataSpace::new("luna:internal:offline:first-db").unwrap(),
        Arc::clone(&cache),
    )
    .unwrap();
    let same =
        annual_assessed_financial_report(2026, AssessedReportStatus::Ready, &mut target.session())
            .unwrap();
    assert_eq!(serde_json::to_value(same).unwrap(), before);
    assert_eq!(
        target.cache_stats().unwrap().calculations,
        0,
        "target-only changes must not recalculate money"
    );
    drop(target);
    assert!(
        weak.upgrade().is_none(),
        "the result cache must not retain the large source profile"
    );
}
#[test]
fn assessed_reuse_scope_honors_optional_and_required_source_states() {
    use luna_engine::report::financial::{
        assessed_source::SharedAssessedReuseCache, fingerprint::StableFinancialDataSpace,
    };
    let data = data();
    let resolvers = resolvers(&data);
    let case=data["cases"].as_array().unwrap().iter().find(|c|{let raw:Value=serde_json::from_str(c["inputJson"].as_str().unwrap()).unwrap();raw["rows"]["scoped"].as_array().is_some_and(Vec::is_empty)&&raw["history"].as_array().is_some_and(|r|!r.is_empty()&&r.iter().all(|p|p["data"]["selection"]["kind"].as_str().is_some_and(|k|k.starts_with("own-"))))&&c["expected"]["value"]["months"][8]["result"]["base"]["complete"]==true&&c["expected"]["value"]["months"][8]["result"]["base"]["positions"][0]["basis"]["hourly"].is_null()}).unwrap();
    let month = format!("{}-09", case["year"].as_i64().unwrap());
    let input = || {
        make_input(
            serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap(),
            Arc::clone(&resolvers[case["track"].as_str().unwrap()]),
        )
    };
    let cache = Arc::new(SharedAssessedReuseCache::new());
    let make = |raw| {
        AssessedSourceBook::new_with_reuse(
            raw,
            StableFinancialDataSpace::new("luna:internal:offline:source-states").unwrap(),
            Arc::clone(&cache),
        )
        .unwrap()
    };
    let base = make(input());
    let expected = base.session().assessed_month(&month).unwrap();
    let mut optional = input();
    optional.scoped_decisions = Evidence::Failed;
    optional.tvl_shift_work = Evidence::Loading;
    optional.annex_month = Evidence::NotRequested;
    optional.annex_premium = Evidence::Missing;
    optional.sue_month = Evidence::Failed;
    optional.sue_allowance = Evidence::Loading;
    optional.paid_absences = Evidence::Failed;
    optional.pause_details = Evidence::Failed;
    let optional = make(optional);
    let same = optional.session().assessed_month(&month).unwrap();
    assert_eq!(
        serde_json::to_value(same).unwrap(),
        serde_json::to_value(expected).unwrap()
    );
    assert_eq!(
        optional.cache_stats().unwrap().calculations,
        0,
        "unrelated failed sources must not prevent native reuse"
    );
    let hits = cache.stats().unwrap().hits;
    let mut missing = input();
    missing.actual_annual_payments = Evidence::Failed;
    let missing = make(missing);
    assert!(missing.session().assessed_month(&month).is_err());
    assert_eq!(
        cache.stats().unwrap().hits,
        hits,
        "relevant I/O failure must precede reuse of an earlier Ready result"
    );
}
fn take(value: &mut Value, key: &str) -> Value {
    value.as_object_mut().unwrap().remove(key).unwrap()
}
fn take_rows(value: &mut Value, key: &str) -> Arc<Vec<Value>> {
    match take(value, key) {
        Value::Array(rows) => Arc::new(rows),
        _ => panic!("raw source rows"),
    }
}
fn make_input(mut raw: Value, resolver: Arc<RuleResolver>) -> AssessedSourceInput {
    let mut rows = take(&mut raw, "rows");
    let annual = RawActualAnnualPayments::try_from_rows(take_rows(&mut rows, "annual")).unwrap();
    let claims = RawTariffAnnualClaims::try_from_rows(take_rows(&mut rows, "claims")).unwrap();
    let scoped = RawRemunerationRows::try_from_rows(
        RemunerationRowsKind::ScopedAllowances,
        take_rows(&mut rows, "scoped"),
    )
    .unwrap();
    let tvl = RawDraftRows::try_from_rows(DraftRowsKind::TvlShiftWork, take_rows(&mut rows, "tvl"))
        .unwrap();
    let mut draft = |key: &str, kind: DraftRowsKind| {
        RawDraftRows::try_from_rows(kind, take_rows(&mut rows, key)).unwrap()
    };
    let annex = draft("annex", DraftRowsKind::AnnexAMonth);
    let premium = draft("premium", DraftRowsKind::AnnexAPremium);
    let sue = draft("sue", DraftRowsKind::SueMonth);
    let sue_allowance = draft("sueAllowance", DraftRowsKind::SueAllowance);
    let pauses = RawShiftTraining::try_from_rows(take_rows(&mut rows, "pause")).unwrap();
    let pause_ready = raw["pauseComplete"] == true;
    AssessedSourceInput {
        work_profile: Arc::new(take(&mut raw, "workProfile")),
        active_shifts: take_rows(&mut raw, "shifts"),
        history: take_rows(&mut raw, "history"),
        resolver,
        settings: serde_json::from_value(take(&mut raw, "settings")).unwrap(),
        legacy_decisions: take_rows(&mut raw, "legacyDecisions"),
        scoped_decisions: Evidence::Ready(Arc::new(scoped)),
        paid_absences: Evidence::Ready(Arc::new(
            PaidAbsenceIndex::new(take_rows(&mut raw, "paidAbsences")).unwrap(),
        )),
        overtime_allocations: Evidence::Ready(Arc::new(
            OvertimeAllocationIndex::new(take_rows(&mut raw, "savedOvertimeAllocations")).unwrap(),
        )),
        actual_annual_payments: Evidence::Ready(Arc::new(annual)),
        tariff_annual_claims: Evidence::Ready(Arc::new(claims)),
        tvl_shift_work: Evidence::Ready(Arc::new(tvl)),
        annex_month: Evidence::Ready(Arc::new(
            DraftConfirmationOwner::new(ConfirmationKind::AnnexA, Arc::clone(annex.saved()))
                .unwrap(),
        )),
        annex_premium: Evidence::Ready(Arc::new(
            AnnexPremiumOwner::new(Arc::clone(premium.saved())).unwrap(),
        )),
        sue_month: Evidence::Ready(Arc::new(
            DraftConfirmationOwner::new(ConfirmationKind::SueMonth, Arc::clone(sue.saved()))
                .unwrap(),
        )),
        sue_allowance: Evidence::Ready(Arc::new(
            DraftConfirmationOwner::new(
                ConfirmationKind::SueAllowance,
                Arc::clone(sue_allowance.saved()),
            )
            .unwrap(),
        )),
        pause_details: if pause_ready {
            Evidence::Ready(Arc::new(pauses))
        } else {
            Evidence::Loading
        },
    }
}
fn data() -> Value {
    value_pool::decode(include_str!(
        "../../reference/assessed-provider-golden.json"
    ))
}
fn resolvers(data: &Value) -> BTreeMap<String, Arc<RuleResolver>> {
    data["catalogs"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(key, d)| {
            let mut resolver = RuleResolver::new(
                serde_json::from_str(d["catalogJson"].as_str().unwrap()).unwrap(),
                serde_json::from_value(d["packageIds"].clone()).unwrap(),
                d["historicalJson"]
                    .as_str()
                    .map(|v| serde_json::from_str(v).unwrap()),
            )
            .unwrap();
            if let Some(ranks) = d.get("collationRanks") {
                resolver =
                    resolver.with_collation_ranks(serde_json::from_value(ranks.clone()).unwrap());
            }
            (key.clone(), Arc::new(resolver))
        })
        .collect()
}
fn difference(a: &Value, e: &Value, path: &str) -> String {
    match (a, e) {
        (Value::Object(a), Value::Object(e)) => {
            for (k, v) in e {
                if a.get(k) != Some(v) {
                    return difference(a.get(k).unwrap_or(&Value::Null), v, &format!("{path}.{k}"));
                }
            }
            format!("{path}:object keys")
        }
        (Value::Array(a), Value::Array(e)) => {
            for (i, (a, e)) in a.iter().zip(e).enumerate() {
                if a != e {
                    return difference(a, e, &format!("{path}[{i}]"));
                }
            }
            format!("{path}:lengths {} vs {}", a.len(), e.len())
        }
        _ => format!("{path}:actual {a}; expected {e}"),
    }
}
#[test]
fn raw_sql_to_native_assessed_year_matches_all_complete_source_outputs() {
    let data = data();
    let resolvers = resolvers(&data);
    let mut failures = vec![];
    let mut checked = 0;
    for case in data["cases"].as_array().unwrap() {
        let input = make_input(
            serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap(),
            Arc::clone(&resolvers[case["track"].as_str().unwrap()]),
        );
        let profile = Arc::clone(&input.work_profile);
        let shifts = Arc::clone(&input.active_shifts);
        let history = Arc::clone(&input.history);
        let book = AssessedSourceBook::new(input).unwrap();
        // Retaining the source owners, rather than copying their Value trees,
        // is observable even after constructing all twelve monthly results.
        assert!(
            Arc::strong_count(&profile) >= 2
                && Arc::strong_count(&shifts) >= 2
                && Arc::strong_count(&history) >= 2
        );
        let mut session = book.session();
        let actual = match annual_assessed_financial_report(
            case["year"].as_i64().unwrap() as i32,
            AssessedReportStatus::Ready,
            &mut session,
        ) {
            Ok(v) => json!({"value":v}),
            Err(e) => json!({"error":{"name":"Error","message":e.to_string()}}),
        };
        checked += 1;
        if actual != case["expected"] {
            failures.push(format!(
                "{} {}",
                case["id"],
                difference(&actual, &case["expected"], "$")
            ));
        }
        // A fresh borrowed session must reuse the snapshot's completed months.
        let count = book.cache_stats().unwrap().calculations;
        let mut repeated = book.session();
        let again = annual_assessed_financial_report(
            case["year"].as_i64().unwrap() as i32,
            AssessedReportStatus::Ready,
            &mut repeated,
        )
        .unwrap();
        assert_eq!(
            serde_json::to_value(again).unwrap(),
            actual["value"],
            "repeated {}",
            case["id"]
        );
        assert_eq!(
            book.cache_stats().unwrap().calculations,
            count,
            "no recalculation {}",
            case["id"]
        );
    }
    assert_eq!(checked, 198);
    assert!(
        failures.is_empty(),
        "{} mismatches\n{}",
        failures.len(),
        failures
            .into_iter()
            .take(20)
            .collect::<Vec<_>>()
            .join("\n\n")
    );
}
#[test]
fn unavailable_unrelated_sources_do_not_block_fixed_own_pay_but_cash_sources_do() {
    let data = data();
    let resolvers = resolvers(&data);
    let case = data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| {
            let raw: Value = serde_json::from_str(c["inputJson"].as_str().unwrap()).unwrap();
            raw["history"].as_array().is_some_and(|rows| {
                !rows.is_empty() && rows.iter().all(|p| p["data"]["selection"]["kind"].as_str().is_some_and(|k|k.starts_with("own-")))
            }) && c["expected"]["value"]["months"][8]["result"]["base"]["complete"] == true
                && c["expected"]["value"]["months"][8]["result"]["base"]["positions"][0]["basis"]["hourly"].is_null()
        })
        .expect("source own monthly pay case");
    let month = format!("{}-09", case["year"].as_i64().unwrap());
    let input = || {
        make_input(
            serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap(),
            Arc::clone(&resolvers[case["track"].as_str().unwrap()]),
        )
    };
    let mut base = input();
    base.scoped_decisions = Evidence::Failed;
    base.tvl_shift_work = Evidence::Loading;
    base.annex_month = Evidence::NotRequested;
    base.annex_premium = Evidence::Missing;
    base.sue_month = Evidence::Failed;
    base.sue_allowance = Evidence::Loading;
    base.paid_absences = Evidence::Failed;
    let book = AssessedSourceBook::new(base).unwrap();
    let required = book.requirements(&month).unwrap();
    assert!(
        !required.contains(&EvidenceKind::AnnexMonth)
            && !required.contains(&EvidenceKind::TvlShiftWork)
            && !required.contains(&EvidenceKind::PaidAbsences)
    );
    let result =
        serde_json::to_value(book.session().assessed_month(&month).unwrap().unwrap()).unwrap();
    assert_eq!(result["base"]["complete"], true);
    assert_eq!(
        book.evidence_state(EvidenceKind::TvlShiftWork),
        EvidenceState::Loading
    );
    assert_eq!(
        book.evidence_state(EvidenceKind::ScopedAllowances),
        EvidenceState::Failed
    );
    assert_eq!(
        book.evidence_state(EvidenceKind::AnnexMonth),
        EvidenceState::NotRequested
    );
    for mode in 0..4 {
        let mut base = input();
        base.actual_annual_payments = match mode {
            0 => Evidence::NotRequested,
            1 => Evidence::Loading,
            2 => Evidence::Missing,
            _ => Evidence::Failed,
        };
        let book = AssessedSourceBook::new(base).unwrap();
        assert!(book.session().assessed_month(&month).is_err());
        assert_eq!(book.cache_stats().unwrap().calculations, 0);
    }
    let mut base = input();
    base.tariff_annual_claims = Evidence::Failed;
    assert!(
        AssessedSourceBook::new(base)
            .unwrap()
            .session()
            .assessed_month(&month)
            .is_err()
    );
}
#[test]
fn missing_relevant_family_evidence_fails_before_pricing() {
    let data = data();
    let resolvers = resolvers(&data);
    for kind in [
        EvidenceKind::PaidAbsences,
        EvidenceKind::OvertimeAllocations,
        EvidenceKind::ScopedAllowances,
        EvidenceKind::TvlShiftWork,
        EvidenceKind::AnnexMonth,
        EvidenceKind::AnnexPremium,
        EvidenceKind::SueMonth,
        EvidenceKind::SueAllowance,
    ] {
        let mut found = false;
        for case in data["cases"].as_array().unwrap() {
            let make = || {
                make_input(
                    serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap(),
                    Arc::clone(&resolvers[case["track"].as_str().unwrap()]),
                )
            };
            let probe = AssessedSourceBook::new(make()).unwrap();
            let month = (1..=12)
                .map(|i| format!("{}-{i:02}", case["year"].as_i64().unwrap()))
                .find(|m| probe.requirements(m).unwrap().contains(&kind));
            let Some(month) = month else {
                continue;
            };
            let mut input = make();
            match kind {
                EvidenceKind::PaidAbsences => input.paid_absences = Evidence::Missing,
                EvidenceKind::OvertimeAllocations => input.overtime_allocations = Evidence::Missing,
                EvidenceKind::ScopedAllowances => input.scoped_decisions = Evidence::Missing,
                EvidenceKind::TvlShiftWork => input.tvl_shift_work = Evidence::Missing,
                EvidenceKind::AnnexMonth => input.annex_month = Evidence::Missing,
                EvidenceKind::AnnexPremium => input.annex_premium = Evidence::Missing,
                EvidenceKind::SueMonth => input.sue_month = Evidence::Missing,
                EvidenceKind::SueAllowance => input.sue_allowance = Evidence::Missing,
                _ => unreachable!("annual sources have separate general guards"),
            }
            let book = AssessedSourceBook::new(input).unwrap();
            assert!(book.session().assessed_month(&month).is_err(), "{kind:?}");
            assert_eq!(book.cache_stats().unwrap().calculations, 0);
            found = true;
            break;
        }
        assert!(found, "source corpus must exercise {kind:?}");
    }
}
#[test]
fn separate_snapshot_books_never_reuse_changed_profile_results() {
    let data = data();
    let resolvers = resolvers(&data);
    let case = data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| {
            let raw: Value = serde_json::from_str(c["inputJson"].as_str().unwrap()).unwrap();
            raw["history"].as_array().is_some_and(|rows| {
                rows.len() == 1 && rows[0]["data"]["selection"]["kind"] == "own-monthly"
            }) && c["expected"]["value"]["months"][8]["result"]["base"]["complete"] == true
        })
        .expect("source own fixed monthly case");
    let make = || {
        make_input(
            serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap(),
            Arc::clone(&resolvers[case["track"].as_str().unwrap()]),
        )
    };
    let month = format!("{}-09", case["year"].as_i64().unwrap());
    let first = AssessedSourceBook::new(make()).unwrap();
    let old =
        serde_json::to_value(first.session().assessed_month(&month).unwrap().unwrap()).unwrap();
    let mut next = make();
    let history = Arc::make_mut(&mut next.history);
    let amount = history[0]["data"]["selection"]["monthlyGrossCents"]
        .as_i64()
        .unwrap();
    history[0]["data"]["selection"]["monthlyGrossCents"] = json!(amount + 10000);
    history[0]["revision"] = json!(history[0]["revision"].as_i64().unwrap() + 1);
    let second = AssessedSourceBook::new(next).unwrap();
    let changed =
        serde_json::to_value(second.session().assessed_month(&month).unwrap().unwrap()).unwrap();
    assert_ne!(
        changed["base"]["knownSubtotalCents"],
        old["base"]["knownSubtotalCents"]
    );
    assert_eq!(first.cache_stats().unwrap().calculations, 1);
    assert_eq!(second.cache_stats().unwrap().calculations, 1);
    assert_eq!(
        serde_json::to_value(first.session().assessed_month(&month).unwrap().unwrap()).unwrap(),
        old
    );
    assert_eq!(first.cache_stats().unwrap().calculations, 1);
}
