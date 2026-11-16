use super::{
    AllowanceError, key,
    model::*,
    shift::{AllowanceDay, plain, policy},
};
use crate::{
    employment::resolve_remuneration_profile_ref,
    remuneration::{
        Presence,
        base::{
            model::RemunerationStatus,
            round_remuneration_cents,
            shift_days::{remuneration_month_shifts, remuneration_shift_days},
        },
        context::model::{ContextError, ContextKind, SourceReference},
        service_facts::{
            SavedTvlShiftWork, is_current_tvl_service_facts, require_burn_care_interval_parents,
            validate_tvl_shift_work,
        },
    },
};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub struct BurnCareResult<'a> {
    pub positions: Vec<SupplementPosition<'a>>,
    pub total_cents: Option<i64>,
}
pub(super) fn integer(value: &Value, key: &str) -> Option<i64> {
    value[key].as_i64()
}
fn hourly_rate(day: &AllowanceDay<'_>) -> Result<Option<i64>, AllowanceError> {
    let Some(policy) = policy(day, "CareAllowancePolicy") else {
        return Ok(None);
    };
    let Some(rate) = integer(policy, "burnCareFullHourCents") else {
        return Ok(None);
    };
    Ok(Some(
        if let Some(share) = integer(policy, "shareBasisPoints") {
            round_remuneration_cents(rate as f64 * share as f64, 10_000.0)?
        } else {
            rate
        },
    ))
}
fn entitlement(day: &AllowanceDay<'_>) -> (Option<bool>, Option<bool>, bool) {
    match &day.context.kind {
        ContextKind::TvlKr {
            care_allowances,
            group_id,
            ..
        } => {
            let group = group_id.get(2..).and_then(|n| n.parse::<i64>().ok());
            (
                care_allowances.as_ref().and_then(|f| f.paid_entitlement),
                care_allowances.as_ref().and_then(|f| f.burn_care),
                group.is_some_and(|n| (5..=9).contains(&n)),
            )
        }
        ContextKind::TvalTraining {
            care_allowances, ..
        } => (
            care_allowances.as_ref().and_then(|f| f.paid_entitlement),
            care_allowances.as_ref().and_then(|f| f.burn_care),
            true,
        ),
        _ => (None, None, false),
    }
}
pub(super) fn filtered_references<'a>(day: &AllowanceDay<'a>) -> Vec<SourceReference<'a>> {
    let ids = policy(day, "CareAllowancePolicy").and_then(|p| p["sourceIds"].as_array());
    day.context
        .source
        .references
        .iter()
        .filter(|r| ids.is_some_and(|ids| ids.iter().any(|id| id.as_str() == r.id.as_deref())))
        .cloned()
        .collect()
}
fn intervals<'a>(
    value: &'a SavedTvlShiftWork<'_>,
) -> Option<&'a [crate::remuneration::service_facts::BurnCareInterval]> {
    match &value.burn_care_intervals {
        Presence::Value(v) => Some(v),
        _ => None,
    }
}

