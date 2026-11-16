use super::{tdl_policy, util::*};
use crate::rules::validation::ValidationIssue;
use serde_json::Value;
use std::collections::BTreeSet;

pub fn tvl_kr_issues(pkg: &Value) -> Vec<ValidationIssue> {
    let r = &pkg["rules"];
    let selection = &r["selection"];
    let selector = &r["selector"];
    let working = rows(r, "employmentWorkingTimeRules");
    let version = n(pkg, "engineContractVersion");
    let mut issues = tdl_policy::tvl_care(pkg);
    if version != 12.0 {
        for (key, code, message) in [
            (
                "tvlShiftAllowancePolicy",
                "UNSUPPORTED_TVL_SHIFT_ALLOWANCE_POLICY",
                "KR shift allowances require contract 12.",
            ),
            (
                "tvlOvertimePolicy",
                "UNSUPPORTED_TVL_OVERTIME_POLICY",
                "KR overtime policy requires contract 12.",
            ),
            (
                "tvlTimePremiumPolicy",
                "UNSUPPORTED_TVL_PREMIUM_POLICY",
                "KR premium policy requires contract 12.",
            ),
        ] {
            if r.get(key).is_some() {
                issue(&mut issues, code, format!("/rules/{key}"), message);
            }
        }
        if r.get("employmentWorkingTimeRules").is_some() && version != 13.0 && version != 14.0 {
            issue(
                &mut issues,
                "UNSUPPORTED_EMPLOYMENT_WORKING_TIME",
                "/rules/employmentWorkingTimeRules",
                "Dated variant/region working-time rules require contract 12.",
            );
        }
        return issues;
    }
    if pkg["packageId"] != "tvl-kr-tdl"
        || selector["agreementId"] != "tv-l"
        || selection["familyId"] != "tvl-kr"
        || selection["engineId"] != "tvl-kr-v1"
        || selection["employmentKind"] != "EMPLOYEE"
    {
        issue(
            &mut issues,
            "TVL_KR_IDENTITY",
            "/rules/selection",
            "Contract 12 requires the explicit TV-L/KR identity.",
        );
    }
    let single;
    let parts = if selector.get("specialPartIds").is_some() {
        rows(selector, "specialPartIds")
    } else {
        single = [selector["specialPartId"].clone()];
        &single
    };
    let variants = rows(selection, "variants");
    let first = variants.first().unwrap_or(&Value::Null);
    if parts.len() != 1
        || parts[0] != "section-43"
        || variants.len() != 1
        || first["id"] != "SECTION_43"
        || first["specialPartId"] != "section-43"
    {
        issue(
            &mut issues,
            "TVL_KR_VARIANT",
            "/rules/selection/variants",
            "The current KR contract covers section 43 only.",
        );
    }
    let c = &selection["capabilities"];
    if c["basePay"] != "SUPPORTED"
        || c["timePremiums"]
            != if truth(r.get("tvlTimePremiumPolicy")) {
                "SUPPORTED"
            } else {
                "UNSUPPORTED"
            }
        || c["overtime"]
            != if truth(r.get("tvlOvertimePolicy")) {
                "SUPPORTED"
            } else {
                "UNSUPPORTED"
            }
        || c["allowances"] != "UNSUPPORTED"
        || c["annualPayment"]
            != if truth(r.get("annualPaymentRules")) {
                "SUPPORTED"
            } else {
                "UNSUPPORTED"
            }
    {
        issue(
            &mut issues,
            "TVL_KR_COMPONENT_COVERAGE",
            "/rules/selection/capabilities",
            "Declared capabilities must match the implemented KR components.",
        );
    }
    if [
        "overtimeBaseRule",
        "weeklyWorkingTimeRules",
        "hourlyCalculation",
        "trainingPay",
    ]
    .iter()
    .any(|key| r.get(*key).is_some())
        || [
            "premiumRules",
            "allowanceRules",
            "combinationRules",
            "workPatternRules",
        ]
        .iter()
        .any(|key| !rows(r, key).is_empty())
    {
        issue(
            &mut issues,
            "TVL_KR_UNSUPPORTED_RULES",
            "/rules",
            "No foreign or unimplemented component rules are allowed.",
        );
    }
    let tables = rows(r, "payTables");
    if tables.len() != 1 {
        issue(
            &mut issues,
            "TVL_KR_TABLE_COUNT",
            "/rules/payTables",
            "Each version must contain exactly one KR table.",
        );
    }
    for (i, table) in tables.iter().enumerate() {
        let mut expected = BTreeSet::new();
        for group in 5..=17 {
            for step in if group <= 6 { 1 } else { 2 }..=6 {
                expected.insert(format!("kr{group}:{step}"));
            }
        }
        for e in rows(table, "entries") {
            if !expected.remove(&format!("{}:{}", s(e, "groupId"), s(e, "stepId")))
                || n(e, "monthlyCents") <= 0.0
            {
                issue(
                    &mut issues,
                    "TVL_KR_TABLE_CELL",
                    format!("/rules/payTables/{i}/entries"),
                    "Unknown, duplicate or non-positive KR group/step cell.",
                );
            }
        }
        if !expected.is_empty() {
            issue(
                &mut issues,
                "TVL_KR_TABLE_INCOMPLETE",
                format!("/rules/payTables/{i}/entries"),
                "KR5/6 require steps 1–6; KR7–17 require steps 2–6.",
            );
        }
    }
    let root = "/rules/employmentWorkingTimeRules";
    if working.is_empty() {
        issue(
            &mut issues,
            "TVL_KR_WORKING_TIME_MISSING",
            root,
            "Explicit regional working-time coverage is required.",
        );
        return issues;
    }
    let known = sources(pkg);
    if let Some(p) = r.get("tvlShiftAllowancePolicy").filter(|p| truth(Some(p))) {
        let path = "/rules/tvlShiftAllowancePolicy";
        for id in rows(p, "sourceIds") {
            if id.as_str().is_none_or(|id| !known.contains(id)) {
                issue(
                    &mut issues,
                    "UNKNOWN_SOURCE_ID",
                    path,
                    "Unknown shift allowance source.",
                );
            }
        }
        let mut next = Some(s(pkg, "validFrom").to_owned());
        let mut valid = true;
        let mut periods: Vec<_> = rows(p, "periods").iter().collect();
        periods.sort_by(|a, b| s(a, "validFrom").cmp(s(b, "validFrom")));
        for p in periods {
            if !valid_date(s(p, "validFrom"))
                || !p["validTo"].is_null()
                    && (!valid_date(s(p, "validTo")) || s(p, "validTo") < s(p, "validFrom"))
            {
                valid = false;
                continue;
            }
            if next.as_deref() != Some(s(p, "validFrom")) {
                valid = false;
            }
            next = after(&p["validTo"]);
        }
        let valid_end = pkg["validTo"].is_null() || valid_date(s(pkg, "validTo"));
        if !valid || !valid_end || next != after(&pkg["validTo"]) {
            issue(
                &mut issues,
                "TVL_KR_SHIFT_ALLOWANCE_COVERAGE",
                path,
                "Shift allowances must cover the exact package period without gaps or overlaps.",
            );
        }
    }
    if let Some(p) = r.get("tvlOvertimePolicy").filter(|p| truth(Some(p))) {
        let root = "/rules/tvlOvertimePolicy";
        for id in rows(p, "sourceIds") {
            if id.as_str().is_none_or(|id| !known.contains(id)) {
                issue(
                    &mut issues,
                    "UNKNOWN_SOURCE_ID",
                    format!("{root}/sourceIds"),
                    "Unknown overtime source.",
                );
            }
        }
        let mut expected: BTreeSet<_> = (5..=17).map(|g| format!("kr{g}")).collect();
        let entries = tables.first().map(|t| rows(t, "entries")).unwrap_or(&[]);
        for rate in rows(p, "groupRates") {
            if !expected.remove(s(rate, "groupId")) {
                issue(
                    &mut issues,
                    "TVL_KR_OVERTIME_GROUPS",
                    format!("{root}/groupRates"),
                    "Unknown or duplicate KR overtime group.",
                );
            }
            for step in [&p["maximumBaseStepId"], &p["premiumReferenceStepId"]] {
                if !entries
                    .iter()
                    .any(|e| e["groupId"] == rate["groupId"] && &e["stepId"] == step)
                {
                    issue(
                        &mut issues,
                        "TVL_KR_OVERTIME_REFERENCE",
                        root,
                        "Missing overtime reference step.",
                    );
                }
            }
        }
        if !expected.is_empty() {
            issue(
                &mut issues,
                "TVL_KR_OVERTIME_GROUPS",
                format!("{root}/groupRates"),
                "Incomplete KR overtime group coverage.",
            );
        }
        if truth(r.get("tvlTimePremiumPolicy"))
            && r["tvlTimePremiumPolicy"]["monthlyFactorThousandths"]
                != p["monthlyFactorThousandths"]
        {
            issue(
                &mut issues,
                "TVL_KR_HOURLY_FACTOR",
                root,
                "Conflicting hourly divisors in the same package.",
            );
        }
    }
    if let Some(p) = r.get("tvlTimePremiumPolicy").filter(|p| truth(Some(p))) {
        for id in rows(p, "sourceIds") {
            if id.as_str().is_none_or(|id| !known.contains(id)) {
                issue(
                    &mut issues,
                    "UNKNOWN_SOURCE_ID",
                    "/rules/tvlTimePremiumPolicy/sourceIds",
                    "Unknown premium source.",
                );
            }
        }
        for key in ["nightWindow", "preHolidayWindow", "saturdayWindow"] {
            if p[key]["startMinute"] == p[key]["endMinute"] {
                issue(
                    &mut issues,
                    "TVL_KR_PREMIUM_WINDOW",
                    "/rules/tvlTimePremiumPolicy",
                    "Ambiguous premium time window.",
                );
            }
        }
        if rows(p, "preHolidayMonthDays").iter().any(|day| {
            !day.as_str()
                .is_some_and(|day| valid_date(&format!("2000-{day}")))
        }) {
            issue(
                &mut issues,
                "TVL_KR_PREMIUM_DATE",
                "/rules/tvlTimePremiumPolicy",
                "Invalid recurring date.",
            );
        }
        let entries = tables.first().map(|t| rows(t, "entries")).unwrap_or(&[]);
        for group in 5..=17 {
            if !entries.iter().any(|e| {
                e["groupId"] == format!("kr{group}") && e["stepId"] == p["referenceStepId"]
            }) {
                issue(
                    &mut issues,
                    "TVL_KR_PREMIUM_REFERENCE",
                    "/rules/tvlTimePremiumPolicy/referenceStepId",
                    "Missing KR reference step.",
                );
            }
        }
    }
    let pairs = unique_strings(variants.iter().flat_map(|v| {
        rows(v, "regions")
            .iter()
            .map(move |r| format!("{}:{}", s(v, "id"), s(r, "id")))
    }));
    let mut ids = BTreeSet::new();
    let mut invalid_range = !valid_date(s(pkg, "validFrom"))
        || !pkg["validTo"].is_null() && !valid_date(s(pkg, "validTo"));
    for (i, rule) in working.iter().enumerate() {
        let path = format!("{root}/{i}");
        if !ids.insert(s(rule, "id")) {
            issue(
                &mut issues,
                "DUPLICATE_WORKING_TIME_ID",
                format!("{path}/id"),
                "Duplicate working-time id.",
            );
        }
        if !pairs.contains(&format!("{}:{}", s(rule, "variantId"), s(rule, "regionId"))) {
            issue(
                &mut issues,
                "UNKNOWN_WORKING_TIME_SELECTION",
                &path,
                "Working time must reference a declared variant/region.",
            );
        }
        for id in rows(rule, "sourceIds") {
            if id.as_str().is_none_or(|id| !known.contains(id)) {
                issue(
                    &mut issues,
                    "UNKNOWN_SOURCE_ID",
                    format!("{path}/sourceIds"),
                    format!("Unknown source: {}.", id.as_str().unwrap_or("")),
                );
            }
        }
        if !valid_date(s(rule, "validFrom"))
            || !rule["validTo"].is_null()
                && (!valid_date(s(rule, "validTo")) || s(rule, "validTo") < s(rule, "validFrom"))
            || s(rule, "validFrom") < s(pkg, "validFrom")
            || !pkg["validTo"].is_null()
                && (rule["validTo"].is_null() || s(rule, "validTo") > s(pkg, "validTo"))
        {
            invalid_range = true;
            issue(
                &mut issues,
                "TVL_KR_WORKING_TIME_RANGE",
                path,
                "Working-time range must be real and inside package validity.",
            );
        }
    }
    if rows(first, "regions").len() != 3
        || ["WEST_38_5", "EAST", "EAST_UNIVERSITY_HOSPITAL"]
            .iter()
            .any(|id| !rows(first, "regions").iter().any(|r| r["id"] == *id))
    {
        issue(
            &mut issues,
            "TVL_KR_REGIONS",
            "/rules/selection/variants",
            "Declare West, East and East university hospitals separately.",
        );
    }
    if invalid_range {
        return issues;
    }
    for pair in pairs {
        let mut selected: Vec<_> = working
            .iter()
            .filter(|r| format!("{}:{}", s(r, "variantId"), s(r, "regionId")) == pair)
            .collect();
        selected.sort_by(|a, b| s(a, "validFrom").cmp(s(b, "validFrom")));
        let empty = selected.is_empty();
        let mut next = Some(s(pkg, "validFrom").to_owned());
        for rule in selected {
            if next.as_deref() != Some(s(rule, "validFrom")) {
                issue(
                    &mut issues,
                    "TVL_KR_WORKING_TIME_COVERAGE",
                    root,
                    format!("Gap or overlap in {pair}."),
                );
            }
            next = after(&rule["validTo"]);
        }
        if empty || next != after(&pkg["validTo"]) {
            issue(
                &mut issues,
                "TVL_KR_WORKING_TIME_COVERAGE",
                root,
                format!("Incomplete coverage for {pair}."),
            );
        }
    }
    issues
}

