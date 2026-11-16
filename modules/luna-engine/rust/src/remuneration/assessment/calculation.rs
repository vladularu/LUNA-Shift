use super::{
    AssessmentError,
    decisions::validate_scoped_rows,
    model::*,
    window::{identity_at, identity_key, observation, split},
};
use crate::{
    employment::employment_work_pattern_from_history,
    input::calendar::validate_monthly_tariff_decision,
    pay::pattern::{
        Assignment, WorkPatternSettings, assess_tvoed_k_calendar_month_refs,
        assess_tvoed_pattern_refs, is_pay_work_shift,
    },
    remuneration::context::{
        model::{ContextKind, FullNativePackageValidator, IssueCode, RemunerationPeriod},
        periods::{remuneration_month_start, resolve_month},
    },
};
use serde_json::Value;
fn issue(code: SpecificIssueCode, message: &str) -> AssessmentIssue {
    AssessmentIssue {
        code: AssessmentIssueCode::Assessment(code),
        message: message.into(),
    }
}
fn unsupported(message: &str) -> AssessmentIssue {
    AssessmentIssue {
        code: AssessmentIssueCode::Context(IssueCode::TariffUnsupported),
        message: message.into(),
    }
}
fn active(value: &Value, date: &str) -> bool {
    value["validFrom"].as_str().is_some_and(|f| f <= date)
        && value
            .get("validTo")
            .is_some_and(|t| t.is_null() || t.as_str().is_some_and(|t| date <= t))
}
fn confirmed_context(period: &RemunerationPeriod<'_>, date: &str) -> bool {
    match &period.context.kind {
        ContextKind::Tariff { .. } | ContextKind::TrainingTariff { .. } => true,
        ContextKind::TvlKr { rule_package, .. } => rule_package.rules()["tvlShiftAllowancePolicy"]
            ["periods"]
            .as_array()
            .is_some_and(|rows| rows.iter().filter(|r| active(r, date)).count() == 1),
        // resolve_month admits only fully validated immutable packages; the original
        // family semantic helper was already included in that native validation.
        ContextKind::TvalTraining { rule_package, .. } => {
            rule_package.valid_from.as_str() <= date
                && rule_package.valid_to.as_deref().is_none_or(|t| date <= t)
                && rule_package
                    .rules()
                    .get("tvalShiftAllowancePolicy")
                    .is_some()
        }
        _ => false,
    }
}
fn initial_issue(period: &RemunerationPeriod<'_>) -> Option<AssessmentIssue> {
    match &period.context.kind {
        ContextKind::Unavailable { issue } => Some(AssessmentIssue {
            code: AssessmentIssueCode::Context(issue.code),
            message: issue.message.clone(),
        }),
        ContextKind::TvoedAnnexADraft { .. } => Some(unsupported(
            "Für TVöD-Anlage A ist noch keine vollständige Schichtzulagenprüfung verfügbar.",
        )),
        ContextKind::TvoedSueDraft { .. } => Some(unsupported(
            "Für SuE ist noch keine vollständige Schichtzulagenprüfung verfügbar.",
        )),
        ContextKind::TvalTraining { .. } => Some(unsupported(
            "TVA-L-Pflege-Schichtzulagen werden nicht aus TVöD-Arbeitsmustern abgeleitet. Bitte den Anspruch für den Zeitraum ausdrücklich bestätigen.",
        )),
        ContextKind::TvlKr { .. } => Some(unsupported(
            "Für TV-L/KR ist noch keine vollständige Schichtzulagenprüfung verfügbar.",
        )),
        ContextKind::TrainingTariff { rule_package, .. }
            if !rule_package.rules()["allowanceRules"]
                .as_array()
                .is_some_and(|r| {
                    r.iter().any(|r| {
                        (r["allowanceType"] == "shift" || r["allowanceType"] == "alternating-shift")
                            && active(r, &period.from)
                    })
                }) =>
        {
            Some(unsupported(
                "Für diesen historischen Zeitraum fehlen noch geprüfte Ausbildungs-Schichtzulagenregeln.",
            ))
        }
        ContextKind::OwnMonthly { .. } | ContextKind::OwnConfigured { .. } => Some(issue(
            SpecificIssueCode::OwnAssessmentUnsupported,
            "Eine tarifliche Schichtzulage wird bei eigener Vergütung nicht automatisch angenommen.",
        )),
        _ => None,
    }
}
fn assess_period<'a>(
    period: &RemunerationPeriod<'a>,
    input: &AssessmentInput<'a>,
) -> Result<PeriodAssessment<'a>, AssessmentError> {
    let settings = employment_work_pattern_from_history(
        input.work_profile,
        input.settings,
        &period.from,
        input.history,
    )?;
    let settings: WorkPatternSettings =
        serde_json::from_value(settings).map_err(|_| AssessmentError::InvalidInput)?;
    let mut result = PeriodAssessment {
        tariff: None,
        night_sequence: None,
        from: period.from.clone(),
        through: period.through.clone(),
        source: period.context.source.clone(),
        assessment: None,
        entitlement: None,
        observed_from: None,
        observed_through: None,
        settings_updated_at: settings.updated_at.clone(),
        issue: None,
    };
    result.issue = initial_issue(period);
    if result.issue.is_some() {
        return Ok(result);
    }
    let window = observation(period, input)?;
    let selection = &period
        .context
        .profile
        .ok_or(AssessmentError::InvalidInput)?["data"]["selection"];
    let package = period
        .context
        .kind
        .rule_package()
        .ok_or(AssessmentError::InvalidInput)?;
    let bt_k = selection["kind"] == "tariff" && selection["variant"] == "BT_K";
    let has_work = window.shifts.iter().any(|s| {
        s["date"]
            .as_str()
            .is_some_and(|d| d.starts_with(&format!("{}-", input.month)))
            && is_pay_work_shift(s)
    });
    let calendar = if bt_k {
        Some(assess_tvoed_k_calendar_month_refs(
            input.month,
            &window.shifts,
            &settings,
            input.resolver,
            input.work_profile["timeZone"]
                .as_str()
                .ok_or(AssessmentError::InvalidInput)?,
            Some(&period.from),
            Some(package),
        )?)
    } else {
        None
    };
    let assessment = match &calendar {
        Some(c) => c["assessment"].clone(),
        None => assess_tvoed_pattern_refs(
            if has_work { &window.shifts } else { &[] },
            &settings,
            input.resolver,
            Some(&period.from),
            None,
            Some(package),
        )?,
    };
    let incomplete =
        settings.assignment == Assignment::Unknown || assessment["requiresConfirmation"] == true;
    if selection["kind"] == "tariff" {
        result.tariff = Some(TariffIdentity {
            package_id: selection["packageId"]
                .as_str()
                .ok_or(AssessmentError::InvalidInput)?
                .into(),
            variant: selection["variant"]
                .as_str()
                .ok_or(AssessmentError::InvalidInput)?
                .into(),
            region: selection["region"]
                .as_str()
                .ok_or(AssessmentError::InvalidInput)?
                .into(),
        });
    }
    result.night_sequence = calendar.map(|mut c| c["nightSequence"].take());
    if !incomplete {
        result.entitlement = Some(Entitlement {
            from: period.from.clone(),
            through: period.through.clone(),
            status: serde_json::from_value(assessment["suggestedAllowance"].clone())
                .map_err(|_| AssessmentError::InvalidInput)?,
            origin: EntitlementOrigin::Estimated,
            revision: None,
        });
    }
    result.assessment = Some(assessment);
    result.observed_from = Some(window.from);
    result.observed_through = Some(window.through);
    if incomplete {
        result.issue = Some(issue(
            SpecificIssueCode::WorkplaceSettingsUnconfirmed,
            "Arbeitsbereich oder dauerhafte Zuordnung müssen für die Zulagen-Schätzung bestätigt werden.",
        ));
    }
    Ok(result)
}
/// Complete source orchestration. Decisions are validated before use; their
/// original order is retained because the source does not use the sorted return.
pub fn derive_dated_allowance_assessments<'a>(
    input: &AssessmentInput<'a>,
) -> Result<AllowanceAssessment<'a>, AssessmentError> {
    remuneration_month_start(input.month)?;
    if input.shifts.len() > 100_000 {
        return Err(AssessmentError::InvalidInput);
    }
    validate_scoped_rows(input.decisions)?;
    if let Some(legacy) = input.legacy_decision {
        validate_monthly_tariff_decision(legacy)?;
        if legacy["month"] != input.month {
            return Err(AssessmentError::Message(
                "Die bisherige Zulagenentscheidung gehört zu einem anderen Monat.",
            ));
        }
    }
    let mut periods = vec![];
    for period in resolve_month(
        input.month,
        input.history,
        input.resolver,
        &FullNativePackageValidator,
    )? {
        let automatic = assess_period(&period, input)?;
        for split in split(&period, input.decisions)? {
            let mut result = automatic.clone();
            result.from = split.from.clone();
            result.through = split.through.clone();
            if let Some(entitlement) = &mut result.entitlement {
                entitlement.from = split.from.clone();
                entitlement.through = split.through.clone();
            }
            if confirmed_context(&period, &split.from) {
                apply_decision(&mut result, split.decision, input)?;
            }
            periods.push(result);
        }
    }
    let entitlements = periods
        .iter()
        .filter_map(|p| p.entitlement.clone())
        .collect::<Vec<_>>();
    let complete = periods.iter().all(|p| p.entitlement.is_some());
    Ok(AllowanceAssessment {
        periods,
        entitlements,
        complete,
        legacy_decision: input.legacy_decision,
    })
}
fn apply_decision(
    result: &mut PeriodAssessment<'_>,
    decision: Option<&Value>,
    input: &AssessmentInput<'_>,
) -> Result<(), AssessmentError> {
    if let Some(decision) = decision {
        if identity_key(&decision["tariff"]) != identity_at(input.history, &result.from)? {
            result.entitlement = None;
            result.issue = Some(issue(
                SpecificIssueCode::AllowanceDecisionTariffMismatch,
                "Die gespeicherte Bestätigung gehört zu einem anderen Tarifbereich.",
            ));
            return Ok(());
        }
        result.issue = None;
        result.entitlement = Some(Entitlement {
            from: result.from.clone(),
            through: result.through.clone(),
            status: serde_json::from_value(decision["allowanceStatus"].clone())
                .map_err(|_| AssessmentError::InvalidInput)?,
            origin: EntitlementOrigin::Confirmed,
            revision: Some(
                decision["revision"]
                    .as_f64()
                    .ok_or(AssessmentError::InvalidInput)? as i64,
            ),
        });
    } else if input.legacy_decision.is_some() {
        result.entitlement = None;
        result.issue = Some(issue(
            SpecificIssueCode::AllowanceReconfirmationRequired,
            "Die bisherige Monatsbestätigung hat keine Tarifzuordnung. Bitte für diesen Vergütungsstand erneut bestätigen.",
        ));
    }
    Ok(())
}

/// Shares the exact automatic-assessment guards and observation windows.
/// Pointer membership is internal only; returned facts preserve source order.
pub(crate) fn observation_shifts<'a>(
    input: &AssessmentInput<'a>,
) -> Result<Vec<&'a Value>, AssessmentError> {
    let mut selected = std::collections::BTreeSet::new();
    for period in resolve_month(
        input.month,
        input.history,
        input.resolver,
        &FullNativePackageValidator,
    )? {
        if initial_issue(&period).is_none() {
            for shift in observation(&period, input)?.shifts {
                selected.insert(shift as *const Value as usize);
            }
        }
    }
    Ok(input
        .shifts
        .iter()
        .filter(|shift| selected.contains(&(*shift as *const Value as usize)))
        .collect())
}
