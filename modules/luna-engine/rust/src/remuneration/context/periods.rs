use super::model::*;
use super::resolve::resolve_context;
use crate::rules::RuleResolver;
use serde_json::Value;

pub fn remuneration_month_start(month: &str) -> Result<jiff::civil::Date, ContextError> {
    if month.len() != 7
        || month.as_bytes()[4] != b'-'
        || month < "1900-01"
        || month
            .bytes()
            .enumerate()
            .any(|(i, b)| i != 4 && !b.is_ascii_digit())
    {
        return Err(ContextError::InvalidMonth);
    }
    format!("{month}-01")
        .parse()
        .map_err(|_| ContextError::InvalidMonth)
}
fn same_context(a: &RemunerationContext<'_>, b: &RemunerationContext<'_>) -> bool {
    if !match (a.profile, b.profile) {
        (None, None) => true,
        (Some(a), Some(b)) => std::ptr::eq(a, b),
        _ => false,
    } {
        return false;
    }
    let same_package = || {
        a.kind
            .rule_package()
            .zip(b.kind.rule_package())
            .is_some_and(|(a, b)| std::ptr::eq(a, b))
    };
    match (&a.kind, &b.kind) {
        (ContextKind::Unavailable { issue: left }, ContextKind::Unavailable { issue: right }) => {
            left.code == right.code
                && a.source.package_id == b.source.package_id
                && a.source.version_id == b.source.version_id
        }
        (ContextKind::Tariff { .. }, ContextKind::Tariff { .. })
        | (ContextKind::TvoedAnnexADraft { .. }, ContextKind::TvoedAnnexADraft { .. })
        | (ContextKind::TvoedSueDraft { .. }, ContextKind::TvoedSueDraft { .. })
        | (ContextKind::TrainingTariff { .. }, ContextKind::TrainingTariff { .. }) => {
            same_package()
        }
        (
            ContextKind::TvalTraining {
                monthly_cents: a,
                full_time_weekly_minutes: aw,
                ..
            },
            ContextKind::TvalTraining {
                monthly_cents: b,
                full_time_weekly_minutes: bw,
                ..
            },
        )
        | (
            ContextKind::TvlKr {
                monthly_cents: a,
                full_time_weekly_minutes: aw,
                ..
            },
            ContextKind::TvlKr {
                monthly_cents: b,
                full_time_weekly_minutes: bw,
                ..
            },
        ) => same_package() && a == b && aw == bw,
        (ContextKind::OwnMonthly { .. }, ContextKind::OwnMonthly { .. })
        | (ContextKind::OwnConfigured { .. }, ContextKind::OwnConfigured { .. }) => true,
        _ => false,
    }
}
pub fn resolve_month<'a>(
    month: &str,
    history: &'a [Value],
    resolver: &'a RuleResolver,
    validation: &impl NativePackageValidator,
) -> Result<Vec<RemunerationPeriod<'a>>, ContextError> {
    let first = remuneration_month_start(month)?;
    let mut periods: Vec<RemunerationPeriod<'a>> = vec![];
    for offset in 0..i64::from(first.days_in_month()) {
        let date = first
            .checked_add(jiff::Span::new().days(offset))
            .map_err(|_| ContextError::InvalidMonth)?
            .to_string();
        let context = resolve_context(&date, history, resolver, validation)?;
        if let Some(previous) = periods
            .last_mut()
            .filter(|p| same_context(&p.context, &context))
        {
            previous.through = date;
        } else {
            periods.push(RemunerationPeriod {
                from: date.clone(),
                through: date,
                context,
            });
        }
    }
    Ok(periods)
}
