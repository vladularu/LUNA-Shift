use super::{
    TariffValidationPackage, ValidationIssue, has, integer_value, issue, number, rows, sources,
    text,
};
use std::collections::BTreeSet;

pub fn annual_payment_rule_issues(pkg: &impl TariffValidationPackage) -> Vec<ValidationIssue> {
    let body = pkg.rules();
    let rules = body.get("annualPaymentRules");
    let s = &body["selection"];
    let version = pkg.engine_contract_version();
    let tvl = version == 12;
    let tval = version == 13;
    let mut issues = vec![];
    let root = "/rules/annualPaymentRules";
    if ![11, 19, 12, 13].contains(&version) {
        if rules.is_some() {
            issue(
                &mut issues,
                "UNSUPPORTED_ANNUAL_PAYMENT",
                root,
                "Annual payment rules require contract 11 or 12.",
            );
        }
        return issues;
    }
    if (tvl || tval) && rules.is_none() && s["capabilities"]["annualPayment"] == "UNSUPPORTED" {
        return issues;
    }
    let rules = rows(body, "annualPaymentRules");
    if s.is_null() || s["capabilities"]["annualPayment"] != "SUPPORTED" || rules.is_empty() {
        issue(
            &mut issues,
            "MISSING_ANNUAL_PAYMENT",
            root,
            "Annual payment support requires explicit complete terms.",
        );
        return issues;
    }
    let training = s["employmentKind"] == "APPRENTICE";
    if training
        && (s["familyId"] != if tval { "tval-pflege" } else { "tvaoed-pflege" }
            || body["selector"]["agreementId"] != if tval { "tva-l-pflege" } else { "tvaoed-vka" })
        || !training
            && (s["familyId"] != if tvl { "tvl-kr" } else { "tvoed-p" }
                || body["selector"]["agreementId"] != if tvl { "tv-l" } else { "tvoed-vka" })
        || tvl && training
    {
        issue(
            &mut issues,
            "ANNUAL_PAYMENT_FAMILY",
            root,
            "Annual payment procedures must match the declared care family.",
        );
    }
    let known = sources(pkg);
    let mut groups = vec![];
    if let Some(table) = rows(body, "payTables")
        .iter()
        .find(|t| t["id"] == body["selector"]["payTableId"])
    {
        for e in rows(table, "entries") {
            if let Some(g) = text(e, "groupId").filter(|g| !groups.contains(g)) {
                groups.push(g);
            }
        }
    }
    let mut ids = BTreeSet::new();
    for (index, r) in rules.iter().enumerate() {
        let path = format!("{root}/{index}");
        if !ids.insert(text(r, "id")) {
            issue(
                &mut issues,
                "DUPLICATE_ANNUAL_PAYMENT",
                &(path.clone() + "/id"),
                "Rule identifiers must be unique.",
            );
        }
        for id in rows(r, "sourceIds") {
            if let Some(id) = id.as_str().filter(|id| !known.contains(*id)) {
                issue(
                    &mut issues,
                    "UNKNOWN_SOURCE_ID",
                    &(path.clone() + "/sourceIds"),
                    format!("Unknown source: {id}"),
                );
            }
        }
        let variant = rows(s, "variants")
            .iter()
            .find(|v| v["id"] == r["variantId"]);
        let parts: &[&str] = if tval {
            &["pflege"]
        } else if tvl {
            &["section-43"]
        } else {
            &["bt-k", "bt-b"]
        };
        if variant
            .is_none_or(|v| text(v, "specialPartId").is_none_or(|part| !parts.contains(&part)))
        {
            issue(
                &mut issues,
                "ANNUAL_PAYMENT_VARIANT",
                &(path.clone() + "/variantId"),
                "Unknown or unsupported annual payment variant.",
            );
        }
        for id in rows(r, "regionIds") {
            if variant.is_none_or(|v| !rows(v, "regions").iter().any(|region| &region["id"] == id))
            {
                issue(
                    &mut issues,
                    "ANNUAL_PAYMENT_REGION",
                    &(path.clone() + "/regionIds"),
                    format!("Unknown region: {}", id.as_str().unwrap_or("")),
                );
            }
        }
        for group in rows(r, "payGroups") {
            if !group.as_str().is_some_and(|g| groups.contains(&g)) {
                issue(
                    &mut issues,
                    "ANNUAL_PAYMENT_GROUP",
                    &(path.clone() + "/payGroups"),
                    format!("Unknown group: {}", group.as_str().unwrap_or("")),
                );
            }
        }
        let first = number(r, "firstEntitlementYear");
        let last = number(r, "lastEntitlementYear");
        let package_from = pkg
            .valid_from()
            .get(..4)
            .and_then(|y| y.parse::<i64>().ok())
            .unwrap_or(0);
        let package_through = pkg
            .valid_to()
            .and_then(|d| d.get(..4))
            .and_then(|y| y.parse::<i64>().ok());
        if first > last || first < package_from || package_through.is_some_and(|y| last > y) {
            issue(
                &mut issues,
                "ANNUAL_PAYMENT_YEARS",
                &path,
                "Claim years must be ordered and within the package years.",
            );
        }
        let months = rows(r, "referenceMonths");
        let bad_months = if tval {
            (months.len() != 1 || months[0].as_f64() != Some(11.0))
                || number(r, "lateEntryAfterMonth") != 11
                || number(r, "payoutMonth") != 11
                || number(r, "rateBasisPoints") != 9500
        } else {
            months.len() != 3
                || months.iter().enumerate().any(|(i, m)| {
                    integer_value(m)
                        != months
                            .first()
                            .and_then(integer_value)
                            .and_then(|first| first.checked_add(i as i64))
                })
                || number(r, "lateEntryAfterMonth")
                    != if tvl {
                        8
                    } else {
                        months.get(2).and_then(integer_value).unwrap_or(i64::MIN)
                    }
                || number(r, "payoutMonth")
                    <= months.get(2).and_then(integer_value).unwrap_or(i64::MIN)
                || (tvl
                    && ((months.len() != 3
                        || months
                            .iter()
                            .enumerate()
                            .any(|(i, m)| m.as_f64() != Some([7.0, 8.0, 9.0][i])))
                        || number(r, "payoutMonth") != 11))
        };
        if bad_months {
            issue(
                &mut issues,
                "ANNUAL_PAYMENT_MONTHS",
                &path,
                "Ordered consecutive reference months must precede payment.",
            );
        }
        let early = !training && variant.is_some_and(|v| v["specialPartId"] == "bt-k");
        let policy = if tval {
            "TVAL_PFLEGE_16"
        } else if tvl {
            "TVL_20"
        } else if training {
            "TVAOED_PFLEGE_14"
        } else {
            "TVOED_VKA_20"
        };
        let eligibility = if tval {
            "TVAL_TRAINING_OR_DIRECT_TAKEOVER_DECEMBER_1"
        } else if tvl {
            "TVL_DECEMBER_1_OR_LEGACY_ATZ"
        } else if training {
            "TRAINING_OR_DIRECT_TAKEOVER_DECEMBER_1"
        } else if early {
            "BT_K_EARLY_EXIT"
        } else {
            "EMPLOYED_DECEMBER_1"
        };
        let exit = if tvl {
            "LAST_THREE_MONTHS_TVL"
        } else if early {
            "LAST_FULL_MONTH_TABLE_AND_FIXED_ALLOWANCES"
        } else {
            "NONE"
        };
        if r["basisPolicy"] != policy
            || r["reductionPolicy"] != policy
            || r["eligibilityPolicy"] != eligibility
            || r["earlyExitBasis"] != exit
        {
            issue(
                &mut issues,
                "ANNUAL_PAYMENT_POLICY",
                &path,
                "Basis, eligibility and reduction policies must match the tariff.",
            );
        }
    }
    let first = rules
        .iter()
        .map(|r| number(r, "firstEntitlementYear"))
        .min()
        .unwrap_or(0);
    let last = rules
        .iter()
        .map(|r| number(r, "lastEntitlementYear"))
        .max()
        .unwrap_or(0);
    for v in rows(s, "variants") {
        for region in rows(v, "regions") {
            for group in &groups {
                let mut applicable: Vec<_> = rules
                    .iter()
                    .filter(|r| {
                        r["variantId"] == v["id"]
                            && text(region, "id").is_some_and(|id| has(rows(r, "regionIds"), id))
                            && has(rows(r, "payGroups"), group)
                    })
                    .collect();
                applicable.sort_by_key(|r| number(r, "firstEntitlementYear"));
                let mut next = first;
                let message = format!(
                    "Annual coverage for {}/{}/{} is incomplete or ambiguous.",
                    text(v, "id").unwrap_or(""),
                    text(region, "id").unwrap_or(""),
                    group
                );
                for r in applicable {
                    let from = number(r, "firstEntitlementYear");
                    if from < next {
                        issue(&mut issues, "ANNUAL_PAYMENT_OVERLAP", root, &message);
                    }
                    if from > next {
                        issue(&mut issues, "ANNUAL_PAYMENT_COVERAGE", root, &message);
                    }
                    next = next.max(number(r, "lastEntitlementYear").saturating_add(1));
                }
                if next <= last {
                    issue(&mut issues, "ANNUAL_PAYMENT_COVERAGE", root, &message);
                }
            }
        }
    }
    issues
}
