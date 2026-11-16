use super::{
    AllowanceError,
    burn::{BurnCareResult, filtered_references, integer},
    key,
    model::*,
    shift::{AllowanceDay, plain, policy, previous, weekly},
};
use crate::remuneration::{
    Presence,
    base::{model::RemunerationStatus, round_remuneration_cents},
    care::{FunctionDuty, LeadershipAnnexF, TvalClinical, TvlClinical},
    context::model::ContextKind,
};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Component {
    Nursing,
    Instructor,
    Clinical,
    Leadership,
    Function,
}
impl Component {
    fn text(self) -> &'static str {
        match self {
            Self::Nursing => "nursing",
            Self::Instructor => "instructor",
            Self::Clinical => "clinical",
            Self::Leadership => "leadership",
            Self::Function => "function",
        }
    }
    fn label(self) -> &'static str {
        match self {
            Self::Nursing => "TV-L-Pflegezulage",
            Self::Instructor => "TV-L-Praxisanleitung",
            Self::Clinical => "TV-L-Tätigkeitszulage",
            Self::Leadership => "TV-L-Leitungszulage",
            Self::Function => "TV-L-Funktions-/Stationsleitungszulage",
        }
    }
}
fn rate_for(
    day: &AllowanceDay<'_>,
    component: Component,
    burn_unclear: bool,
    burn_positive: bool,
) -> Option<i64> {
    let policy = policy(day, "CareAllowancePolicy")?;
    let ContextKind::TvlKr {
        care_allowances: Some(facts),
        group_id,
        ..
    } = &day.context.kind
    else {
        return None;
    };
    let group = group_id.get(2..)?.parse::<i64>().ok()?;
    match component {
        Component::Function => {
            if facts.function_duty == Presence::Value(FunctionDuty::None)
                || facts.paid_entitlement == Some(false)
            {
                return Some(0);
            }
            let Presence::Value(duty) = facts.function_duty else {
                return None;
            };
            if facts.paid_entitlement != Some(true) || duty == FunctionDuty::Leadership && group < 9
            {
                return None;
            }
            let clinical = rate_for(day, Component::Clinical, burn_unclear, burn_positive)?;
            if clinical > 0 && burn_positive {
                return None;
            }
            if clinical > 0 {
                Some(0)
            } else {
                integer(policy, "functionMonthlyCents")
            }
        }
        Component::Nursing => {
            if facts.nursing == Some(false) || facts.paid_entitlement == Some(false) {
                Some(0)
            } else if facts.nursing == Some(true) && facts.paid_entitlement == Some(true) {
                integer(policy, "nursingMonthlyCents")
            } else {
                None
            }
        }
        Component::Instructor => {
            if facts.instructor == Some(false) || facts.paid_entitlement == Some(false) {
                Some(0)
            } else if (5..=9).contains(&group)
                && facts.instructor == Some(true)
                && facts.paid_entitlement == Some(true)
            {
                integer(policy, "instructorMonthlyCents")
            } else {
                None
            }
        }
        Component::Leadership => {
            if facts.leadership_annex_f_number == Some(LeadershipAnnexF::None)
                || facts.paid_entitlement == Some(false)
            {
                return Some(0);
            }
            let Some(LeadershipAnnexF::Number(number)) = facts.leadership_annex_f_number else {
                return None;
            };
            if facts.paid_entitlement != Some(true) || group < 9 {
                return None;
            }
            policy["leadershipTiers"]
                .as_array()?
                .iter()
                .find(|tier| integer(tier, "annexFNumber") == Some(i64::from(number)))
                .and_then(|tier| integer(tier, "monthlyCents"))
        }
        Component::Clinical => {
            if facts.clinical == Some(TvlClinical::None) || facts.paid_entitlement == Some(false) {
                return Some(0);
            }
            let clinical = facts.clinical?;
            if facts.paid_entitlement != Some(true) || burn_unclear {
                return None;
            }
            let leader = matches!(
                clinical,
                TvlClinical::LeaderLower | TvlClinical::LeaderHigher
            );
            if leader && !(9..=15).contains(&group) || !leader && !(5..=9).contains(&group) {
                return None;
            }
            integer(
                policy,
                if matches!(
                    clinical,
                    TvlClinical::DirectHigher | TvlClinical::LeaderHigher
                ) {
                    "clinicalHigherMonthlyCents"
                } else {
                    "clinicalLowerMonthlyCents"
                },
            )
        }
    }
}
fn finish<'a>(
    positions: Vec<SupplementPosition<'a>>,
) -> Result<Vec<SupplementPosition<'a>>, AllowanceError> {
    positions
        .into_iter()
        .map(|mut p| {
            p.amount_cents = p
                .basis
                .personal_monthly_cents
                .map(|amount| {
                    round_remuneration_cents(
                        amount as f64 * p.basis.calendar_days as f64,
                        p.basis.month_days as f64,
                    )
                })
                .transpose()?;
            p.basis.proration = if p.basis.calendar_days == p.basis.month_days {
                Proration::None
            } else {
                Proration::CalendarDays
            };
            Ok(p)
        })
        .collect()
}

