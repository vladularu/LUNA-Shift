use super::{AssessmentError, model::AssessmentInput};
use crate::{
    employment::{ResolutionStatus, resolve_remuneration_profile_ref},
    remuneration::{
        context::{
            model::{ContextKind, RemunerationPeriod},
            periods::remuneration_month_start,
        },
        profile::{Selection, validate_profile},
    },
};
use serde_json::Value;
use std::collections::BTreeSet;
pub(super) fn identity_key(value: &Value) -> Option<String> {
    serde_json::to_string(&[
        value["packageId"].as_str()?,
        value["variant"].as_str()?,
        value["region"].as_str()?,
    ])
    .ok()
}
pub(super) fn identity_at(
    history: &[Value],
    date: &str,
) -> Result<Option<String>, AssessmentError> {
    let resolved = resolve_remuneration_profile_ref(history, date)?;
    if resolved.status != ResolutionStatus::Dated {
        return Ok(None);
    }
    let Some(profile) = resolved.profile else {
        return Ok(None);
    };
    Ok(match validate_profile(&profile["data"]) {
        Ok(p) if matches!(p.selection(), Selection::Tariff(_)) => {
            identity_key(&profile["data"]["selection"])
        }
        _ => None,
    })
}
pub(super) struct Observation<'a> {
    pub from: String,
    pub through: String,
    pub shifts: Vec<&'a Value>,
}
pub(super) fn observation<'a>(
    period: &RemunerationPeriod<'_>,
    input: &AssessmentInput<'a>,
) -> Result<Observation<'a>, AssessmentError> {
    let pkg = match period.context.kind {
        ContextKind::Tariff { rule_package, .. }
        | ContextKind::TrainingTariff { rule_package, .. } => rule_package,
        _ => return Err(AssessmentError::Message("Tarifkontext fehlt.")),
    };
    let first = remuneration_month_start(input.month)?;
    let lookback = pkg.rules()["workPatternPolicy"]["assessmentLookbackMonths"]
        .as_i64()
        .ok_or(AssessmentError::InvalidInput)?;
    let minimum = first
        .checked_sub(jiff::Span::new().months(lookback))
        .map_err(|_| AssessmentError::InvalidInput)?;
    let maximum = first.last_of_month();
    let wanted = identity_at(input.history, &period.from)?;
    let mut from: jiff::civil::Date = period
        .from
        .parse()
        .map_err(|_| AssessmentError::InvalidInput)?;
    let mut through = from;
    while from > minimum {
        let previous = from
            .checked_sub(jiff::Span::new().days(1))
            .map_err(|_| AssessmentError::InvalidInput)?;
        if identity_at(input.history, &previous.to_string())? != wanted {
            break;
        }
        from = previous;
    }
    while through < maximum {
        let next = through
            .checked_add(jiff::Span::new().days(1))
            .map_err(|_| AssessmentError::InvalidInput)?;
        if identity_at(input.history, &next.to_string())? != wanted {
            break;
        }
        through = next;
    }
    let from = from.to_string();
    let through = through.to_string();
    let mut seen = BTreeSet::new();
    let mut shifts = vec![];
    for shift in input.shifts {
        if shift.get("deletedAt") == Some(&Value::Null)
            && shift["date"]
                .as_str()
                .is_some_and(|date| from.as_str() <= date && date <= through.as_str())
        {
            let id = shift["id"].as_str().ok_or(AssessmentError::InvalidInput)?;
            if !seen.insert(id) {
                return Err(AssessmentError::Message(
                    "Ein Dienst wurde mehrfach zur Zulagenprüfung übergeben.",
                ));
            }
            shifts.push(shift);
        }
    }
    Ok(Observation {
        from,
        through,
        shifts,
    })
}
pub(super) struct DecisionPeriod<'a> {
    pub from: String,
    pub through: String,
    pub decision: Option<&'a Value>,
}
pub(super) fn split<'a>(
    period: &RemunerationPeriod<'_>,
    decisions: &'a [Value],
) -> Result<Vec<DecisionPeriod<'a>>, AssessmentError> {
    let next = |date: &str, days: i64| {
        date.parse::<jiff::civil::Date>()
            .map_err(|_| AssessmentError::InvalidInput)?
            .checked_add(jiff::Span::new().days(days))
            .map(|d| d.to_string())
            .map_err(|_| AssessmentError::InvalidInput)
    };
    let exclusive = next(&period.through, 1)?;
    let mut boundaries = BTreeSet::from([period.from.clone(), exclusive.clone()]);
    for decision in decisions {
        let from = decision["from"]
            .as_str()
            .ok_or(AssessmentError::InvalidInput)?;
        let end = next(
            decision["through"]
                .as_str()
                .ok_or(AssessmentError::InvalidInput)?,
            1,
        )?;
        if period.from.as_str() < from && from < exclusive.as_str() {
            boundaries.insert(from.to_owned());
        }
        if period.from < end && end < exclusive {
            boundaries.insert(end);
        }
    }
    let boundaries: Vec<_> = boundaries.into_iter().collect();
    boundaries
        .windows(2)
        .map(|pair| {
            Ok(DecisionPeriod {
                from: pair[0].clone(),
                through: next(&pair[1], -1)?,
                decision: decisions.iter().find(|d| {
                    d["from"].as_str().is_some_and(|f| f <= pair[0].as_str())
                        && d["through"].as_str().is_some_and(|t| t >= pair[0].as_str())
                }),
            })
        })
        .collect()
}
