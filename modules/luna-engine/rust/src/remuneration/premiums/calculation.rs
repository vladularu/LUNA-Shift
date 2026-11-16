use super::{PremiumError, common::text, model::*, own, tdl, training};
use crate::{
    employment::profile_view::CalculationProfileStore,
    pay::{
        legacy_interval::{self, IntervalError, TimePremiumInterval},
        premium_minutes::PremiumError as MinuteError,
    },
    remuneration::{
        base::{
            model::RemunerationStatus,
            round_remuneration_cents,
            shift_days::{
                RemunerationShiftDay, remuneration_month_shifts, remuneration_shift_days,
            },
        },
        context::{
            model::{ContextKind, FullNativePackageValidator, IssueCode, RemunerationSource},
            periods::remuneration_month_start,
            resolve::resolve_context,
        },
    },
    rules::{RuleKind, RuleResolver, holidays::HolidayError},
};
use serde_json::{Value, json};
use std::{collections::HashMap, sync::Arc};

pub struct PremiumInput<'a> {
    pub work_profile: Arc<Value>,
    pub history: &'a [Value],
    pub tvl_shift_work: &'a [Value],
}
fn base<'a>(
    shift: &Value,
    day: &RemunerationShiftDay,
    source: RemunerationSource<'a>,
) -> Result<TimeRemunerationPosition<'a>, PremiumError> {
    let shift_id = text(shift, "id")?;
    Ok(TimeRemunerationPosition {
        id: format!("{shift_id}:{}", day.from_epoch_minutes),
        kind: PositionKind::TimePremium,
        label: "Zeitzuschläge".into(),
        from: day.date.clone(),
        through: day.date.clone(),
        from_epoch_minutes: day.from_epoch_minutes,
        until_epoch_minutes: day.until_epoch_minutes,
        shift_id: Some(shift_id.into()),
        source,
        status: if day.estimated_pause {
            RemunerationStatus::Estimated
        } else {
            RemunerationStatus::Calculated
        },
        amount_cents: Some(0),
        issue: None,
        basis: PremiumBasis {
            rule_id: None,
            minutes: day.net_minutes,
            hourly_rate_cents: None,
            percentage_basis_points: None,
            rounded_premium_hourly_cents: None,
            pause_method: if day.estimated_pause {
                PauseMethod::CenteredDurationEstimate
            } else {
                PauseMethod::None
            },
        },
    })
}
fn unavailable<'a>(
    mut position: TimeRemunerationPosition<'a>,
    issue: PremiumIssue,
) -> TimeRemunerationPosition<'a> {
    position.status = RemunerationStatus::Unavailable;
    position.amount_cents = None;
    position.issue = Some(issue);
    position
}
fn current_shift_work(
    facts: &[Value],
    shift: &Value,
    time_zone: &str,
    profile: Option<&Value>,
) -> Option<bool> {
    let profile = profile?;
    let mut current = facts.iter().filter(|value| {
        crate::remuneration::service_facts::is_current_tvl_shift_work(
            value, shift, time_zone, profile,
        )
    });
    let first = current.next()?.get("shiftWork").and_then(Value::as_bool);
    if current.next().is_some() {
        None
    } else {
        first
    }
}
fn legacy_profile(
    work: &Value,
    profile: Option<&Value>,
    weekly: i64,
    full_time: i64,
) -> Result<Value, PremiumError> {
    let profile = profile.ok_or(PremiumError::InvalidInput)?;
    let selection = &profile["data"]["selection"];
    if selection["kind"] != "tariff" {
        return Err(PremiumError::InvalidInput);
    }
    let level = text(selection, "level")?
        .parse::<i64>()
        .map_err(|_| PremiumError::InvalidInput)?;
    // `work` is already the shared compact monetary view, never the large
    // target-capable snapshot. Preserve every other condition field verbatim.
    let mut result = work.clone();
    let map = result.as_object_mut().ok_or(PremiumError::InvalidInput)?;
    map.insert("weeklyMinutes".into(), json!(weekly));
    map.insert("manualMonthlyGrossCents".into(), Value::Null);
    map.insert("updatedAt".into(), profile["updatedAt"].clone());
    map.insert("tariff".into(),json!({"payGroup":selection["group"],"payLevel":level,"sector":selection["variant"],"tariffRegion":selection["region"],"fullTimeWeeklyMinutes":full_time}));
    Ok(result)
}
fn caught(error: &PremiumError) -> Option<PremiumIssue> {
    let missing_rate = match error {
        PremiumError::MissingRate => true,
        PremiumError::Interval(e) => matches!(e.as_ref(), IntervalError::MissingRate),
        _ => false,
    };
    if missing_rate {
        return Some(PremiumIssue::new(
            PremiumIssueKind::PremiumRateMissing,
            error.to_string(),
        ));
    }
    let failure = match error {
        PremiumError::Interval(e) => e.rule_failure(),
        PremiumError::Classification(e) => match e.as_ref() {
            MinuteError::Holiday(HolidayError::Resolution(f)) => Some(f.as_ref()),
            _ => None,
        },
        _ => None,
    };
    if failure.is_some_and(|f| f.kind == RuleKind::Holiday) {
        Some(PremiumIssue::new(
            PremiumIssueKind::HolidayRulesUnavailable,
            "Die Feiertagsregeln sind für diesen Abschnitt nicht verfügbar.",
        ))
    } else {
        None
    }
}
fn shift_positions<'a>(
    shift: &Value,
    initial_work: Arc<Value>,
    input: &PremiumInput<'a>,
    resolver: &'a RuleResolver,
    included_month: Option<&str>,
) -> Result<(Vec<TimeRemunerationPosition<'a>>, f64), PremiumError> {
    let days = remuneration_shift_days(
        shift,
        initial_work
            .get("timeZone")
            .and_then(Value::as_str)
            .unwrap_or(""),
    )?;
    let mut positions = vec![];
    let mut net = 0.0;
    let mut work = initial_work;
    for day in days {
        // The source advances a possibly partial legacy employment overlay
        // from the previous day. Reusing direct-at(original,date) would erase
        // inherited fields. Both inputs here are already target-free Arc views.
        let mut store = CalculationProfileStore::new(Arc::clone(&work))?;
        work = store.at(&day.date)?.calculation;
        if included_month.is_some_and(|month| !day.date.starts_with(&format!("{month}-")))
            || day.net_minutes <= 0.0
        {
            continue;
        }
        net += day.net_minutes;
        let context = resolve_context(
            &day.date,
            input.history,
            resolver,
            &FullNativePackageValidator,
        )?;
        let position = base(shift, &day, context.source)?;
        let result = match context.kind {
            ContextKind::Unavailable { issue } => {
                positions.push(unavailable(position, issue.into()));
                continue;
            }
            ContextKind::TvoedAnnexADraft { .. } => {
                positions.push(unavailable(
                    position,
                    PremiumIssue::context(
                        IssueCode::TariffUnsupported,
                        "Die TVöD-Anlage-A-Zeitzuschläge sind noch nicht fachlich freigegeben.",
                    ),
                ));
                continue;
            }
            ContextKind::TvoedSueDraft { .. } => {
                positions.push(unavailable(
                    position,
                    PremiumIssue::context(
                        IssueCode::TariffUnsupported,
                        "SuE-Zeitzuschläge sind für diesen Tabellenentwurf noch nicht berechenbar.",
                    ),
                ));
                continue;
            }
            ContextKind::OwnConfigured { configuration, .. } => {
                positions.extend(own::calculate(
                    &position,
                    &day,
                    shift,
                    &work,
                    &configuration,
                    resolver,
                )?);
                continue;
            }
            ContextKind::OwnMonthly { .. } => {
                positions.push(unavailable(
                    position,
                    PremiumIssue::new(
                        PremiumIssueKind::OwnPremiumsUnconfigured,
                        "Für die eigene Vergütung sind noch keine Zuschlagsparameter bestätigt.",
                    ),
                ));
                continue;
            }
            ContextKind::TvalTraining {
                rule_package,
                monthly_cents,
                full_time_weekly_minutes,
                employer_scope,
                employment_category,
                ..
            } => tdl::calculate(
                &position,
                &day,
                shift,
                &work,
                &tdl::Context {
                    family: tdl::Family::Training {
                        monthly_cents,
                        employer_scope,
                    },
                    package: rule_package,
                    full_time_weekly_minutes,
                    employment_category,
                },
                resolver,
                current_shift_work(
                    input.tvl_shift_work,
                    shift,
                    text(&work, "timeZone")?,
                    context.profile,
                ),
            ),
            ContextKind::TvlKr {
                rule_package,
                full_time_weekly_minutes,
                group_id,
                employment_category,
                ..
            } => tdl::calculate(
                &position,
                &day,
                shift,
                &work,
                &tdl::Context {
                    family: tdl::Family::Kr {
                        group_id: &group_id,
                    },
                    package: rule_package,
                    full_time_weekly_minutes,
                    employment_category,
                },
                resolver,
                current_shift_work(
                    input.tvl_shift_work,
                    shift,
                    text(&work, "timeZone")?,
                    context.profile,
                ),
            ),
            ContextKind::TrainingTariff {
                rule_package,
                monthly_cents,
                weekly_minutes,
                full_time_weekly_minutes,
                ..
            } => training::calculate(
                &position,
                &day,
                shift,
                &work,
                &training::TrainingContext {
                    package: rule_package,
                    monthly_cents,
                    weekly_minutes,
                    full_time_weekly_minutes,
                },
                resolver,
            ),
            ContextKind::Tariff {
                rule_package,
                weekly_minutes,
                full_time_weekly_minutes,
                ..
            } => {
                let has_premiums = rule_package.rules()["premiumRules"]
                    .as_array()
                    .is_some_and(|rows| rows.iter().any(|r| r["premiumType"] != "OVERTIME"));
                if !has_premiums {
                    Err(PremiumError::MissingRate)
                } else {
                    let profile = legacy_profile(
                        &work,
                        context.profile,
                        weekly_minutes,
                        full_time_weekly_minutes,
                    )?;
                    let interval = TimePremiumInterval {
                        from: day.from,
                        until: day.until,
                        date: day.date.clone(),
                    };
                    legacy_interval::calculate_time_premium_interval(
                        shift,
                        &profile,
                        resolver,
                        &interval,
                        Some(&rule_package.package_id),
                    )
                    .map_err(PremiumError::from)
                    .map(|result| {
                        if result.premium_lines.is_empty() {
                            let mut p = position.clone();
                            p.label = "Keine Zeitzuschläge in diesem Abschnitt".into();
                            return vec![p];
                        }
                        result
                            .premium_lines
                            .into_iter()
                            .map(|line| {
                                let mut p = position.clone();
                                p.id = format!("{}:{}", p.id, line.rule_id);
                                p.label = line.label;
                                p.amount_cents = Some((line.amount * 100.0 + 0.5).floor() as i64);
                                p.basis.rule_id = Some(line.rule_id);
                                p.basis.minutes = line.minutes as f64;
                                p.basis.hourly_rate_cents =
                                    Some((line.hourly_rate * 100.0 + 0.5).floor() as i64);
                                p.basis.percentage_basis_points =
                                    Some((line.percentage * 100.0 + 0.5).floor() as i64);
                                p
                            })
                            .collect()
                    })
                }
            }
        };
        match result {
            Ok(mut result) => positions.append(&mut result),
            Err(e) => {
                if let Some(issue) = caught(&e) {
                    positions.push(unavailable(position, issue));
                } else {
                    return Err(e);
                }
            }
        }
    }
    Ok((positions, net))
}
fn summarize<'a>(
    raw: Vec<TimeRemunerationPosition<'a>>,
    net_minutes: f64,
) -> Result<TimeRemunerationResult<'a>, PremiumError> {
    let mut positions: Vec<TimeRemunerationPosition<'a>> = vec![];
    let mut groups: HashMap<String, usize> = HashMap::new();
    for position in raw {
        let key = if position.amount_cents.is_none() || position.basis.rule_id.is_none() {
            position.id.clone()
        } else {
            serde_json::to_string(&json!([
                &position.shift_id,
                position.from.get(..7).ok_or(PremiumError::InvalidInput)?,
                &position.source,
                &position.basis.rule_id,
                position.basis.hourly_rate_cents,
                position.basis.percentage_basis_points,
                position.basis.rounded_premium_hourly_cents.flatten(),
                position.status,
                position.basis.pause_method
            ]))
            .map_err(|_| PremiumError::InvalidInput)?
        };
        if let Some(index) = groups.get(&key).copied() {
            if position.basis.hourly_rate_cents.is_none()
                && position.basis.percentage_basis_points != Some(0)
            {
                positions[index] = position;
                continue;
            }
            let previous = &mut positions[index];
            let minutes = previous.basis.minutes + position.basis.minutes;
            let units = if let Some(rounded) = position.basis.rounded_premium_hourly_cents.flatten()
            {
                rounded as f64 * 10_000.0
            } else {
                position.basis.hourly_rate_cents.unwrap_or(0) as f64
                    * position.basis.percentage_basis_points.unwrap_or(10_000) as f64
            };
            previous.through = position.through;
            previous.until_epoch_minutes = position.until_epoch_minutes;
            previous.amount_cents = Some(round_remuneration_cents(units * minutes, 600_000.0)?);
            previous.basis.minutes = minutes;
        } else {
            groups.insert(key, positions.len());
            positions.push(position);
        }
    }
    let complete = positions.iter().all(|p| p.amount_cents.is_some());
    let known_subtotal_cents = positions.iter().try_fold(0i64, |sum, p| {
        sum.checked_add(p.amount_cents.unwrap_or(0))
            .ok_or(PremiumError::InvalidInput)
    })?;
    let status = if !complete {
        RemunerationStatus::Unavailable
    } else if positions
        .iter()
        .any(|p| p.status == RemunerationStatus::Estimated)
    {
        RemunerationStatus::Estimated
    } else {
        RemunerationStatus::Calculated
    };
    Ok(TimeRemunerationResult {
        positions,
        net_minutes,
        complete,
        total_cents: if complete {
            Some(known_subtotal_cents)
        } else {
            None
        },
        known_subtotal_cents,
        status,
    })
}
pub fn calculate_dated_shift_time_premiums<'a>(
    shift: &Value,
    input: &PremiumInput<'a>,
    resolver: &'a RuleResolver,
    included_month: Option<&str>,
) -> Result<TimeRemunerationResult<'a>, PremiumError> {
    if let Some(month) = included_month {
        remuneration_month_start(month)?;
    }
    let store = CalculationProfileStore::new(Arc::clone(&input.work_profile))?;
    let (positions, net) = shift_positions(
        shift,
        Arc::clone(store.base()),
        input,
        resolver,
        included_month,
    )?;
    summarize(positions, net)
}
pub fn calculate_monthly_time_remuneration<'a>(
    month: &str,
    shifts: &[Value],
    input: &PremiumInput<'a>,
    resolver: &'a RuleResolver,
) -> Result<TimeRemunerationResult<'a>, PremiumError> {
    let shifts = remuneration_month_shifts(month, shifts)?;
    let store = CalculationProfileStore::new(Arc::clone(&input.work_profile))?;
    let mut positions = vec![];
    let mut net = 0.0;
    for shift in shifts {
        let (raw, minutes) = shift_positions(
            shift,
            Arc::clone(store.base()),
            input,
            resolver,
            Some(month),
        )?;
        let result = summarize(raw, minutes)?;
        positions.extend(result.positions);
        net += result.net_minutes;
    }
    summarize(positions, net)
}
