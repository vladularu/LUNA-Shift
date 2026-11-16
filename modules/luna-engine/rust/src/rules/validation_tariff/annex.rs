//! Source-only TVöD Annex A and SuE contracts, including their disabled-execution gates.
use super::util::*;
use crate::rules::validation::ValidationIssue;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn parts(selector: &Value) -> Vec<&Value> {
    if let Some(parts) = selector.get("specialPartIds") {
        a(parts).iter().collect()
    } else {
        selector.get("specialPartId").into_iter().collect()
    }
}
pub(super) fn capabilities_unsupported(selection: &Value) -> bool {
    selection["capabilities"]
        .as_object()
        .is_none_or(|o| o.values().all(|v| v == "UNSUPPORTED"))
}
fn forbidden(rules: &Value, allowed: &[&str]) -> bool {
    rules
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
}
pub(super) fn valid_cents(v: &Value) -> bool {
    v.as_f64().is_some_and(|n| {
        n.is_finite() && n.fract() == 0.0 && n > 0.0 && n <= 9_007_199_254_740_991.0
    })
}
const ANNEX_GROUPS: &[&str] = &[
    "eg15", "eg14", "eg13", "eg12", "eg11", "eg10", "eg9c", "eg9b", "eg9a", "eg8", "eg7", "eg6",
    "eg5", "eg4", "eg3", "eg2", "eg1",
];
pub fn tvoed_annex_a_issues(pkg: &Value) -> Vec<ValidationIssue> {
    let mut out = vec![];
    let rules = &pkg["rules"];
    let selection = &rules["selection"];
    if n(pkg, "engineContractVersion") != 16.0 {
        if s(pkg, "packageId") == "tvoed-vka-anlage-a"
            || s(selection, "familyId") == "tvoed-vka-annex-a"
        {
            issue(
                &mut out,
                "TVOED_A_CONTRACT",
                "/engineContractVersion",
                "Anlage A requires contract 16.",
            );
        }
        return out;
    }
    let selector = &rules["selector"];
    let p = parts(selector);
    if s(pkg, "packageId") != "tvoed-vka-anlage-a"
        || s(selector, "agreementId") != "tvoed-vka"
        || p.len() != 2
        || !p.iter().any(|v| *v == "bt-k")
        || !p.iter().any(|v| *v == "bt-b")
        || s(selector, "payTableId") != "anlage-a"
        || s(selection, "familyId") != "tvoed-vka-annex-a"
        || s(selection, "engineId") != "tvoed-annex-a-v1"
        || s(selection, "employmentKind") != "EMPLOYEE"
    {
        issue(
            &mut out,
            "TVOED_A_IDENTITY",
            "/rules/selection",
            "Explicit VKA Anlage A identity required.",
        );
    }
    if a(&selection["variants"]).len() != 2
        || ["BT_K", "BT_B"].iter().any(|id| {
            let v = a(&selection["variants"]).iter().find(|v| s(v, "id") == *id);
            v.is_none_or(|v| {
                s(v, "specialPartId") != if *id == "BT_K" { "bt-k" } else { "bt-b" }
                    || a(&v["regions"]).len() != 1
                    || s(&v["regions"][0], "id") != "VKA"
                    || s(&v["regions"][0], "payTableId") != "anlage-a"
            })
        })
    {
        issue(
            &mut out,
            "TVOED_A_SELECTION",
            "/rules/selection/variants",
            "BT-K and BT-B must map to Anlage A.",
        );
    }
    if s(pkg, "status") != "DRAFT" || !capabilities_unsupported(selection) {
        issue(
            &mut out,
            "TVOED_A_NOT_EXECUTABLE",
            "/rules/selection/capabilities",
            "The source-only table must remain DRAFT with all capabilities unsupported.",
        );
    }
    if forbidden(
        rules,
        &[
            "selection",
            "selector",
            "payTables",
            "premiumRules",
            "allowanceRules",
            "combinationRules",
            "workPatternRules",
            "workPatternPolicy",
            "tvoedAnnexAOvertimePolicy",
            "tvoedAnnexATimePremiumPolicy",
        ],
    ) {
        issue(
            &mut out,
            "TVOED_A_FOREIGN_RULES",
            "/rules",
            "Unimplemented calculation rules are forbidden.",
        );
    }
    let tables = a(&rules["payTables"]);
    if tables.len() != 1 || s(&rules["payTables"][0], "id") != "anlage-a" {
        issue(
            &mut out,
            "TVOED_A_TABLE",
            "/rules/payTables",
            "Exactly one Anlage A table required.",
        );
        return out;
    }
    let variant_sources: Vec<&Value> = a(&selection["variants"])
        .iter()
        .flat_map(|v| a(&v["sourceIds"]))
        .collect();
    let known_sources = sources(pkg);
    let overtime = &rules["tvoedAnnexAOvertimePolicy"];
    let path = "/rules/tvoedAnnexAOvertimePolicy";
    if !truth(rules.get("tvoedAnnexAOvertimePolicy")) {
        issue(
            &mut out,
            "TVOED_A_OVERTIME_MISSING",
            path,
            "Dated § 7/§ 8 overtime facts are required while calculation remains disabled.",
        );
    } else {
        if overtime.get("validFrom") != pkg.get("validFrom")
            || overtime.get("validTo") != pkg.get("validTo")
            || a(&overtime["sourceIds"]).len() != 2
            || variant_sources.len() != 2
            || variant_sources
                .iter()
                .any(|id| !a(&overtime["sourceIds"]).contains(id))
            || a(&overtime["sourceIds"])
                .iter()
                .any(|id| !known_sources.contains(id.as_str().unwrap_or("")))
        {
            issue(
                &mut out,
                "TVOED_A_OVERTIME_SOURCE_RANGE",
                path,
                "Both variant sources and exact package validity are required.",
            );
        }
        if s(overtime, "premiumReferenceStepId") != "s3"
            || s(overtime, "workPayMaximumStepId") != "s4"
            || n(overtime, "monthlyFactorThousandths") != 4348.0
            || n(overtime, "standardFullTimeWeeklyMinutes") != 2340.0
            || overtime["requiresConfirmedClassification"] != true
            || overtime["requiresSeparateSettlement"] != true
        {
            issue(
                &mut out,
                "TVOED_A_OVERTIME_VALUE",
                path,
                "Overtime stage basis, weekly hours or safeguards changed.",
            );
        }
        let mut expected: BTreeMap<&str, f64> = ANNEX_GROUPS
            .iter()
            .map(|g| {
                (
                    *g,
                    if ["eg9c", "eg10", "eg11", "eg12", "eg13", "eg14", "eg15"].contains(g) {
                        1500.0
                    } else {
                        3000.0
                    },
                )
            })
            .collect();
        for band in a(&overtime["rateBands"]) {
            for group in a(&band["groupIds"]) {
                let group = group.as_str().unwrap_or("");
                if expected.remove(group) != Some(n(band, "premiumBasisPoints")) {
                    issue(
                        &mut out,
                        "TVOED_A_OVERTIME_RATE",
                        format!("{path}/rateBands"),
                        format!("Incorrect or repeated group {group}."),
                    );
                }
            }
        }
        if !expected.is_empty() {
            issue(
                &mut out,
                "TVOED_A_OVERTIME_RATE",
                format!("{path}/rateBands"),
                "All EG rate groups must be covered once.",
            );
        }
    }
    let premium = &rules["tvoedAnnexATimePremiumPolicy"];
    let path = "/rules/tvoedAnnexATimePremiumPolicy";
    if !truth(rules.get("tvoedAnnexATimePremiumPolicy")) {
        issue(
            &mut out,
            "TVOED_A_PREMIUM_MISSING",
            path,
            "Dated § 8 facts are required even while calculation remains disabled.",
        );
    } else {
        if premium.get("validFrom") != pkg.get("validFrom")
            || premium.get("validTo") != pkg.get("validTo")
            || a(&premium["sourceIds"]).len() != 2
            || variant_sources.len() != 2
            || variant_sources
                .iter()
                .any(|id| !a(&premium["sourceIds"]).contains(id))
            || a(&premium["sourceIds"])
                .iter()
                .any(|id| !known_sources.contains(id.as_str().unwrap_or("")))
        {
            issue(
                &mut out,
                "TVOED_A_PREMIUM_SOURCE_RANGE",
                path,
                "Premium facts require both sourced variants and exact package validity.",
            );
        }
        if s(premium, "referenceStepId") != "s3"
            || n(premium, "monthlyFactorThousandths") != 4348.0
            || n(premium, "standardFullTimeWeeklyMinutes") != 2340.0
            || n(&premium["nightWindow"], "startMinute") != 1260.0
            || n(&premium["nightWindow"], "endMinute") != 360.0
            || n(premium, "nightBasisPoints") != 2000.0
            || n(premium, "sundayBasisPoints") != 2500.0
            || n(premium, "holidayWithTimeOffBasisPoints") != 3500.0
            || n(premium, "holidayWithoutTimeOffBasisPoints") != 13500.0
            || n(&premium["preHolidayWindow"], "startMinute") != 360.0
            || n(&premium["preHolidayWindow"], "endMinute") != 0.0
            || a(&premium["preHolidayMonthDays"]).len() != 2
            || !a(&premium["preHolidayMonthDays"]).contains(&Value::from("12-24"))
            || !a(&premium["preHolidayMonthDays"]).contains(&Value::from("12-31"))
            || n(premium, "preHolidayBasisPoints") != 3500.0
            || n(&premium["saturdayWindow"], "startMinute") != 780.0
            || n(&premium["saturdayWindow"], "endMinute") != 1260.0
            || n(premium, "saturdayBasisPoints") != 2000.0
            || premium["saturdayShiftLegacyAngestellteOnly"] != true
            || s(premium, "competition") != "HIGHEST_SUNDAY_HOLIDAY_PREHOLIDAY_SATURDAY"
            || premium["nightStacks"] != true
            || n(premium, "holidayWithoutTimeOffMaximumTotalBasisPoints") != 23500.0
            || premium["localAgreementMayIncrease"] != true
        {
            issue(
                &mut out,
                "TVOED_A_PREMIUM_VALUE",
                path,
                "§ 8/BT-K/BT-B rates, windows or exception changed.",
            );
        }
    }
    let mut expected: BTreeSet<String> = ANNEX_GROUPS
        .iter()
        .flat_map(|g| {
            (1..=6)
                .filter(|step| *g != "eg1" || *step != 1)
                .map(move |step| format!("{g}:s{step}"))
        })
        .collect();
    for entry in a(&tables[0]["entries"]) {
        if !expected.remove(&format!("{}:{}", s(entry, "groupId"), s(entry, "stepId")))
            || !valid_cents(&entry["monthlyCents"])
        {
            issue(
                &mut out,
                "TVOED_A_TABLE_ENTRY",
                "/rules/payTables/0/entries",
                "Invalid or duplicate EG/stage/value.",
            );
        }
    }
    if !expected.is_empty() {
        issue(
            &mut out,
            "TVOED_A_TABLE_INCOMPLETE",
            "/rules/payTables/0/entries",
            "All 101 printed amounts are required; EG 1 has no stage 1.",
        );
    }
    out
}

