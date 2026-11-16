mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    calendar::recurrence::CollationRanks, report::time::TimeReportContext, rules::RuleResolver,
};
use serde_json::{Value, json};
use std::sync::Arc;

#[test]
fn complete_time_fields_match_original_public_monthly_analysis_and_are_reused() {
    let data: Value = value_pool::decode(include_str!("../../reference/monthly-time-golden.json"));
    let cases = data["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 1241);
    let resolver = Arc::new(RuleResolver::bundled().unwrap());
    for case in cases {
        let input = &case["input"];
        let ranks: CollationRanks =
            serde_json::from_value(input["collationRanks"].clone()).unwrap();
        let case_resolver = if let Some(raw) = input.get("resolver") {
            Arc::new(
                RuleResolver::from_catalog_json(
                    raw["catalog"].clone(),
                    serde_json::from_value(raw["packageIds"].clone()).unwrap(),
                    raw.get("historical")
                        .filter(|v| !v.is_null())
                        .map(|v| serde_json::from_value(v.clone()).unwrap()),
                )
                .unwrap()
                .with_collation_ranks(
                    serde_json::from_value(raw["collationRanks"].clone()).unwrap(),
                ),
            )
        } else {
            Arc::clone(&resolver)
        };
        let result = TimeReportContext::new(
            Arc::new(input["profile"].clone()),
            Arc::new(input["entries"].as_array().unwrap().clone()),
            case_resolver,
            ranks,
        )
        .and_then(|mut context| {
            let month = input["month"].as_str().unwrap();
            let first = context.month_shared(month)?;
            assert!(Arc::ptr_eq(&first, &context.month_shared(month)?));
            assert_eq!(context.month_computations(), 1);
            Ok(first)
        });
        let actual = match result {
            Ok(value) => json!({"value":value.as_ref()}),
            Err(error) => {
                json!({"error":{"name":error.source_error_name(),"message":error.to_string()}})
            }
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}

#[test]
fn month_and_year_navigation_share_completed_native_months_without_recalculation() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/annual-time-golden.json")).unwrap();
    let resolver = Arc::new(RuleResolver::bundled().unwrap());
    let cases = data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|case| case["expected"]["value"]["worktimeCoverageComplete"] == true)
        .take(8)
        .collect::<Vec<_>>();
    assert_eq!(cases.len(), 8);
    for case in cases {
        let input = &case["input"];
        let year = input["year"].as_i64().unwrap() as i32;
        for month_first in [false, true] {
            let mut context = TimeReportContext::new(
                Arc::new(input["profile"].clone()),
                Arc::new(input["entries"].as_array().unwrap().clone()),
                Arc::clone(&resolver),
                serde_json::from_value(input["collationRanks"].clone()).unwrap(),
            )
            .unwrap();
            let first = month_first.then(|| context.month_shared(&format!("{year}-01")).unwrap());
            let annual = context.annual_shared(year).unwrap();
            common::assert_json_eq(
                &json!({"value":annual.as_ref()}),
                &case["expected"],
                case["id"].as_str().unwrap(),
            );
            assert_eq!(context.month_computations(), 12);
            if let Some(first) = first {
                assert!(Arc::ptr_eq(
                    &first,
                    &context.month_shared(&format!("{year}-01")).unwrap()
                ));
            }
            for month in 1..=12 {
                let month = format!("{year}-{month:02}");
                let value = context.month_shared(&month).unwrap();
                assert!(Arc::ptr_eq(&value, &context.month_shared(&month).unwrap()));
            }
            assert_eq!(context.month_computations(), 12);
            assert!(Arc::ptr_eq(&annual, &context.annual_shared(year).unwrap()));
            assert_eq!(context.annual_computations(), 1);
        }
    }
}
