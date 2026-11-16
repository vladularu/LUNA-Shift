use super::{AllowanceError, model::*};
use crate::{
    remuneration::{
        base::{model::RemunerationStatus, round_remuneration_cents},
        context::{
            model::{ContextKind, FullNativePackageValidator, IssueCode},
            periods::{remuneration_month_start, resolve_month},
        },
        own_config::PartialMonth,
    },
    rules::RuleResolver,
};
use serde_json::Value;

/// Personal fixed amounts already reflect part time; apply only confirmed calendar proration.
pub fn calculate_own_monthly_allowances<'a>(
    month: &str,
    history: &'a [Value],
    resolver: &'a RuleResolver,
) -> Result<Vec<SupplementPosition<'a>>, AllowanceError> {
    let first = remuneration_month_start(month)?;
    if !history
        .iter()
        .any(|p| p["data"]["selection"]["kind"] == "own-configured")
    {
        return Ok(vec![]);
    }
    let mut result = vec![];
    for period in resolve_month(month, history, resolver, &FullNativePackageValidator)? {
        let ContextKind::OwnConfigured { configuration, .. } = &period.context.kind else {
            continue;
        };
        for allowance in configuration.fixed_allowances() {
            let from = allowance.valid_from.as_str().max(&period.from);
            let through = allowance
                .valid_to
                .as_deref()
                .map_or(period.through.as_str(), |to| to.min(&period.through));
            if from > through {
                continue;
            }
            let start: jiff::civil::Date =
                from.parse().map_err(|_| AllowanceError::InvalidInput)?;
            let end: jiff::civil::Date =
                through.parse().map_err(|_| AllowanceError::InvalidInput)?;
            let days = start
                .until(end)
                .map_err(|_| AllowanceError::InvalidInput)?
                .get_days()
                + 1;
            let full = days == i32::from(first.days_in_month());
            let confirmed = full || allowance.partial_month == PartialMonth::CalendarDays;
            let mut basis = SupplementBasis::empty(days, i32::from(first.days_in_month()));
            basis.rule_id = Some(allowance.id.clone());
            basis.personal_monthly_cents = Some(allowance.monthly_cents);
            basis.proration = if full {
                Proration::None
            } else if allowance.partial_month == PartialMonth::CalendarDays {
                Proration::CalendarDays
            } else {
                Proration::Unconfirmed
            };
            result.push(SupplementPosition {
                id: format!("own-allowance:{}:{from}", allowance.id),
                kind: SupplementKind::Allowance,
                label: allowance.title.clone(),
                from: from.into(),
                through: through.into(),
                source: period.context.source.clone(),
                basis,
                amount_cents: if confirmed {
                    Some(round_remuneration_cents(
                        allowance.monthly_cents as f64 * days as f64,
                        first.days_in_month() as f64,
                    )?)
                } else {
                    None
                },
                status: if confirmed {
                    RemunerationStatus::Calculated
                } else {
                    RemunerationStatus::Unavailable
                },
                issue: (!confirmed).then(|| {
                    SupplementIssue::context(
                        IssueCode::OwnProrationUnconfirmed,
                        format!(
                            "Bitte die Teilmonatsberechnung für „{}“ bestätigen.",
                            allowance.title
                        ),
                    )
                }),
            });
        }
    }
    Ok(result)
}