pub fn calculate_care_allowances<'a>(
    days: &[AllowanceDay<'a>],
    burn: BurnCareResult<'a>,
) -> Result<Vec<SupplementPosition<'a>>, AllowanceError> {
    if days.is_empty() {
        return Ok(vec![]);
    }
    if matches!(days[0].context.kind, ContextKind::TvalTraining { .. }) {
        return training(days, burn);
    }
    let mut positions: Vec<SupplementPosition<'a>> = vec![];
    let burn_unclear = burn.total_cents.is_none();
    let burn_amount = burn.total_cents.unwrap_or(0);
    for component in [
        Component::Nursing,
        Component::Instructor,
        Component::Clinical,
        Component::Leadership,
        Component::Function,
    ] {
        let mut previous_key: Option<String> = None;
        for day in days {
            let Some(policy) = policy(day, "CareAllowancePolicy") else {
                previous_key = None;
                continue;
            };
            let p = plain(&day.date)?;
            let (weekly, full) = weekly(day)?;
            let rate = rate_for(day, component, burn_unclear, burn_amount > 0);
            let personal = rate
                .map(|rate| round_remuneration_cents(rate as f64 * weekly as f64, full as f64))
                .transpose()?;
            let ContextKind::TvlKr {
                group_id,
                care_allowances,
                ..
            } = &day.context.kind
            else {
                return Err(AllowanceError::InvalidInput);
            };
            let k = key((
                component.text(),
                &day.date[..7],
                &day.context.source,
                group_id,
                weekly,
                full,
                care_allowances,
                policy,
                rate,
            ))?;
            if let Some(before) = positions.last_mut().filter(|before| {
                previous_key.as_ref() == Some(&k)
                    && before.through == previous(p).unwrap_or_default()
            }) {
                before.through = day.date.clone();
                before.basis.calendar_days += 1;
                continue;
            }
            previous_key = Some(k);
            let mut source = day.context.source.clone();
            source.references = filtered_references(day);
            let mut basis = SupplementBasis::empty(1, i32::from(p.days_in_month()));
            basis.rule_id = Some(if component == Component::Function {
                "tvl-section-43:8".into()
            } else {
                format!("tvl-part-iv:{}", component.text())
            });
            basis.allowance_type = Some(AllowanceType::Care);
            basis.rate_cents = rate;
            basis.personal_monthly_cents = personal;
            basis.proration = Proration::CalendarDays;
            positions.push(SupplementPosition{id:format!("tvl-care:{}:{}",component.text(),day.date),kind:SupplementKind::Allowance,label:component.label().into(),from:day.date.clone(),through:day.date.clone(),amount_cents:rate.map(|_|0),status:if rate.is_none(){RemunerationStatus::Unavailable}else if rate==Some(0){RemunerationStatus::Calculated}else{RemunerationStatus::Estimated},source,basis,issue:rate.is_none().then(||SupplementIssue::new(SupplementIssueKind::AllowanceDecisionMissing,if component==Component::Clinical&&burn_unclear{"Schwerbrandpflegezeiten oder Anspruch bitte klären; die monatliche Anrechnung auf die Tätigkeitszulage ist noch unbestimmt."}else if component==Component::Function&&burn_amount>0{"Zusammentreffen von Funktionszulage, Tätigkeitszulage und Schwerbrandpflege bitte fachlich klären."}else{"Bitte die persönlichen Voraussetzungen, Entgeltanspruch und passende Tätigkeits-/Gruppenzuordnung im datierten Vergütungsprofil bestätigen."}))});
        }
    }
    let mut finished = finish(positions)?;
    let clinical: Vec<_> = finished
        .iter()
        .filter(|p| p.basis.rule_id.as_deref() == Some("tvl-part-iv:clinical"))
        .collect();
    let unknown = clinical.iter().any(|p| p.amount_cents.is_none());
    let total: i64 = clinical.iter().map(|p| p.amount_cents.unwrap_or(0)).sum();
    if unknown && burn_amount > 0 {
        for p in &mut finished {
            if p.basis.rule_id.as_deref() == Some("tvl-part-iv:clinical")
                && p.amount_cents.unwrap_or(0) > 0
            {
                p.amount_cents = None;
                p.status = RemunerationStatus::Unavailable;
                p.issue = Some(SupplementIssue::new(
                    SupplementIssueKind::AllowanceDecisionMissing,
                    "Die Tätigkeitszulage ist nicht für den ganzen Monat geklärt; ihre Schwerbrandpflege-Anrechnung bleibt offen.",
                ));
            }
        }
    }
    let offset = if !unknown && burn_amount > 0 {
        total.min(burn_amount)
    } else {
        0
    };
    let mut offset_position = None;
    if offset > 0 {
        let mut p = burn
            .positions
            .first()
            .ok_or(AllowanceError::InvalidInput)?
            .clone();
        p.id = format!("tvl-care:burn-offset:{}", &days[0].date[..7]);
        p.label = "Anrechnung Schwerbrandpflege auf Tätigkeitszulage".into();
        p.amount_cents = Some(-offset);
        p.status = RemunerationStatus::Estimated;
        p.issue = None;
        p.basis.rule_id = Some("tvl-part-iv:burn-month-offset".into());
        p.basis.rate_cents = None;
        p.basis.personal_monthly_cents = None;
        p.basis.proration = Proration::None;
        offset_position = Some(p);
    }
    finished.extend(burn.positions);
    finished.extend(offset_position);
    Ok(finished)
}

