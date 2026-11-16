//! The two source Caritas validators intentionally retain their separate diagnostics.
mod policy;
mod rates;
mod working;
use super::{
    annex::{capabilities_unsupported, parts},
    util::*,
};
use crate::rules::validation::ValidationIssue;
use serde_json::Value;
use std::collections::BTreeSet;
#[derive(Clone, Copy, PartialEq)]
pub(super) enum Mode {
    Table,
    Care,
}
impl Mode {
    fn care(self) -> bool {
        self == Self::Care
    }
}
const ALLOWED: &[&str] = &[
    "selection",
    "selector",
    "payTables",
    "employmentWorkingTimeRules",
    "caritasCareAllowanceRates",
    "caritasShiftAllowanceRates",
    "caritasTimePremiumRates",
    "caritasAnnualPaymentRules",
    "caritasTimePremiumPolicy",
    "caritasOvertimePolicy",
    "caritasAnnualPaymentPolicy",
    "premiumRules",
    "allowanceRules",
    "combinationRules",
    "workPatternRules",
    "workPatternPolicy",
];
fn region(pkg: &Value) -> Option<&str> {
    ["bw", "bayern", "mitte", "nord", "nrw", "ost"]
        .into_iter()
        .find(|r| s(pkg, "packageId") == format!("avr-caritas-p-{r}"))
}
fn pairs(pkg: &Value) -> Vec<String> {
    unique_strings(
        a(&pkg["rules"]["selection"]["variants"])
            .iter()
            .flat_map(|v| {
                a(&v["regions"])
                    .iter()
                    .map(move |r| format!("{}:{}", s(v, "id"), s(r, "id")))
            }),
    )
}
fn pair(v: &Value) -> String {
    format!("{}:{}", s(v, "variantId"), s(v, "regionId"))
}
fn invalid_range(pkg: &Value, v: &Value) -> bool {
    !valid_date(s(v, "validFrom"))
        || !valid_date(s(v, "validTo"))
        || s(v, "validTo") < s(v, "validFrom")
        || s(v, "validFrom") < s(pkg, "validFrom")
        || (pkg["validTo"] != Value::Null && s(v, "validTo") > s(pkg, "validTo"))
}
fn unknown_sources(pkg: &Value, v: &Value, path: &str, out: &mut Vec<ValidationIssue>) {
    let known = sources(pkg);
    for id in a(&v["sourceIds"]) {
        if !known.contains(id.as_str().unwrap_or("")) {
            issue(
                out,
                "UNKNOWN_SOURCE_ID",
                format!("{path}/sourceIds"),
                id.as_str().unwrap_or(""),
            );
        }
    }
}
fn includes(v: &Value, key: &str, value: &str) -> bool {
    a(&v[key]).iter().any(|v| v == value)
}
pub fn caritas_table_issues(pkg: &Value) -> Vec<ValidationIssue> {
    calculate(pkg, Mode::Table)
}
pub fn caritas_care_issues(pkg: &Value) -> Vec<ValidationIssue> {
    calculate(pkg, Mode::Care)
}
fn calculate(pkg: &Value, mode: Mode) -> Vec<ValidationIssue> {
    let mut out = vec![];
    let rules = &pkg["rules"];
    let selection = &rules["selection"];
    let selector = &rules["selector"];
    let claims = s(pkg, "packageId").starts_with("avr-caritas-p")
        || s(selection, "familyId") == "avr-caritas-p";
    if n(pkg, "engineContractVersion") != 14.0 {
        if claims {
            issue(
                &mut out,
                "CARITAS_CONTRACT",
                "/engineContractVersion",
                if mode.care() {
                    "Caritas Pflege requires contract 14."
                } else {
                    "Caritas P tables require contract 14."
                },
            );
        }
        if !mode.care()
            && rules.get("employmentWorkingTimeRules").is_some()
            && ![12.0, 13.0].contains(&n(pkg, "engineContractVersion"))
        {
            issue(
                &mut out,
                "CARITAS_WORKING_TIME_CONTRACT",
                "/rules/employmentWorkingTimeRules",
                "Dated employment working time requires contract 12, 13 or 14.",
            );
        }
        let fields = if mode.care() {
            &[
                (
                    "caritasCareAllowanceRates",
                    "CARITAS_RATE_CONTRACT",
                    "Caritas rates require contract 14.",
                ),
                (
                    "caritasShiftAllowanceRates",
                    "CARITAS_SHIFT_CONTRACT",
                    "Caritas shift rates require contract 14.",
                ),
                (
                    "caritasTimePremiumPolicy",
                    "CARITAS_TIME_PREMIUM_CONTRACT",
                    "Caritas time-premium policy requires contract 14.",
                ),
                (
                    "caritasOvertimePolicy",
                    "CARITAS_OVERTIME_CONTRACT",
                    "Caritas overtime policy requires contract 14.",
                ),
                (
                    "caritasAnnualPaymentPolicy",
                    "CARITAS_ANNUAL_CONTRACT",
                    "Caritas annual-payment policy requires contract 14.",
                ),
            ][..]
        } else {
            &[
                (
                    "caritasCareAllowanceRates",
                    "CARITAS_RATE_CONTRACT",
                    "Caritas care allowance rates require contract 14.",
                ),
                (
                    "caritasShiftAllowanceRates",
                    "CARITAS_SHIFT_CONTRACT",
                    "Caritas shift allowance rates require contract 14.",
                ),
                (
                    "caritasTimePremiumRates",
                    "CARITAS_PREMIUM_CONTRACT",
                    "Caritas time premium rates require contract 14.",
                ),
            ][..]
        };
        for (field, code, message) in fields {
            if rules.get(field).is_some() {
                issue(&mut out, code, format!("/rules/{field}"), *message);
            }
        }
        return out;
    }
    let region = region(pkg);
    if region.is_none()
        || s(selector, "agreementId") != "avr-caritas"
        || s(selection, "familyId") != "avr-caritas-p"
        || s(selection, "engineId") != "avr-caritas-p-v1"
        || s(selection, "employmentKind") != "EMPLOYEE"
    {
        issue(
            &mut out,
            "CARITAS_IDENTITY",
            "/rules/selection",
            if mode.care() {
                "Explicit regional Caritas Pflege identity required."
            } else {
                "A regional Caritas P identity is required."
            },
        );
    }
    if !mode.care() {
        if s(pkg, "status") != "DRAFT" {
            issue(
                &mut out,
                "CARITAS_DRAFT_ONLY",
                "/status",
                "Table-only Caritas packages must remain DRAFT.",
            );
        }
        let expected = if region == Some("ost") {
            [("2025-01-01", "2025-12-31"), ("2026-01-01", "2026-12-31")]
        } else {
            [("2025-07-01", "2026-01-31"), ("2026-02-01", "2026-12-31")]
        };
        if !expected
            .iter()
            .any(|(start, end)| s(pkg, "validFrom") == *start && s(pkg, "validTo") == *end)
        {
            issue(
                &mut out,
                "CARITAS_TABLE_PERIOD",
                "/validFrom",
                "The P table period must match a sourced 2025 or 2026 period.",
            );
        }
    }
    let p = parts(selector);
    let distinct: BTreeSet<&str> = p.iter().map(|v| v.as_str().unwrap_or("")).collect();
    if p.len() != 2
        || distinct.len() != 2
        || !distinct
            .iter()
            .all(|v| ["anlage-31", "anlage-32"].contains(v))
    {
        issue(
            &mut out,
            if mode.care() {
                "CARITAS_PARTS"
            } else {
                "CARITAS_ANNEXES"
            },
            "/rules/selector",
            if mode.care() {
                "Both distinct care annexes must be declared."
            } else {
                "Both care annexes must be declared once."
            },
        );
    }
    let expected_regions: Vec<String> = match region {
        Some("ost") => [
            "OST_TARIF_OST",
            "OST_TARIF_WEST_BERLIN",
            "OST_TARIF_WEST_HAMBURG",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect(),
        Some(r) => vec![r.to_uppercase()],
        None => vec![],
    };
    let variants = a(&selection["variants"]);
    let mut referenced = BTreeSet::new();
    let mut remaining = BTreeSet::from(["ANLAGE_31", "ANLAGE_32"]);
    if !mode.care()
        && (variants.len() != 2
            || variants.iter().any(|v| match s(v, "id") {
                "ANLAGE_31" => s(v, "specialPartId") != "anlage-31",
                "ANLAGE_32" => s(v, "specialPartId") != "anlage-32",
                _ => true,
            }))
    {
        issue(
            &mut out,
            "CARITAS_VARIANTS",
            "/rules/selection/variants",
            "Both distinct care annexes are required.",
        );
    }
    for variant in variants {
        if mode.care() {
            let valid = match s(variant, "id") {
                "ANLAGE_31" => s(variant, "specialPartId") == "anlage-31",
                "ANLAGE_32" => s(variant, "specialPartId") == "anlage-32",
                _ => false,
            };
            if !valid || !remaining.contains(s(variant, "id")) {
                issue(
                    &mut out,
                    "CARITAS_VARIANTS",
                    "/rules/selection/variants",
                    "Unknown or duplicate care annex.",
                );
            }
            remaining.remove(s(variant, "id"));
        }
        let regions = a(&variant["regions"]);
        let ids: BTreeSet<&str> = regions.iter().map(|r| s(r, "id")).collect();
        if regions.len() != expected_regions.len()
            || (!mode.care() && ids.len() != expected_regions.len())
            || expected_regions.iter().any(|id| !ids.contains(id.as_str()))
        {
            issue(
                &mut out,
                if mode.care() {
                    "CARITAS_REGION"
                } else {
                    "CARITAS_REGIONS"
                },
                "/rules/selection/variants",
                if mode.care() {
                    "Each regional package must bind its own commission and every applicable tariff territory."
                } else {
                    "Every annex requires its regional territories."
                },
            );
        }
        for r in regions {
            if let Some(id) = r.get("payTableId") {
                referenced.insert(id.as_str().unwrap_or(""));
            } else {
                issue(
                    &mut out,
                    "CARITAS_TABLE_MAPPING",
                    "/rules/selection/variants",
                    if mode.care() {
                        "Every care annex and tariff territory requires an explicit pay table mapping."
                    } else {
                        "Every territory requires an explicit P table."
                    },
                );
            }
        }
    }
    if mode.care() && !remaining.is_empty() {
        issue(
            &mut out,
            "CARITAS_VARIANTS",
            "/rules/selection/variants",
            "Both care annexes required.",
        );
    }
    if !truth(rules.get("selection")) || !capabilities_unsupported(selection) {
        issue(
            &mut out,
            if mode.care() {
                "CARITAS_COMPONENT_COVERAGE"
            } else {
                "CARITAS_CAPABILITIES"
            },
            "/rules/selection/capabilities",
            if mode.care() {
                "Table-only contract must not claim calculation support."
            } else {
                "Table evidence does not enable a pay capability."
            },
        );
    }
    if rules
        .as_object()
        .is_some_and(|o| o.keys().any(|k| !ALLOWED.contains(&k.as_str())))
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
            if mode.care() {
                "CARITAS_UNSUPPORTED_RULES"
            } else {
                "CARITAS_FOREIGN_RULES"
            },
            "/rules",
            if mode.care() {
                "Unimplemented or foreign calculation rules are forbidden."
            } else {
                "Table-only packages cannot inherit another tariff's calculation rules."
            },
        );
    }
    let tables = a(&rules["payTables"]);
    let bad_count = tables.is_empty() || tables.len() > 4;
    let unreferenced = tables.iter().any(|t| !referenced.contains(s(t, "id")));
    if mode.care() {
        if bad_count {
            issue(
                &mut out,
                "CARITAS_TABLE_COUNT",
                "/rules/payTables",
                "One to four dated P tables required.",
            );
        }
        if unreferenced {
            issue(
                &mut out,
                "CARITAS_UNREFERENCED_TABLE",
                "/rules/payTables",
                "Every declared P table must be bound to an annex and tariff territory.",
            );
        }
    } else if bad_count || unreferenced {
        issue(
            &mut out,
            "CARITAS_TABLES",
            "/rules/payTables",
            "One to four mapped P tables are required.",
        );
    }
    for (i, table) in tables.iter().enumerate() {
        let path = if mode.care() {
            "/rules/payTables".to_owned()
        } else {
            format!("/rules/payTables/{i}/entries")
        };
        let mut expected: BTreeSet<String> = [4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
            .iter()
            .flat_map(|g| (if *g <= 6 { 1 } else { 2 }..=6).map(move |step| format!("p{g}:{step}")))
            .collect();
        for e in a(&table["entries"]) {
            if !expected.remove(&format!(
                "{}:{}",
                s(e, "groupId"),
                e["stepId"]
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| n(e, "stepId").to_string())
            )) || n(e, "monthlyCents") <= 0.0
            {
                issue(
                    &mut out,
                    "CARITAS_TABLE_ENTRY",
                    &path,
                    if mode.care() {
                        "Invalid or duplicate P group/stage/value; P5 is not a Caritas care group."
                    } else {
                        "Only distinct positive P4/P6/P7–P16 values at their printed steps are valid."
                    },
                );
            }
        }
        if !expected.is_empty() {
            issue(
                &mut out,
                "CARITAS_TABLE_INCOMPLETE",
                path,
                if mode.care() {
                    "All 62 P group/stage values required."
                } else {
                    "All 62 printed P values are required."
                },
            );
        }
    }
    working::check(pkg, mode, &mut out);
    rates::check(pkg, mode, &mut out);
    if mode.care() {
        policy::check(pkg, &mut out);
    }
    out
}
