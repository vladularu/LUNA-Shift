use super::{
    BaseError,
    absence::{is_current_paid_absence, is_own_paid_absence, validate_paid_absence},
    model::*,
    prepared::PaidAbsenceIndex,
    round_remuneration_cents,
    shift_days::remuneration_shift_days,
};
use crate::remuneration::{
    context::model::{ContextKind, IssueCode, RemunerationIssue, RemunerationPeriod},
    own_config::OwnBase,
};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
pub struct OwnHourlyInput<'a> {
    pub shifts: &'a [Value],
    pub time_zone: &'a str,
    pub paid_absences: &'a [Value],
}
pub fn calculate_own_hourly_period<'a>(
    period: &RemunerationPeriod<'a>,
    month_days: i32,
    input: Option<&OwnHourlyInput<'_>>,
) -> Result<Vec<BasePosition<'a>>, BaseError> {
    calculate_own_hourly_period_with_paid_absences(period, month_days, input, None)
}
pub(crate) fn calculate_own_hourly_period_with_paid_absences<'a>(
    period: &RemunerationPeriod<'a>,
    month_days: i32,
    input: Option<&OwnHourlyInput<'_>>,
    prepared: Option<&PaidAbsenceIndex>,
) -> Result<Vec<BasePosition<'a>>, BaseError> {
    let ContextKind::OwnConfigured {
        configuration,
        weekly_minutes,
    } = &period.context.kind
    else {
        return Err(BaseError::OwnHourlyMissing);
    };
    let OwnBase::Hourly {
        cents_per_hour: rate,
    } = configuration.base()
    else {
        return Err(BaseError::OwnHourlyMissing);
    };
    let from = period
        .from
        .parse::<jiff::civil::Date>()
        .map_err(|_| BaseError::InvalidShift)?;
    let through = period
        .through
        .parse::<jiff::civil::Date>()
        .map_err(|_| BaseError::InvalidShift)?;
    let calendar_days = from
        .until(through)
        .map_err(|_| BaseError::InvalidShift)?
        .get_days()
        + 1;
    let mut base = BasePosition {
        id: format!("hourly:{}", period.from),
        kind: "base",
        label: "Stundenlohn · Arbeitszeit".into(),
        from: period.from.clone(),
        through: period.through.clone(),
        amount_cents: None,
        status: RemunerationStatus::Unavailable,
        source: period.context.source.clone(),
        issue: None,
        basis: BaseBasis {
            weekly_minutes: Some(*weekly_minutes),
            proration: Proration::PaidMinutes,
            hourly: Some(HourlyBasis {
                rate_cents: *rate,
                paid_minutes: None,
                kind: HourlyKind::Worked,
                shift_id: None,
                confirmation_revision: None,
                pause_estimated: false,
            }),
            ..BaseBasis::empty(calendar_days, month_days)
        },
    };
    let Some(input) = input else {
        base.issue = Some(RemunerationIssue::new(
            IssueCode::OwnHourlyInputMissing,
            "Für Stundenlohn fehlen die Dienst- und Abwesenheitsdaten.",
        ));
        return Ok(vec![base]);
    };
    super::temporal_zone(input.time_zone)?;
    let mut confirmations = BTreeMap::new();
    if let Some(prepared) = prepared {
        if !prepared.matches(input.paid_absences) {
            return Err(BaseError::InvalidCalculation);
        }
    } else {
        for raw in input.paid_absences {
            let value = validate_paid_absence(raw)?;
            if confirmations
                .insert(value.shift_id.clone(), value)
                .is_some()
            {
                return Err(BaseError::DuplicateAbsence);
            }
        }
    }
    let preceding = from
        .checked_sub(jiff::Span::new().days(1))
        .map_err(|_| BaseError::InvalidShift)?
        .to_string();
    let entries: Vec<_> = input
        .shifts
        .iter()
        .filter(|s| {
            s.get("deletedAt").is_some_and(Value::is_null)
                && s["date"]
                    .as_str()
                    .is_some_and(|d| d >= preceding.as_str() && d <= period.through.as_str())
        })
        .collect();
    let mut seen = BTreeSet::new();
    for s in &entries {
        if !seen.insert(s["id"].as_str().ok_or(BaseError::InvalidShift)?) {
            return Err(BaseError::DuplicateShift);
        }
    }
    let mut minutes = 0.0;
    let mut estimated = false;
    let mut others = vec![];
    for shift in entries {
        let date = shift["date"].as_str().ok_or(BaseError::InvalidShift)?;
        let id = shift["id"].as_str().ok_or(BaseError::InvalidShift)?;
        let title = shift["title"].as_str().ok_or(BaseError::InvalidShift)?;
        if is_own_paid_absence(shift) {
            if date < period.from.as_str() {
                continue;
            }
            let confirmed = match prepared {
                Some(index) => index.get(id),
                None => confirmations.get(id),
            };
            let valid =
                confirmed.is_some_and(|c| is_current_paid_absence(c, shift, input.time_zone));
            let paid = confirmed.filter(|_| valid).and_then(|c| c.paid_minutes);
            let mut position = base.clone();
            position.id = format!("hourly-absence:{id}:{date}");
            position.label = format!("Bezahlte Abwesenheit · {title}");
            position.from = date.into();
            position.through = date.into();
            position.amount_cents = paid
                .map(|minutes| round_remuneration_cents(*rate as f64 * minutes as f64, 60.0))
                .transpose()?;
            position.status = if valid {
                RemunerationStatus::Calculated
            } else {
                RemunerationStatus::Unavailable
            };
            position.basis.calendar_days = 1;
            position.basis.hourly = Some(HourlyBasis {
                rate_cents: *rate,
                paid_minutes: paid.map(|m| m as f64),
                kind: HourlyKind::Absence,
                shift_id: Some(id.into()),
                confirmation_revision: confirmed.map(|c| c.revision),
                pause_estimated: false,
            });
            position.issue = if valid {
                None
            } else {
                Some(RemunerationIssue::new(
                    IssueCode::PaidAbsenceUnconfirmed,
                    "Bitte bezahlte Stunden für diesen Eintrag bestätigen; eine frühere Bestätigung fehlt, wurde aufgehoben oder passt nicht mehr.",
                ))
            };
            others.push(position);
            continue;
        }
        let days = remuneration_shift_days(shift, input.time_zone)?;
        if days.is_empty() && date >= period.from.as_str() {
            let mut position = base.clone();
            position.id = format!("hourly-missing:{id}");
            position.from = date.into();
            position.through = date.into();
            position.label = format!("Dienstzeit fehlt · {title}");
            position.issue = Some(RemunerationIssue::new(
                IssueCode::WorkTimeMissing,
                "Für diesen Arbeitsdienst fehlt eine berechenbare Dienstzeit.",
            ));
            others.push(position);
            continue;
        }
        let selected: Vec<_> = days
            .iter()
            .filter(|d| d.date >= period.from && d.date <= period.through)
            .collect();
        let selected_minutes = selected.iter().fold(0.0, |sum, d| sum + d.net_minutes);
        minutes += selected_minutes;
        if selected.len() != days.len() && selected.iter().any(|d| d.estimated_pause) {
            estimated = true;
        }
    }
    base.amount_cents = Some(round_remuneration_cents(*rate as f64 * minutes, 60.0)?);
    base.status = if estimated {
        RemunerationStatus::Estimated
    } else {
        RemunerationStatus::Calculated
    };
    let basis = base
        .basis
        .hourly
        .as_mut()
        .ok_or(BaseError::OwnHourlyMissing)?;
    basis.paid_minutes = Some(minutes);
    basis.pause_estimated = estimated;
    let mut result = vec![base];
    result.extend(others);
    Ok(result)
}
