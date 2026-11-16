use super::{PremiumError, common::*, model::*};
use crate::{
    remuneration::{
        base::{
            model::RemunerationStatus, round_remuneration_cents, shift_days::RemunerationShiftDay,
        },
        own_config::{
            Combination, OwnBase, OwnConfiguration, OwnRate, OwnTimePremium, PremiumType,
        },
    },
    rules::RuleResolver,
};
use serde_json::Value;
#[derive(Clone, Copy)]
enum CandidateIssue {
    HolidayUnknown,
    MissingHourlyBasis,
}
impl CandidateIssue {
    fn position_issue(self) -> PremiumIssue {
        match self {
            Self::HolidayUnknown => PremiumIssue::new(
                PremiumIssueKind::HolidayRulesUnavailable,
                "Die Feiertagsregeln sind für diesen Zuschlag nicht verfügbar.",
            ),
            Self::MissingHourlyBasis => PremiumIssue::new(
                PremiumIssueKind::PremiumRateMissing,
                "Bitte die persönliche Stundenbasis für prozentuale Zuschläge bestätigen.",
            ),
        }
    }
}
#[derive(Clone, Copy)]
struct Candidate<'a> {
    rule: &'a OwnTimePremium,
    hourly: Option<i64>,
    percentage: Option<i64>,
    units: f64,
    issue: Option<CandidateIssue>,
}
fn candidate<'a>(
    rule: &'a OwnTimePremium,
    config: &OwnConfiguration,
    holiday_unknown: bool,
) -> Candidate<'a> {
    let hourly = match &rule.rate {
        OwnRate::Hourly { cents_per_hour } => Some(*cents_per_hour),
        OwnRate::Percent { .. } => match config.base() {
            OwnBase::Hourly { cents_per_hour } => Some(*cents_per_hour),
            OwnBase::Monthly { .. } => config.percentage_basis_hourly_cents(),
        },
    };
    let percentage = match &rule.rate {
        OwnRate::Hourly { .. } => None,
        OwnRate::Percent { basis_points } => Some(*basis_points),
    };
    let issue = if holiday_unknown {
        Some(CandidateIssue::HolidayUnknown)
    } else if hourly.is_none() && percentage != Some(0) {
        Some(CandidateIssue::MissingHourlyBasis)
    } else {
        None
    };
    Candidate {
        rule,
        hourly,
        percentage,
        units: hourly.unwrap_or(0) as f64 * percentage.unwrap_or(10_000) as f64,
        issue,
    }
}
fn label(kind: PremiumType) -> &'static str {
    match kind {
        PremiumType::Night => "Eigener Nachtzuschlag",
        PremiumType::Saturday => "Eigener Samstagszuschlag",
        PremiumType::Sunday => "Eigener Sonntagszuschlag",
        PremiumType::Holiday => "Eigener Feiertagszuschlag",
    }
}
fn count<'a>(buckets: &mut Vec<(Candidate<'a>, f64)>, entry: Candidate<'a>) {
    if let Some((_, minutes)) = buckets
        .iter_mut()
        .find(|(old, _)| old.rule.id == entry.rule.id)
    {
        *minutes += 1.0;
    } else {
        buckets.push((entry, 1.0));
    }
}
pub(super) fn calculate<'a>(
    base: &TimeRemunerationPosition<'a>,
    day: &RemunerationShiftDay,
    shift: &Value,
    work: &Value,
    config: &OwnConfiguration,
    resolver: &RuleResolver,
) -> Result<Vec<TimeRemunerationPosition<'a>>, PremiumError> {
    let Some(premiums) = config.time_premiums() else {
        let mut position = base.clone();
        position.label = "Eigene Zeitzuschläge ausgeschaltet".into();
        return Ok(vec![position]);
    };
    let frame = frame(shift, work)?.ok_or(PremiumError::OwnTimeMissing)?;
    let clock = DayClock::new(day, work)?;
    let applicable: Vec<&OwnTimePremium> = premiums
        .rules
        .iter()
        .filter(|r| {
            matches!(r.premium_type, PremiumType::Night | PremiumType::Holiday)
                || r.premium_type == PremiumType::Saturday && clock.weekday == 6
                || r.premium_type == PremiumType::Sunday && clock.weekday == 7
        })
        .collect();
    let mut holiday_state: Option<Option<bool>> = None;
    let mut buckets = vec![];
    let mut offset = day.from;
    while offset < day.until {
        if !frame.paused(offset) {
            let minute = clock.minute(offset)?;
            let mut matches = vec![];
            for rule in &applicable {
                if rule
                    .window
                    .as_ref()
                    .is_some_and(|w| !in_window(minute, w.start_minute as f64, w.end_minute as f64))
                {
                    continue;
                }
                if rule.premium_type == PremiumType::Holiday {
                    if holiday_state.is_none() {
                        holiday_state = Some(holiday(&day.date, work, resolver)?);
                    }
                    if holiday_state == Some(Some(false)) {
                        continue;
                    }
                }
                matches.push(candidate(
                    rule,
                    config,
                    rule.premium_type == PremiumType::Holiday && holiday_state == Some(None),
                ));
            }
            if premiums.combination == Combination::Add {
                for entry in matches {
                    count(&mut buckets, entry);
                }
            } else if matches.iter().any(|entry| entry.issue.is_some()) {
                for entry in matches.into_iter().filter(|entry| entry.issue.is_some()) {
                    count(&mut buckets, entry);
                }
            } else {
                let mut best: Option<Candidate<'_>> = None;
                for entry in matches {
                    if best.is_none_or(|old| {
                        entry.units > old.units
                            || entry.units == old.units
                                && entry
                                    .rule
                                    .id
                                    .encode_utf16()
                                    .cmp(old.rule.id.encode_utf16())
                                    .is_lt()
                    }) {
                        best = Some(entry);
                    }
                }
                if let Some(winner) = best {
                    count(&mut buckets, winner);
                }
            }
        }
        offset += 1.0;
    }
    if buckets.is_empty() {
        let mut position = base.clone();
        position.label = "Keine eigenen Zeitzuschläge in diesem Abschnitt".into();
        return Ok(vec![position]);
    }
    buckets
        .into_iter()
        .map(|(entry, minutes)| {
            let mut position = base.clone();
            position.id = format!("{}:own:{}", base.id, entry.rule.id);
            position.label = label(entry.rule.premium_type).into();
            position.issue = entry.issue.map(CandidateIssue::position_issue);
            position.amount_cents = if position.issue.is_some() {
                None
            } else {
                Some(round_remuneration_cents(entry.units * minutes, 600_000.0)?)
            };
            if position.issue.is_some() {
                position.status = RemunerationStatus::Unavailable;
            }
            position.basis.rule_id = Some(entry.rule.id.clone());
            position.basis.minutes = minutes;
            position.basis.hourly_rate_cents = entry.hourly;
            position.basis.percentage_basis_points = entry.percentage;
            Ok(position)
        })
        .collect()
}
