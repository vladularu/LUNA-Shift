use super::model::*;
use crate::{
    remuneration::{
        base::model::RemunerationStatus,
        context::{
            model::{ContextError, RemunerationSource, SourceReference},
            periods::remuneration_month_start,
        },
        tariff_annual::{
            TariffAnnualError,
            payment::calculate_checked_tariff_annual_claim,
            saved::{SavedAnnualError, SavedTariffAnnualClaim, ValidatedSavedClaims},
            selection::{self, AnnualTariffSelection, select_annual_tariff},
        },
    },
    rules::RuleResolver,
};
use num_bigint::BigInt;
use num_traits::Zero;
use serde_json::Value;
use std::{borrow::Cow, collections::BTreeSet};
#[derive(Debug)]
pub enum TariffAnnualComposeError {
    Context(ContextError),
    Core(TariffAnnualError),
    Saved(SavedAnnualError),
}
impl From<ContextError> for TariffAnnualComposeError {
    fn from(e: ContextError) -> Self {
        Self::Context(e)
    }
}
impl From<TariffAnnualError> for TariffAnnualComposeError {
    fn from(e: TariffAnnualError) -> Self {
        Self::Core(e)
    }
}
impl From<SavedAnnualError> for TariffAnnualComposeError {
    fn from(e: SavedAnnualError) -> Self {
        Self::Saved(e)
    }
}
impl std::fmt::Display for TariffAnnualComposeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Context(e) => e.fmt(f),
            Self::Core(e) => e.fmt(f),
            Self::Saved(e) => e.fmt(f),
        }
    }
}
impl std::error::Error for TariffAnnualComposeError {}
impl TariffAnnualComposeError {
    pub fn class_name(&self) -> &str {
        match self {
            Self::Core(e) => e.class_name(),
            Self::Saved(e) => e.class_name(),
            _ => "Error",
        }
    }
}
fn allocation_issues(
    records: &[&SavedTariffAnnualClaim],
) -> Result<BTreeSet<i32>, TariffAnnualError> {
    let mut blocked = BTreeSet::new();
    let years: BTreeSet<_> = records.iter().map(|r| r.claim.data().year).collect();
    for year in years {
        let rows: Vec<_> = records
            .iter()
            .filter(|r| r.claim.data().year == year)
            .collect();
        if rows.len() < 2 {
            continue;
        }
        let mut numerator = BigInt::from(0);
        let mut denominator = BigInt::from(1);
        let mut seen = BTreeSet::new();
        for row in rows {
            let c = row.claim.data();
            let a = &c.allocation;
            let key = serde_json::to_string(&(
                &c.selection.package_id,
                &c.selection.variant,
                &c.selection.region,
                &c.selection.group,
                &c.employment.start,
                &c.employment.end,
            ))
            .map_err(|_| TariffAnnualError::Rule)?;
            if !seen.insert(key)
                || a.required != Some(true)
                || a.twelfths_numerator.is_none()
                || a.twelfths_denominator.is_none()
            {
                blocked.insert(year);
                break;
            }
            numerator = &numerator
                * BigInt::from(a.twelfths_denominator.ok_or(TariffAnnualError::Claim)?)
                + BigInt::from(a.twelfths_numerator.ok_or(TariffAnnualError::Claim)?)
                    * &denominator;
            denominator *= BigInt::from(a.twelfths_denominator.ok_or(TariffAnnualError::Claim)?);
            if numerator > BigInt::from(12) * &denominator {
                blocked.insert(year);
                break;
            }
            let mut x = numerator.clone();
            let mut y = denominator.clone();
            while !y.is_zero() {
                let next = &x % &y;
                x = y;
                y = next;
            }
            numerator /= &x;
            denominator /= &x;
        }
    }
    Ok(blocked)
}
fn source_for<'a>(
    row: &'a SavedTariffAnnualClaim,
    selected: &AnnualTariffSelection<'a>,
    actual: bool,
) -> RemunerationSource<'a> {
    let mut source = RemunerationSource::new(None, None);
    source.kind = if actual { "profile" } else { "tariff" };
    if actual {
        return source;
    }
    source.requested_package_id = Some(&row.claim.data().selection.package_id);
    if let AnnualTariffSelection::Selected {
        package, versions, ..
    } = selected
    {
        let package = *package;
        source.package_id = Some(&package.package_id);
        source.version_id = Some(&package.version_id);
        source.package_valid_from = Some(&package.valid_from);
        source.package_valid_to = package.valid_to.as_deref();
        for package in versions {
            let package = *package;
            let ids: BTreeSet<&str> = package.rules()["annualPaymentRules"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|r| {
                    selection::matches(r, row.claim.data().year, &row.claim.data().selection)
                })
                .flat_map(|r| {
                    r["sourceIds"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(Value::as_str)
                })
                .collect();
            for r in package
                .sources()
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter(|r| r["id"].as_str().is_some_and(|id| ids.contains(id)))
            {
                source.references.push(SourceReference {
                    id: r["id"]
                        .as_str()
                        .map(|id| Cow::Owned(format!("{}:{id}", package.version_id))),
                    title: r["title"].as_str(),
                    url: r["url"].as_str(),
                    section: r["section"].as_str(),
                });
            }
        }
    }
    source
}
/// The retained collection includes cross-year actual cash payments and all
/// same-year split-claim facts; current employment family alone is insufficient.
pub fn calculate_tariff_annual_payments<'a>(
    month: &str,
    saved: &'a ValidatedSavedClaims,
    resolver: &'a RuleResolver,
) -> Result<AnnualResult<'a>, TariffAnnualComposeError> {
    let first = remuneration_month_start(month)?;
    let active: Vec<_> = saved
        .records()
        .iter()
        .filter(|r| {
            !r.revoked && (r.claim.data().version.number() != 3 || r.actual_payment.is_some())
        })
        .collect();
    let blocked = allocation_issues(&active)?;
    let mut positions = vec![];
    for row in active {
        let claim = row.claim.data();
        let actual = row.actual_payment.as_ref();
        if actual.map_or(claim.year != i32::from(first.year()), |a| {
            a.payout_month != month
        }) {
            continue;
        }
        let selected = if actual.is_some() {
            AnnualTariffSelection::Unavailable {
                code: AnnualIssueCode::AnnualRuleMissing,
            }
        } else {
            select_annual_tariff(claim.year, &claim.selection, resolver)?
        };
        let estimate = if actual.is_none() {
            match &selected {
                AnnualTariffSelection::Selected { package, .. } => {
                    Some(calculate_checked_tariff_annual_claim(package, &row.claim)?)
                }
                _ => None,
            }
        } else {
            None
        };
        let expected_payout = match &selected {
            AnnualTariffSelection::Selected { rule, .. } => rule["payoutMonth"]
                .as_i64()
                .map(|m| format!("{}-{m:02}", claim.year)),
            _ => None,
        };
        if actual.is_none() && expected_payout.as_deref().is_some_and(|m| m != month) {
            continue;
        }
        let split = blocked.contains(&claim.year);
        let amount = if split {
            None
        } else if let Some(actual) = actual {
            Some(actual.gross_cents)
        } else {
            estimate.as_ref().and_then(|e| e.amount_cents)
        };
        let code = if split {
            Some(AnnualIssueCode::AnnualAllocationUnconfirmed)
        } else if actual.is_some() {
            None
        } else if let AnnualTariffSelection::Unavailable { code } = &selected {
            Some(*code)
        } else if amount.is_none() {
            Some(AnnualIssueCode::AnnualInputMissing)
        } else {
            None
        };
        let versions = match &selected {
            AnnualTariffSelection::Selected { versions, .. } => {
                versions.iter().map(|p| p.version_id.clone()).collect()
            }
            _ => vec![],
        };
        let twelfths = estimate.as_ref().and_then(|e| e.twelfths.as_ref());
        let missing = if split {
            vec!["allocation.multipleClaims".into()]
        } else if actual.is_some() {
            vec![]
        } else if let AnnualTariffSelection::Unavailable { code } = &selected {
            vec![
                match code {
                    AnnualIssueCode::AnnualRuleMissing => "ANNUAL_RULE_MISSING",
                    AnnualIssueCode::AnnualRuleAmbiguous => "ANNUAL_RULE_AMBIGUOUS",
                    _ => "ANNUAL_RULE_INVALID",
                }
                .into(),
            ]
        } else {
            estimate
                .as_ref()
                .map(|e| e.missing.clone())
                .unwrap_or_default()
        };
        positions.push(AnnualPosition{id:format!("tariff-annual:{}:{}",claim.year,claim.id),kind:AnnualPositionKind::AnnualPayment,label:format!("Tarifliche Jahressonderzahlung {}",claim.year),from:first.to_string(),through:format!("{month}-{:02}",first.days_in_month()),amount_cents:amount,status:if amount.is_none(){RemunerationStatus::Unavailable}else if actual.is_some(){RemunerationStatus::Calculated}else{RemunerationStatus::Estimated},source:source_for(row,&selected,actual.is_some()),basis:AnnualBasis{payment_id:claim.id.clone(),entitlement_year:claim.year,method:if actual.is_some(){AnnualMethod::Actual}else{AnnualMethod::Percent},full_amount_cents:None,confirmed_basis_cents:estimate.as_ref().and_then(|e|e.basis_cents),percentage_basis_points:estimate.as_ref().and_then(|e|e.rate_basis_points),entitlement_months:twelfths.map(|t|t.numerator as f64/t.denominator as f64),actual_revision:actual.map(|_|row.revision),tariff:Some(TariffBasis{claim_revision:Some(row.revision),rule_id:estimate.as_ref().and_then(|e|e.rule_id.clone()),versions,basis_method:estimate.as_ref().and_then(|e|e.basis_method).map(|m|m.text().into()),basis_months:estimate.as_ref().map(|e|e.basis_months.clone()).unwrap_or_default(),twelfths:twelfths.map(|t|Twelfths{numerator:t.numerator,denominator:t.denominator}),missing})},issue:code.map(|code|AnnualIssue{code,message:match code{AnnualIssueCode::AnnualAllocationUnconfirmed=>"Mehrere Jahresansprüche sind nicht eindeutig aufgeteilt oder überschreiten zusammen zwölf Zwölftel. Bitte Zuordnung prüfen.",AnnualIssueCode::AnnualInputMissing=>"Für die tarifliche Jahressonderzahlung fehlen bestätigte Anspruchs- oder Bemessungsangaben.",_=>"Für diesen Jahresanspruch fehlt eine eindeutige, gültige Tarifregel. Betrag und gegebenenfalls Auszahlungsmonat bleiben offen."}.into()})});
    }
    Ok(summarize_annual(positions))
}
