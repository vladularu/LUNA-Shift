use bigdecimal::BigDecimal;
use luna_engine::{
    calendar::recurrence::CollationRanks,
    credit::{
        analysis, metrics,
        summary::{self, MetricsError},
    },
    rules::RuleResolver,
    target::TargetContext,
};
use serde_json::{Value, json};
use std::str::FromStr;
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
fn rank(input: &Value) -> CollationRanks {
    serde_json::from_value(input["collationRanks"].clone()).expect("host collation")
}
fn analysis_part(
    input: &Value,
    timed: bool,
    resolver: &RuleResolver,
) -> Result<Value, MetricsError> {
    analysis::monthly_shift_type_analysis(
        input["month"].as_str().unwrap(),
        input["entries"].as_array().unwrap(),
        &input["profile"],
        resolver,
        &rank(input),
        timed,
    )
}
fn run(c: &Value, resolver: &RuleResolver) -> Result<Value, MetricsError> {
    let i = &c["input"];
    let month = || i["month"].as_str().unwrap();
    let entries = || i["entries"].as_array().unwrap();
    match c["operation"].as_str().unwrap() {
        "metrics.monthlySummary" => {
            let context: Option<TargetContext> = i
                .get("context")
                .map(|v| serde_json::from_value(v.clone()).expect("context"));
            let shifts: Vec<Value> = entries()
                .iter()
                .filter(|v| v["kind"] == "SHIFT")
                .cloned()
                .collect();
            summary::calculate_monthly_summary(
                month(),
                &shifts,
                &i["profile"],
                resolver,
                context.as_ref(),
                &rank(i),
            )
        }
        "metrics.monthlyHoursSeries" => {
            metrics::monthly_hours_series(month(), entries(), &i["profile"], resolver, &rank(i))
        }
        "metrics.dailySummary" => metrics::daily_summary(
            i["date"].as_str().unwrap(),
            entries(),
            &i["profile"],
            resolver,
            &rank(i),
        ),
        "metrics.shiftTypeAnalysis" => analysis_part(i, false, resolver),
        "metrics.timedShiftTypeAnalysis" => analysis_part(i, true, resolver),
        "metrics.shiftTypeAnalysisOrder" => {
            let value = analysis_part(i, false, resolver)?;
            Ok(json!(
                value
                    .get("appearances")
                    .and_then(Value::as_object)
                    .map(|record| record.keys().collect::<Vec<_>>())
                    .unwrap_or_default()
            ))
        }
        "metrics.shiftTypeDistribution" => metrics::shift_type_distribution(month(), entries()),
        "metrics.shiftTypeDistributionEntries" => {
            metrics::shift_type_distribution_entries(month(), entries())
        }
        "metrics.monthProgress" => metrics::month_progress(
            i["actualMinutes"].as_f64().unwrap(),
            i["targetMinutes"].as_f64().unwrap(),
        ),
        "metrics.clampDateToMonth" => {
            metrics::clamp_date_to_month(i["date"].as_str().unwrap(), month()).map(Value::String)
        }
        "metrics.combineShiftTypeAnalyses" => {
            let parts = i["parts"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| analysis_part(p, i["timed"].as_bool().unwrap(), resolver))
                .collect::<Result<Vec<_>, _>>()?;
            analysis::combine_shift_type_analyses(&parts)
        }
        op => panic!("Unknown {op}"),
    }
}
#[test]
fn native_monthly_calendar_and_analysis_outputs_match_frozen_raw_facts() {
    let fixtures: Value =
        serde_json::from_str(include_str!("../../reference/monthly-metrics-golden.json")).unwrap();
    assert_eq!(
        fixtures["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let cases = fixtures["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 449);
    let resolver = RuleResolver::bundled().unwrap();
    for c in cases {
        let actual = match run(c, &resolver) {
            Ok(v) => v,
            Err(e) => json!({"$error":{"name":e.source_error_name(),"message":e.to_string()}}),
        };
        assert!(
            same_value(&actual, &c["expected"]),
            "{}\nactual {actual}\nexpected {}",
            c["id"],
            c["expected"]
        );
    }
}
