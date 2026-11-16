mod common;
use luna_engine::input::stored_profile::{
    checked_stored_work_profile, load_simple_salary_for_profile, map_profile_row,
    salary_basis_count, unresolved_salary_profile,
};
use serde_json::{Value, json};
use std::sync::Arc;
#[test]
fn sql_mapping_salary_loading_and_all_preference_subsets_match_original_source() {
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/input-stored-profile-golden.json"
    ))
    .unwrap();
    let cases = data["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 2932);
    let mut opaque = 0;
    for case in cases {
        let input = &case["input"];
        let actual = match case["operation"].as_str().unwrap() {
            "mapProfileRow" => match map_profile_row(input) {
                Ok(value) => json!({"value":value}),
                Err(error) => json!({"$error":error.message(),"name":error.name()}),
            },
            "loadSimpleSalaryForProfile" => match load_simple_salary_for_profile(
                &input["profile"],
                input["salaryRows"].as_array().unwrap(),
            ) {
                Ok(value) => json!({"value":value}),
                Err(error) => {
                    json!({"$error":error.to_string(),"name":error.name(),"code":error.code()})
                }
            },
            "salaryBasisCount" => json!({"value":salary_basis_count(input)}),
            "unresolvedSalaryProfile" => json!({"value":unresolved_salary_profile(input).unwrap()}),
            "combined" => {
                let mapped = map_profile_row(&input["profileRow"]).unwrap();
                match load_simple_salary_for_profile(
                    &mapped,
                    input["salaryRows"].as_array().unwrap(),
                ) {
                    Ok(value) => json!({"value":value}),
                    Err(error) => {
                        json!({"$error":error.to_string(),"name":error.name(),"code":error.code()})
                    }
                }
            }
            operation => panic!("unknown {operation}"),
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
        if case["opaqueParity"] == true {
            opaque += 1;
            let raw = Arc::new(input["profileRow"].clone());
            let salary = Arc::new(input["salaryRows"].as_array().unwrap().clone());
            let checked =
                checked_stored_work_profile(Arc::clone(&raw), Arc::clone(&salary)).unwrap();
            assert!(Arc::ptr_eq(checked.raw_profile(), &raw));
            assert!(Arc::ptr_eq(checked.raw_salary_rows(), &salary));
            common::assert_json_eq(
                checked.flat_profile(),
                &case["expected"]["value"],
                case["id"].as_str().unwrap(),
            );
            assert_eq!(checked.core_profile()["weeklyMinutes"], 2310);
            assert_eq!(checked.core_profile()["tariff"], Value::Null);
        }
    }
    assert_eq!(opaque, 196);
}
fn row() -> Value {
    json!({"display_name":null,"employer_name":null,"federal_state":"NW","holiday_region":"NONE","weekly_minutes":2310,"time_zone":"Europe/Berlin","industry":null,"manual_monthly_gross_cents":null,"pay_group":null,"pay_level":null,"tariff_sector":null,"tariff_region":"OTHER","full_time_weekly_minutes":null,"regular_rotating_night_work":null,"sunday_holiday_work_eligible":null,"all_employment_work_recorded":null,"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z"})
}
#[test]
fn malformed_or_conflicting_salary_rows_keep_calendar_facts_and_original_drafts() {
    let mut raw = row();
    raw["manual_monthly_gross_cents"] = json!(0);
    raw["pay_group"] = json!("P8");
    raw["pay_level"] = Value::Null;
    let salary = Arc::new(vec![
        json!({"key":"salary_vka_e","value":"{bad"}),
        json!({"key":"salary_vka_e","value":"null"}),
    ]);
    let checked = checked_stored_work_profile(Arc::new(raw.clone()), Arc::clone(&salary)).unwrap();
    assert_eq!(checked.raw_profile().as_ref(), &raw);
    assert!(Arc::ptr_eq(checked.raw_salary_rows(), &salary));
    assert_eq!(checked.core_profile()["weeklyMinutes"], 2310);
    assert_eq!(checked.core_profile()["timeZone"], "Europe/Berlin");
    assert!(!checked.salary_issues().is_empty());
    assert_eq!(salary_basis_count(checked.flat_profile()), 0);
    assert_eq!(
        checked.flat_profile()["salaryBasisConflict"]["manualMonthlyGrossCents"],
        0
    );
    assert_eq!(
        checked.flat_profile()["salaryBasisConflict"]["tariff"]["payGroup"],
        "P8"
    );
    assert_eq!(
        checked.flat_profile()["salaryBasisConflict"]["vkaETariff"],
        "{bad"
    );
}
#[test]
fn source_row_shape_and_raw_boolean_facts_cannot_accept_sender_calculation_flags() {
    for field in [
        "salaryBasisConflict",
        "workingTimeTarget",
        "employmentTimeline",
        "ready",
    ] {
        let mut injected = row();
        injected[field] = Value::Null;
        assert!(checked_stored_work_profile(Arc::new(injected), Arc::new(vec![])).is_err());
    }
    let mut bad = row();
    bad["regular_rotating_night_work"] = json!(2);
    assert!(
        map_profile_row(&bad).is_ok(),
        "source pure mapper converts non1 tofalse"
    );
    assert!(
        checked_stored_work_profile(Arc::new(bad), Arc::new(vec![])).is_err(),
        "strict SQL boundary requires original nullable0/1 facts"
    );
    let salary = vec![json!({"key":"salary_vka_e","value":"null","ready":true})];
    let checked = checked_stored_work_profile(Arc::new(row()), Arc::new(salary)).unwrap();
    assert!(!checked.salary_issues().is_empty());
    assert_eq!(salary_basis_count(checked.flat_profile()), 0);
    assert!(checked.flat_profile()["salaryBasisConflict"].is_object());
}
