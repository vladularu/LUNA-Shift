use super::*;
use crate::{
    remuneration::tariff_annual::{
        TariffAnnualError,
        model::{ClaimSelection, ClaimVersion, ValidatedClaim},
    },
    rules::{RuleKind, RuleResolver},
};
use std::collections::{BTreeMap, BTreeSet};
pub enum DraftSelection<'a> {
    Selected {
        package: &'a RulePackage,
        versions: Vec<&'a RulePackage>,
    },
    Unavailable {
        code: &'static str,
    },
}
fn unavailable_selection(code: &'static str) -> DraftSelection<'static> {
    DraftSelection::Unavailable { code }
}
pub fn select_draft<'a>(
    input: &Value,
    resolver: &'a RuleResolver,
    validator: &impl NativePackageValidator,
) -> Result<DraftSelection<'a>, TariffAnnualError> {
    let Some(year) =
        integer(&input["year"], 1900, 4099).filter(|_| input["version"].as_f64() == Some(3.0))
    else {
        return Ok(unavailable_selection("CARITAS_ANNUAL_RULE_INVALID"));
    };
    let s = &input["selection"];
    select_parts(
        year as i32,
        text(s, "packageId"),
        text(s, "variant"),
        text(s, "region"),
        text(s, "group"),
        resolver,
        validator,
    )
}
pub(super) fn select_checked<'a>(
    claim: &ValidatedClaim,
    resolver: &'a RuleResolver,
    validator: &impl NativePackageValidator,
) -> Result<DraftSelection<'a>, TariffAnnualError> {
    let c = claim.data();
    if c.version != ClaimVersion::V3 {
        return Ok(unavailable_selection("CARITAS_ANNUAL_RULE_INVALID"));
    }
    select_for_selection(c.year, &c.selection, resolver, validator)
}
fn select_for_selection<'a>(
    year: i32,
    s: &ClaimSelection,
    resolver: &'a RuleResolver,
    validator: &impl NativePackageValidator,
) -> Result<DraftSelection<'a>, TariffAnnualError> {
    select_parts(
        year,
        &s.package_id,
        &s.variant,
        &s.region,
        &s.group,
        resolver,
        validator,
    )
}
fn select_parts<'a>(
    year: i32,
    id: &str,
    variant: &str,
    region: &str,
    group: &str,
    resolver: &'a RuleResolver,
    validator: &impl NativePackageValidator,
) -> Result<DraftSelection<'a>, TariffAnnualError> {
    let mut matching = Vec::new();
    for pkg in resolver.annual_tariff_candidates(id, year) {
        if !validator
            .validate(pkg)
            .map_err(|_| TariffAnnualError::ValidationUnavailable)?
            || pkg.kind != RuleKind::Tariff
            || pkg.package_id != id
            || pkg.engine_contract_version != 14
            || pkg.status() != Some("DRAFT")
        {
            return Ok(unavailable_selection("CARITAS_ANNUAL_RULE_INVALID"));
        }
        let reference = format!("{year}-09-01");
        if pkg.valid_from > reference || pkg.valid_to.as_ref().is_some_and(|to| *to < reference) {
            continue;
        }
        let selected = resolve_tariff_selection(pkg, variant, region);
        if selected.is_none_or(|s| !s.groups.iter().any(|g| g.id == group)) {
            continue;
        }
        let rules: Vec<_> = rows(pkg.rules(), "caritasAnnualPaymentRules")
            .iter()
            .filter(|r| {
                r["entitlementYear"].as_f64() == Some(year as f64)
                    && r["variantId"] == variant
                    && r["regionId"] == region
                    && rows(r, "payGroups").iter().any(|g| *g == group)
            })
            .collect();
        if rules.is_empty() {
            continue;
        }
        if rules.len() != 1 {
            return Ok(unavailable_selection("CARITAS_ANNUAL_RULE_AMBIGUOUS"));
        }
        matching.push((pkg, rules[0]));
    }
    if matching.is_empty() {
        return Ok(unavailable_selection("CARITAS_ANNUAL_RULE_MISSING"));
    }
    let terms = matching
        .iter()
        .map(|(_, r)| {
            serde_json::to_string(&[
                &r["rateBasisPoints"],
                &r["referenceMonths"],
                &r["groupReferenceMonth"],
                &r["groupReferenceDay"],
                &r["payoutMonth"],
                &r["basisPolicy"],
                &r["eligibilityPolicy"],
                &r["reductionPolicy"],
                &r["basisRegionId"],
                &r["basisTablePolicy"],
            ])
            .map_err(|_| TariffAnnualError::Rule)
        })
        .collect::<Result<BTreeSet<_>, _>>()?;
    if terms.len() != 1 {
        return Ok(unavailable_selection("CARITAS_ANNUAL_RULE_AMBIGUOUS"));
    }
    let mut starts: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    for (pkg, _) in &matching {
        starts
            .entry(&pkg.valid_from)
            .or_default()
            .insert(&pkg.version_id);
    }
    let mut ranks = BTreeMap::new();
    for (pkg, _) in &matching {
        if starts[pkg.valid_from.as_str()].len() > 1 {
            ranks.insert(
                pkg.version_id.as_str(),
                resolver
                    .collation_rank(&pkg.version_id)
                    .ok_or(TariffAnnualError::InvalidCollation)?,
            );
        }
    }
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
    let package = matching[0].0;
    Ok(DraftSelection::Selected {
        package,
        versions: matching.into_iter().map(|(p, _)| p).collect(),
    })
}
