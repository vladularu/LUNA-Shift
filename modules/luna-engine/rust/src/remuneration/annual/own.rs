use super::{AnnualError, actual::validate_actual_own_annual_payments, model::*};
use crate::{
    employment::require_remuneration_date,
    remuneration::{
        base::{model::RemunerationStatus, round_remuneration_cents},
        context::{
            model::{ContextKind, FullNativePackageValidator, RemunerationSource},
            periods::remuneration_month_start,
            resolve::resolve_context,
        },
        own_config::{SpecialAmount, SpecialPayment},
    },
    rules::RuleResolver,
};
use serde_json::Value;
use std::collections::BTreeSet;
struct Candidate<'a> {
    payment: SpecialPayment,
    source: RemunerationSource<'a>,
    payout_month: String,
    ambiguous: bool,
}
fn terms(payment: &SpecialPayment) -> Result<String, AnnualError> {
    serde_json::to_string(&(
        &payment.title,
        payment.payout_month,
        payment.entitlement_months,
        &payment.amount,
    ))
    .map_err(|_| AnnualError::Encoding)
}
fn candidates<'a>(
    year: i16,
    history: &'a [Value],
    resolver: &'a RuleResolver,
) -> Result<Vec<Candidate<'a>>, AnnualError> {
    let first = format!("{year}-01-01");
    let last = format!("{year}-12-31");
    let mut boundaries = BTreeSet::from([first.clone()]);
    for p in history {
        if p.get("effectiveFrom") == Some(&Value::Null) {
            continue;
        }
        let date = p["effectiveFrom"]
            .as_str()
            .ok_or(crate::employment::EmploymentError::InvalidDate)?;
        require_remuneration_date(date)?;
        if date > first.as_str() && date <= last.as_str() {
            boundaries.insert(date.into());
        }
    }
    let boundaries: Vec<_> = boundaries.into_iter().collect();
    let mut result: Vec<Candidate<'a>> = vec![];
    for (index, from) in boundaries.iter().enumerate() {
        let through = if let Some(next) = boundaries.get(index + 1) {
            next.parse::<jiff::civil::Date>()
                .map_err(|_| AnnualError::InvalidInput)?
                .checked_sub(jiff::Span::new().days(1))
                .map_err(|_| AnnualError::InvalidInput)?
                .to_string()
        } else {
            last.clone()
        };
        let context = resolve_context(from, history, resolver, &FullNativePackageValidator)?;
        let ContextKind::OwnConfigured { configuration, .. } = &context.kind else {
            continue;
        };
        for payment in configuration.special_payments() {
            let payout = format!("{year}-{:02}", payment.payout_month);
            let start = remuneration_month_start(&payout)?;
            let begin = from
                .as_str()
                .max(&payment.valid_from)
                .max(&start.to_string())
                .to_owned();
            let end = through
                .as_str()
                .min(payment.valid_to.as_deref().unwrap_or(&last))
                .min(&format!("{payout}-{:02}", start.days_in_month()))
                .to_owned();
            if begin > end {
                continue;
            }
            if let Some(previous) = result
                .iter_mut()
                .find(|previous| previous.payment.id == payment.id)
            {
                previous.ambiguous |= terms(&previous.payment)? != terms(payment)?;
                if payout < previous.payout_month {
                    previous.payout_month = payout;
                }
            } else {
                result.push(Candidate {
                    payment: payment.clone(),
                    source: context.source.clone(),
                    payout_month: payout,
                    ambiguous: false,
                });
            }
        }
    }
    Ok(result)
}
pub fn calculate_own_annual_payments<'a>(
    month: &str,
    history: &'a [Value],
    actual_payments: &Value,
    resolver: &'a RuleResolver,
) -> Result<AnnualResult<'a>, AnnualError> {
    let first = remuneration_month_start(month)?;
    let actuals = validate_actual_own_annual_payments(actual_payments)?;
    calculate_checked(month, first, history, &actuals, resolver)
}
/// Borrow admitted SQL rows directly; no Value::Array clone of active records.
pub fn calculate_own_annual_payment_rows<'a>(
    month: &str,
    history: &'a [Value],
    actual_payments: &[Value],
    resolver: &'a RuleResolver,
) -> Result<AnnualResult<'a>, AnnualError> {
    let first = remuneration_month_start(month)?;
    let actuals = super::actual::validate_actual_own_annual_payment_rows(actual_payments)?;
    calculate_checked(month, first, history, &actuals, resolver)
}
fn calculate_checked<'a>(
    month: &str,
    first: jiff::civil::Date,
    history: &'a [Value],
    actuals: &[super::actual::ActualOwnAnnualPayment<'_>],
    resolver: &'a RuleResolver,
) -> Result<AnnualResult<'a>, AnnualError> {
    let mut positions = vec![];
    let from = first.to_string();
    let through = format!("{month}-{:02}", first.days_in_month());
    for candidate in candidates(first.year(), history, resolver)? {
        let p = &candidate.payment;
        if candidate.payout_month != month
            || actuals
                .iter()
                .any(|a| a.payment_id == p.id && a.entitlement_year == i32::from(first.year()))
        {
            continue;
        }
        let basis = match p.amount {
            SpecialAmount::Percent {
                confirmed_basis_cents,
                ..
            } => confirmed_basis_cents,
            _ => None,
        };
        let missing = p.entitlement_months.is_none()
            || matches!(p.amount, SpecialAmount::Percent { .. }) && basis.is_none();
        let amount = if candidate.ambiguous || missing {
            None
        } else {
            Some(match p.amount {
                SpecialAmount::Fixed { cents } => round_remuneration_cents(
                    cents as f64 * p.entitlement_months.ok_or(AnnualError::InvalidInput)? as f64,
                    12.0,
                )?,
                SpecialAmount::Percent { basis_points, .. } => round_remuneration_cents(
                    basis.ok_or(AnnualError::InvalidInput)? as f64
                        * basis_points as f64
                        * p.entitlement_months.ok_or(AnnualError::InvalidInput)? as f64,
                    120_000.0,
                )?,
            })
        };
        positions.push(AnnualPosition{id:format!("own-annual:{}:{}",first.year(),p.id),kind:AnnualPositionKind::AnnualPayment,label:p.title.clone(),from:from.clone(),through:through.clone(),amount_cents:amount,status:if amount.is_none(){RemunerationStatus::Unavailable}else{RemunerationStatus::Estimated},source:candidate.source,basis:AnnualBasis{payment_id:p.id.clone(),entitlement_year:i32::from(first.year()),method:if matches!(p.amount,SpecialAmount::Fixed{..}){AnnualMethod::Fixed}else{AnnualMethod::Percent},full_amount_cents:match p.amount{SpecialAmount::Fixed{cents}=>Some(cents),_=>None},confirmed_basis_cents:basis,percentage_basis_points:match p.amount{SpecialAmount::Percent{basis_points,..}=>Some(basis_points),_=>None},entitlement_months:p.entitlement_months.map(|n|n as f64),actual_revision:None,tariff:None},issue:if candidate.ambiguous{Some(AnnualIssue{code:AnnualIssueCode::AnnualTermsAmbiguous,message:format!("Die Angaben für „{}“ wechseln im Auszahlungszeitraum. Bitte die Sonderzahlung für dieses Jahr eindeutig bestätigen.",p.title)})}else if missing{Some(AnnualIssue{code:AnnualIssueCode::AnnualInputMissing,message:format!("Für „{}“ fehlen bestätigte Anspruchsmonate oder die Berechnungsgrundlage.",p.title)})}else{None}});
    }
    for actual in actuals.iter().filter(|a| a.payout_month == month) {
        positions.push(AnnualPosition {
            id: format!(
                "own-annual:{}:{}",
                actual.entitlement_year, actual.payment_id
            ),
            kind: AnnualPositionKind::AnnualPayment,
            label: actual.title.into(),
            from: from.clone(),
            through: through.clone(),
            amount_cents: Some(actual.gross_cents),
            status: RemunerationStatus::Calculated,
            issue: None,
            source: RemunerationSource::new(None, None),
            basis: AnnualBasis {
                payment_id: actual.payment_id.into(),
                entitlement_year: actual.entitlement_year,
                method: AnnualMethod::Actual,
                full_amount_cents: None,
                confirmed_basis_cents: None,
                percentage_basis_points: None,
                entitlement_months: None,
                actual_revision: Some(actual.revision),
                tariff: None,
            },
        });
    }
    Ok(summarize_annual(positions))
}
