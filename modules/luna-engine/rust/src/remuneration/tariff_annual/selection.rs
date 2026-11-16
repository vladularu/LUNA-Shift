use super::{TariffAnnualError, model::ClaimSelection};
use crate::{
    remuneration::annual::model::AnnualIssueCode,
    rules::{RulePackage, RuleResolver, validation::validate_tariff_package},
};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub enum AnnualTariffSelection<'a> {
    Selected {
        package: &'a RulePackage,
        rule: &'a Value,
        versions: Vec<&'a RulePackage>,
    },
    Unavailable {
        code: AnnualIssueCode,
    },
}
fn terms(rule: &Value) -> Result<String, TariffAnnualError> {
    serde_json::to_string(&[
        &rule["rateBasisPoints"],
        &rule["referenceMonths"],
        &rule["lateEntryAfterMonth"],
        &rule["basisPolicy"],
        &rule["eligibilityPolicy"],
        &rule["reductionPolicy"],
        &rule["earlyExitBasis"],
        &rule["payoutMonth"],
    ])
    .map_err(|_| TariffAnnualError::Rule)
}
pub(crate) fn matches(rule: &Value, year: i32, selection: &ClaimSelection) -> bool {
    rule["variantId"] == selection.variant
        && rule["regionIds"].as_array().is_some_and(|a| {
            a.iter()
                .any(|v| v.as_str() == Some(selection.region.as_str()))
        })
        && rule["payGroups"].as_array().is_some_and(|a| {
            a.iter()
                .any(|v| v.as_str() == Some(selection.group.as_str()))
        })
        && rule["firstEntitlementYear"]
            .as_i64()
            .is_some_and(|from| i64::from(year) >= from)
        && rule["lastEntitlementYear"]
            .as_i64()
            .is_some_and(|to| i64::from(year) <= to)
}
/// All applicable annual declarations must agree; date ties use admitted locale ranks.
pub fn select_annual_tariff<'a>(
    year: i32,
    selection: &ClaimSelection,
    resolver: &'a RuleResolver,
) -> Result<AnnualTariffSelection<'a>, TariffAnnualError> {
    let mut matching = vec![];
    for package in resolver.annual_tariff_candidates(&selection.package_id, year) {
        if ![11, 12, 13].contains(&package.engine_contract_version) {
            continue;
        }
        if !validate_tariff_package(package)
            .map_err(|_| TariffAnnualError::ValidationUnavailable)?
            || package.package_id != selection.package_id
        {
            return Ok(AnnualTariffSelection::Unavailable {
                code: AnnualIssueCode::AnnualRuleInvalid,
            });
        }
        let rules: Vec<&Value> = package.rules()["annualPaymentRules"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|rule| matches(rule, year, selection))
            .collect();
        if rules.len() > 1 {
            return Ok(AnnualTariffSelection::Unavailable {
                code: AnnualIssueCode::AnnualRuleAmbiguous,
            });
        }
        if let Some(rule) = rules.first() {
            matching.push((package, *rule));
        }
    }
    if matching.is_empty() {
        return Ok(AnnualTariffSelection::Unavailable {
            code: AnnualIssueCode::AnnualRuleMissing,
        });
    }
    let unique = matching
        .iter()
        .map(|(_, rule)| terms(rule))
        .collect::<Result<BTreeSet<_>, _>>()?;
    if unique.len() != 1 {
        return Ok(AnnualTariffSelection::Unavailable {
            code: AnnualIssueCode::AnnualRuleAmbiguous,
        });
    }
    let mut starts: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    for (package, _) in &matching {
        starts
            .entry(&package.valid_from)
            .or_default()
            .insert(&package.version_id);
    }
    let mut ranks = BTreeMap::new();
    for (package, _) in &matching {
        if starts[package.valid_from.as_str()].len() > 1 {
            ranks.insert(
                package.version_id.as_str(),
                resolver
                    .collation_rank(&package.version_id)
                    .ok_or(TariffAnnualError::InvalidCollation)?,
            );
        }
    }
    // Stable sort preserves catalog order when locale comparison regards distinct IDs as equal.
    matching.sort_by(|(a, _), (b, _)| {
        b.valid_from.cmp(&a.valid_from).then_with(|| {
            if a.version_id == b.version_id {
                std::cmp::Ordering::Equal
            } else {
                ranks
                    .get(b.version_id.as_str())
                    .cmp(&ranks.get(a.version_id.as_str()))
            }
        })
    });
    let (package, rule) = matching[0];
    Ok(AnnualTariffSelection::Selected {
        package,
        rule,
        versions: matching.into_iter().map(|(package, _)| package).collect(),
    })
}
