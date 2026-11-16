use super::{AllowanceError, key, model::*};
use crate::remuneration::{
    base::{model::RemunerationStatus, round_remuneration_cents},
    context::model::{ContextKind, RemunerationContext},
    profile::TvalEmployerScope,
};
use serde_json::Value;
use std::borrow::Cow;

pub struct AllowanceDay<'a> {
    pub date: String,
    pub context: RemunerationContext<'a>,
    pub entitlement: Option<Cow<'a, Value>>,
    pub worked_minutes: f64,
    pub estimated_pause: bool,
}
fn number(value: &Value, key: &str) -> Result<i64, AllowanceError> {
    value[key].as_i64().ok_or(AllowanceError::InvalidInput)
}
pub(super) fn active(value: &Value, date: &str) -> bool {
    value["validFrom"].as_str().is_some_and(|from| from <= date)
        && value
            .get("validTo")
            .is_some_and(|until| until.is_null() || until.as_str().is_some_and(|to| date <= to))
}
pub(super) fn plain(date: &str) -> Result<jiff::civil::Date, AllowanceError> {
    date.parse().map_err(|_| AllowanceError::InvalidDay)
}
pub(super) fn previous(date: jiff::civil::Date) -> Result<String, AllowanceError> {
    date.checked_sub(jiff::Span::new().days(1))
        .map(|d| d.to_string())
        .map_err(|_| AllowanceError::InvalidDay)
}
pub(super) fn policy<'a>(day: &AllowanceDay<'a>, suffix: &str) -> Option<&'a Value> {
    let package = match &day.context.kind {
        ContextKind::TvlKr { rule_package, .. }
        | ContextKind::TvalTraining { rule_package, .. } => *rule_package,
        _ => return None,
    };
    package.rules().get(format!(
        "{}{}",
        if matches!(day.context.kind, ContextKind::TvalTraining { .. }) {
            "tval"
        } else {
            "tvl"
        },
        suffix
    ))
}
pub(super) fn weekly(day: &AllowanceDay<'_>) -> Result<(i64, i64), AllowanceError> {
    match day.context.kind {
        ContextKind::TvlKr {
            weekly_minutes,
            full_time_weekly_minutes,
            ..
        }
        | ContextKind::TvalTraining {
            weekly_minutes,
            full_time_weekly_minutes,
            ..
        } => Ok((weekly_minutes, full_time_weekly_minutes)),
        _ => Err(AllowanceError::InvalidInput),
    }
}
struct Bucket<'a> {
    key: String,
    position: SupplementPosition<'a>,
    monthly: bool,
    personal: Option<i64>,
}

