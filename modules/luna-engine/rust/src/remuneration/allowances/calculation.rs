use super::{
    AllowanceError,
    burn::calculate_care_burn,
    care::calculate_care_allowances,
    general::{Bucket, DayWork, create_bucket, finish_bucket},
    model::*,
    own::calculate_own_monthly_allowances,
    shift::{AllowanceDay, calculate_shift_allowances},
};
use crate::remuneration::assessment::model::Entitlement;
use crate::{
    remuneration::{
        base::{
            model::RemunerationStatus,
            shift_days::{remuneration_month_shifts, remuneration_shift_days},
        },
        context::{
            model::{ContextKind, FullNativePackageValidator},
            periods::remuneration_month_start,
            resolve::resolve_context,
        },
    },
    rules::RuleResolver,
};
use serde_json::Value;
use std::{borrow::Cow, collections::BTreeMap};

pub struct AllowanceInput<'a> {
    pub work_profile: &'a Value,
    pub history: &'a [Value],
    pub entitlements: &'a [Value],
    pub tvl_shift_work: &'a [Value],
}
pub struct AllowanceContextInput<'a> {
    pub work_profile: &'a Value,
    pub history: &'a [Value],
    pub tvl_shift_work: &'a [Value],
}
enum EntitlementSource<'raw, 'derived> {
    Raw(&'raw [Value]),
    Derived(&'derived [Entitlement]),
}
impl<'raw> EntitlementSource<'raw, '_> {
    fn validate(&self) -> Result<(), AllowanceError> {
        match self {
            Self::Raw(rows) => validate_entitlements(rows),
            Self::Derived(rows) => {
                let rows = rows
                    .iter()
                    .map(serde_json::to_value)
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|_| AllowanceError::Encoding)?;
                validate_entitlements(&rows)
            }
        }
    }
    fn at(&self, date: &str) -> Result<Option<Cow<'raw, Value>>, AllowanceError> {
        let mut result = None;
        match self {
            Self::Raw(rows) => {
                for row in *rows {
                    if row["from"].as_str().is_some_and(|from| from <= date)
                        && row["through"].as_str().is_some_and(|to| date <= to)
                    {
                        if result.is_some() {
                            return Err(AllowanceError::OverlappingEntitlements);
                        }
                        result = Some(Cow::Borrowed(row));
                    }
                }
            }
            Self::Derived(rows) => {
                for row in *rows {
                    if row.from.as_str() <= date && date <= row.through.as_str() {
                        if result.is_some() {
                            return Err(AllowanceError::OverlappingEntitlements);
                        }
                        result = Some(Cow::Owned(
                            serde_json::to_value(row).map_err(|_| AllowanceError::Encoding)?,
                        ));
                    }
                }
            }
        }
        Ok(result)
    }
}
fn validate_entitlements(entitlements: &[Value]) -> Result<(), AllowanceError> {
    for e in entitlements {
        let date = |key: &str| {
            e[key]
                .as_str()
                .filter(|s| {
                    s.len() == 10
                        && s.bytes().enumerate().all(|(i, b)| {
                            if [4, 7].contains(&i) {
                                b == b'-'
                            } else {
                                b.is_ascii_digit()
                            }
                        })
                })
                .and_then(|s| {
                    s.parse::<jiff::civil::Date>()
                        .ok()
                        .filter(|date| date.to_string() == s)
                })
        };
        let from = date("from").ok_or(AllowanceError::InvalidEntitlement)?;
        let through = date("through").ok_or(AllowanceError::InvalidEntitlement)?;
        if from > through
            || !matches!(
                e["status"].as_str(),
                Some(
                    "NONE"
                        | "SHIFT_MONTHLY"
                        | "SHIFT_HOURLY"
                        | "ALTERNATING_MONTHLY"
                        | "ALTERNATING_HOURLY"
                )
            )
            || !matches!(e["origin"].as_str(), Some("confirmed" | "estimated"))
            || !e.get("revision").is_some_and(|r| {
                r.is_null()
                    || r.as_f64().is_some_and(|n| {
                        n.fract() == 0.0
                            && (1.0..=crate::money::MAX_SAFE_INTEGER as f64).contains(&n)
                    })
            })
        {
            return Err(AllowanceError::InvalidEntitlement);
        }
    }
    Ok(())
}
pub fn calculate_monthly_dated_allowances<'a>(
    month: &str,
    shifts: &[Value],
    input: &AllowanceInput<'a>,
    resolver: &'a RuleResolver,
) -> Result<SupplementResult<'a>, AllowanceError> {
    calculate_inner(
        month,
        shifts,
        &AllowanceContextInput {
            work_profile: input.work_profile,
            history: input.history,
            tvl_shift_work: input.tvl_shift_work,
        },
        resolver,
        EntitlementSource::Raw(input.entitlements),
    )
}
/// Production assessed composition consumes only native typed assessment facts.
/// Raw confirmations stay borrowed; small derived facts are owned by their result.
pub fn calculate_allowances_from_native_assessment<'a>(
    month: &str,
    shifts: &[Value],
    input: &AllowanceContextInput<'a>,
    resolver: &'a RuleResolver,
    assessment: &crate::remuneration::assessment::model::AllowanceAssessment<'_>,
) -> Result<SupplementResult<'a>, AllowanceError> {
    calculate_inner(
        month,
        shifts,
        input,
        resolver,
        EntitlementSource::Derived(&assessment.entitlements),
    )
}
fn calculate_inner<'a>(
    month: &str,
    shifts: &[Value],
    input: &AllowanceContextInput<'a>,
    resolver: &'a RuleResolver,
    entitlements: EntitlementSource<'a, '_>,
) -> Result<SupplementResult<'a>, AllowanceError> {
    let first = remuneration_month_start(month)?;
    entitlements.validate()?;
    let mut work_days: BTreeMap<String, DayWork> = BTreeMap::new();
    for shift in remuneration_month_shifts(month, shifts)? {
        for day in remuneration_shift_days(
            shift,
            input.work_profile["timeZone"]
                .as_str()
                .ok_or(AllowanceError::InvalidInput)?,
        )? {
            let before = work_days.entry(day.date).or_insert(DayWork {
                minutes: 0.0,
                estimated_pause: false,
            });
            before.minutes += day.net_minutes;
            before.estimated_pause |= day.estimated_pause;
        }
    }
    let mut buckets: Vec<Bucket<'a>> = vec![];
    let mut last_by_key: BTreeMap<String, usize> = BTreeMap::new();
    let mut tvl_days = vec![];
    let mut tval_days = vec![];
    for offset in 0..i64::from(first.days_in_month()) {
        let plain = first
            .checked_add(jiff::Span::new().days(offset))
            .map_err(|_| AllowanceError::InvalidInput)?;
        let date = plain.to_string();
        let context = resolve_context(&date, input.history, resolver, &FullNativePackageValidator)?;
        if matches!(context.kind, ContextKind::OwnConfigured { .. }) {
            continue;
        }
        let entitlement = entitlements.at(&date)?;
        let empty = DayWork {
            minutes: 0.0,
            estimated_pause: false,
        };
        let work = work_days.get(&date).unwrap_or(&empty);
        let shift_type = if entitlement.as_deref().is_some_and(|e| {
            e["status"]
                .as_str()
                .is_some_and(|s| s.starts_with("ALTERNATING"))
        }) {
            AllowanceType::AlternatingShift
        } else {
            AllowanceType::Shift
        };
        let types: Vec<Option<AllowanceType>> = match context.kind {
            ContextKind::Tariff { .. } => vec![
                Some(AllowanceType::Care),
                Some(AllowanceType::Tvoed),
                Some(shift_type),
            ],
            ContextKind::TrainingTariff { .. } => vec![Some(AllowanceType::Care), Some(shift_type)],
            _ => vec![None],
        };
        for kind in types {
            let (k, bucket) = create_bucket(
                &context,
                &date,
                i32::from(first.days_in_month()),
                kind,
                entitlement.clone(),
                work,
                input.work_profile,
            )?;
            let previous = plain
                .checked_sub(jiff::Span::new().days(1))
                .map_err(|_| AllowanceError::InvalidInput)?
                .to_string();
            if let Some(index) = last_by_key
                .get(&k)
                .copied()
                .filter(|index| buckets[*index].position.through == previous)
            {
                let before = &mut buckets[index].position;
                before.through = date.clone();
                before.status = if bucket.position.issue.is_some() {
                    RemunerationStatus::Unavailable
                } else if bucket.position.status == RemunerationStatus::Estimated
                    || before.status == RemunerationStatus::Estimated
                {
                    RemunerationStatus::Estimated
                } else {
                    RemunerationStatus::Calculated
                };
                before.basis.minutes += bucket.position.basis.minutes;
                before.basis.calendar_days += 1;
                if bucket.position.basis.pause_method == PauseMethod::CenteredDurationEstimate {
                    before.basis.pause_method = PauseMethod::CenteredDurationEstimate;
                }
            } else {
                last_by_key.insert(k, buckets.len());
                buckets.push(bucket);
            }
        }
        let training = matches!(context.kind, ContextKind::TvalTraining { .. });
        if training || matches!(context.kind, ContextKind::TvlKr { .. }) {
            let day = AllowanceDay {
                date,
                context,
                entitlement,
                worked_minutes: work.minutes,
                estimated_pause: work.estimated_pause,
            };
            if training {
                tval_days.push(day);
            } else {
                tvl_days.push(day);
            }
        }
    }
    let mut positions = buckets
        .into_iter()
        .map(finish_bucket)
        .collect::<Result<Vec<_>, _>>()?;
    positions.extend(calculate_shift_allowances(&tvl_days)?);
    positions.extend(calculate_shift_allowances(&tval_days)?);
    let zone = input.work_profile["timeZone"]
        .as_str()
        .ok_or(AllowanceError::InvalidInput)?;
    let tval_burn = calculate_care_burn(
        &tval_days,
        shifts,
        input.history,
        input.tvl_shift_work,
        zone,
    )?;
    positions.extend(calculate_care_allowances(&tval_days, tval_burn)?);
    let tvl_burn =
        calculate_care_burn(&tvl_days, shifts, input.history, input.tvl_shift_work, zone)?;
    positions.extend(calculate_care_allowances(&tvl_days, tvl_burn)?);
    positions.extend(calculate_own_monthly_allowances(
        month,
        input.history,
        resolver,
    )?);
    Ok(summarize_supplements(positions))
}