pub fn tval_training_issues(pkg: &Value) -> Vec<ValidationIssue> {
    let mut issues = tdl_policy::tval_shift(pkg);
    issues.extend(tdl_policy::tval_premium(pkg));
    issues.extend(tdl_policy::tval_overtime(pkg));
    issues.extend(tdl_policy::tval_care(pkg));
    let r = &pkg["rules"];
    let selector = &r["selector"];
    let selection = &r["selection"];
    let training = r.get("tvalTrainingPay");
    if n(pkg, "engineContractVersion") != 13.0 {
        if training.is_some() {
            issue(
                &mut issues,
                "UNSUPPORTED_TVAL_TRAINING",
                "/rules/tvalTrainingPay",
                "TVA-L training requires contract 13.",
            );
        }
        return issues;
    }
    if pkg["packageId"] != "tval-pflege-tdl"
        || selector["agreementId"] != "tva-l-pflege"
        || selection["familyId"] != "tval-pflege"
        || selection["engineId"] != "tval-pflege-v1"
        || selection["employmentKind"] != "APPRENTICE"
    {
        issue(
            &mut issues,
            "TVAL_IDENTITY",
            "/rules/selection",
            "Contract 13 requires the explicit TVA-L Pflege identity.",
        );
    }
    let single;
    let parts = if selector.get("specialPartId").is_some() {
        single = [selector["specialPartId"].clone()];
        &single
    } else {
        rows(selector, "specialPartIds")
    };
    let variants = rows(selection, "variants");
    let first = variants.first().unwrap_or(&Value::Null);
    if parts.len() != 1
        || parts[0] != "pflege"
        || variants.len() != 1
        || first["id"] != "CARE"
        || first["specialPartId"] != "pflege"
    {
        issue(
            &mut issues,
            "TVAL_VARIANT",
            "/rules/selection/variants",
            "TVA-L Pflege needs its own CARE variant.",
        );
    }
    let c = &selection["capabilities"];
    if c["basePay"] != "SUPPORTED"
        || c["annualPayment"]
            != if truth(r.get("annualPaymentRules")) {
                "SUPPORTED"
            } else {
                "UNSUPPORTED"
            }
        || c["timePremiums"]
            != if truth(r.get("tvalTimePremiumPolicy")) {
                "SUPPORTED"
            } else {
                "UNSUPPORTED"
            }
        || c["overtime"]
            != if truth(r.get("tvalOvertimePolicy")) {
                "SUPPORTED"
            } else {
                "UNSUPPORTED"
            }
        || c["allowances"] != "UNSUPPORTED"
    {
        issue(
            &mut issues,
            "TVAL_COMPONENT_COVERAGE",
            "/rules/selection/capabilities",
            "Only implemented components may be advertised.",
        );
    }
    let Some(training) = training.filter(|p| truth(Some(p))) else {
        issue(
            &mut issues,
            "TVAL_TRAINING_MISSING",
            "/rules/tvalTrainingPay",
            "Explicit training categories are required.",
        );
        return issues;
    };
    if [
        "trainingPay",
        "hourlyCalculation",
        "overtimeBaseRule",
        "weeklyWorkingTimeRules",
    ]
    .iter()
    .any(|key| r.get(*key).is_some())
        || [
            "premiumRules",
            "allowanceRules",
            "combinationRules",
            "workPatternRules",
        ]
        .iter()
        .any(|key| !rows(r, key).is_empty())
    {
        issue(
            &mut issues,
            "TVAL_FOREIGN_RULES",
            "/rules",
            "Foreign or unimplemented remuneration rules are not allowed.",
        );
    }
    let known = sources(pkg);
    let check = |ids: &[Value], path: &str, issues: &mut Vec<ValidationIssue>| {
        for id in ids {
            if id.as_str().is_none_or(|id| !known.contains(id)) {
                issue(
                    issues,
                    "UNKNOWN_SOURCE_ID",
                    path,
                    format!("Unknown source: {}", id.as_str().unwrap_or("")),
                );
            }
        }
    };
    check(
        rows(training, "sourceIds"),
        "/rules/tvalTrainingPay/sourceIds",
        &mut issues,
    );
    let expected_groups: &[&str] = if s(pkg, "validFrom") < "2027-01-01" {
        &["regular"]
    } else {
        &["regular", "assistant"]
    };
    if s(pkg, "validFrom") < "2027-01-01"
        && (pkg["validTo"].is_null() || s(pkg, "validTo") >= "2027-01-01")
    {
        issue(
            &mut issues,
            "TVAL_CATEGORY_BOUNDARY",
            "/validTo",
            "Split package coverage at the 2027 training-category change.",
        );
    }
    let categories = rows(training, "categories");
    if categories.len() != expected_groups.len()
        || expected_groups
            .iter()
            .any(|group| categories.iter().filter(|c| c["groupId"] == *group).count() != 1)
    {
        issue(
            &mut issues,
            "TVAL_CATEGORIES",
            "/rules/tvalTrainingPay/categories",
            "Categories must match their dated legal scope.",
        );
    }
    let mut pairs = BTreeSet::new();
    for category in categories {
        let regular = category["groupId"] == "regular";
        let expected: &[&str] = if regular {
            &["1", "2", "3"]
        } else {
            &["1", "2"]
        };
        if category["periodKind"]
            != if regular {
                "TRAINING_YEAR"
            } else {
                "TRAINING_MONTH_BRACKET"
            }
            || rows(category, "levels").len() != expected.len()
            || expected.iter().any(|level| {
                rows(category, "levels")
                    .iter()
                    .filter(|l| l["id"] == *level)
                    .count()
                    != 1
            })
        {
            issue(
                &mut issues,
                "TVAL_LEVELS",
                "/rules/tvalTrainingPay/categories",
                "Regular years and assistant month brackets must remain distinct.",
            );
        }
        for level in rows(category, "levels") {
            pairs.insert(format!("{}:{}", s(category, "groupId"), s(level, "id")));
        }
        check(
            rows(category, "sourceIds"),
            "/rules/tvalTrainingPay/categories/sourceIds",
            &mut issues,
        );
    }
    let tables = rows(r, "payTables");
    let table = tables.first().unwrap_or(&Value::Null);
    if tables.len() != 1 || table["id"] != selector["payTableId"] {
        issue(
            &mut issues,
            "TVAL_TABLE",
            "/rules/payTables",
            "Exactly one selected training table is required.",
        );
    }
    for e in rows(table, "entries") {
        if !pairs.remove(&format!("{}:{}", s(e, "groupId"), s(e, "stepId")))
            || n(e, "monthlyCents") <= 0.0
        {
            issue(
                &mut issues,
                "TVAL_TABLE_CELL",
                "/rules/payTables",
                "Unknown, duplicate or non-positive training amount.",
            );
        }
    }
    if !pairs.is_empty() {
        issue(
            &mut issues,
            "TVAL_TABLE_INCOMPLETE",
            "/rules/payTables",
            "Every declared training period needs one amount.",
        );
    }
    let regions: Vec<_> = rows(first, "regions").iter().map(|r| s(r, "id")).collect();
    if regions.len() != 3
        || ["WEST_38_5", "EAST", "EAST_UNIVERSITY_HOSPITAL"]
            .iter()
            .any(|id| !regions.contains(id))
    {
        issue(
            &mut issues,
            "TVAL_REGIONS",
            "/rules/selection/variants/regions",
            "Require explicit supported training working-time regions.",
        );
    }
    if !valid_date(s(pkg, "validFrom"))
        || !pkg["validTo"].is_null() && !valid_date(s(pkg, "validTo"))
    {
        return issues;
    }
    let working = rows(r, "employmentWorkingTimeRules");
    let mut seen = BTreeSet::new();
    for row in working {
        check(
            rows(row, "sourceIds"),
            "/rules/employmentWorkingTimeRules/sourceIds",
            &mut issues,
        );
        if seen.contains(s(row, "id"))
            || row["variantId"] != "CARE"
            || !regions.contains(&s(row, "regionId"))
        {
            issue(
                &mut issues,
                "TVAL_WORKING_TIME_IDENTITY",
                "/rules/employmentWorkingTimeRules",
                "Duplicate or foreign working-time rule.",
            );
        }
        seen.insert(s(row, "id"));
    }
    for region in regions {
        let mut next = Some(s(pkg, "validFrom").to_owned());
        let mut selected: Vec<_> = working
            .iter()
            .filter(|row| s(row, "regionId") == region)
            .collect();
        selected.sort_by(|a, b| s(a, "validFrom").cmp(s(b, "validFrom")));
        let mut valid = !selected.is_empty();
        for row in selected {
            if !valid_date(s(row, "validFrom"))
                || !row["validTo"].is_null()
                    && (!valid_date(s(row, "validTo")) || s(row, "validTo") < s(row, "validFrom"))
            {
                valid = false;
                continue;
            }
            if next.as_deref() != Some(s(row, "validFrom")) {
                valid = false;
            }
            next = after(&row["validTo"]);
        }
        if !valid || next != after(&pkg["validTo"]) {
            issue(
                &mut issues,
                "TVAL_WORKING_TIME_COVERAGE",
                "/rules/employmentWorkingTimeRules",
                "Working time must cover every package day exactly once per region.",
            );
        }
    }
    issues
}