/// Days are native resolved contexts; no caller-supplied amounts or readiness flags.
pub fn calculate_shift_allowances<'a>(
    days: &[AllowanceDay<'a>],
) -> Result<Vec<SupplementPosition<'a>>, AllowanceError> {
    let mut buckets: Vec<Bucket<'a>> = vec![];
    let mut previous_date: Option<&str> = None;
    for day in days {
        let training = matches!(day.context.kind, ContextKind::TvalTraining { .. });
        let date = &day.date;
        let p = plain(date)?;
        let (weekly, full) = weekly(day)?;
        if training
            && (p.to_string() != *date
                || previous_date.is_some_and(|previous| date.as_str() <= previous)
                || day.worked_minutes.fract() != 0.0
                || day.worked_minutes < 0.0
                || day.worked_minutes > crate::money::MAX_SAFE_INTEGER as f64
                || weekly <= 0
                || weekly > full)
        {
            return Err(AllowanceError::InvalidDay);
        }
        previous_date = Some(date);
        let found_policy = policy(day, "ShiftAllowancePolicy");
        if found_policy.is_none() && !training {
            continue;
        }
        let policy = found_policy.unwrap_or(&Value::Null);
        let package = day
            .context
            .kind
            .rule_package()
            .ok_or(AllowanceError::InvalidInput)?;
        let valid = found_policy.is_some()
            && package.valid_from.as_str() <= date.as_str()
            && package
                .valid_to
                .as_deref()
                .is_none_or(|to| date.as_str() <= to);
        let scope = match &day.context.kind {
            ContextKind::TvalTraining { employer_scope, .. } => employer_scope.map(|s| match s {
                TvalEmployerScope::General => "GENERAL",
                TvalEmployerScope::Section43 => "SECTION_43",
            }),
            _ => None,
        };
        let period_list = if training {
            policy["scopes"]
                .as_array()
                .and_then(|scopes| scopes.iter().find(|row| row["id"].as_str() == scope))
                .and_then(|row| row["rates"]["periods"].as_array())
        } else {
            policy["periods"].as_array()
        };
        let periods: Vec<&Value> = period_list
            .into_iter()
            .flatten()
            .filter(|row| (!training || valid) && active(row, date))
            .collect();
        let period = if periods.len() == 1 {
            Some(periods[0])
        } else {
            None
        };
        let confirmed = day.entitlement.as_deref().filter(|e| {
            e["origin"] == "confirmed"
                && (!training
                    || (e["from"].as_str().is_some_and(|from| from <= date.as_str())
                        && e["through"].as_str().is_some_and(|to| date.as_str() <= to)))
        });
        let status = confirmed.and_then(|e| e["status"].as_str());
        let monthly = status.is_some_and(|s| s.ends_with("_MONTHLY"));
        let alternating = status.is_some_and(|s| s.starts_with("ALTERNATING"));
        let no_claim = status == Some("NONE");
        let rate = if status.is_none() || training && !valid || !training && period.is_none() {
            None
        } else if no_claim {
            Some(0)
        } else {
            period
                .map(|row| {
                    number(
                        row,
                        if alternating {
                            if monthly {
                                "alternatingMonthlyCents"
                            } else {
                                "alternatingHourlyCents"
                            }
                        } else if monthly {
                            "shiftMonthlyCents"
                        } else {
                            "shiftHourlyCents"
                        },
                    )
                })
                .transpose()?
        };
        let share = if training && valid {
            Some(number(policy, "shareBasisPoints")?)
        } else {
            None
        };
        let personal = rate
            .map(|rate| -> Result<i64, AllowanceError> {
                let training_rate = if let Some(share) = share {
                    round_remuneration_cents(rate as f64 * share as f64, 10_000.0)?
                } else {
                    rate
                };
                Ok(if monthly {
                    round_remuneration_cents(training_rate as f64 * weekly as f64, full as f64)?
                } else {
                    training_rate
                })
            })
            .transpose()?;
        let issue = if training && !valid {
            Some(SupplementIssue::new(
                SupplementIssueKind::AllowanceRuleMissing,
                "Die datierte TVA-L-Schichtzulagenregel fehlt oder ist ungültig.",
            ))
        } else if !training && period.is_none() {
            Some(SupplementIssue::new(
                SupplementIssueKind::AllowanceRuleMissing,
                "Die datierte TV-L-Schichtzulagenregel fehlt.",
            ))
        } else if confirmed.is_none() {
            Some(SupplementIssue::new(
                SupplementIssueKind::AllowanceDecisionMissing,
                if training {
                    "Bitte den TVA-L-Schichtzulagenanspruch für diesen Zeitraum ausdrücklich bestätigen."
                } else {
                    "Bitte den TV-L-Schichtzulagenanspruch für diesen Zeitraum ausdrücklich bestätigen."
                },
            ))
        } else if training && !no_claim && period.is_none() {
            Some(SupplementIssue::new(
                SupplementIssueKind::AllowanceDecisionMissing,
                "Bitte bestätigen, ob die allgemeine TV-L-Regel oder die Krankenhausregelung nach § 43 gilt.",
            ))
        } else {
            None
        };
        let mut basis = SupplementBasis::empty(1, i32::from(p.days_in_month()));
        basis.rule_id = period.map(|period| {
            if training {
                format!(
                    "tval-{}:{}:{}",
                    scope.unwrap_or("null"),
                    status.unwrap_or("undefined"),
                    period["validFrom"].as_str().unwrap_or("")
                )
            } else {
                format!(
                    "tvl-{}:{}",
                    status.unwrap_or("unconfirmed").to_lowercase(),
                    period["validFrom"].as_str().unwrap_or("")
                )
            }
        });
        basis.allowance_type = Some(if alternating {
            AllowanceType::AlternatingShift
        } else {
            AllowanceType::Shift
        });
        basis.rate_cents = rate;
        basis.personal_monthly_cents = monthly.then_some(personal).flatten();
        basis.percentage_basis_points = share;
        basis.minutes = if !monthly && !no_claim {
            day.worked_minutes
        } else {
            0.0
        };
        basis.entitlement = if confirmed.is_some() {
            day.entitlement.clone()
        } else {
            None
        };
        basis.pause_method = if !monthly && !no_claim && day.estimated_pause {
            PauseMethod::CenteredDurationEstimate
        } else {
            PauseMethod::None
        };
        basis.proration = if training && issue.is_some() {
            Proration::Unconfirmed
        } else if monthly {
            Proration::CalendarDays
        } else if no_claim {
            Proration::None
        } else {
            Proration::WorkedMinutes
        };
        let position = SupplementPosition {
            id: format!(
                "{}-shift-allowance:{date}",
                if training { "tval" } else { "tvl" }
            ),
            kind: SupplementKind::Allowance,
            label: format!(
                "{}-{}zulage{}",
                if training { "TVA-L" } else { "TV-L" },
                if alternating {
                    "Wechselschicht"
                } else {
                    "Schicht"
                },
                if training {
                    " · Ausbildungsanteil"
                } else {
                    ""
                }
            ),
            from: date.clone(),
            through: date.clone(),
            source: day.context.source.clone(),
            amount_cents: if training {
                issue.is_none().then_some(0)
            } else {
                rate.map(|_| 0)
            },
            status: if training && issue.is_some() || !training && rate.is_none() {
                RemunerationStatus::Unavailable
            } else if no_claim {
                RemunerationStatus::Calculated
            } else {
                RemunerationStatus::Estimated
            },
            issue,
            basis,
        };
        let k = if training {
            key((
                &date[..7],
                &day.context.source,
                weekly,
                full,
                scope,
                period,
                confirmed,
                rate,
                personal,
                &position.issue,
            ))?
        } else {
            key((
                &date[..7],
                &day.context.source,
                weekly,
                full,
                period,
                confirmed,
                rate,
            ))?
        };
        if let Some(before) = buckets.last_mut().filter(|before| {
            before.key == k && before.position.through == previous(p).unwrap_or_default()
        }) {
            before.position.through = date.clone();
            before.position.basis.calendar_days += 1;
            before.position.basis.minutes += position.basis.minutes;
            if position.basis.pause_method == PauseMethod::CenteredDurationEstimate {
                before.position.basis.pause_method = PauseMethod::CenteredDurationEstimate;
            }
        } else {
            buckets.push(Bucket {
                key: k,
                position,
                monthly,
                personal,
            });
        }
    }
    buckets
        .into_iter()
        .map(|mut b| {
            if let Some(personal) = b.personal.filter(|_| {
                !matches!(
                    b.position.source.requested_package_id,
                    Some("tval-pflege-tdl")
                ) || b.position.issue.is_none()
            }) {
                b.position.amount_cents = Some(if b.monthly {
                    round_remuneration_cents(
                        personal as f64 * b.position.basis.calendar_days as f64,
                        b.position.basis.month_days as f64,
                    )?
                } else {
                    round_remuneration_cents(personal as f64 * b.position.basis.minutes, 60.0)?
                });
                if b.monthly && b.position.basis.calendar_days == b.position.basis.month_days {
                    b.position.basis.proration = Proration::None;
                }
            }
            Ok(b.position)
        })
        .collect()
}