const SUE_GROUPS: &[&str] = &[
    "s18", "s17", "s16", "s15", "s14", "s13", "s12", "s11b", "s11a", "s9", "s8b", "s8a", "s7",
    "s4", "s3", "s2",
];
const SUE_SOURCE: &str = "vka-tvoed-sue-bt-b-2025-2026";
pub fn tvoed_sue_issues(pkg: &Value) -> Vec<ValidationIssue> {
    let rules = &pkg["rules"];
    let selection = &rules["selection"];
    let mut out = vec![];
    if n(pkg, "engineContractVersion") != 18.0
        && s(pkg, "packageId") != "tvoed-vka-sue-bt-b"
        && s(selection, "familyId") != "tvoed-vka-sue"
    {
        return out;
    }
    if n(pkg, "engineContractVersion") != 18.0 {
        issue(
            &mut out,
            "TVOED_SUE_CONTRACT",
            "/engineContractVersion",
            "SuE BT-B source tables require contract 18.",
        );
        return out;
    }
    let selector = &rules["selector"];
    let p = parts(selector);
    let variant = &selection["variants"][0];
    let region = &variant["regions"][0];
    if s(pkg, "packageId") != "tvoed-vka-sue-bt-b"
        || s(selector, "agreementId") != "tvoed-vka"
        || p.len() != 1
        || p[0] != "bt-b"
        || s(selector, "payTableId") != "anlage-c"
        || s(selection, "familyId") != "tvoed-vka-sue"
        || s(selection, "engineId") != "tvoed-sue-bt-b-table-draft-v1"
        || s(selection, "employmentKind") != "EMPLOYEE"
        || a(&selection["variants"]).len() != 1
        || s(variant, "id") != "BT_B"
        || s(variant, "specialPartId") != "bt-b"
        || a(&variant["sourceIds"]).len() != 1
        || variant["sourceIds"][0] != SUE_SOURCE
        || a(&variant["regions"]).len() != 1
        || s(region, "id") != "VKA"
        || s(region, "payTableId") != "anlage-c"
        || a(&region["sourceIds"]).len() != 1
        || region["sourceIds"][0] != SUE_SOURCE
    {
        issue(
            &mut out,
            "TVOED_SUE_IDENTITY",
            "/rules/selection",
            "Explicit BT-B Anlage C identity required.",
        );
    }
    if s(pkg, "status") != "DRAFT"
        || s(&pkg["review"], "status") != "DRAFT"
        || !truth(rules.get("selection"))
        || !capabilities_unsupported(selection)
    {
        issue(
            &mut out,
            "TVOED_SUE_NOT_ACTIVATABLE",
            "/rules/selection/capabilities",
            "The SuE source table must remain DRAFT with all capabilities unsupported.",
        );
    }
    if forbidden(
        rules,
        &[
            "selection",
            "selector",
            "payTables",
            "premiumRules",
            "allowanceRules",
            "tvoedSueAllowancePolicy",
            "combinationRules",
            "workPatternRules",
            "workPatternPolicy",
        ],
    ) {
        issue(
            &mut out,
            "TVOED_SUE_FOREIGN_RULES",
            "/rules",
            "Unimplemented calculation rules are forbidden.",
        );
    }
    let allowance = &rules["tvoedSueAllowancePolicy"];
    let expected_bands: &[(&[&str], f64, Option<&str>)] = &[
        (
            &["s2", "s3", "s4", "s7", "s8a", "s8b", "s9", "s11a"],
            13000.0,
            None,
        ),
        (&["s11b", "s12", "s14"], 18000.0, None),
        (&["s15"], 18000.0, Some("6")),
    ];
    if !truth(rules.get("tvoedSueAllowancePolicy"))
        || allowance["partTimeProRata"] != true
        || allowance["conversionDaysRequireSeparateCalculation"] != true
        || a(&allowance["sourceIds"]).len() != 1
        || allowance["sourceIds"][0] != SUE_SOURCE
        || a(&allowance["bands"]).len() != expected_bands.len()
        || expected_bands
            .iter()
            .enumerate()
            .any(|(i, (groups, cents, case_group))| {
                let band = &allowance["bands"][i];
                n(band, "monthlyCents") != *cents
                    || match case_group {
                        Some(g) => band["caseGroup"] != *g,
                        None => band.get("caseGroup") != Some(&Value::Null),
                    }
                    || a(&band["groupIds"]).len() != groups.len()
                    || groups
                        .iter()
                        .any(|g| !a(&band["groupIds"]).iter().any(|v| v == g))
            })
    {
        issue(
            &mut out,
            "TVOED_SUE_ALLOWANCE_POLICY",
            "/rules/tvoedSueAllowancePolicy",
            "§ 52(6) BT-B requires exact group, case-group, amount and source mapping.",
        );
    }
    if !sources(pkg).contains(SUE_SOURCE)
        || a(&rules["payTables"]).len() != 1
        || s(&rules["payTables"][0], "id") != "anlage-c"
        || a(&rules["payTables"][0]["sourceIds"]).len() != 1
        || rules["payTables"][0]["sourceIds"][0] != SUE_SOURCE
    {
        issue(
            &mut out,
            "TVOED_SUE_TABLE",
            "/rules/payTables",
            "One source-linked Anlage C table required.",
        );
        return out;
    }
    let entries = a(&rules["payTables"][0]["entries"]);
    if entries.len() != 96 {
        issue(
            &mut out,
            "TVOED_SUE_CELL_COUNT",
            "/rules/payTables/0/entries",
            "Exactly 96 cells required.",
        );
    }
    let mut seen = BTreeSet::new();
    for (i, e) in entries.iter().enumerate() {
        let cell = format!("{}/{}", s(e, "groupId"), s(e, "stepId"));
        if !SUE_GROUPS.contains(&s(e, "groupId"))
            || !["s1", "s2", "s3", "s4", "s5", "s6"].contains(&s(e, "stepId"))
            || seen.contains(&cell)
            || !valid_cents(&e["monthlyCents"])
        {
            issue(
                &mut out,
                "TVOED_SUE_CELL",
                format!("/rules/payTables/0/entries/{i}"),
                format!("Invalid or repeated cell {cell}."),
            );
        }
        seen.insert(cell);
    }
    for group in SUE_GROUPS {
        for step in 1..=6 {
            let cell = format!("{group}/s{step}");
            if !seen.contains(&cell) {
                issue(
                    &mut out,
                    "TVOED_SUE_MISSING_CELL",
                    "/rules/payTables/0/entries",
                    format!("Missing {cell}."),
                );
            }
        }
    }
    out
}
