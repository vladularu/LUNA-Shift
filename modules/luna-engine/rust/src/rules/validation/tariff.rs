//! Generic tariff semantics; family-specific validators precede this module.
use super::{ValidationIssue, common::*};
use serde_json::Value;
use std::collections::HashSet;
pub(super) fn issues(package: &Value) -> Vec<ValidationIssue> {
    let mut issues = vec![];
    let rules = &package["rules"];
    let version = n(package, "engineContractVersion") as u32;
    let source_ids: HashSet<_> = a(&package["sources"]).iter().map(|v| s(v, "id")).collect();
    let tables = a(&rules["payTables"]);
    duplicates(
        tables.iter().map(|v| s(v, "id")),
        "/rules/payTables",
        "pay table id",
        &mut issues,
    );
    let selected = tables
        .iter()
        .find(|table| table["id"] == rules["selector"]["payTableId"]);
    if selected.is_none() {
        issue(
            &mut issues,
            "UNKNOWN_PAY_TABLE",
            "/rules/selector/payTableId",
            format!(
                "Unknown pay table: {}.",
                s(&rules["selector"], "payTableId")
            ),
        );
    }
    let mut known_steps = HashSet::new();
    for (i, table) in tables.iter().enumerate() {
        let path = format!("/rules/payTables/{i}");
        references(
            &table["sourceIds"],
            &source_ids,
            &format!("{path}/sourceIds"),
            &mut issues,
        );
        let combinations: Vec<_> = a(&table["entries"])
            .iter()
            .map(|entry| format!("{}:{}", s(entry, "groupId"), s(entry, "stepId")))
            .collect();
        duplicates(
            combinations.iter().map(String::as_str),
            &format!("{path}/entries"),
            "group and step combination",
            &mut issues,
        );
        for (j, entry) in a(&table["entries"]).iter().enumerate() {
            known_steps.insert(s(entry, "stepId"));
            if version >= 3 && entry.get("hourlyCents").is_some() {
                issue(
                    &mut issues,
                    "UNEXPECTED_FIXED_HOURLY_RATE",
                    format!("{path}/entries/{j}/hourlyCents"),
                    "Tariff engine contract v3 derives hourly rates from monthly pay and weekly working time.",
                );
            }
            if version < 3 && entry.get("hourlyCents").is_none() {
                issue(
                    &mut issues,
                    "MISSING_FIXED_HOURLY_RATE",
                    format!("{path}/entries/{j}/hourlyCents"),
                    "Tariff engine contracts before v3 require a fixed hourly rate.",
                );
            }
        }
    }
    let overtime = rules.get("overtimeBaseRule");
    if version >= 2
        && !matches!(version, 10 | 12..=18)
        && !(version == 11 && rules["selection"]["employmentKind"] == "APPRENTICE")
        && overtime.is_none()
    {
        issue(
            &mut issues,
            "MISSING_OVERTIME_BASE_RULE",
            "/rules/overtimeBaseRule",
            "Tariff engine contracts v2 and newer require an overtime base rule.",
        );
    } else if version == 1 && overtime.is_some() {
        issue(
            &mut issues,
            "UNSUPPORTED_OVERTIME_BASE_RULE",
            "/rules/overtimeBaseRule",
            "Tariff engine contract v1 must not define an overtime base rule.",
        );
    }
    if let Some(overtime) = overtime {
        references(
            &overtime["sourceIds"],
            &source_ids,
            "/rules/overtimeBaseRule/sourceIds",
            &mut issues,
        );
        if let Some(table) = selected {
            let mut groups = vec![];
            for entry in a(&table["entries"]) {
                let group = s(entry, "groupId");
                if !groups.contains(&group) {
                    groups.push(group);
                }
            }
            let missing: Vec<_> = groups
                .into_iter()
                .filter(|group| {
                    !a(&table["entries"]).iter().any(|entry| {
                        s(entry, "groupId") == *group
                            && entry["stepId"] == overtime["maximumStepId"]
                    })
                })
                .collect();
            if !missing.is_empty() {
                issue(
                    &mut issues,
                    "UNKNOWN_OVERTIME_BASE_STEP",
                    "/rules/overtimeBaseRule/maximumStepId",
                    format!(
                        "Maximum overtime step {} is missing for pay groups: {}.",
                        s(overtime, "maximumStepId"),
                        missing.join(", ")
                    ),
                );
            }
        }
    }
    let weekly = rules.get("weeklyWorkingTimeRules");
    let hourly = rules.get("hourlyCalculation");
    if version >= 3 && !matches!(version, 12..=18) {
        if weekly.is_none() {
            issue(
                &mut issues,
                "MISSING_WEEKLY_WORKING_TIME_RULES",
                "/rules/weeklyWorkingTimeRules",
                "Tariff engine contract v3 requires sector and tariff-region working-time rules.",
            );
        }
        if hourly.is_none() {
            issue(
                &mut issues,
                "MISSING_HOURLY_CALCULATION",
                "/rules/hourlyCalculation",
                "Tariff engine contract v3 requires the contractual hourly-rate formula.",
            );
        }
    } else if weekly.is_some() || hourly.is_some() {
        issue(
            &mut issues,
            "UNSUPPORTED_TARIFF_V3_RULES",
            "/rules",
            "Tariff contracts before v3 must not define v3 working-time or hourly-rate rules.",
        );
    }
    if let Some(weekly) = weekly {
        duplicates(
            a(weekly).iter().map(|v| s(v, "id")),
            "/rules/weeklyWorkingTimeRules",
            "weekly working-time rule id",
            &mut issues,
        );
        for (i, rule) in a(weekly).iter().enumerate() {
            references(
                &rule["sourceIds"],
                &source_ids,
                &format!("/rules/weeklyWorkingTimeRules/{i}/sourceIds"),
                &mut issues,
            );
        }
        for sector in ["BT_K", "BT_B"] {
            for region in ["KAV_BW", "OTHER"] {
                let count = a(weekly)
                    .iter()
                    .filter(|rule| {
                        a(&rule["sectors"]).iter().any(|v| v == sector)
                            && a(&rule["tariffRegions"]).iter().any(|v| v == region)
                    })
                    .count();
                if count != 1 {
                    issue(
                        &mut issues,
                        "AMBIGUOUS_WEEKLY_WORKING_TIME",
                        "/rules/weeklyWorkingTimeRules",
                        format!(
                            "Expected exactly one weekly working-time rule for {sector}/{region}, found {count}."
                        ),
                    );
                }
            }
        }
    }
    if let Some(hourly) = hourly {
        references(
            &hourly["sourceIds"],
            &source_ids,
            "/rules/hourlyCalculation/sourceIds",
            &mut issues,
        );
    }
    let premiums = a(&rules["premiumRules"]);
    let allowances = a(&rules["allowanceRules"]);
    let combinations = a(&rules["combinationRules"]);
    let patterns = a(&rules["workPatternRules"]);
    duplicates(
        premiums
            .iter()
            .chain(allowances)
            .chain(combinations)
            .chain(patterns)
            .map(|v| s(v, "id")),
        "/rules",
        "rule id",
        &mut issues,
    );
    for (i, rule) in premiums.iter().enumerate() {
        let path = format!("/rules/premiumRules/{i}");
        references(
            &rule["sourceIds"],
            &source_ids,
            &format!("{path}/sourceIds"),
            &mut issues,
        );
        if rule["rateBasis"] == "TABLE_STEP" {
            if rule["referenceStepId"].is_null()
                || !known_steps.contains(s(rule, "referenceStepId"))
            {
                issue(
                    &mut issues,
                    "UNKNOWN_REFERENCE_STEP",
                    format!("{path}/referenceStepId"),
                    "TABLE_STEP requires an existing referenceStepId.",
                );
            }
        } else if !rule["referenceStepId"].is_null() {
            issue(
                &mut issues,
                "UNEXPECTED_REFERENCE_STEP",
                format!("{path}/referenceStepId"),
                "INDIVIDUAL_HOURLY must not define referenceStepId.",
            );
        }
        let conditions = &rule["conditions"];
        for excluded in a(&conditions["excludesShiftTypes"]) {
            if a(&conditions["requiresShiftTypes"]).contains(excluded) {
                issue(
                    &mut issues,
                    "CONTRADICTORY_CONDITION",
                    format!("{path}/conditions"),
                    format!(
                        "Shift type {} cannot be required and excluded.",
                        excluded.as_str().unwrap_or("")
                    ),
                );
            }
        }
        for day in a(&conditions["monthDays"]).iter().filter_map(Value::as_str) {
            if !real_date(&format!("2000-{day}")) {
                issue(
                    &mut issues,
                    "INVALID_MONTH_DAY",
                    format!("{path}/conditions/monthDays"),
                    format!("Invalid recurring calendar date: {day}."),
                );
            }
        }
    }
    for (i, rule) in allowances.iter().enumerate() {
        let path = format!("/rules/allowanceRules/{i}");
        references(
            &rule["sourceIds"],
            &source_ids,
            &format!("{path}/sourceIds"),
            &mut issues,
        );
        range(s(rule, "validFrom"), &rule["validTo"], &path, &mut issues);
        if s(rule, "validFrom") < s(package, "validFrom")
            || package["validTo"]
                .as_str()
                .is_some_and(|end| rule["validTo"].is_null() || s(rule, "validTo") > end)
        {
            issue(
                &mut issues,
                "ALLOWANCE_OUTSIDE_PACKAGE_RANGE",
                path,
                "Allowance validity must stay inside the package validity.",
            );
        }
    }
    let combinable: HashSet<_> = premiums
        .iter()
        .chain(allowances)
        .map(|v| s(v, "id"))
        .collect();
    for (i, rule) in combinations.iter().enumerate() {
        let path = format!("/rules/combinationRules/{i}");
        references(
            &rule["sourceIds"],
            &source_ids,
            &format!("{path}/sourceIds"),
            &mut issues,
        );
        for member in a(&rule["memberRuleIds"]).iter().filter_map(Value::as_str) {
            if !combinable.contains(member) {
                issue(
                    &mut issues,
                    "UNKNOWN_COMBINATION_MEMBER",
                    format!("{path}/memberRuleIds"),
                    format!("Unknown combinable rule: {member}."),
                );
            }
        }
        if rule["mode"] == "PRIORITY" {
            let priorities: HashSet<_> = a(&rule["priorityRuleIds"])
                .iter()
                .filter_map(Value::as_str)
                .collect();
            if priorities.len() != a(&rule["memberRuleIds"]).len()
                || a(&rule["memberRuleIds"])
                    .iter()
                    .filter_map(Value::as_str)
                    .any(|id| !priorities.contains(id))
            {
                issue(
                    &mut issues,
                    "INVALID_PRIORITY_ORDER",
                    format!("{path}/priorityRuleIds"),
                    "PRIORITY requires every member exactly once in priorityRuleIds.",
                );
            }
        } else if !a(&rule["priorityRuleIds"]).is_empty() {
            issue(
                &mut issues,
                "UNEXPECTED_PRIORITY_ORDER",
                format!("{path}/priorityRuleIds"),
                "priorityRuleIds is only allowed for PRIORITY mode.",
            );
        }
    }
    for (i, rule) in patterns.iter().enumerate() {
        references(
            &rule["sourceIds"],
            &source_ids,
            &format!("/rules/workPatternRules/{i}/sourceIds"),
            &mut issues,
        );
    }
    let policy = &rules["workPatternPolicy"];
    references(
        &policy["sourceIds"],
        &source_ids,
        "/rules/workPatternPolicy/sourceIds",
        &mut issues,
    );
    let boundaries = &policy["shiftWindowBoundaries"];
    if !(n(boundaries, "nightEndMinute") < n(boundaries, "earlyEndMinute")
        && n(boundaries, "earlyEndMinute") < n(boundaries, "dayEndMinute")
        && n(boundaries, "dayEndMinute") < n(boundaries, "nightStartMinute"))
    {
        issue(
            &mut issues,
            "INVALID_SHIFT_WINDOW_BOUNDARIES",
            "/rules/workPatternPolicy/shiftWindowBoundaries",
            "Shift-window boundaries must be strictly increasing.",
        );
    }
    if n(policy, "alternatingMinimumShifts") < n(policy, "shiftWorkMinimumShifts")
        || n(policy, "alternatingMinimumWindows") < n(policy, "shiftWorkMinimumWindows")
    {
        issue(
            &mut issues,
            "INVALID_ALTERNATING_PATTERN_LIMITS",
            "/rules/workPatternPolicy",
            "Alternating-shift limits must not be lower than shift-work limits.",
        );
    }
    issues
}
