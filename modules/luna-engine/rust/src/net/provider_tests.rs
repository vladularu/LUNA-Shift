use super::*;
use crate::net::gross_evidence::calculate_automatic_net_pay_forecast;
use crate::net::payment_projection::{ProjectionError, project_salary_payment};
use crate::net::payment_schedule::validate_salary_payment_preferences;
use crate::net::payout_forecast::{
    AutomaticPaymentInput, calculate_automatic_payment_net_pay_forecast,
};
use crate::net::settings::resolve_net_pay_settings;
mod common {
    include!("../../tests/common/mod.rs");
}

fn scope(input: &Value) -> SourceDataScope {
    // The raw fixture is deliberately incapable of supplying pay, traces or
    // classifications. Every monetary expectation is outside inputJson.
    let allowed = [
        "month",
        "profile",
        "shifts",
        "assessmentShifts",
        "workPatternSettings",
        "decisions",
        "netSettings",
        "preferences",
        "perspective",
        "sourceSettings",
        "socialInsuranceAttribution",
    ];
    assert!(
        input
            .as_object()
            .unwrap()
            .keys()
            .all(|key| allowed.contains(&key.as_str()))
    );
    SourceDataScope {
        profile: Arc::new(input["profile"].clone()),
        shifts: Arc::new(input["shifts"].as_array().unwrap().clone()),
        assessment_shifts: Arc::new(input["assessmentShifts"].as_array().unwrap().clone()),
        decisions: Arc::new(serde_json::from_value(input["decisions"].clone()).unwrap()),
        work_pattern_settings: serde_json::from_value(input["workPatternSettings"].clone())
            .unwrap(),
    }
}

