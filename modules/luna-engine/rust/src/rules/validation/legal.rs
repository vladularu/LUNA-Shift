use super::{ValidationIssue, common::*, youth};
use serde_json::Value;
use std::collections::HashSet;
pub(super) fn issues(package: &Value) -> Vec<ValidationIssue> {
    let mut issues = youth::issues(package);
    let rules = &package["rules"];
    let version = n(package, "engineContractVersion");
    let sources: HashSet<_> = a(&package["sources"]).iter().map(|v| s(v, "id")).collect();
    for (
        minimum,
        defined,
        path,
        missing_code,
        missing_message,
        unsupported_code,
        unsupported_message,
        only_v1,
    ) in [
        (
            3.0,
            rules["nightWork"].get("workerQualification").is_some(),
            "/rules/nightWork/workerQualification",
            "MISSING_NIGHT_WORKER_QUALIFICATION",
            "Legal engine contracts v3 and newer require night-worker qualification rules.",
            "UNSUPPORTED_NIGHT_WORKER_QUALIFICATION",
            "Legal engine contract v1 must not define night-worker qualification rules.",
            true,
        ),
        (
            4.0,
            rules["workingTime"].get("standardAverage").is_some(),
            "/rules/workingTime/standardAverage",
            "MISSING_STANDARD_WORKING_TIME_AVERAGE",
            "Legal engine contract v4 and newer require the standard working-time average windows.",
            "UNSUPPORTED_STANDARD_WORKING_TIME_AVERAGE",
            "Legal engine contracts before v4 must not define standard working-time average windows.",
            false,
        ),
        (
            5.0,
            rules.get("sundayHolidayRest").is_some(),
            "/rules/sundayHolidayRest",
            "MISSING_SUNDAY_HOLIDAY_REST",
            "Legal engine contract v5 and newer require Sunday and holiday rest rules.",
            "UNSUPPORTED_SUNDAY_HOLIDAY_REST",
            "Legal engine contracts before v5 must not define Sunday and holiday rest rules.",
            false,
        ),
    ] {
        if version >= minimum && !defined {
            issue(&mut issues, missing_code, path, missing_message);
        } else if defined
            && if only_v1 {
                version == 1.0
            } else {
                version < minimum
            }
        {
            issue(&mut issues, unsupported_code, path, unsupported_message);
        }
    }
    if n(&rules["workingTime"], "maxDailyMinutes")
        <= n(&rules["workingTime"], "standardDailyMinutes")
    {
        issue(
            &mut issues,
            "INVALID_WORKING_TIME_LIMITS",
            "/rules/workingTime",
            "maxDailyMinutes must be greater than standardDailyMinutes.",
        );
    }
    for path in [
        "/rules/workingTime/sourceIds",
        "/rules/breaks/sourceIds",
        "/rules/nightWork/sourceIds",
        "/rules/restPeriod/sourceIds",
        "/rules/sundayHolidayRest/sourceIds",
        "/rules/planning/sourceIds",
        "/rules/youthProtection/sourceIds",
        "/rules/youthProtection/exam/sourceIds",
        "/rules/adultTraining/bbig/sourceIds",
        "/rules/adultTraining/bbig/exam/sourceIds",
        "/rules/adultTraining/pflbg/sourceIds",
    ] {
        if let Some(ids) = package.pointer(path) {
            references(ids, &sources, path, &mut issues);
        }
    }
    let (mut threshold, mut required) = (-1.0, -1.0);
    for (i, tier) in a(&rules["breaks"]["tiers"]).iter().enumerate() {
        if n(tier, "overMinutes") <= threshold || n(tier, "requiredMinutes") < required {
            issue(
                &mut issues,
                "UNSORTED_BREAK_TIERS",
                format!("/rules/breaks/tiers/{i}"),
                "Break thresholds must increase and required minutes must not decrease.",
            );
        }
        threshold = n(tier, "overMinutes");
        required = n(tier, "requiredMinutes");
    }
    duplicates(
        a(&rules["restPeriod"]["deviations"])
            .iter()
            .map(|v| s(v, "id")),
        "/rules/restPeriod/deviations",
        "rest deviation id",
        &mut issues,
    );
    for (i, deviation) in a(&rules["restPeriod"]["deviations"]).iter().enumerate() {
        let path = format!("/rules/restPeriod/deviations/{i}");
        references(
            &deviation["sourceIds"],
            &sources,
            &format!("{path}/sourceIds"),
            &mut issues,
        );
        if n(deviation, "minimumMinutes") >= n(&rules["restPeriod"], "defaultMinutes") {
            issue(
                &mut issues,
                "INVALID_REST_DEVIATION",
                format!("{path}/minimumMinutes"),
                "A rest deviation must be lower than defaultMinutes.",
            );
        }
        if n(deviation, "compensationMinutes") <= n(&rules["restPeriod"], "defaultMinutes") {
            issue(
                &mut issues,
                "INVALID_REST_COMPENSATION",
                format!("{path}/compensationMinutes"),
                "Compensation must be greater than defaultMinutes.",
            );
        }
        if version >= 6.0 && deviation.get("compensationWithinCalendarMonths").is_none() {
            issue(
                &mut issues,
                "MISSING_CALENDAR_MONTH_COMPENSATION",
                format!("{path}/compensationWithinCalendarMonths"),
                "Legal engine contract v6 requires the calendar-month compensation alternative.",
            );
        }
        if version < 6.0 && deviation.get("compensationWithinCalendarMonths").is_some() {
            issue(
                &mut issues,
                "UNSUPPORTED_CALENDAR_MONTH_COMPENSATION",
                format!("{path}/compensationWithinCalendarMonths"),
                "Legal engine contracts before v6 must not define calendar-month compensation.",
            );
        }
    }
    issues
}
