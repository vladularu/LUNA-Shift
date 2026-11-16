use super::{
    TariffValidationPackage, ValidationIssue, has, issue, rows, source_issues, sources, text,
};
use crate::rules::RulePackage;
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeSet;

pub fn tariff_selection_issues(pkg: &impl TariffValidationPackage) -> Vec<ValidationIssue> {
    let rules = pkg.rules();
    let selection = rules.get("selection");
    let version = pkg.engine_contract_version();
    let mut issues = vec![];
    let root = "/rules/selection";
    if ![8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].contains(&version) {
        if selection.is_some() {
            issue(
                &mut issues,
                "UNSUPPORTED_TARIFF_SELECTION",
                root,
                "Selection metadata requires tariff contract 8, 10, 11, 12, 13, 14, 15, 16, 17, 18 or 19.",
            );
        }
        return issues;
    }
    let Some(s) = selection.filter(|s| s.is_object()) else {
        issue(
            &mut issues,
            "MISSING_TARIFF_SELECTION",
            root,
            "Tariff contracts 8, 10, 11, 12, 13, 14, 15, 16, 17 and 18 require selection metadata.",
        );
        return issues;
    };
    let apprentice = s["employmentKind"] == "APPRENTICE";
    let supported_variants = || {
        rows(s, "variants").len() == 2
            && rows(s, "variants").iter().all(|v| {
                matches!(
                    (text(v, "id"), text(v, "specialPartId")),
                    (Some("BT_K"), Some("bt-k")) | (Some("BT_B"), Some("bt-b"))
                ) && rows(v, "regions").len() == 2
                    && ["OTHER", "KAV_BW"]
                        .iter()
                        .all(|id| rows(v, "regions").iter().any(|r| r["id"] == *id))
                    && rows(v, "regions").iter().all(|r| {
                        r.get("payTableId")
                            .is_none_or(|id| id == &rules["selector"]["payTableId"])
                    })
            })
    };
    if (version == 10 || version == 11 && apprentice)
        && !(pkg.package_id() == "tvaoed-pflege-vka"
            && s["familyId"] == "tvaoed-pflege"
            && s["engineId"] == "tvaoed-pflege-v1"
            && apprentice
            && rules["selector"]["agreementId"] == "tvaoed-vka"
            && rows(rules, "payTables").len() == 1
            && supported_variants()
            && s["capabilities"]["basePay"] == "SUPPORTED"
            && s["capabilities"]["annualPayment"]
                == if version == 11 {
                    "SUPPORTED"
                } else {
                    "UNSUPPORTED"
                })
    {
        issue(
            &mut issues,
            "UNSUPPORTED_TARIFF_SELECTION",
            root,
            "Training contracts 10 and 11 require explicit TVAÃ¶D-Pflege VKA BT-K/BT-B identity and capabilities.",
        );
    }
    if (version == 11 && !apprentice || version == 19)
        && !(pkg.package_id() == "tvoed-vka-bt-k"
            && s["familyId"] == "tvoed-p"
            && s["engineId"] == "tvoed-p-v3"
            && s["employmentKind"] == "EMPLOYEE"
            && rules["selector"]["agreementId"] == "tvoed-vka"
            && rows(rules, "payTables").len() == 1
            && supported_variants()
            && s["capabilities"]
                .as_object()
                .is_some_and(|c| c.values().all(|v| v == "SUPPORTED")))
    {
        issue(
            &mut issues,
            "UNSUPPORTED_TARIFF_SELECTION",
            root,
            "This app supports contract 11 only for TVÃ¶D-VKA BT-K/BT-B employees with one pay table.",
        );
    }
    let known = sources(pkg);
    let selector = &rules["selector"];
    let owned;
    let parts = if selector.get("specialPartIds").is_some() {
        rows(selector, "specialPartIds")
    } else {
        owned = vec![selector["specialPartId"].clone()];
        &owned
    };
    let mut variants = BTreeSet::new();
    for (index, variant) in rows(s, "variants").iter().enumerate() {
        let path = format!("{root}/variants/{index}");
        if !variants.insert(text(variant, "id")) {
            issue(
                &mut issues,
                "DUPLICATE_SELECTION_VARIANT",
                &(path.clone() + "/id"),
                "Variant identifiers must be unique.",
            );
        }
        if !text(variant, "specialPartId").is_some_and(|p| has(parts, p)) {
            issue(
                &mut issues,
                "UNKNOWN_SELECTION_SPECIAL_PART",
                &(path.clone() + "/specialPartId"),
                "The variant must reference a declared special part.",
            );
        }
        source_issues(
            &mut issues,
            rows(variant, "sourceIds"),
            &known,
            &(path.clone() + "/sourceIds"),
        );
        let mut regions = BTreeSet::new();
        for (index, region) in rows(variant, "regions").iter().enumerate() {
            let path = format!("{path}/regions/{index}");
            if !regions.insert(text(region, "id")) {
                issue(
                    &mut issues,
                    "DUPLICATE_SELECTION_REGION",
                    &(path.clone() + "/id"),
                    "Region identifiers must be unique within their variant.",
                );
            }
            source_issues(
                &mut issues,
                rows(region, "sourceIds"),
                &known,
                &(path.clone() + "/sourceIds"),
            );
            if region.get("payTableId").is_some_and(|id| {
                rows(rules, "payTables")
                    .iter()
                    .filter(|t| &t["id"] == id)
                    .count()
                    != 1
            }) {
                issue(
                    &mut issues,
                    "UNKNOWN_SELECTION_PAY_TABLE",
                    &(path + "/payTableId"),
                    "The region must reference exactly one declared pay table.",
                );
            }
        }
    }
    issues
}
#[derive(Debug, Serialize)]
pub struct SelectedGroup {
    pub id: String,
    pub levels: Vec<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedSelection<'a> {
    pub package_id: &'a str,
    pub version_id: &'a str,
    pub label: Option<&'a str>,
    pub valid_from: &'a str,
    pub valid_to: Option<&'a str>,
    pub family_id: &'a str,
    pub engine_id: &'a str,
    pub employment_kind: &'a str,
    pub variant: &'a Value,
    pub region: &'a Value,
    pub capabilities: &'a Value,
    pub groups: Vec<SelectedGroup>,
}
pub fn resolve_tariff_selection<'a>(
    pkg: &'a RulePackage,
    variant: &str,
    region: &str,
) -> Option<ResolvedSelection<'a>> {
    if !tariff_selection_issues(pkg).is_empty() {
        return None;
    }
    let rules = pkg.rules();
    let s = rules.get("selection")?;
    let variant = rows(s, "variants").iter().find(|v| v["id"] == variant)?;
    let region = rows(variant, "regions")
        .iter()
        .find(|r| r["id"] == region)?;
    let id = region
        .get("payTableId")
        .filter(|v| !v.is_null())
        .unwrap_or(&rules["selector"]["payTableId"]);
    let tables: Vec<_> = rows(rules, "payTables")
        .iter()
        .filter(|t| &t["id"] == id)
        .collect();
    if tables.len() != 1 {
        return None;
    }
    let mut groups: Vec<SelectedGroup> = vec![];
    for e in rows(tables[0], "entries") {
        let id = text(e, "groupId")?;
        let level = text(e, "stepId")?;
        if let Some(g) = groups.iter_mut().find(|g| g.id == id) {
            if g.levels.iter().any(|l| l == level) {
                return None;
            }
            g.levels.push(level.into());
        } else {
            groups.push(SelectedGroup {
                id: id.into(),
                levels: vec![level.into()],
            });
        }
    }
    Some(ResolvedSelection {
        package_id: &pkg.package_id,
        version_id: &pkg.version_id,
        label: pkg.label(),
        valid_from: &pkg.valid_from,
        valid_to: pkg.valid_to.as_deref(),
        family_id: text(s, "familyId")?,
        engine_id: text(s, "engineId")?,
        employment_kind: text(s, "employmentKind")?,
        variant,
        region,
        capabilities: s.get("capabilities")?,
        groups,
    })
}
