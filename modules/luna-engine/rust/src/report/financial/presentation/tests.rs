use super::*;
#[path = "../../../../tests/common/mod.rs"]
mod common;
use crate::test_value_pool as value_pool;
#[test]
fn complete_frozen_source_monetary_presenters() {
    let fixture = value_pool::decode(include_str!(
        "../../../../../reference/salary-presentation-golden.json"
    ));
    for case in array(&fixture["cases"]) {
        if case["operation"] == "runtime" {
            continue;
        }
        let input = &case["input"];
        let actual = if case["operation"] == "deductions" {
            deductions(&input["pay"])
        } else {
            let ranks: CollationRanks =
                serde_json::from_value(case["platformCollationRanks"].clone()).unwrap();
            let pay = nullish(input, "pay");
            let classification = nullish(input, "classification");
            let shifts = array(&input["shifts"]);
            let filter = input["filter"].as_str();
            let breakdowns = pay
                .map(|p| array(&p["shiftBreakdowns"]))
                .unwrap_or_default();
            let mut actual = json!({"breakdown":breakdown(breakdowns,shifts,filter,&ranks).unwrap(),"salaryRows":salary_rows(pay,classification,shifts,filter,&ranks).unwrap(),"earnedRows":earned_rows(pay,classification,shifts,filter,&ranks).unwrap(),"serviceSummary":service_summary(pay,classification,shifts,input["includeSpecialDutyPay"].as_bool().unwrap(),filter,&ranks).unwrap(),"premiumSummary":classification.map(premium_summary),"specialAmounts":pay.map(|p|array(&p["specialDutyBreakdowns"])).unwrap_or_default().iter().map(special_amount).collect::<Vec<_>>()});
            let mut decorated = json!({"breakdownRows":actual["breakdown"]["rows"],"salaryRows":actual["salaryRows"],"earnedRows":actual["earnedRows"],"serviceRows":actual["serviceSummary"]["rows"]});
            for key in ["breakdownRows", "salaryRows", "earnedRows", "serviceRows"] {
                decorate_rows(&mut decorated[key], classification.is_some());
            }
            actual["decoratedRows"] = decorated;
            actual
        };
        common::assert_json_eq(&actual, &case["expected"], text(case, "id"));
    }
}
#[test]
fn presentation_rounding_and_locale_boundaries_are_exact() {
    assert_eq!(js_round(0.49999999999999994), 0.0);
    assert_eq!(js_round(-0.5), 0.0);
    assert_eq!(js_round(-1.5), -1.0);
    let row = json!({"shiftId":"ä","date":"2026-07-01","premiumLines":[{"key":"night","label":"Nacht","amount":1.25}]});
    assert!(breakdown(&[row], &[], None, &CollationRanks::default()).is_err());
    let candidates = collation_candidates(
        None,
        Some(&json!({"shifts":[{"shiftId":"derived","sourceShiftId":"original"}]})),
        &[],
    );
    assert!(
        candidates.contains("")
            && candidates.contains("original")
            && !candidates.contains("derived")
    );
}
