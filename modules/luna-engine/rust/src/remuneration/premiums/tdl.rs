use super::{PremiumError, common::*, model::*};
use crate::{
    remuneration::{
        base::{
            model::RemunerationStatus, round_remuneration_cents, shift_days::RemunerationShiftDay,
        },
        context::model::IssueCode,
        profile::{TvalEmployerScope, TvlEmploymentCategory},
    },
    rules::{RulePackage, RuleResolver},
};
use serde_json::Value;
#[derive(Clone, Copy)]
pub(super) enum Family<'a> {
    Kr {
        group_id: &'a str,
    },
    Training {
        monthly_cents: i64,
        employer_scope: Option<TvalEmployerScope>,
    },
}
pub(super) struct Context<'a> {
    pub family: Family<'a>,
    pub package: &'a RulePackage,
    pub full_time_weekly_minutes: i64,
    pub employment_category: Option<TvlEmploymentCategory>,
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum Id {
    Night,
    Sunday,
    HolidayWith,
    HolidayWithout,
    PreHoliday,
    Saturday,
    SaturdayFixed,
    SaturdayUnknown,
    HolidayUnknown,
}
impl Id {
    fn text(self) -> &'static str {
        match self {
            Self::Night => "night",
            Self::Sunday => "sunday",
            Self::HolidayWith => "holiday-with-time-off",
            Self::HolidayWithout => "holiday-without-time-off",
            Self::PreHoliday => "pre-holiday",
            Self::Saturday => "saturday",
            Self::SaturdayFixed => "saturday-fixed",
            Self::SaturdayUnknown => "saturday-unconfirmed",
            Self::HolidayUnknown => "holiday-unconfirmed",
        }
    }
    fn unknown(self) -> bool {
        matches!(self, Self::SaturdayUnknown | Self::HolidayUnknown)
    }
}
#[derive(Clone, Copy)]
struct Candidate {
    id: Id,
    label: &'static str,
    hourly: i64,
    percentage: Option<i64>,
    rounded: Option<i64>,
}
impl Candidate {
    fn rank(self) -> f64 {
        self.rounded.map_or(
            self.hourly as f64 * self.percentage.unwrap_or(10_000) as f64,
            |n| n as f64,
        )
    }
}
fn count(buckets: &mut Vec<(Candidate, f64)>, candidate: Candidate) {
    if let Some((_, minutes)) = buckets.iter_mut().find(|(old, _)| old.id == candidate.id) {
        *minutes += 1.0;
    } else {
        buckets.push((candidate, 1.0));
    }
}
fn integer(v: &Value, key: &str) -> Result<i64, PremiumError> {
    let n = number(v, key)?;
    if n.fract() != 0.0 || n.abs() > crate::money::MAX_SAFE_INTEGER as f64 {
        return Err(PremiumError::MissingRate);
    }
    Ok(n as i64)
}
pub(super) fn calculate<'a>(
    base: &TimeRemunerationPosition<'a>,
    day: &RemunerationShiftDay,
    shift: &Value,
    work: &Value,
    context: &Context<'_>,
    resolver: &RuleResolver,
    shift_work: Option<bool>,
) -> Result<Vec<TimeRemunerationPosition<'a>>, PremiumError> {
    let training = matches!(context.family, Family::Training { .. });
    let rules = context.package.rules();
    let policy = rules
        .get(if training {
            "tvalTimePremiumPolicy"
        } else {
            "tvlTimePremiumPolicy"
        })
        .filter(|v| v.is_object())
        .ok_or(PremiumError::MissingRate)?;
    let monthly = match context.family {
        Family::Training { monthly_cents, .. } => monthly_cents,
        Family::Kr { group_id } => {
            let reference = rules["payTables"][0]["entries"]
                .as_array()
                .and_then(|entries| {
                    entries.iter().find(|e| {
                        e["groupId"] == group_id && e.get("stepId") == policy.get("referenceStepId")
                    })
                })
                .ok_or(PremiumError::MissingRate)?;
            integer(reference, "monthlyCents")?
        }
    };
    let hourly = round_remuneration_cents(
        monthly as f64 * 60_000.0,
        context.full_time_weekly_minutes as f64 * number(policy, "monthlyFactorThousandths")?,
    )?;
    let percent = |id, label, rate: i64| -> Result<Candidate, PremiumError> {
        Ok(Candidate {
            id,
            label,
            hourly,
            percentage: Some(rate),
            rounded: if training {
                Some(round_remuneration_cents(
                    hourly as f64 * rate as f64,
                    10_000.0,
                )?)
            } else {
                None
            },
        })
    };
    let saturday_percent = percent(
        Id::Saturday,
        "Samstagszuschlag",
        integer(policy, "saturdayBasisPoints")?,
    )?;
    let fixed = integer(
        policy,
        if training {
            "hospitalSalariedShiftHourlyCents"
        } else {
            "saturdaySalariedShiftHourlyCents"
        },
    )?;
    let saturday_fixed = Candidate {
        id: Id::SaturdayFixed,
        label: if training {
            "Samstagszuschlag · § 43 / § 38 Abs. 5"
        } else {
            "Samstagszuschlag · § 38 Abs. 5 Satz 1"
        },
        hourly: fixed,
        percentage: None,
        rounded: if training { Some(fixed) } else { None },
    };
    let saturday = if shift_work == Some(false) {
        Some(saturday_percent)
    } else if let Family::Training { employer_scope, .. } = context.family {
        let no_shift = employer_scope == Some(TvalEmployerScope::General)
            || context.employment_category == Some(TvlEmploymentCategory::Other);
        let fixed_confirmed = employer_scope == Some(TvalEmployerScope::Section43)
            && context.employment_category == Some(TvlEmploymentCategory::SalariedSection3851);
        if shift_work == Some(true) && fixed_confirmed {
            Some(saturday_fixed)
        } else if shift_work == Some(true) && no_shift {
            None
        } else {
            let mut upper = if shift_work == Some(true) {
                saturday_fixed
            } else if no_shift || saturday_percent.rank() >= saturday_fixed.rank() {
                saturday_percent
            } else {
                saturday_fixed
            };
            upper.id = Id::SaturdayUnknown;
            Some(upper)
        }
    } else if shift_work == Some(true) && context.employment_category.is_some() {
        if context.employment_category == Some(TvlEmploymentCategory::SalariedSection3851) {
            Some(saturday_fixed)
        } else {
            None
        }
    } else {
        let mut upper = if shift_work == Some(true) {
            saturday_fixed
        } else if context.employment_category == Some(TvlEmploymentCategory::Other)
            || saturday_percent.rank() >= saturday_fixed.rank()
        {
            saturday_percent
        } else {
            saturday_fixed
        };
        upper.id = Id::SaturdayUnknown;
        Some(upper)
    };
    let holiday = holiday(&day.date, work, resolver)?;
    if !training && holiday.is_none() {
        let mut position = base.clone();
        position.status = RemunerationStatus::Unavailable;
        position.amount_cents = None;
        position.issue = Some(PremiumIssue::new(
            PremiumIssueKind::HolidayRulesUnavailable,
            "Die Feiertagsregeln fehlen für diesen TV-L-Abschnitt.",
        ));
        return Ok(vec![position]);
    }
    let bounds = frame(shift, work)?.ok_or(PremiumError::MissingRate)?;
    let clock = DayClock::new(day, work)?;
    let night = percent(
        Id::Night,
        "Nachtzuschlag",
        integer(policy, "nightBasisPoints")?,
    )?;
    let sunday = percent(
        Id::Sunday,
        "Sonntagszuschlag",
        integer(policy, "sundayBasisPoints")?,
    )?;
    let with_time_off = shift["holidayPremiumMode"] == "WITH_TIME_OFF";
    let holiday_rate = integer(
        policy,
        if with_time_off {
            "holidayWithTimeOffBasisPoints"
        } else {
            "holidayWithoutTimeOffBasisPoints"
        },
    )?;
    let holiday_candidate = percent(
        if with_time_off {
            Id::HolidayWith
        } else {
            Id::HolidayWithout
        },
        "Feiertagszuschlag",
        holiday_rate,
    )?;
    let holiday_unknown = percent(
        Id::HolidayUnknown,
        "Feiertagszuschlag ungeklärt",
        holiday_rate,
    )?;
    let pre_holiday = percent(
        Id::PreHoliday,
        "Vorfesttagszuschlag",
        integer(policy, "preHolidayBasisPoints")?,
    )?;
    let pre_day = policy["preHolidayMonthDays"]
        .as_array()
        .is_some_and(|days| days.iter().any(|v| v.as_str() == day.date.get(5..)));
    let window = |key: &str| -> Result<(f64, f64), PremiumError> {
        Ok((
            number(&policy[key], "startMinute")?,
            number(&policy[key], "endMinute")?,
        ))
    };
    let (night_from, night_until) = window("nightWindow")?;
    let (pre_from, pre_until) = window("preHolidayWindow")?;
    let (sat_from, sat_until) = window("saturdayWindow")?;
    let mut buckets = vec![];
    let mut offset = day.from;
    while offset < day.until {
        if !bounds.paused(offset) {
            let minute = clock.minute(offset)?;
            if in_window(minute, night_from, night_until) {
                count(&mut buckets, night);
            }
            let competing = [
                if clock.weekday == 7 {
                    Some(sunday)
                } else {
                    None
                },
                if holiday == Some(true) {
                    Some(holiday_candidate)
                } else {
                    None
                },
                if pre_day && in_window(minute, pre_from, pre_until) {
                    Some(pre_holiday)
                } else {
                    None
                },
                if clock.weekday == 6 && in_window(minute, sat_from, sat_until) {
                    saturday
                } else {
                    None
                },
                if training && holiday.is_none() {
                    Some(holiday_unknown)
                } else {
                    None
                },
            ];
            let mut best: Option<Candidate> = None;
            for item in competing.into_iter().flatten() {
                if best.is_none_or(|old| {
                    item.rank() > old.rank()
                        || training
                            && item.rank() == old.rank()
                            && old.id.unknown()
                            && !item.id.unknown()
                }) {
                    best = Some(item);
                }
            }
            if let Some(winner) = best {
                count(&mut buckets, winner);
            }
        }
        offset += 1.0;
    }
    if buckets.is_empty() {
        let mut position = base.clone();
        position.label = if training {
            "Keine TVA-L-Zeitzuschläge in diesem Abschnitt"
        } else {
            "Keine TV-L-Zeitzuschläge in diesem Abschnitt"
        }
        .into();
        return Ok(vec![position]);
    }
    buckets.into_iter().map(|(c,minutes)|{
        let mut position=base.clone();let rule_id=format!("{}-{}",if training{"tval"}else{"tvl"},c.id.text());position.id=format!("{}:{rule_id}",base.id);position.label=c.label.into();
        if c.id.unknown(){position.status=RemunerationStatus::Unavailable;position.amount_cents=None;position.issue=Some(if c.id==Id::HolidayUnknown{PremiumIssue::new(PremiumIssueKind::HolidayRulesUnavailable,"Feiertagsregeln fehlen für diesen TVA-L-Abschnitt.")}else{PremiumIssue::context(IssueCode::ProfileInvalid,if training{"Für den TVA-L-Samstagszuschlag bitte Arbeitgeberregelung, Schichtarbeitsbezug und Beschäftigtenkategorie bestätigen."}else{"Für den Samstagszuschlag bitte Schichtarbeitsbezug und Kategorie nach § 38 Abs. 5 TV-L bestätigen."})});}
        else{position.amount_cents=Some(if training{round_remuneration_cents(c.rounded.ok_or(PremiumError::MissingRate)? as f64*minutes,60.0)?}else{round_remuneration_cents(c.rank()*minutes,600_000.0)?});position.issue=None;}
        position.basis.rule_id=Some(rule_id);position.basis.minutes=minutes;position.basis.hourly_rate_cents=if c.id.unknown(){None}else{Some(c.hourly)};position.basis.percentage_basis_points=if c.id.unknown(){None}else{c.percentage};position.basis.rounded_premium_hourly_cents=if training{Some(if c.id.unknown(){None}else{c.rounded})}else{None};Ok(position)
    }).collect()
}
