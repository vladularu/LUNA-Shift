use super::{
    OvertimeError, families, integer, legacy,
    own::{self, unavailable},
    prepared::OvertimeAllocationIndex,
    saved::{
        SavedOvertimeAllocation, is_current_overtime_allocation, validate_overtime_allocation,
    },
};
use crate::{
    pay::pattern::is_pay_work_shift,
    remuneration::{
        allowances::model::*,
        base::{
            model::RemunerationStatus,
            shift_days::{remuneration_month_shifts, remuneration_shift_days},
        },
        context::{
            model::{ContextKind, FullNativePackageValidator, IssueCode, RemunerationContext},
            periods::remuneration_month_start,
            resolve::resolve_context,
        },
    },
    rules::RuleResolver,
};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub struct OvertimeInput<'a> {
    pub work_profile: &'a Value,
    pub history: &'a [Value],
}
#[derive(Default)]
pub struct ShiftOvertimeOptions<'a> {
    pub allocations: Option<&'a [Value]>,
    pub included_month: Option<&'a str>,
    pub saved_allocation: Option<&'a Value>,
}
fn position<'a>(
    shift: &Value,
    date: &str,
    through: &str,
    minutes: f64,
    context: &RemunerationContext<'a>,
) -> Result<SupplementPosition<'a>, OvertimeError> {
    let mut basis = SupplementBasis::empty(
        0,
        i32::from(remuneration_month_start(&date[..7])?.days_in_month()),
    );
    basis.shift_id = shift["id"].as_str().map(str::to_owned);
    basis.minutes = minutes;
    basis.proration = Proration::WorkedMinutes;
    Ok(SupplementPosition {
        id: format!(
            "overtime:{}:{date}",
            shift["id"].as_str().ok_or(OvertimeError::InvalidInput)?
        ),
        kind: SupplementKind::OvertimeBase,
        label: "Überstunden-Grundvergütung".into(),
        from: date.into(),
        through: through.into(),
        amount_cents: Some(0),
        status: RemunerationStatus::Calculated,
        source: context.source.clone(),
        basis,
        issue: None,
    })
}
fn allocated<'a>(
    mut position: SupplementPosition<'a>,
    context: &RemunerationContext<'a>,
    shift: &Value,
    work: &Value,
) -> Result<Vec<SupplementPosition<'a>>, OvertimeError> {
    match &context.kind {
        ContextKind::Unavailable { issue } => {
            position.amount_cents = None;
            position.status = RemunerationStatus::Unavailable;
            position.issue = Some(issue.clone().into());
            Ok(vec![position])
        }
        ContextKind::TvoedAnnexADraft { .. } | ContextKind::TvoedSueDraft { .. } => {
            position.amount_cents = None;
            position.status = RemunerationStatus::Unavailable;
            position.issue = Some(SupplementIssue::context(
                IssueCode::TariffUnsupported,
                if matches!(context.kind, ContextKind::TvoedAnnexADraft { .. }) {
                    "Die TVöD-Anlage-A-Überstundenregeln sind noch nicht fachlich freigegeben."
                } else {
                    "SuE-Überstunden sind für diesen Tabellenentwurf noch nicht berechenbar."
                },
            ));
            Ok(vec![position])
        }
        ContextKind::TrainingTariff { .. }
        | ContextKind::TvlKr { .. }
        | ContextKind::TvalTraining { .. } => families::calculate(position, context),
        ContextKind::OwnConfigured { configuration, .. } => own::calculate(position, configuration),
        ContextKind::OwnMonthly { .. } => Ok(vec![unavailable(
            position,
            SupplementIssueKind::OwnOvertimeUnconfigured,
            "Für die eigene Vergütung ist die Überstunden-Auszahlungsbasis noch nicht bestätigt.",
        )]),
        ContextKind::Tariff { .. } => legacy::calculate(position, context, shift, work),
    }
}
fn empty<'a>() -> SupplementResult<'a> {
    summarize_supplements(vec![])
}
fn shift_from_validated<'a>(
    shift: &Value,
    input: &OvertimeInput<'a>,
    resolver: &'a RuleResolver,
    allocations: Option<&[Value]>,
    included_month: Option<&str>,
    saved: Option<(&Value, &SavedOvertimeAllocation<'_>)>,
) -> Result<SupplementResult<'a>, OvertimeError> {
    if let Some(month) = included_month {
        remuneration_month_start(month)?;
    }
    if shift.get("deletedAt") != Some(&Value::Null)
        || !is_pay_work_shift(shift)
        || shift["tariffOvertimeConfirmed"] != true
        || shift["overtimeMinutes"].as_f64() == Some(0.0)
    {
        return Ok(empty());
    }
    let zone = input.work_profile["timeZone"]
        .as_str()
        .ok_or(OvertimeError::InvalidInput)?;
    let days = remuneration_shift_days(shift, zone)?;
    let overtime = shift["overtimeMinutes"]
        .as_f64()
        .ok_or(OvertimeError::InvalidInput)?;
    if days.is_empty() {
        let date = shift["date"].as_str().ok_or(OvertimeError::InvalidInput)?;
        if included_month.is_some_and(|month| !date.starts_with(&format!("{month}-"))) {
            return Ok(empty());
        }
        let context = resolve_context(date, input.history, resolver, &FullNativePackageValidator)?;
        return Ok(summarize_supplements(vec![unavailable(
            position(shift, date, date, overtime, &context)?,
            SupplementIssueKind::OvertimeMinutesInvalid,
            "Bestätigte Überstunden benötigen tatsächliche Dienstzeit.",
        )]));
    }
    let indices: Vec<usize> = days
        .iter()
        .enumerate()
        .filter(|(_, d)| {
            included_month.is_none_or(|month| d.date.starts_with(&format!("{month}-")))
        })
        .map(|(i, _)| i)
        .collect();
    if indices.is_empty() {
        return Ok(empty());
    }
    let contexts = days
        .iter()
        .map(|d| {
            resolve_context(
                &d.date,
                input.history,
                resolver,
                &FullNativePackageValidator,
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    let first_index = indices[0];
    let whole = position(
        shift,
        &days[first_index].date,
        &days[*indices.last().ok_or(OvertimeError::InvalidInput)?].date,
        overtime,
        &contexts[first_index],
    )?;
    let net = days.iter().map(|d| d.net_minutes).sum::<f64>();
    if let Some((raw, saved)) = saved
        && !is_current_overtime_allocation(raw, shift, zone)
    {
        return Ok(summarize_supplements(vec![unavailable(
            whole,
            SupplementIssueKind::OvertimeAllocationRequired,
            if saved.allocations.is_none() {
                "Die Tagesaufteilung wurde aufgehoben. Bitte die Überstunden erneut den jeweiligen Tagen zuordnen."
            } else {
                "Dienst oder Zeitzone stimmen nicht mehr mit der gespeicherten Tagesaufteilung überein. Bitte die Überstunden erneut bestätigen."
            },
        )]));
    }
    if integer(&shift["overtimeMinutes"]).is_none() || overtime < 0.0 || overtime > net {
        return Ok(summarize_supplements(vec![unavailable(
            whole,
            SupplementIssueKind::OvertimeMinutesInvalid,
            "Bestätigte Überstunden dürfen die tatsächliche Dienstzeit nicht überschreiten.",
        )]));
    }
    let raw_allocations: Option<Vec<(&str, f64)>> = if let Some((_, saved)) = saved {
        Some(
            saved
                .allocations
                .as_ref()
                .ok_or(OvertimeError::InvalidInput)?
                .iter()
                .map(|d| (d.date, d.minutes as f64))
                .collect(),
        )
    } else {
        allocations
            .map(|rows| {
                rows.iter()
                    .map(|r| {
                        Ok((
                            r["date"].as_str().ok_or(OvertimeError::InvalidAllocation)?,
                            r["minutes"]
                                .as_f64()
                                .ok_or(OvertimeError::InvalidAllocation)?,
                        ))
                    })
                    .collect::<Result<Vec<_>, OvertimeError>>()
            })
            .transpose()?
    };
    if let Some(mut allocations) = raw_allocations {
        let mut seen = BTreeSet::new();
        let valid = allocations.iter().all(|(date, minutes)| {
            days.iter().find(|d| d.date == *date).is_some_and(|d| {
                seen.insert(*date)
                    && minutes.is_finite()
                    && minutes.fract() == 0.0
                    && *minutes >= 0.0
                    && *minutes <= crate::money::MAX_SAFE_INTEGER as f64
                    && *minutes <= d.until - d.from
            })
        });
        if !valid || allocations.iter().map(|(_, minutes)| *minutes).sum::<f64>() != overtime {
            return Err(OvertimeError::InvalidAllocation);
        }
        allocations.sort_by(|a, b| a.0.cmp(b.0));
        let mut grouped: Vec<(String, SupplementPosition<'a>, usize)> = vec![];
        for (date, minutes) in allocations {
            if minutes == 0.0
                || included_month.is_some_and(|month| !date.starts_with(&format!("{month}-")))
            {
                continue;
            }
            let index = days
                .iter()
                .position(|d| d.date == date)
                .ok_or(OvertimeError::InvalidAllocation)?;
            let k = legacy::context_key(&contexts[index], date, input.work_profile, shift)?;
            if let Some((_, prior, prior_index)) = grouped.iter_mut().find(|(old, _, _)| *old == k)
            {
                prior.through = date.into();
                prior.basis.minutes += minutes;
                *prior_index = index;
            } else {
                grouped.push((
                    k,
                    position(shift, date, date, minutes, &contexts[index])?,
                    index,
                ));
            }
        }
        let mut positions = vec![];
        for (_, p, index) in grouped {
            positions.extend(allocated(p, &contexts[index], shift, input.work_profile)?);
        }
        return Ok(summarize_supplements(positions));
    }
    let k = legacy::context_key(&contexts[0], &days[0].date, input.work_profile, shift)?;
    let same = contexts
        .iter()
        .zip(&days)
        .map(|(context, day)| legacy::context_key(context, &day.date, input.work_profile, shift))
        .collect::<Result<Vec<_>, _>>()?
        .iter()
        .all(|key| *key == k);
    if !same {
        return Ok(summarize_supplements(vec![unavailable(
            whole,
            SupplementIssueKind::OvertimeAllocationRequired,
            "Bitte bestätigte Überstunden den jeweiligen Tagen zuordnen; der Dienst überschreitet einen Vergütungs- oder Monatswechsel.",
        )]));
    }
    Ok(summarize_supplements(allocated(
        whole,
        &contexts[0],
        shift,
        input.work_profile,
    )?))
}
pub fn calculate_dated_shift_overtime<'a>(
    shift: &Value,
    input: &OvertimeInput<'a>,
    resolver: &'a RuleResolver,
    options: &ShiftOvertimeOptions<'_>,
) -> Result<SupplementResult<'a>, OvertimeError> {
    if options.allocations.is_some() && options.saved_allocation.is_some() {
        return Err(OvertimeError::MixedAllocations);
    }
    let saved = options
        .saved_allocation
        .map(validate_overtime_allocation)
        .transpose()?;
    shift_from_validated(
        shift,
        input,
        resolver,
        options.allocations,
        options.included_month,
        options.saved_allocation.zip(saved.as_ref()),
    )
}
pub fn calculate_monthly_dated_overtime<'a>(
    month: &str,
    shifts: &[Value],
    input: &OvertimeInput<'a>,
    resolver: &'a RuleResolver,
    allocations: &BTreeMap<String, Vec<Value>>,
    saved_allocations: &[Value],
) -> Result<SupplementResult<'a>, OvertimeError> {
    monthly(
        month,
        shifts,
        input,
        resolver,
        allocations,
        saved_allocations,
        None,
    )
}
pub fn calculate_monthly_dated_overtime_prepared<'a>(
    month: &str,
    shifts: &[Value],
    input: &OvertimeInput<'a>,
    resolver: &'a RuleResolver,
    allocations: &BTreeMap<String, Vec<Value>>,
    saved: &OvertimeAllocationIndex,
) -> Result<SupplementResult<'a>, OvertimeError> {
    monthly(
        month,
        shifts,
        input,
        resolver,
        allocations,
        saved.raw(),
        Some(saved),
    )
}
fn monthly<'a>(
    month: &str,
    shifts: &[Value],
    input: &OvertimeInput<'a>,
    resolver: &'a RuleResolver,
    allocations: &BTreeMap<String, Vec<Value>>,
    saved_allocations: &[Value],
    prepared: Option<&OvertimeAllocationIndex>,
) -> Result<SupplementResult<'a>, OvertimeError> {
    if !allocations.is_empty() && !saved_allocations.is_empty() {
        return Err(OvertimeError::MixedAllocations);
    }
    let mut saved_by_shift = BTreeMap::new();
    if let Some(prepared) = prepared {
        if !prepared.matches(saved_allocations) {
            return Err(OvertimeError::InvalidInput);
        }
    } else {
        for raw in saved_allocations {
            let saved = validate_overtime_allocation(raw)?;
            if saved_by_shift.contains_key(saved.shift_id) {
                return Err(OvertimeError::DuplicateSaved);
            }
            saved_by_shift.insert(saved.shift_id, (raw, saved));
        }
    }
    let mut positions = vec![];
    for shift in remuneration_month_shifts(month, shifts)? {
        let id = shift["id"].as_str().ok_or(OvertimeError::InvalidInput)?;
        let prepared_row = prepared.and_then(|index| index.get(id));
        let saved = if prepared.is_some() {
            prepared_row.as_ref().map(|(raw, saved)| (*raw, saved))
        } else {
            saved_by_shift.get(id).map(|(raw, saved)| (*raw, saved))
        };
        positions.extend(
            shift_from_validated(
                shift,
                input,
                resolver,
                allocations.get(id).map(Vec::as_slice),
                Some(month),
                saved,
            )?
            .positions,
        );
    }
    Ok(summarize_supplements(positions))
}
