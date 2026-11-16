mod common;
#[path = "support/salary_snapshot.rs"]
mod salary_snapshot;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::runtime::financial_report::annual_display;
use serde_json::Value;
#[test]
fn original_annual_pay_props_and_net_display_operations_are_exact() {
    let corpus = value_pool::decode(include_str!(
        "../../reference/annual-financial-display-golden.json"
    ));
    let mut counts = [0; 3];
    for case in corpus["cases"].as_array().unwrap() {
        let actual = match case["kind"].as_str().unwrap() {
            "GROSS" => {
                counts[0] += 1;
                annual_display::gross_overview(&case["input"])
            }
            "NET" => {
                counts[1] += 1;
                annual_display::net_amounts(&case["input"])
            }
            "BOUNDARY" => {
                counts[2] += 1;
                annual_display::net_amount(
                    if case["negativeInputZero"] == true {
                        -0.0
                    } else {
                        case["cents"].as_f64().unwrap()
                    },
                    case["preliminary"].as_bool().unwrap(),
                )
            }
            _ => unreachable!(),
        }
        .unwrap_or_else(|error| panic!("{}: {error:?}", case["id"]));
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
    assert_eq!(counts, [87, 954, 48]);
}
#[test]
fn display_boundary_rejects_nonfinite_or_malformed_values_without_ready_zero() {
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert!(annual_display::net_amount(value, false).is_err());
    }
    for raw in [
        Value::Null,
        serde_json::json!({}),
        serde_json::json!({"year":2026,"months":[]}),
    ] {
        assert!(annual_display::gross_overview(&raw).is_err());
        assert!(annual_display::net_amounts(&raw).is_err());
    }
}

#[test]
fn genuine_native_year_net_retains_its_original_output_and_adds_only_display_facts() {
    use luna_engine::{
        contract::{ReportPeriod, SalaryPerspective},
        runtime::{report::SectionOutput, view_composition::ViewCompositionSource},
    };
    let corpus = value_pool::decode(include_str!("../../reference/payroll-page-golden.json"));
    let case = corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["expected"]["statement"]["availableNet"] == true)
        .unwrap();
    let facts = salary_snapshot::facts(salary_snapshot::raw(case));
    let presentation = ViewCompositionSource::from_facts(&facts).net(
        &ReportPeriod::Year { year: 2026 },
        SalaryPerspective::Earned,
    );
    let SectionOutput::Ready { value: original } = presentation.output else {
        panic!("genuine native yearly net unavailable")
    };
    let SectionOutput::Ready { value: overlay } = presentation.overlay else {
        panic!("native net overlay unavailable")
    };
    common::assert_json_eq(
        &overlay["annualNetPay"],
        &original,
        "original-year-net-unchanged",
    );
    assert_eq!(overlay["annualNetAmountDisplay"]["state"], "READY");
    assert!(
        original["availableMonthCount"].as_u64().unwrap() > 0,
        "positive source coverage"
    );
    common::assert_json_eq(
        &overlay["annualNetAmountDisplay"]["value"],
        &annual_display::net_amounts(&original).unwrap(),
        "borrowed-native-year-display",
    );
}
