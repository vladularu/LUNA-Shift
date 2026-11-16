use super::{ValidationIssue, common::*};
use serde_json::Value;
use std::collections::HashSet;
pub(super) fn issues(package: &Value) -> Vec<ValidationIssue> {
    let mut issues = vec![];
    let holidays = a(&package["rules"]["holidays"]);
    let version = n(package, "engineContractVersion");
    let sources: HashSet<_> = a(&package["sources"]).iter().map(|v| s(v, "id")).collect();
    if package["validTo"].is_null() && version < 7.0 {
        issue(
            &mut issues,
            "UNSUPPORTED_OPEN_HOLIDAY_PACKAGE_RANGE",
            "/validTo",
            "Open-ended holiday packages require holiday engine contract v7 or later.",
        );
    }
    duplicates(
        holidays.iter().map(|v| s(v, "id")),
        "/rules/holidays",
        "holiday id",
        &mut issues,
    );
    for (i, holiday) in holidays.iter().enumerate() {
        let path = format!("/rules/holidays/{i}");
        let to = &holiday["validTo"];
        range(s(holiday, "validFrom"), to, &path, &mut issues);
        references(
            &holiday["sourceIds"],
            &sources,
            &format!("{path}/sourceIds"),
            &mut issues,
        );
        if to.is_null() && version < 7.0 {
            issue(
                &mut issues,
                "UNSUPPORTED_OPEN_HOLIDAY_RANGE",
                format!("{path}/validTo"),
                "Open-ended holiday rules require holiday engine contract v7 or later.",
            );
        }
        let scope = s(holiday, "scope");
        let states = &holiday["federalStates"];
        let regions = &holiday["regionIds"];
        if scope == "NATIONWIDE" && (!states.is_null() || !regions.is_null()) {
            issue(
                &mut issues,
                "INVALID_HOLIDAY_SCOPE",
                format!("{path}/federalStates"),
                "NATIONWIDE holidays must use federalStates and regionIds: null.",
            );
        }
        if scope == "STATEWIDE" && (states.is_null() || !regions.is_null()) {
            issue(
                &mut issues,
                "INVALID_HOLIDAY_SCOPE",
                format!("{path}/federalStates"),
                "STATEWIDE holidays require federal states and must not define regionIds.",
            );
        }
        if scope == "REGIONAL" && (states.is_null() || regions.is_null()) {
            issue(
                &mut issues,
                "INVALID_HOLIDAY_SCOPE",
                format!("{path}/regionIds"),
                "REGIONAL holidays require at least one federal state and one region id.",
            );
        }
        if s(holiday, "validFrom") < s(package, "validFrom")
            || package["validTo"]
                .as_str()
                .is_some_and(|end| to.is_null() || s(holiday, "validTo") > end)
        {
            issue(
                &mut issues,
                "HOLIDAY_OUTSIDE_PACKAGE_RANGE",
                &path,
                "Holiday validity must stay inside the package validity.",
            );
        }
        let calculation = &holiday["calculation"];
        let kind = s(calculation, "type");
        if package["validTo"].is_null() && kind != "SPECIFIC_DATE" && !to.is_null() {
            issue(
                &mut issues,
                "FINITE_RECURRING_HOLIDAY_IN_OPEN_PACKAGE",
                format!("{path}/validTo"),
                "Recurring holidays in an open-ended package must also be open-ended.",
            );
        }
        if kind == "FIXED_DATE"
            && !real_date(&format!(
                "2000-{:02}-{:02}",
                n(calculation, "month") as u32,
                n(calculation, "day") as u32
            ))
        {
            issue(
                &mut issues,
                "INVALID_FIXED_HOLIDAY_DATE",
                format!("{path}/calculation"),
                "The fixed month and day do not form a calendar date.",
            );
        }
        if kind == "SPECIFIC_DATE" {
            date(
                s(calculation, "date"),
                &format!("{path}/calculation/date"),
                &mut issues,
            );
            if to.is_null() {
                issue(
                    &mut issues,
                    "OPEN_ENDED_SPECIFIC_HOLIDAY",
                    format!("{path}/validTo"),
                    "A specific holiday date must have a finite validity end.",
                );
            }
            if s(calculation, "date") < s(holiday, "validFrom")
                || to.as_str().is_some_and(|end| s(calculation, "date") > end)
            {
                issue(
                    &mut issues,
                    "SPECIFIC_HOLIDAY_OUTSIDE_RANGE",
                    format!("{path}/calculation/date"),
                    "The specific date must stay inside the holiday validity.",
                );
            }
        }
    }
    issues
}