#[test]
fn native_gross_earned_and_cash_net_match_frozen_source_from_raw_facts_only() {
    let reference: Value = serde_json::from_str(include_str!(
        "../../../reference/native-gross-provider-golden.json"
    ))
    .unwrap();
    let cases = reference["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 1605);
    let resolver = RuleResolver::bundled().unwrap();
    let mut full_comparisons = 0;
    let mut rejected_ambiguous_histories = 0;
    let mut cash_comparisons = 0;
    for case in cases {
        let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let id = case["id"].as_str().unwrap();
        let month = input["month"].as_str().unwrap();
        let scope = scope(&input);
        let profile = Arc::clone(&scope.profile);
        let shifts = Arc::clone(&scope.shifts);
        let mut provider = NativeGrossEvidenceProvider::new(scope, &resolver).unwrap();
        let evidence = provider.month_evidence(
            month,
            Arc::clone(&profile),
            Arc::clone(&shifts),
            EvidenceNeed::GrossOnly,
            &resolver,
        );
        if case["expected"].get("$error").is_some() {
            assert_eq!(
                case["expected"]["$error"],
                "Mehrdeutige Vergütungshistorie."
            );
            assert!(
                evidence.is_err(),
                "{id}: ambiguous remuneration must be rejected"
            );
            rejected_ambiguous_histories += 1;
            continue;
        }
        let evidence = evidence.unwrap_or_else(|_| panic!("{id}: native evidence unavailable"));
        assert!(
            Arc::ptr_eq(&profile, &evidence.source.profile),
            "{id}: share raw profile"
        );
        assert!(
            Arc::ptr_eq(&shifts, &evidence.source.shifts),
            "{id}: share original plan"
        );
        let requested_trace = provider
            .month_evidence(
                month,
                Arc::clone(&profile),
                Arc::clone(&shifts),
                EvidenceNeed::PayrollTraces,
                &resolver,
            )
            .unwrap();
        assert!(
            Arc::ptr_eq(&evidence, &requested_trace),
            "{id}: no repricing on evidence request"
        );
        assert_eq!(provider.calculations, 1, "{id}");
        assert_eq!(
            provider.diagnostics()["traceCapturePolicy"],
            "SAME_PRICING_PASS"
        );
        assert_eq!(provider.diagnostics()["cachedTimeAccounts"], 0);
        let forecast = calculate_automatic_net_pay_forecast(
            month,
            Arc::clone(&profile),
            Arc::clone(&shifts),
            &input["netSettings"],
            &resolver,
            &mut provider,
        );
        let account = provider.special_duty_time_account(month).unwrap();
        assert!(
            Arc::ptr_eq(
                &account,
                &provider.special_duty_time_account(month).unwrap()
            ),
            "{id}: reuse time account"
        );
        assert_eq!(
            provider.calculations, 1,
            "{id}: no financial repricing for time account"
        );
        let mut actual = json!({"pay":evidence.source.pay(),"forecast":forecast,"timeAccount":account.to_json()});
        if !input["preferences"].is_null() {
            let preferences = validate_salary_payment_preferences(&input["preferences"]).unwrap();
            let projection = project_salary_payment(
                month,
                serde_json::from_value(input["perspective"].clone()).unwrap(),
                &preferences,
                |month| {
                    provider
                        .source(month)
                        .map_err(|_| ProjectionError::InvalidSource)
                },
            )
            .unwrap();
            let history = input["sourceSettings"].as_array().unwrap();
            let selected = resolve_net_pay_settings(month, history).unwrap();
            let request = AutomaticPaymentInput {
                month,
                profile: Arc::clone(&profile),
                settings: &selected["settings"],
                projection: &projection,
                source_settings: history,
                social_insurance_attribution: input["socialInsuranceAttribution"].as_str(),
            };
            actual["payout"] =
                calculate_automatic_payment_net_pay_forecast(&request, &resolver, &mut provider);
            actual["projection"] = serde_json::to_value(projection).unwrap();
            assert_eq!(
                provider.calculations,
                provider.months.len(),
                "{id}: source months price once"
            );
            cash_comparisons += 1;
        }
        common::assert_json_eq(&actual, &case["expected"], id);
        full_comparisons += 1;
    }
    assert_eq!(full_comparisons, 1600);
    assert_eq!(cash_comparisons, 128);
    assert_eq!(rejected_ambiguous_histories, 5);
}

#[test]
fn cached_money_cannot_cross_raw_snapshot_or_catalog_boundaries() {
    let reference: Value = serde_json::from_str(include_str!(
        "../../../reference/native-gross-provider-golden.json"
    ))
    .unwrap();
    let input: Value =
        serde_json::from_str(reference["cases"][0]["inputJson"].as_str().unwrap()).unwrap();
    let scope = scope(&input);
    let profile = Arc::clone(&scope.profile);
    let shifts = Arc::clone(&scope.shifts);
    let resolver = RuleResolver::bundled().unwrap();
    let other_resolver = RuleResolver::bundled().unwrap();
    let mut provider = NativeGrossEvidenceProvider::new(scope, &resolver).unwrap();
    let month = input["month"].as_str().unwrap();
    provider
        .month_evidence(
            month,
            Arc::clone(&profile),
            Arc::clone(&shifts),
            EvidenceNeed::GrossOnly,
            &resolver,
        )
        .unwrap();
    let mut changed = profile.as_ref().clone();
    changed["weeklyMinutes"] = json!(1200);
    assert!(
        provider
            .month_evidence(
                month,
                Arc::new(changed),
                Arc::clone(&shifts),
                EvidenceNeed::PayrollTraces,
                &resolver
            )
            .is_err()
    );
    let mut changed = shifts.as_ref().clone();
    changed[0]["startTime"] = json!("05:00");
    assert!(
        provider
            .month_evidence(
                month,
                Arc::clone(&profile),
                Arc::new(changed),
                EvidenceNeed::PayrollTraces,
                &resolver
            )
            .is_err()
    );
    assert!(
        provider
            .month_evidence(
                month,
                profile,
                shifts,
                EvidenceNeed::PayrollTraces,
                &other_resolver
            )
            .is_err()
    );
    assert_eq!(provider.calculations, 1);
}

#[test]
fn month_cache_is_bounded_and_all_months_share_one_projected_plan() {
    let reference: Value = serde_json::from_str(include_str!(
        "../../../reference/native-gross-provider-golden.json"
    ))
    .unwrap();
    let example = reference["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| {
            case["id"]
                .as_str()
                .is_some_and(|id| id.starts_with("month-manual-"))
        })
        .unwrap();
    let mut input: Value = serde_json::from_str(example["inputJson"].as_str().unwrap()).unwrap();
    input["shifts"] = json!([]);
    input["assessmentShifts"] = json!([]);
    let scope = scope(&input);
    let profile = Arc::clone(&scope.profile);
    let shifts = Arc::clone(&scope.shifts);
    let resolver = RuleResolver::bundled().unwrap();
    let mut provider = NativeGrossEvidenceProvider::new(scope, &resolver).unwrap();
    let shared_plan = Arc::clone(&provider.projected_regular_shifts);
    assert!(Arc::ptr_eq(&shifts, &shared_plan));
    for offset in 0..=MAX_CACHED_MONTHS {
        let month =
            crate::net::payment_schedule::add_salary_payment_months("2024-01", offset as i32)
                .unwrap();
        let evidence = provider
            .month_evidence(
                &month,
                Arc::clone(&profile),
                Arc::clone(&shifts),
                EvidenceNeed::GrossOnly,
                &resolver,
            )
            .unwrap();
        assert!(Arc::ptr_eq(
            &shared_plan,
            &evidence.projected_regular_shifts
        ));
        assert!(Arc::ptr_eq(&shifts, &evidence.source.shifts));
    }
    assert_eq!(provider.months.len(), MAX_CACHED_MONTHS);
    assert_eq!(provider.recency.len(), MAX_CACHED_MONTHS);
    assert_eq!(provider.calculations, MAX_CACHED_MONTHS + 1);
    assert!(!provider.months.contains_key("2024-01"));
    provider
        .month_evidence(
            "2024-01",
            profile,
            shifts,
            EvidenceNeed::PayrollTraces,
            &resolver,
        )
        .unwrap();
    assert_eq!(provider.calculations, MAX_CACHED_MONTHS + 2);
    assert_eq!(provider.months.len(), MAX_CACHED_MONTHS);
}
