use super::{
    TariffValidationPackage, ValidationIssue, has, issue, null, nullish, number, rows,
    source_issues, sources, text,
};
use std::collections::BTreeSet;

pub fn training_pay_issues(pkg: &impl TariffValidationPackage) -> Vec<ValidationIssue> {
    let rules = pkg.rules();
    let training = rules.get("trainingPay");
    let s = &rules["selection"];
    let mut issues = vec![];
    if pkg.engine_contract_version() != 10
        && !(pkg.engine_contract_version() == 11 && s["employmentKind"] == "APPRENTICE")
    {
        if training.is_some() {
            issue(
                &mut issues,
                "UNSUPPORTED_TRAINING_PAY",
                "/rules/trainingPay",
                "Training pay requires training contract 10 or 11.",
            );
        }
        return issues;
    }
    let Some(training) = training.filter(|t| t.is_object() && s["employmentKind"] == "APPRENTICE")
    else {
        issue(
            &mut issues,
            "MISSING_TRAINING_PAY",
            "/rules/trainingPay",
            "Training contracts 10 and 11 require training pay and APPRENTICE selection.",
        );
        return issues;
    };
    let known = sources(pkg);
    source_issues(
        &mut issues,
        rows(training, "sourceIds"),
        &known,
        "/rules/trainingPay/sourceIds",
    );
    let overtime: Vec<_> = rows(rules, "premiumRules")
        .iter()
        .filter(|r| r["premiumType"] == "OVERTIME")
        .collect();
    if rules.get("overtimeBaseRule").is_some() {
        issue(
            &mut issues,
            "TRAINING_OVERTIME_BASIS_INVALID",
            "/rules/overtimeBaseRule",
            "Training years must not be capped by an employee table step.",
        );
    }
    if s["capabilities"]["overtime"] == "SUPPORTED" {
        if overtime.len() != 1 {
            issue(
                &mut issues,
                "TRAINING_OVERTIME_INCOMPLETE",
                "/rules/premiumRules",
                "Supported training overtime requires exactly one explicit rate.",
            );
        }
        for r in overtime {
            let c = &r["conditions"];
            if r["rateBasis"] != "INDIVIDUAL_HOURLY"
                || !null(r, "referenceStepId")
                || !null(r, "timeWindow")
                || [
                    "payGroups",
                    "sectors",
                    "federalStates",
                    "holidayPremiumModes",
                    "allowanceStatuses",
                    "monthDays",
                ]
                .iter()
                .any(|k| !null(c, k))
                || !nullish(c, "tariffRegions")
                || !rows(c, "requiresShiftTypes").is_empty()
                || !rows(c, "excludesShiftTypes").is_empty()
                || number(r, "percentageBasisPoints") < 0
                || rows(rules, "combinationRules").iter().any(|comb| {
                    text(r, "id").is_some_and(|id| has(rows(comb, "memberRuleIds"), id))
                })
            {
                issue(
                    &mut issues,
                    "TRAINING_OVERTIME_BASIS_INVALID",
                    "/rules/premiumRules",
                    "Training overtime uses individual training pay, without employee conditions or calendar-premium combinations.",
                );
            }
        }
    }
    if s["capabilities"]["timePremiums"] == "SUPPORTED" {
        let premiums: Vec<_> = rows(rules, "premiumRules")
            .iter()
            .filter(|r| r["premiumType"] != "OVERTIME")
            .collect();
        if [
            "NIGHT",
            "SUNDAY",
            "SATURDAY",
            "PRE_HOLIDAY",
            "HOLIDAY_WITH_TIME_OFF",
            "HOLIDAY_WITHOUT_TIME_OFF",
        ]
        .iter()
        .any(|kind| {
            premiums
                .iter()
                .filter(|r| r["premiumType"] == *kind)
                .count()
                != 1
        }) {
            issue(
                &mut issues,
                "TRAINING_PREMIUMS_INCOMPLETE",
                "/rules/premiumRules",
                "Supported training premiums require each time-premium type exactly once.",
            );
        }
        for r in &premiums {
            let c = &r["conditions"];
            if r["rateBasis"] != "INDIVIDUAL_HOURLY"
                || !null(r, "referenceStepId")
                || ["payGroups", "sectors", "allowanceStatuses"]
                    .iter()
                    .any(|k| !null(c, k))
                || !nullish(c, "tariffRegions")
            {
                issue(
                    &mut issues,
                    "TRAINING_PREMIUM_BASIS_INVALID",
                    "/rules/premiumRules",
                    "Training premiums cannot use employee steps or employee-only conditions.",
                );
            }
        }
        let ids: Vec<_> = premiums
            .iter()
            .filter(|r| r["premiumType"] != "NIGHT")
            .filter_map(|r| text(r, "id"))
            .collect();
        let combinations: Vec<_> = rows(rules, "combinationRules")
            .iter()
            .filter(|r| {
                rows(r, "memberRuleIds")
                    .iter()
                    .any(|id| premiums.iter().any(|p| &p["id"] == id))
            })
            .collect();
        if combinations.len() != 1
            || combinations[0]["mode"] != "EXCLUSIVE_HIGHEST"
            || rows(combinations[0], "memberRuleIds").len() != ids.len()
            || ids
                .iter()
                .any(|id| !has(rows(combinations[0], "memberRuleIds"), id))
        {
            issue(
                &mut issues,
                "TRAINING_PREMIUM_COMBINATION_INVALID",
                "/rules/combinationRules",
                "Calendar premiums use the highest rate; night premiums remain additive.",
            );
        }
    }
    for r in rows(rules, "allowanceRules") {
        let c = &r["conditions"];
        if r["allowanceType"] == "care" {
            if r["id"] != "training-special-duty-pe1"
                || r["amountKind"] != "FIXED_MONTHLY"
                || r["prorateByPartTime"] != true
                || !null(c, "payGroups")
                || !rows(c, "requiresShiftTypes").is_empty()
                || !rows(c, "excludesShiftTypes").is_empty()
                || ["allowanceStatuses", "holidayPremiumModes", "monthDays"]
                    .iter()
                    .any(|k| !null(c, k))
            {
                issue(
                    &mut issues,
                    "TRAINING_SPECIAL_ALLOWANCE_INVALID",
                    "/rules/allowanceRules",
                    "Training special-duty allowance needs explicit personal eligibility, not employee or shift-status conditions.",
                );
            }
            continue;
        }
        if r["allowanceType"] != "shift" && r["allowanceType"] != "alternating-shift" {
            continue;
        }
        let status = match (
            r["allowanceType"].as_str(),
            r["amountKind"] == "FIXED_MONTHLY",
        ) {
            (Some("shift"), true) => "SHIFT_MONTHLY",
            (Some("shift"), false) => "SHIFT_HOURLY",
            (_, true) => "ALTERNATING_MONTHLY",
            (_, false) => "ALTERNATING_HOURLY",
        };
        if !null(c, "payGroups")
            || !rows(c, "requiresShiftTypes").is_empty()
            || !rows(c, "excludesShiftTypes").is_empty()
            || rows(c, "allowanceStatuses").len() != 1
            || c["allowanceStatuses"][0] != status
            || (r["amountKind"] == "FIXED_HOURLY" && r["prorateByPartTime"] == true)
        {
            issue(
                &mut issues,
                "TRAINING_ALLOWANCE_BASIS_INVALID",
                "/rules/allowanceRules",
                "Training shift allowances need their own status and must not reduce worked-hour amounts by part-time again.",
            );
        }
    }
    let mut groups = BTreeSet::new();
    let mut pairs: Vec<String> = vec![];
    for (index, c) in rows(training, "categories").iter().enumerate() {
        let path = format!("/rules/trainingPay/categories/{index}");
        let id = text(c, "groupId").unwrap_or("");
        if !groups.insert(id) {
            issue(
                &mut issues,
                "DUPLICATE_TRAINING_CATEGORY",
                &path,
                "Training category identifiers must be unique.",
            );
        }
        source_issues(
            &mut issues,
            rows(c, "sourceIds"),
            &known,
            &(path + "/sourceIds"),
        );
        for year in rows(c, "years") {
            let year = year
                .as_f64()
                .map(|n| n.to_string())
                .unwrap_or_else(|| year.to_string());
            let pair = format!("{id}:s{year}");
            if !pairs.contains(&pair) {
                pairs.push(pair);
            }
        }
    }
    if let Some(table) = rows(rules, "payTables")
        .iter()
        .find(|t| t["id"] == rules["selector"]["payTableId"])
    {
        for pair in &pairs {
            if rows(table, "entries")
                .iter()
                .filter(|e| {
                    format!(
                        "{}:{}",
                        text(e, "groupId").unwrap_or(""),
                        text(e, "stepId").unwrap_or("")
                    ) == *pair
                })
                .count()
                != 1
            {
                issue(
                    &mut issues,
                    "TRAINING_TABLE_INCOMPLETE",
                    "/rules/payTables",
                    format!("Expected exactly one training amount for {pair}."),
                );
            }
        }
        for e in rows(table, "entries") {
            if !pairs.contains(&format!(
                "{}:{}",
                text(e, "groupId").unwrap_or(""),
                text(e, "stepId").unwrap_or("")
            )) {
                issue(
                    &mut issues,
                    "UNDECLARED_TRAINING_YEAR",
                    "/rules/payTables",
                    "Every training row needs a declared category and year.",
                );
            }
        }
    }
    issues
}
