use super::{model::*, tariff::TariffAnnualComposeError};
use crate::{
    remuneration::{
        base::model::RemunerationStatus,
        context::{
            model::{RemunerationSource, SourceReference},
            periods::remuneration_month_start,
        },
        tariff_annual::{
            TariffAnnualError,
            model::ClaimSelection,
            saved::ValidatedSavedClaims,
            selection::{AnnualTariffSelection, select_annual_tariff},
        },
    },
    rules::RuleResolver,
};
use serde_json::Value;
use std::{
    borrow::Cow,
    collections::{BTreeMap, BTreeSet},
};
fn family(package: &str, variant: &str, region: &str) -> Result<String, TariffAnnualError> {
    serde_json::to_string(&(package, variant, region)).map_err(|_| TariffAnnualError::Rule)
}
fn selection(value: &Value) -> Result<ClaimSelection, TariffAnnualError> {
    let s = &value["data"]["selection"];
    let text = |key: &str| {
        s[key]
            .as_str()
            .map(str::to_owned)
            .ok_or(TariffAnnualError::Claim)
    };
    let group = text("group")?;
    let numeric_group = group
        .strip_prefix("KR")
        .or_else(|| group.strip_prefix('P'))
        .is_some_and(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()));
    Ok(ClaimSelection {
        package_id: text("packageId")?,
        variant: text("variant")?,
        region: text("region")?,
        group: if numeric_group {
            group.to_lowercase()
        } else {
            group
        },
        confirmed: false,
        group_at_september1_confirmed: None,
    })
}
/// Discovers missing personal claims; never infers employment or invents a zero claim.
pub fn missing_tariff_annual_claims<'a>(
    month: &str,
    history: &'a [Value],
    saved: &ValidatedSavedClaims,
    resolver: &'a RuleResolver,
) -> Result<AnnualResult<'a>, TariffAnnualComposeError> {
    let first = remuneration_month_start(month)?;
    let year = i32::from(first.year());
    let covered = saved
        .records()
        .iter()
        .filter(|r| !r.revoked && r.claim.data().year == year)
        .map(|r| {
            let s = &r.claim.data().selection;
            family(&s.package_id, &s.variant, &s.region)
        })
        .collect::<Result<BTreeSet<_>, _>>()?;
    let mut sorted: Vec<&Value> = history.iter().collect();
    sorted.sort_by(|a, b| {
        a["effectiveFrom"]
            .as_str()
            .unwrap_or("")
            .cmp(b["effectiveFrom"].as_str().unwrap_or(""))
    });
    let mut groups: Vec<(String, Vec<&Value>)> = vec![];
    let mut indices: BTreeMap<String, usize> = BTreeMap::new();
    for (index, p) in sorted.iter().enumerate() {
        let s = &p["data"]["selection"];
        let next = sorted
            .get(index + 1)
            .and_then(|p| p["effectiveFrom"].as_str());
        if s["kind"] != "tariff"
            || p["effectiveFrom"]
                .as_str()
                .is_some_and(|from| from > format!("{year}-12-31").as_str())
            || next.is_some_and(|next| !next.is_empty() && next <= format!("{year}-01-01").as_str())
        {
            continue;
        }
        let family_selection = selection(p)?;
        let key = family(
            &family_selection.package_id,
            &family_selection.variant,
            &family_selection.region,
        )?;
        if covered.contains(&key) {
            continue;
        }
        if let Some(index) = indices.get(&key).copied() {
            groups[index].1.push(p);
        } else {
            indices.insert(key.clone(), groups.len());
            groups.push((key, vec![p]));
        }
    }
    let mut positions = vec![];
    for (key, profiles) in groups {
        let profile = *profiles.last().ok_or(TariffAnnualError::Claim)?;
        let chosen = selection(profile)?;
        if !resolver
            .annual_tariff_candidates(&chosen.package_id, year)
            .iter()
            .any(|p| {
                p.engine_contract_version == 11
                    || [12, 13].contains(&p.engine_contract_version)
                        && p.rules().get("annualPaymentRules").is_some()
            })
        {
            continue;
        }
        let selections = profiles
            .iter()
            .map(|p| select_annual_tariff(year, &selection(p)?, resolver))
            .collect::<Result<Vec<_>, TariffAnnualError>>()?;
        let payouts: BTreeSet<_> = selections
            .iter()
            .filter_map(|s| match s {
                AnnualTariffSelection::Selected { rule, .. } => rule["payoutMonth"].as_i64(),
                _ => None,
            })
            .collect();
        let failure = selections.iter().find_map(|s| match s {
            AnnualTariffSelection::Unavailable { code } => Some(*code),
            _ => None,
        });
        let selected = selections.last().ok_or(TariffAnnualError::Claim)?;
        let payout_known = failure.is_none() && payouts.len() == 1;
        if payout_known && !payouts.contains(&i64::from(first.month())) {
            continue;
        }
        let code = failure.unwrap_or(if payouts.len() > 1 {
            AnnualIssueCode::AnnualRuleAmbiguous
        } else {
            AnnualIssueCode::AnnualInputMissing
        });
        let package = match selected {
            AnnualTariffSelection::Selected { package, .. } => Some(*package),
            _ => None,
        };
        let versions: Vec<_> = selections
            .iter()
            .flat_map(|s| match s {
                AnnualTariffSelection::Selected { versions, .. } => versions.clone(),
                _ => vec![],
            })
            .collect();
        let mut references: Vec<SourceReference<'a>> = vec![];
        for package in &versions {
            let package = *package;
            for source in package
                .sources()
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let id = format!(
                    "{}:{}",
                    package.version_id,
                    source["id"].as_str().ok_or(TariffAnnualError::Rule)?
                );
                let reference = SourceReference {
                    id: Some(Cow::Owned(id.clone())),
                    title: source["title"].as_str(),
                    url: source["url"].as_str(),
                    section: source["section"].as_str(),
                };
                if let Some(old) = references
                    .iter_mut()
                    .find(|r| r.id.as_deref() == Some(id.as_str()))
                {
                    *old = reference;
                } else {
                    references.push(reference);
                }
            }
        }
        let mut seen_versions = BTreeSet::new();
        let version_ids = versions
            .into_iter()
            .filter(|p| seen_versions.insert(p.version_id.as_str()))
            .map(|p| p.version_id.clone())
            .collect();
        let raw_selection = &profile["data"]["selection"];
        let source = RemunerationSource {
            kind: "tariff",
            profile_effective_from: profile["effectiveFrom"].as_str(),
            profile_revision: profile["revision"]
                .as_f64()
                .filter(|n| n.fract() == 0.0 && n.abs() <= crate::money::MAX_SAFE_INTEGER as f64)
                .map(|n| n as i64),
            requested_package_id: raw_selection["packageId"].as_str(),
            package_id: package.map(|p| p.package_id.as_str()),
            version_id: package.map(|p| p.version_id.as_str()),
            package_valid_from: package.map(|p| p.valid_from.as_str()),
            package_valid_to: package.and_then(|p| p.valid_to.as_deref()),
            references,
        };
        let code_text = match code {
            AnnualIssueCode::AnnualRuleMissing => "ANNUAL_RULE_MISSING",
            AnnualIssueCode::AnnualRuleAmbiguous => "ANNUAL_RULE_AMBIGUOUS",
            AnnualIssueCode::AnnualRuleInvalid => "ANNUAL_RULE_INVALID",
            _ => "ANNUAL_INPUT_MISSING",
        };
        let mut missing = vec!["claim".into()];
        if code != AnnualIssueCode::AnnualInputMissing {
            missing.push(code_text.into());
        }
        positions.push(AnnualPosition{id:format!("tariff-annual-missing:{year}:{key}"),kind:AnnualPositionKind::AnnualPayment,label:format!("Tarifliche Jahressonderzahlung {year} · Angaben fehlen"),from:first.to_string(),through:format!("{month}-{:02}",first.days_in_month()),amount_cents:None,status:RemunerationStatus::Unavailable,source,basis:AnnualBasis{payment_id:format!("missing:{key}"),entitlement_year:year,method:AnnualMethod::Percent,full_amount_cents:None,confirmed_basis_cents:None,percentage_basis_points:None,entitlement_months:None,actual_revision:None,tariff:Some(TariffBasis{claim_revision:None,rule_id:None,versions:version_ids,basis_method:None,basis_months:vec![],twelfths:None,missing})},issue:Some(AnnualIssue{code,message:if payout_known{"Persönliche Angaben zur tariflichen Jahressonderzahlung fehlen. Unter Jahressonderzahlungen bearbeiten Anspruch und Bemessung ergänzen; ein fehlender Eintrag bedeutet nicht 0 € Anspruch."}else{"Persönliche Jahresangaben und eine eindeutige Tarifgrundlage fehlen. Betrag und Auszahlungsmonat bleiben offen."}.into()})});
    }
    Ok(summarize_annual(positions))
}
