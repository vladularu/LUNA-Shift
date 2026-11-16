//! Exact source-table guards for the distinct DRK employee and apprentice drafts.
use super::{
    annex::{capabilities_unsupported, parts, valid_cents},
    util::*,
};
use crate::rules::validation::ValidationIssue;
use serde_json::Value;
use std::collections::BTreeSet;
struct Spec {
    annex: &'static str,
    table: &'static str,
    variant: &'static str,
    engine: &'static str,
    prefix: &'static str,
    groups: Vec<String>,
    without_one: BTreeSet<String>,
    cells: usize,
}
fn spec(id: &str) -> Option<Spec> {
    let (annex, table, variant, engine, prefix, groups, without_one, cells) = match id {
        "drk-rtv-e" => (
            "anlage-a1",
            "anlage-a1-e",
            "ANLAGE_A1",
            "drk-rtv-e-v1",
            "DRK_E",
            [
                "e15", "e14", "e13", "e12", "e11", "e10", "e9", "e9a", "e9b", "e9c", "e8", "e7",
                "e7a", "e6", "e6a", "e6b", "e5", "e4", "e3", "e2", "e1",
            ]
            .iter()
            .map(|s| s.to_string())
            .collect(),
            BTreeSet::from(["e1".into()]),
            125,
        ),
        "drk-rtv-p" => (
            "anlage-a2",
            "anlage-a2-p",
            "ANLAGE_A2",
            "drk-rtv-p-v1",
            "DRK_P",
            (5..=16).rev().map(|n| format!("p{n}")).collect(),
            (7..=16).map(|n| format!("p{n}")).collect(),
            62,
        ),
        "drk-rtv-s" => (
            "anlage-a3",
            "anlage-a3-s",
            "ANLAGE_A3",
            "drk-rtv-s-v1",
            "DRK_S",
            [
                "s18", "s17", "s16", "s15", "s14", "s13", "s12", "s11b", "s11a", "s9", "s8b",
                "s8a", "s7", "s4", "s3", "s2",
            ]
            .iter()
            .map(|s| s.to_string())
            .collect(),
            BTreeSet::new(),
            96,
        ),
        _ => return None,
    };
    Some(Spec {
        annex,
        table,
        variant,
        engine,
        prefix,
        groups,
        without_one,
        cells,
    })
}
fn executable_claim(pkg: &Value, selection: &Value) -> bool {
    s(pkg, "status") != "DRAFT"
        || s(&pkg["review"], "status") != "DRAFT"
        || pkg["rules"].get("selection").is_none()
        || !capabilities_unsupported(selection)
        || [
            "premiumRules",
            "allowanceRules",
            "combinationRules",
            "workPatternRules",
        ]
        .iter()
        .any(|k| !a(&pkg["rules"][k]).is_empty())
}
pub fn drk_table_issues(pkg: &Value) -> Vec<ValidationIssue> {
    let mut out = vec![];
    if s(pkg, "packageId") == "drk-rtv-training" {
        return out;
    }
    let rules = &pkg["rules"];
    let selection = &rules["selection"];
    if n(pkg, "engineContractVersion") != 17.0
        && !s(pkg, "packageId").starts_with("drk-rtv-")
        && s(selection, "familyId") != "drk-rtv"
    {
        return out;
    }
    if n(pkg, "engineContractVersion") != 17.0 {
        issue(
            &mut out,
            "DRK_CONTRACT",
            "/engineContractVersion",
            "DRK source tables require contract 17.",
        );
        return out;
    }
    let Some(spec) = spec(s(pkg, "packageId")) else {
        issue(
            &mut out,
            "DRK_IDENTITY",
            "/packageId",
            "Unknown DRK table family under contract 17.",
        );
        return out;
    };
    let selector = &rules["selector"];
    let parts = parts(selector);
    let variant = &selection["variants"][0];
    let region = &variant["regions"][0];
    if s(selector, "agreementId") != "drk-rtv"
        || parts.len() != 1
        || parts[0] != spec.annex
        || s(selector, "payTableId") != spec.table
        || s(selection, "familyId") != "drk-rtv"
        || s(selection, "engineId") != spec.engine
        || s(selection, "employmentKind") != "EMPLOYEE"
        || a(&selection["variants"]).len() != 1
        || s(variant, "id") != spec.variant
        || s(variant, "specialPartId") != spec.annex
        || a(&variant["regions"]).len() != 1
        || s(region, "id") != "BTG"
        || s(region, "payTableId") != spec.table
    {
        issue(
            &mut out,
            &format!("{}_IDENTITY", spec.prefix),
            "/rules/selection",
            "Explicit DRK annex identity required.",
        );
    }
    if executable_claim(pkg, selection) {
        issue(
            &mut out,
            &format!("{}_NOT_ACTIVATABLE", spec.prefix),
            "/rules/selection/capabilities",
            "A DRK table draft cannot claim any executable tariff capability.",
        );
    }
    if a(&rules["payTables"]).len() != 1 || s(&rules["payTables"][0], "id") != spec.table {
        issue(
            &mut out,
            &format!("{}_TABLE", spec.prefix),
            "/rules/payTables",
            "Exactly one DRK annex table is required.",
        );
        return out;
    }
    let entries = a(&rules["payTables"][0]["entries"]);
    if entries.len() != spec.cells {
        issue(
            &mut out,
            &format!("{}_CELL_COUNT", spec.prefix),
            "/rules/payTables/0/entries",
            format!("Expected {} cells.", spec.cells),
        );
    }
    for group in &spec.groups {
        let actual: Vec<&str> = entries
            .iter()
            .filter(|e| s(e, "groupId") == group)
            .map(|e| s(e, "stepId"))
            .collect();
        let first = if spec.without_one.contains(group) {
            2
        } else {
            1
        };
        let expected: Vec<String> = (first..=6).map(|n| format!("s{n}")).collect();
        if actual.len() != expected.len()
            || actual.iter().collect::<BTreeSet<_>>().len() != expected.len()
            || expected.iter().any(|e| !actual.contains(&e.as_str()))
        {
            issue(
                &mut out,
                &format!("{}_STAGES", spec.prefix),
                "/rules/payTables/0/entries",
                format!("Invalid stages for {group}: {}.", actual.join(",")),
            );
        }
    }
    for (i, e) in entries.iter().enumerate() {
        if !spec.groups.iter().any(|g| g == s(e, "groupId")) || !valid_cents(&e["monthlyCents"]) {
            issue(
                &mut out,
                &format!("{}_CELL", spec.prefix),
                format!("/rules/payTables/0/entries/{i}"),
                "Unexpected DRK group or invalid monthly amount.",
            );
        }
    }
    out
}
pub fn drk_training_table_issues(pkg: &Value) -> Vec<ValidationIssue> {
    let mut out = vec![];
    if s(pkg, "packageId") != "drk-rtv-training" {
        return out;
    }
    let rules = &pkg["rules"];
    let selection = &rules["selection"];
    let selector = &rules["selector"];
    let p = parts(selector);
    if n(pkg, "engineContractVersion") != 17.0 {
        issue(
            &mut out,
            "DRK_TRAINING_CONTRACT",
            "/engineContractVersion",
            "DRK training drafts require contract 17.",
        );
    }
    let valid_to = match s(pkg, "validFrom") {
        "2024-06-01" => Some(Value::from("2025-08-31")),
        "2025-09-01" => Some(Value::from("2026-09-30")),
        "2026-10-01" => Some(Value::Null),
        _ => None,
    };
    if valid_to.is_none() || valid_to.as_ref() != pkg.get("validTo") {
        issue(
            &mut out,
            "DRK_TRAINING_PERIOD",
            "/validFrom",
            "Unknown DRK training table period.",
        );
    }
    let variants = [
        ("ANLAGE_3", "anlage-3"),
        ("ANLAGE_3A_A", "anlage-3a"),
        ("ANLAGE_3A_B", "anlage-3a"),
    ];
    if s(selector, "agreementId") != "drk-rtv"
        || p.len() != 2
        || !p.iter().any(|v| *v == "anlage-3")
        || !p.iter().any(|v| *v == "anlage-3a")
        || s(selector, "payTableId") != "training"
        || s(selection, "familyId") != "drk-rtv"
        || s(selection, "engineId") != "drk-rtv-training-v1"
        || s(selection, "employmentKind") != "APPRENTICE"
        || a(&selection["variants"]).len() != 3
        || variants.iter().any(|(id, part)| {
            a(&selection["variants"])
                .iter()
                .find(|v| s(v, "id") == *id)
                .is_none_or(|v| {
                    s(v, "specialPartId") != *part
                        || a(&v["regions"]).len() != 1
                        || s(&v["regions"][0], "id") != "BTG"
                        || s(&v["regions"][0], "payTableId") != "training"
                })
        })
    {
        issue(
            &mut out,
            "DRK_TRAINING_IDENTITY",
            "/rules/selection",
            "Explicit Anlage 3/3a category selection required.",
        );
    }
    if executable_claim(pkg, selection) || rules.get("trainingPay").is_some() {
        issue(
            &mut out,
            "DRK_TRAINING_NOT_ACTIVATABLE",
            "/rules/selection/capabilities",
            "Training source tables cannot claim an executable pay rule.",
        );
    }
    if a(&rules["payTables"]).len() != 1 || s(&rules["payTables"][0], "id") != "training" {
        issue(
            &mut out,
            "DRK_TRAINING_TABLE",
            "/rules/payTables",
            "Exactly one training table is required.",
        );
        return out;
    }
    let entries = a(&rules["payTables"][0]["entries"]);
    if entries.len() != 8 {
        issue(
            &mut out,
            "DRK_TRAINING_CELL_COUNT",
            "/rules/payTables/0/entries",
            "Expected eight monthly amounts.",
        );
    }
    let stages = [
        ("anlage-3-general", 4),
        ("anlage-3a-a", 3),
        ("anlage-3a-b", 1),
    ];
    for (group, count) in stages {
        let actual: Vec<&str> = entries
            .iter()
            .filter(|e| s(e, "groupId") == group)
            .map(|e| s(e, "stepId"))
            .collect();
        if actual.len() != count
            || actual.iter().collect::<BTreeSet<_>>().len() != count
            || (1..=count).any(|n| !actual.contains(&format!("s{n}").as_str()))
        {
            issue(
                &mut out,
                "DRK_TRAINING_STAGES",
                "/rules/payTables/0/entries",
                format!("Invalid years for {group}."),
            );
        }
    }
    for (i, e) in entries.iter().enumerate() {
        if !stages.iter().any(|(g, _)| *g == s(e, "groupId")) || !valid_cents(&e["monthlyCents"]) {
            issue(
                &mut out,
                "DRK_TRAINING_CELL",
                format!("/rules/payTables/0/entries/{i}"),
                "Unknown training category or invalid monthly amount.",
            );
        }
    }
    out
}
