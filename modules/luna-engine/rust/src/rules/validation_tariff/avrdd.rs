//! AVR.DD source-table and dated policy semantic checks.
use super::{
    annex::{capabilities_unsupported, parts},
    util::*,
};
use crate::rules::validation::ValidationIssue;
use serde_json::Value;
use std::collections::BTreeSet;
fn expected_stages(group: &str) -> &'static [&'static str] {
    let number = group
        .get(2..)
        .unwrap_or("")
        .parse::<f64>()
        .unwrap_or(f64::NAN);
    if number <= 2.0 {
        &["base", "exp1"]
    } else if number <= 4.0 {
        &["entry", "base", "exp1"]
    } else if number <= 6.0 {
        &["entry", "base", "exp1", "exp2"]
    } else {
        &["entry", "base", "exp1", "exp2", "exp3"]
    }
}
fn dated_rates(pkg: &Value, name: &str, missing: &str, period: &str) -> Vec<ValidationIssue> {
    let mut out = vec![];
    let path = format!("/rules/{name}");
    let rates = a(&pkg["rules"][name]);
    if rates.is_empty() {
        issue(&mut out, missing, path, "Dated AVR.DD rates required.");
        return out;
    }
    let known = sources(pkg);
    let mut next = s(pkg, "validFrom").to_owned();
    for (i, rate) in rates.iter().enumerate() {
        let p = format!("{path}/{i}");
        for id in a(&rate["sourceIds"]) {
            if !known.contains(id.as_str().unwrap_or("")) {
                issue(
                    &mut out,
                    "UNKNOWN_SOURCE_ID",
                    format!("{p}/sourceIds"),
                    id.as_str().unwrap_or(""),
                );
            }
        }
        if s(rate, "validFrom") != next
            || (rate["validTo"] != Value::Null && s(rate, "validTo") < s(rate, "validFrom"))
        {
            issue(
                &mut out,
                period,
                &p,
                "Rates must cover the package without gaps or overlap.",
            );
            break;
        }
        if rate["validTo"] == Value::Null {
            if i != rates.len() - 1 || pkg["validTo"] != Value::Null {
                issue(
                    &mut out,
                    period,
                    &p,
                    "An open rate must be the final package rate.",
                );
            }
            next = "OPEN".into();
        } else if let Some(value) = next_date(s(rate, "validTo")) {
            next = value;
        } else {
            issue(&mut out, period, &p, "Invalid rate end date.");
            break;
        }
    }
    if pkg["validTo"] == Value::Null {
        if next != "OPEN" {
            issue(&mut out, period, path, "Rates must reach the package end.");
        }
    } else if let Some(end) = next_date(s(pkg, "validTo")) {
        if next != end {
            issue(&mut out, period, path, "Rates must reach the package end.");
        }
    } else {
        issue(&mut out, period, path, "Invalid package end date.");
    }
    out
}
pub fn avrdd_issues(pkg: &Value) -> Vec<ValidationIssue> {
    let mut out = vec![];
    let rules = &pkg["rules"];
    let selection = &rules["selection"];
    let selector = &rules["selector"];
    let fields = [
        "avrddStagePolicy",
        "avrddHourlyRates",
        "avrddTimePremiumPolicy",
        "avrddOvertimePolicy",
        "avrddShiftAllowanceRates",
        "avrddCareAllowanceRates",
        "avrddAdvancedAllowancePolicies",
    ];
    if n(pkg, "engineContractVersion") != 15.0 {
        if s(pkg, "packageId") == "avr-dd-anlage-1"
            || s(selection, "familyId") == "avr-dd"
            || fields.iter().any(|k| rules.get(k).is_some())
        {
            issue(
                &mut out,
                "AVRDD_CONTRACT",
                "/engineContractVersion",
                "AVR.DD requires tariff contract 15.",
            );
        }
        return out;
    }
    let p = parts(selector);
    if s(pkg, "packageId") != "avr-dd-anlage-1"
        || s(selector, "agreementId") != "avr-dd"
        || p.len() != 1
        || p[0] != "anlage-1"
        || s(selection, "familyId") != "avr-dd"
        || s(selection, "engineId") != "avr-dd-v1"
        || s(selection, "employmentKind") != "EMPLOYEE"
    {
        issue(
            &mut out,
            "AVRDD_IDENTITY",
            "/rules/selection",
            "Explicit AVR.DD Anlage 1 identity required.",
        );
    }
    let v = &selection["variants"][0];
    if a(&selection["variants"]).len() != 1
        || s(v, "id") != "ANLAGE_1"
        || s(v, "specialPartId") != "anlage-1"
        || a(&v["regions"]).len() != 1
        || s(&v["regions"][0], "id") != "AVR_DD"
        || v["regions"][0].get("payTableId") != selector.get("payTableId")
    {
        issue(
            &mut out,
            "AVRDD_SELECTION",
            "/rules/selection/variants",
            "One explicitly mapped AVR.DD Anlage 1 variant required.",
        );
    }
    if s(pkg, "status") != "DRAFT" || !capabilities_unsupported(selection) {
        issue(
            &mut out,
            "AVRDD_NOT_EXECUTABLE",
            "/rules/selection/capabilities",
            "Source-only AVR.DD packages must stay DRAFT with every calculation capability unsupported.",
        );
    }
    let allowed = [
        "selection",
        "selector",
        "payTables",
        "avrddStagePolicy",
        "avrddHourlyRates",
        "avrddTimePremiumPolicy",
        "avrddOvertimePolicy",
        "avrddShiftAllowanceRates",
        "avrddCareAllowanceRates",
        "avrddAdvancedAllowancePolicies",
        "premiumRules",
        "allowanceRules",
        "combinationRules",
        "workPatternRules",
        "workPatternPolicy",
    ];
    if rules
        .as_object()
        .is_some_and(|o| o.keys().any(|k| !allowed.contains(&k.as_str())))
        || [
            "premiumRules",
            "allowanceRules",
            "combinationRules",
            "workPatternRules",
        ]
        .iter()
        .any(|k| !a(&rules[k]).is_empty())
    {
        issue(
            &mut out,
            "AVRDD_FOREIGN_RULES",
            "/rules",
            "Foreign or unimplemented calculation rules are forbidden.",
        );
    }
    let tables = a(&rules["payTables"]);
    if tables.len() != 1 || rules["payTables"][0].get("id") != selector.get("payTableId") {
        issue(
            &mut out,
            "AVRDD_TABLE_COUNT",
            "/rules/payTables",
            "Exactly one mapped Anlage 2 table required.",
        );
    }
    let groups: Vec<String> = (1..=13).map(|n| format!("eg{n}")).collect();
    let mut expected: BTreeSet<String> = groups
        .iter()
        .flat_map(|g| {
            expected_stages(g)
                .iter()
                .map(move |step| format!("{g}:{step}"))
        })
        .collect();
    for e in a(&rules["payTables"][0]["entries"]) {
        if !expected.remove(&format!("{}:{}", s(e, "groupId"), s(e, "stepId")))
            || n(e, "monthlyCents") <= 0.0
        {
            issue(
                &mut out,
                "AVRDD_TABLE_ENTRY",
                "/rules/payTables/0/entries",
                "Invalid or duplicate group/stage/value.",
            );
        }
    }
    if !expected.is_empty() {
        issue(
            &mut out,
            "AVRDD_TABLE_INCOMPLETE",
            "/rules/payTables/0/entries",
            "Every actual EG stage is required; missing stages are not zero-valued stages.",
        );
    }
    let known = sources(pkg);
    let stages = &rules["avrddStagePolicy"];
    if !truth(rules.get("avrddStagePolicy")) {
        issue(
            &mut out,
            "AVRDD_STAGES_MISSING",
            "/rules/avrddStagePolicy",
            "Group-dependent stage progression required.",
        );
    } else {
        for id in a(&stages["sourceIds"]) {
            if !known.contains(id.as_str().unwrap_or("")) {
                issue(
                    &mut out,
                    "UNKNOWN_SOURCE_ID",
                    "/rules/avrddStagePolicy/sourceIds",
                    id.as_str().unwrap_or(""),
                );
            }
        }
        let mut remaining: BTreeSet<&str> = groups.iter().map(String::as_str).collect();
        for (i, g) in a(&stages["groups"]).iter().enumerate() {
            let path = format!("/rules/avrddStagePolicy/groups/{i}");
            if !remaining.remove(s(g, "groupId")) {
                issue(
                    &mut out,
                    "AVRDD_STAGE_GROUP",
                    &path,
                    "Unknown or duplicate EG group.",
                );
            }
            let expected = expected_stages(s(g, "groupId"));
            let sequence = a(&g["stages"]);
            if sequence.len() != expected.len()
                || sequence.iter().enumerate().any(|(i, stage)| {
                    expected.get(i).copied() != Some(s(stage, "stepId"))
                        || (i == sequence.len() - 1)
                            != (stage.get("monthsToNext") == Some(&Value::Null))
                })
            {
                issue(
                    &mut out,
                    "AVRDD_STAGE_SEQUENCE",
                    path,
                    "Stages and terminal progression must match the group.",
                );
            }
        }
        if !remaining.is_empty() {
            issue(
                &mut out,
                "AVRDD_STAGE_INCOMPLETE",
                "/rules/avrddStagePolicy/groups",
                "All 13 EG groups required.",
            );
        }
    }
    if truth(rules.get("avrddHourlyRates")) {
        let mut remaining: BTreeSet<&str> = groups.iter().map(String::as_str).collect();
        for (i, rate) in a(&rules["avrddHourlyRates"]).iter().enumerate() {
            let path = format!("/rules/avrddHourlyRates/{i}");
            if !remaining.remove(s(rate, "groupId")) {
                issue(
                    &mut out,
                    "AVRDD_HOURLY_GROUP",
                    &path,
                    "Unknown or duplicate Anlage 9 EG group.",
                );
            }
            for id in a(&rate["sourceIds"]) {
                if !known.contains(id.as_str().unwrap_or("")) {
                    issue(
                        &mut out,
                        "UNKNOWN_SOURCE_ID",
                        format!("{path}/sourceIds"),
                        id.as_str().unwrap_or(""),
                    );
                }
            }
        }
        if !remaining.is_empty() {
            issue(
                &mut out,
                "AVRDD_HOURLY_INCOMPLETE",
                "/rules/avrddHourlyRates",
                "All 13 Anlage 9 rates required.",
            );
        }
    }
    let premium = &rules["avrddTimePremiumPolicy"];
    if truth(rules.get("avrddTimePremiumPolicy")) {
        for id in a(&premium["sourceIds"]) {
            if !known.contains(id.as_str().unwrap_or("")) {
                issue(
                    &mut out,
                    "UNKNOWN_SOURCE_ID",
                    "/rules/avrddTimePremiumPolicy/sourceIds",
                    id.as_str().unwrap_or(""),
                );
            }
        }
        if n(&premium["nightWindow"], "startMinute") != 1260.0
            || n(&premium["nightWindow"], "endMinute") != 360.0
            || n(&premium["saturdayWindow"], "startMinute") != 780.0
            || n(&premium["saturdayWindow"], "endMinute") != 1260.0
        {
            issue(
                &mut out,
                "AVRDD_PREMIUM_WINDOW",
                "/rules/avrddTimePremiumPolicy",
                "AVR.DD § 9e(4) and § 20a(1) windows must match the source text.",
            );
        }
    }
    if truth(rules.get("avrddOvertimePolicy")) {
        for id in a(&rules["avrddOvertimePolicy"]["sourceIds"]) {
            if !known.contains(id.as_str().unwrap_or("")) {
                issue(
                    &mut out,
                    "UNKNOWN_SOURCE_ID",
                    "/rules/avrddOvertimePolicy/sourceIds",
                    id.as_str().unwrap_or(""),
                );
            }
        }
    }
    for (name, missing, period) in [
        (
            "avrddShiftAllowanceRates",
            "AVRDD_SHIFT_RATES_MISSING",
            "AVRDD_SHIFT_RATE_PERIOD",
        ),
        (
            "avrddCareAllowanceRates",
            "AVRDD_CARE_RATES_MISSING",
            "AVRDD_CARE_RATE_PERIOD",
        ),
        (
            "avrddAdvancedAllowancePolicies",
            "AVRDD_ADVANCED_ALLOWANCES_MISSING",
            "AVRDD_ADVANCED_ALLOWANCE_PERIOD",
        ),
    ] {
        out.extend(dated_rates(pkg, name, missing, period));
    }
    for (i, policy) in a(&rules["avrddAdvancedAllowancePolicies"])
        .iter()
        .enumerate()
    {
        let legacy = s(policy, "validFrom") < "2026-07-01";
        if (legacy && (policy["validTo"] == Value::Null || s(policy, "validTo") >= "2026-07-01"))
            || s(policy, "phase")
                != if legacy {
                    "LEGACY_EFG"
                } else {
                    "POST_2026_07_EFGH"
                }
            || s(policy, "practiceMode")
                != if legacy {
                    "HALF_EG8_DIFFERENCE"
                } else {
                    "FIXED_MONTHLY"
                }
            || if legacy {
                policy["practiceMonthlyCents"] != Value::Null
            } else {
                policy["practiceMonthlyCents"] == Value::Null
            }
        {
            issue(
                &mut out,
                "AVRDD_ADVANCED_ALLOWANCE_PHASE",
                format!("/rules/avrddAdvancedAllowancePolicies/{i}"),
                "§ 14(2) letter assignment and practice mode change on 01.07.2026.",
            );
        }
    }
    out
}
