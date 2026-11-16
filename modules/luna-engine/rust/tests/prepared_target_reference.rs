//! Prepared paths are compared directly with the immutable Build52 oracle,
//! independently of the compatibility wrappers that use the same native kernel.
use bigdecimal::BigDecimal;
use luna_engine::{
    calendar::recurrence::CollationRanks,
    credit::{
        analysis,
        context::DailyCreditContextCache,
        metrics,
        summary::{self, MetricsError},
    },
    rules::RuleResolver,
    target::{PreparedTargetContext, PreparedTargetSource, TargetContext, TargetError},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{str::FromStr, sync::Arc};

fn same_value(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => {
            BigDecimal::from_str(&a.to_string()).unwrap()
                == BigDecimal::from_str(&b.to_string()).unwrap()
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same_value(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(k, v)| b.get(k).is_some_and(|b| same_value(v, b)))
        }
        _ => a == b,
    }
}
fn context(input: &Value) -> Result<Option<PreparedTargetContext>, TargetError> {
    input
        .get("context")
        .map(|v| {
            TargetContext::deserialize(v)
                .map(|c| PreparedTargetContext::new(Arc::new(c)))
                .map_err(|_| TargetError::InvalidInput)
        })
        .transpose()
}
#[test]
fn all_471_target_cases_match_frozen_outputs_through_prepared_source_and_override() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/target-golden.json")).unwrap();
    let resolver = RuleResolver::bundled().unwrap();
    let mut count = 0;
    for case in fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["operation"] == "target")
    {
        let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let source = PreparedTargetSource::new(Arc::new(input["profile"].clone()));
        let computation = (|| {
            let profile = source.base_profile()?;
            let context = context(&input)?;
            profile.calculate(
                input["month"].as_str().unwrap(),
                &resolver,
                context.as_ref(),
            )
        })();
        let actual = match computation {
            Ok(value) => json!({"value":value}),
            Err(e) => json!({"error":{"name":"WorkingTimeTargetError","message":e.to_string()}}),
        };
        assert_eq!(actual, case["expected"], "{}", case["id"]);
        assert!(source.stats().input_parses <= 1);
        assert!(source.stats().context_preparations <= 1);
        count += 1;
    }
    assert_eq!(count, 471);
}

fn run_metric(case: &Value, resolver: &RuleResolver) -> Result<Value, MetricsError> {
    let i = &case["input"];
    let source = PreparedTargetSource::new(Arc::new(i["profile"].clone()));
    let mut cache = DailyCreditContextCache::with_source(&source, resolver);
    let rank: CollationRanks = serde_json::from_value(i["collationRanks"].clone()).unwrap();
    let entries = i["entries"].as_array().unwrap();
    let month = || i["month"].as_str().unwrap();
    let result = match case["operation"].as_str().unwrap() {
        "metrics.monthlySummary" => {
            let context = context(i)?;
            let shifts: Vec<_> = entries
                .iter()
                .filter(|v| v["kind"] == "SHIFT")
                .cloned()
                .collect();
            let value = summary::calculate_monthly_summary_prepared(
                month(),
                &shifts,
                &mut cache,
                context.as_ref(),
                &rank,
            )?;
            let pay = luna_engine::pay::special::calculate_special_duty_pay(
                month(),
                &shifts,
                source.profile(),
                resolver,
            )?;
            let same_pass = summary::calculate_monthly_summary_prepared_with_pay(
                month(),
                &shifts,
                &mut cache,
                context.as_ref(),
                &rank,
                &pay,
            )?;
            assert!(same_value(&value, &same_pass), "same-pass {}", case["id"]);
            Ok(value)
        }
        "metrics.monthlyHoursSeries" => {
            metrics::monthly_hours_series_prepared(month(), entries, &mut cache, &rank)
        }
        "metrics.dailySummary" => {
            metrics::daily_summary_prepared(i["date"].as_str().unwrap(), entries, &mut cache, &rank)
        }
        "metrics.shiftTypeAnalysis" => {
            analysis::monthly_shift_type_analysis_prepared(month(), entries, &mut cache, &rank)
        }
        "metrics.shiftTypeAnalysisOrder" => {
            let value = analysis::monthly_shift_type_analysis_prepared(
                month(),
                entries,
                &mut cache,
                &rank,
            )?;
            Ok(json!(
                value
                    .get("appearances")
                    .and_then(Value::as_object)
                    .map(|r| r.keys().collect::<Vec<_>>())
                    .unwrap_or_default()
            ))
        }
        _ => unreachable!(),
    };
    assert!(source.stats().input_parses <= 1);
    assert!(source.stats().context_preparations <= 1);
    result
}
#[test]
fn all_286_target_dependent_reports_match_frozen_outputs_with_shared_preparation() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/monthly-metrics-golden.json")).unwrap();
    let resolver = RuleResolver::bundled().unwrap();
    let mut count = 0;
    for case in fixture["cases"].as_array().unwrap().iter().filter(|c| {
        matches!(
            c["operation"].as_str(),
            Some(
                "metrics.monthlySummary"
                    | "metrics.monthlyHoursSeries"
                    | "metrics.dailySummary"
                    | "metrics.shiftTypeAnalysis"
                    | "metrics.shiftTypeAnalysisOrder"
            )
        )
    }) {
        let actual = match run_metric(case, &resolver) {
            Ok(v) => v,
            Err(e) => json!({"$error":{"name":e.source_error_name(),"message":e.to_string()}}),
        };
        assert!(
            same_value(&actual, &case["expected"]),
            "{}\nactual {actual}\nexpected {}",
            case["id"],
            case["expected"]
        );
        count += 1;
    }
    assert_eq!(count, 286);
}