fn training<'a>(
    days: &[AllowanceDay<'a>],
    burn: BurnCareResult<'a>,
) -> Result<Vec<SupplementPosition<'a>>, AllowanceError> {
    let mut positions: Vec<SupplementPosition<'a>> = vec![];
    let mut previous_key: Option<String> = None;
    for day in days {
        let p = plain(&day.date)?;
        let policy = policy(day, "CareAllowancePolicy");
        let ContextKind::TvalTraining {
            care_allowances,
            rule_package,
            ..
        } = &day.context.kind
        else {
            return Err(AllowanceError::InvalidInput);
        };
        let (weekly, full) = weekly(day)?;
        let valid = policy.is_some()
            && rule_package.valid_from.as_str() <= day.date.as_str()
            && rule_package
                .valid_to
                .as_deref()
                .is_none_or(|to| day.date.as_str() <= to);
        let no_claim = care_allowances.as_ref().is_some_and(|f| {
            f.clinical == Some(TvalClinical::None) || f.paid_entitlement == Some(false)
        });
        let employee = if !valid {
            None
        } else if no_claim {
            Some(0)
        } else {
            care_allowances
                .as_ref()
                .filter(|f| {
                    f.paid_entitlement == Some(true)
                        && f.clinical.is_some()
                        && burn.total_cents.is_some()
                })
                .and_then(|f| {
                    integer(
                        policy?,
                        if f.clinical == Some(TvalClinical::Higher) {
                            "clinicalHigherMonthlyCents"
                        } else {
                            "clinicalLowerMonthlyCents"
                        },
                    )
                })
        };
        let share = policy.and_then(|p| integer(p, "shareBasisPoints"));
        let personal = employee
            .map(|rate| -> Result<i64, AllowanceError> {
                let training = round_remuneration_cents(
                    rate as f64 * share.ok_or(AllowanceError::InvalidInput)? as f64,
                    10_000.0,
                )?;
                Ok(round_remuneration_cents(
                    training as f64 * weekly as f64,
                    full as f64,
                )?)
            })
            .transpose()?;
        let issue = if !valid {
            Some(SupplementIssue::new(
                SupplementIssueKind::AllowanceRuleMissing,
                "Die datierte TVA-L-Tätigkeitszulagenregel fehlt.",
            ))
        } else if employee.is_none() {
            Some(SupplementIssue::new(
                SupplementIssueKind::AllowanceDecisionMissing,
                if burn.total_cents.is_none() {
                    "Schwerbrandpflegeanspruch und tatsächliche Zeiten bitte klären; die monatliche Anrechnung ist offen."
                } else {
                    "Bitte Entgeltanspruch und qualifizierende TVA-L-Tätigkeit im datierten Profil bestätigen."
                },
            ))
        } else {
            None
        };
        let k = key((
            &day.date[..7],
            &day.context.source,
            policy,
            care_allowances,
            personal,
            employee,
            &issue,
        ))?;
        if let Some(before) = positions.last_mut().filter(|before| {
            previous_key.as_ref() == Some(&k) && before.through == previous(p).unwrap_or_default()
        }) {
            before.through = day.date.clone();
            before.basis.calendar_days += 1;
            continue;
        }
        previous_key = Some(k);
        let mut source = day.context.source.clone();
        source.references = filtered_references(day);
        let mut basis = SupplementBasis::empty(1, i32::from(p.days_in_month()));
        basis.rule_id = Some("tval-part-iv:clinical".into());
        basis.allowance_type = Some(AllowanceType::Care);
        basis.rate_cents = employee;
        basis.personal_monthly_cents = personal;
        basis.percentage_basis_points = share;
        basis.proration = Proration::CalendarDays;
        positions.push(SupplementPosition {
            id: format!("tval-care:clinical:{}", day.date),
            kind: SupplementKind::Allowance,
            label: "TVA-L-Tätigkeitszulage · Ausbildungsanteil".into(),
            from: day.date.clone(),
            through: day.date.clone(),
            amount_cents: personal.map(|_| 0),
            status: if issue.is_some() {
                RemunerationStatus::Unavailable
            } else if no_claim {
                RemunerationStatus::Calculated
            } else {
                RemunerationStatus::Estimated
            },
            issue,
            source,
            basis,
        });
    }
    let mut finished = finish(positions)?;
    let unknown = finished.iter().any(|p| p.amount_cents.is_none());
    let burn_amount = burn.total_cents.unwrap_or(0);
    if unknown && burn_amount > 0 {
        for p in &mut finished {
            if p.amount_cents.unwrap_or(0) > 0 {
                p.amount_cents = None;
                p.status = RemunerationStatus::Unavailable;
                p.issue = Some(SupplementIssue::new(
                    SupplementIssueKind::AllowanceDecisionMissing,
                    "Monatliche Tätigkeitszulage nicht vollständig geklärt; Schwerbrandpflege-Anrechnung bleibt offen.",
                ));
            }
        }
    }
    let offset = if unknown {
        0
    } else {
        burn_amount.min(finished.iter().map(|p| p.amount_cents.unwrap_or(0)).sum())
    };
    let mut offset_position = None;
    if offset > 0 {
        let mut p = finished
            .first()
            .ok_or(AllowanceError::InvalidInput)?
            .clone();
        if let Some(burn) = burn.positions.first() {
            p.source = burn.source.clone();
        }
        p.id = format!("tval-care:burn-offset:{}", &days[0].date[..7]);
        p.label = "Anrechnung Schwerbrandpflege auf TVA-L-Tätigkeitszulage".into();
        p.from = days[0].date.clone();
        p.through = days[days.len() - 1].date.clone();
        p.amount_cents = Some(-offset);
        p.status = RemunerationStatus::Estimated;
        p.issue = None;
        p.basis.rule_id = Some("tval-part-iv:burn-month-offset".into());
        p.basis.rate_cents = None;
        p.basis.personal_monthly_cents = None;
        p.basis.calendar_days =
            i32::try_from(days.len()).map_err(|_| AllowanceError::InvalidInput)?;
        p.basis.proration = Proration::None;
        offset_position = Some(p);
    }
    finished.extend(burn.positions);
    finished.extend(offset_position);
    Ok(finished)
}
