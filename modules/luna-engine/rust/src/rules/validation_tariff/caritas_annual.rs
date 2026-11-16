//! Optional sourced Caritas §16 metadata; calculation readiness stays separately guarded.
use super::{annex::capabilities_unsupported, util::*};
use crate::rules::validation::ValidationIssue;
use serde_json::Value;
use std::collections::BTreeSet;
pub const CARE_GROUPS: &[&str] = &[
    "p4", "p6", "p7", "p8", "p9", "p10", "p11", "p12", "p13", "p14", "p15", "p16",
];
pub fn caritas_annual_payment_issues(pkg: &Value) -> Vec<ValidationIssue> {
    let mut out = vec![];
    let root = "/rules/caritasAnnualPaymentRules";
    let Some(rules) = pkg["rules"].get("caritasAnnualPaymentRules") else {
        return out;
    };
    let selection = &pkg["rules"]["selection"];
    if n(pkg, "engineContractVersion") != 14.0
        || s(pkg, "status") != "DRAFT"
        || s(selection, "familyId") != "avr-caritas-p"
        || s(selection, "engineId") != "avr-caritas-p-v1"
        || !capabilities_unsupported(selection)
    {
        issue(
            &mut out,
            "CARITAS_ANNUAL_CONTRACT",
            root,
            "Caritas annual rules require unsupported DRAFT contract 14.",
        );
        return out;
    }
    let known = sources(pkg);
    let mut ids = BTreeSet::new();
    for (i, rule) in a(rules).iter().enumerate() {
        let path = format!("{root}/{i}");
        if !ids.insert(s(rule, "id")) {
            issue(
                &mut out,
                "CARITAS_ANNUAL_ID",
                format!("{path}/id"),
                "Annual rule IDs must be unique.",
            );
        }
        let variant = a(&selection["variants"])
            .iter()
            .find(|v| v.get("id") == rule.get("variantId"));
        let territory = variant.and_then(|v| {
            a(&v["regions"])
                .iter()
                .find(|v| v.get("id") == rule.get("regionId"))
        });
        if territory.is_none() || !["ANLAGE_31", "ANLAGE_32"].contains(&s(rule, "variantId")) {
            issue(
                &mut out,
                "CARITAS_ANNUAL_SELECTION",
                &path,
                "Annual rules must reference a declared care annex and territory.",
            );
            continue;
        }
        let territory = territory.unwrap();
        let year = n(rule, "entitlementYear").to_string();
        let date = format!("{year}-09-01");
        if date.as_str() < s(pkg, "validFrom")
            || (pkg["validTo"] != Value::Null && date.as_str() > s(pkg, "validTo"))
        {
            issue(
                &mut out,
                "CARITAS_ANNUAL_YEAR",
                format!("{path}/entitlementYear"),
                "September 1 must fall within the package validity.",
            );
        }
        if a(&rule["payGroups"]).iter().any(|g| {
            let g = g.as_str().unwrap_or("");
            !CARE_GROUPS.contains(&g)
                || n(rule, "rateBasisPoints")
                    != if ["p4", "p6", "p7", "p8"].contains(&g) {
                        8600.0
                    } else {
                        7600.0
                    }
        }) {
            issue(
                &mut out,
                "CARITAS_ANNUAL_RATE",
                &path,
                "P4/P6/P7/P8 use 86%; P9-P16 use 76%, including P16 mapped to EG12.",
            );
        }
        if a(&rule["referenceMonths"])
            .iter()
            .enumerate()
            .any(|(i, m)| m.as_f64() != [7.0, 8.0, 9.0].get(i).copied())
        {
            issue(
                &mut out,
                "CARITAS_ANNUAL_REFERENCE_MONTHS",
                format!("{path}/referenceMonths"),
                "The ordinary reference months are July, August, September in that order.",
            );
        }
        if s(rule, "eligibilityPolicy")
            != if s(rule, "variantId") == "ANLAGE_31" {
                "ANLAGE_31_SECTION_16_1_AND_6"
            } else {
                "ANLAGE_32_SECTION_16_1"
            }
        {
            issue(
                &mut out,
                "CARITAS_ANNUAL_ELIGIBILITY",
                format!("{path}/eligibilityPolicy"),
                "The annex-specific eligibility policy must be explicit.",
            );
        }
        let east = s(rule, "regionId") == "OST_TARIF_OST" && n(rule, "entitlementYear") == 2025.0;
        let expected_region = if east {
            "OST_TARIF_WEST_HAMBURG"
        } else {
            s(rule, "regionId")
        };
        let expected_policy = if east {
            "RK_OST_WEST_TABLE_2025"
        } else {
            "SELECTED_TERRITORY"
        };
        let basis = variant.and_then(|v| {
            a(&v["regions"])
                .iter()
                .find(|r| r.get("id") == rule.get("basisRegionId"))
        });
        if s(rule, "basisRegionId") != expected_region
            || s(rule, "basisTablePolicy") != expected_policy
            || basis.and_then(|b| b.get("payTableId")).is_none()
            || !a(&pkg["rules"]["payTables"])
                .iter()
                .any(|t| t.get("id") == basis.and_then(|b| b.get("payTableId")))
        {
            issue(
                &mut out,
                "CARITAS_ANNUAL_BASIS",
                &path,
                "The selected year and territory require an explicit, mapped annual table basis.",
            );
        }
        let mut required = vec![format!("caritas-avr-jsz-{year}")];
        required.extend(
            a(&territory["sourceIds"])
                .iter()
                .map(|id| id.as_str().unwrap_or("").to_owned()),
        );
        if s(pkg, "packageId") == "avr-caritas-p-ost" && n(rule, "entitlementYear") == 2026.0 {
            required.push("caritas-bk-2025-03-jsz-ost".into());
        }
        if a(&rule["sourceIds"])
            .iter()
            .any(|id| !known.contains(id.as_str().unwrap_or("")))
            || required
                .iter()
                .any(|id| !a(&rule["sourceIds"]).iter().any(|v| v == id))
        {
            issue(
                &mut out,
                "CARITAS_ANNUAL_SOURCE",
                format!("{path}/sourceIds"),
                "Known annual norm, regional sources and the applicable Ost repeal source are required.",
            );
        }
    }
    for year in [2025, 2026] {
        let date = format!("{year}-09-01");
        if date.as_str() < s(pkg, "validFrom")
            || (pkg["validTo"] != Value::Null && date.as_str() > s(pkg, "validTo"))
        {
            continue;
        }
        for variant in a(&selection["variants"]) {
            for territory in a(&variant["regions"]) {
                for group in CARE_GROUPS {
                    let matches = a(rules)
                        .iter()
                        .filter(|r| {
                            n(r, "entitlementYear") == f64::from(year)
                                && r.get("variantId") == variant.get("id")
                                && r.get("regionId") == territory.get("id")
                                && a(&r["payGroups"]).iter().any(|g| g == group)
                        })
                        .count();
                    if matches != 1 {
                        issue(
                            &mut out,
                            "CARITAS_ANNUAL_COVERAGE",
                            root,
                            format!(
                                "Exactly one annual rule is required for {year}/{}/{}/{group}.",
                                s(variant, "id"),
                                s(territory, "id")
                            ),
                        );
                    }
                }
            }
        }
    }
    out
}
