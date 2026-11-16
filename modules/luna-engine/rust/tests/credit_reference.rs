use luna_engine::{
    EngineError,
    calendar::recurrence::CollationRanks,
    credit::{
        context,
        daily::{self, DailyCreditContext},
        duty,
    },
    employment,
    rules::RuleResolver,
};
use serde_json::Value;

fn run(case: &Value) -> Result<Value, EngineError> {
    let input = &case["input"];
    let entries = || {
        input["entries"]
            .as_array()
            .expect("fixture entries")
            .as_slice()
    };
    match case["operation"].as_str().expect("operation") {
        "credit.dutyWorkParts" => duty::duty_work_parts(&input["entry"]),
        "credit.specialDutyWorkMinutes" => duty::special_duty_work_minutes(&input["entry"]),
        "credit.projectDutyWork" => duty::project_duty_work(&input["entry"]).map(Value::Array),
        "credit.projectDutyShifts" => duty::project_duty_shifts(entries()).map(Value::Array),
        "credit.projectDutyCalendarDays" => {
            duty::project_duty_calendar_days(entries()).map(Value::Array)
        }
        "credit.projectRegularPayShifts" => {
            duty::project_regular_pay_shifts(entries()).map(Value::Array)
        }
        "credit.dutyCalendarDates" => duty::duty_calendar_dates(&input["entry"])
            .map(|dates| Value::Array(dates.into_iter().map(Value::from).collect())),
        "credit.calculateTimedDailyWorkCredit" | "credit.calculateDailyWorkCredit" => {
            let ranks: CollationRanks =
                serde_json::from_value(input["collationRanks"].clone()).expect("ranks");
            let date = input["date"].as_str().expect("date");
            if case["operation"] == "credit.calculateTimedDailyWorkCredit" {
                daily::calculate_timed_daily_work_credit(
                    date,
                    entries(),
                    input["timeZone"].as_str().expect("zone"),
                    &ranks,
                )?
                .to_json()
            } else {
                let resolver = RuleResolver::bundled().expect("bundled rules");
                let effective = employment::employment_profile_at(&input["profile"], date)
                    .expect("native employment selection");
                let derived = context::resolve_daily_credit_context(date, &effective, &resolver)
                    .expect("native target context");
                let frozen = DailyCreditContext::from_json(&input["context"])?;
                assert_eq!(
                    derived.context.target_minutes, frozen.target_minutes,
                    "native contractual target"
                );
                assert_eq!(
                    derived.context.absence_reference_minutes, frozen.absence_reference_minutes,
                    "native separate absence reference"
                );
                context::calculate_daily_work_credit_from_profile(
                    date,
                    entries(),
                    &input["profile"],
                    &resolver,
                    &ranks,
                )
                .expect("native complete daily credit")
                .to_json()
            }
        }
        other => panic!("unknown operation {other}"),
    }
}

#[test]
fn all_frozen_credit_results_and_observer_allocations_match() {
    let fixtures: Value = serde_json::from_str(include_str!("../../reference/credit-golden.json"))
        .expect("frozen credit reference");
    assert_eq!(
        fixtures["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let cases = fixtures["cases"].as_array().expect("cases");
    assert_eq!(cases.len(), 112, "coverage must not silently shrink");
    for case in cases {
        let actual = run(case).unwrap_or_else(|error| panic!("{}: {error}", case["id"]));
        assert_eq!(actual, case["expected"], "{}", case["id"]);
    }
}

#[test]
fn invalid_duty_clocks_and_malformed_calendar_sizes_are_errors() {
    let mut entry = serde_json::json!({"date":"2026-07-01","startTime":"08:00","endTime":"25:00","breakMinutes":0,"specialDuty":{"kind":"STANDBY","endDay":0,"parts":[],"callouts":[],"timeZone":"Europe/Berlin"}});
    assert_eq!(duty::duty_work_parts(&entry), Err(EngineError::InvalidTime));
    entry["endTime"] = Value::from("08:00");
    entry["specialDuty"]["endDay"] = Value::from(1_000_000);
    assert_eq!(
        duty::duty_calendar_dates(&entry),
        Err(EngineError::InvalidDuration)
    );
}

#[test]
fn loading_target_is_propagated_without_a_zero_credit_placeholder() {
    let profile = serde_json::json!({"federalState":"NW","holidayRegion":"NONE","weeklyMinutes":2310,"timeZone":"Europe/Berlin","workingTimeTarget":{"status":"loading","notices":[],"periods":[]}});
    let resolver = RuleResolver::bundled().expect("bundled rules");
    assert!(matches!(
        context::resolve_daily_credit_context("2026-07-01", &profile, &resolver),
        Err(luna_engine::target::TargetError::Loading)
    ));
}