/// Whole actual elapsed hours are paid once per calendar month. Unknown activity
/// or claim evidence remains unavailable and cannot silently become zero.
pub fn calculate_care_burn<'a>(
    days: &[AllowanceDay<'a>],
    shifts: &[Value],
    history: &'a [Value],
    saved: &'a [Value],
    time_zone: &str,
) -> Result<BurnCareResult<'a>, AllowanceError> {
    if days.is_empty() {
        return Ok(BurnCareResult {
            positions: vec![],
            total_cents: Some(0),
        });
    }
    let training = matches!(days[0].context.kind, ContextKind::TvalTraining { .. });
    let prefix = if training { "tval" } else { "tvl" };
    let month = &days[0].date[..7];
    let by_date: BTreeMap<&str, &AllowanceDay<'a>> =
        days.iter().map(|d| (d.date.as_str(), d)).collect();
    let mut eligible = BTreeSet::new();
    let mut problem: Option<&str> = None;
    for day in days {
        let (paid, burn, group) = entitlement(day);
        if paid == Some(false) || burn == Some(false) {
            continue;
        }
        if paid != Some(true) || burn != Some(true) || !group {
            problem = Some(if training {
                "Bitte Entgeltanspruch und qualifizierende Schwerbrandpflege im TVA-L-Vergütungsprofil bestätigen."
            } else {
                "Bitte Entgeltanspruch, KR5–KR9 und die qualifizierende Schwerbrandpflege im Vergütungsprofil bestätigen."
            });
        } else {
            eligible.insert(day.date.as_str());
        }
    }
    let mut facts_by_key: BTreeMap<String, Vec<&Value>> = BTreeMap::new();
    let mut facts_by_shift: BTreeMap<String, Vec<&Value>> = BTreeMap::new();
    for raw in saved {
        facts_by_key
            .entry(key((raw.get("shiftId"), raw.get("profileEffectiveFrom")))?)
            .or_default()
            .push(raw);
        facts_by_shift
            .entry(key(raw.get("shiftId"))?)
            .or_default()
            .push(raw);
    }
    let mut rates = Vec::new();
    let mut actual_ranges: Vec<(f64, f64)> = vec![];
    let mut minutes = 0.0;
    for shift in remuneration_month_shifts(month, shifts)? {
        let parts = remuneration_shift_days(shift, time_zone)?;
        if !parts
            .iter()
            .any(|part| eligible.contains(part.date.as_str()))
        {
            continue;
        }
        let mut checked: BTreeMap<String, Option<SavedTvlShiftWork<'_>>> = BTreeMap::new();
        for part in &parts {
            if !eligible.contains(part.date.as_str()) {
                continue;
            }
            let profile = resolve_remuneration_profile_ref(history, &part.date)
                .map_err(ContextError::from)?
                .profile;
            let k = key((
                shift.get("id"),
                profile.and_then(|p| p.get("effectiveFrom")),
            ))?;
            if !checked.contains_key(&k) {
                let matches = facts_by_key.get(&k).map(Vec::as_slice).unwrap_or(&[]);
                let candidate = profile.filter(|_| matches.len() == 1).and_then(|profile| {
                    let candidate = validate_tvl_shift_work(matches[0]).ok()?;
                    if !is_current_tvl_service_facts(matches[0], shift, time_zone, profile) {
                        return None;
                    }
                    let spans = intervals(&candidate)?;
                    require_burn_care_interval_parents(spans, shift, time_zone, profile, history)
                        .ok()?;
                    Some(candidate)
                });
                checked.insert(k.clone(), candidate);
            }
            let Some(candidate) = checked.get(&k).and_then(Option::as_ref) else {
                problem = Some(
                    "Tatsächliche Schwerbrandpflegezeiten fehlen oder sind nach Dienst-/Profiländerung neu zu bestätigen. Im TV-L-Dienstformular auch keine Tätigkeit ausdrücklich bestätigen.",
                );
                continue;
            };
            for interval in intervals(candidate).ok_or(AllowanceError::InvalidInput)? {
                let from = part.from.max(interval.from as f64);
                let until = part.until.min(interval.until as f64);
                if until <= from {
                    continue;
                }
                if let Some(rate) = hourly_rate(by_date[part.date.as_str()])? {
                    if !rates.contains(&rate) {
                        rates.push(rate);
                    }
                } else {
                    problem =
                        Some("Der Tarifbetrag für Schwerbrandpflege fehlt im gültigen Katalog.");
                }
                minutes += until - from;
                actual_ranges.push((
                    part.from_epoch_minutes + from - part.from,
                    part.from_epoch_minutes + until - part.from,
                ));
            }
        }
        let mut current_total = 0.0;
        for raw in facts_by_shift
            .get(&key(shift.get("id"))?)
            .into_iter()
            .flatten()
        {
            if facts_by_key
                .get(&key((raw.get("shiftId"), raw.get("profileEffectiveFrom")))?)
                .is_none_or(|rows| rows.len() != 1)
            {
                continue;
            }
            let Some(profile) = history
                .iter()
                .find(|p| p.get("effectiveFrom") == raw.get("profileEffectiveFrom"))
            else {
                continue;
            };
            if !is_current_tvl_service_facts(raw, shift, time_zone, profile) {
                continue;
            }
            if let Ok(candidate) = validate_tvl_shift_work(raw) {
                for range in intervals(&candidate).unwrap_or(&[]) {
                    current_total += range.until as f64 - range.from as f64;
                }
            }
        }
        if current_total > parts.iter().map(|p| p.net_minutes).sum::<f64>() {
            problem = Some(
                "Bestätigte Tätigkeitszeiten überschreiten zusammen die Dienstzeit ohne Pause.",
            );
        }
    }
    actual_ranges.sort_by(|a, b| a.0.total_cmp(&b.0));
    if actual_ranges.windows(2).any(|pair| pair[1].0 < pair[0].1) {
        problem = Some(
            "Bestätigte Schwerbrandpflegezeiten überschneiden sich; bitte die Dienste prüfen.",
        );
    }
    if rates.len() > 1 {
        problem = Some(
            "Mehrere Schwerbrandpflege-Stundensätze innerhalb eines Monats benötigen eine getrennt bestätigte Zuordnung voller Stunden.",
        );
    }
    let rate = rates.first().copied().or(hourly_rate(&days[0])?);
    let amount = if problem.is_some() {
        None
    } else if minutes == 0.0 {
        Some(0)
    } else {
        rate.map(|rate| (minutes / 60.0).floor() as i64 * rate)
    };
    let mut source = days[0].context.source.clone();
    let mut references: Vec<SourceReference<'a>> = vec![];
    for day in days {
        for reference in filtered_references(day) {
            if let Some(old) = references.iter_mut().find(|old| old.id == reference.id) {
                *old = reference;
            } else {
                references.push(reference);
            }
        }
    }
    source.references = references;
    if days.iter().any(|d| {
        d.context.source.profile_effective_from != source.profile_effective_from
            || d.context.source.profile_revision != source.profile_revision
    }) {
        source.profile_effective_from = None;
        source.profile_revision = None;
    }
    if days
        .iter()
        .any(|d| d.context.source.version_id != source.version_id)
    {
        source.version_id = None;
        source.package_valid_from = None;
        source.package_valid_to = None;
    }
    let mut basis = SupplementBasis::empty(
        i32::try_from(days.len()).map_err(|_| AllowanceError::InvalidInput)?,
        i32::from(plain(&days[0].date)?.days_in_month()),
    );
    basis.rule_id = Some(format!("{prefix}-part-iv:burn-month-full-hours"));
    basis.allowance_type = Some(AllowanceType::Care);
    basis.rate_cents = rate;
    basis.percentage_basis_points = training
        .then(|| {
            policy(&days[0], "CareAllowancePolicy").and_then(|p| integer(p, "shareBasisPoints"))
        })
        .flatten();
    basis.minutes = minutes;
    basis.proration = Proration::WorkedMinutes;
    let position = SupplementPosition {
        id: format!("{prefix}-care:burn:{month}"),
        kind: SupplementKind::Allowance,
        label: if training {
            "TVA-L-Schwerbrandpflege · Ausbildungsanteil"
        } else {
            "TV-L-Schwerbrandpflege"
        }
        .into(),
        from: days[0].date.clone(),
        through: days[days.len() - 1].date.clone(),
        amount_cents: amount,
        status: if amount.is_none() {
            RemunerationStatus::Unavailable
        } else if minutes > 0.0 {
            RemunerationStatus::Estimated
        } else {
            RemunerationStatus::Calculated
        },
        source,
        issue: amount.is_none().then(|| {
            SupplementIssue::new(
                SupplementIssueKind::AllowanceDecisionMissing,
                problem.unwrap_or("Schwerbrandpflege-Regel fehlt."),
            )
        }),
        basis,
    };
    Ok(BurnCareResult {
        positions: vec![position],
        total_cents: amount,
    })
}
