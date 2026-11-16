use super::{
    DraftPayError, day_bounds,
    from_work::{AnnexFromWorkInput, calculate_with_work_evidence},
    sue::{
        CaseGroupSelection, ConversionSelection, SueAllowanceInput, SueAllowanceResult,
        calculate_sue_draft_allowance,
    },
};
use crate::{
    remuneration::{
        allowances::model::{
            AllowanceType, Proration, SupplementBasis, SupplementIssue, SupplementKind,
            SupplementPosition,
        },
        base::{
            BaseError, calculation::SueMonthConfirmation, draft::SueInput,
            model::RemunerationStatus, shift_days::remuneration_shift_days,
        },
        context::{
            model::{ContextKind, FullNativePackageValidator, IssueCode},
            periods::{remuneration_month_start, resolve_month},
        },
        draft_facts::{
            model::{
                CaseGroup, ConfirmationAnswers, ConfirmationKind, ConversionDays,
                SavedDraftConfirmation, SavedPremiumFacts,
            },
            month::is_current_confirmation,
            premium::{is_current_premium_facts, shift_binding},
            resolve::resolve_saved_annex_a_month_confirmation,
        },
        premiums::model::{
            PauseMethod, PositionKind, PremiumBasis, PremiumIssue, PremiumIssueKind,
            TimeRemunerationPosition, TimeRemunerationResult,
        },
    },
    rules::RuleResolver,
};
use serde_json::Value;
use std::collections::BTreeMap;
pub struct SavedAnnexPremiumInput<'a, 'facts> {
    pub month: &'a str,
    pub shifts: &'a [Value],
    pub work_profile: &'a Value,
    pub history: &'a [Value],
    pub saved_month_confirmations: &'facts [SavedDraftConfirmation<'a>],
    pub saved_premium_facts: &'facts [SavedPremiumFacts<'a>],
    pub pause_details: &'a [Value],
    pub entries_complete: bool,
    pub pause_details_complete: bool,
}
fn unavailable<'a>(
    month: &str,
    source: crate::remuneration::context::model::RemunerationSource<'a>,
    message: &str,
) -> Result<TimeRemunerationResult<'a>, DraftPayError> {
    let date = format!("{month}-01");
    let (from, until) = day_bounds(&date, "Europe/Berlin")?;
    Ok(TimeRemunerationResult {
        status: RemunerationStatus::Unavailable,
        complete: false,
        total_cents: None,
        known_subtotal_cents: 0,
        net_minutes: 0.0,
        positions: vec![TimeRemunerationPosition {
            id: format!("tvoed-annex-a:{month}:unavailable"),
            kind: PositionKind::TimePremium,
            label: "TVöD-Zeitzuschläge (Entwurf)".into(),
            from: date.clone(),
            through: date,
            from_epoch_minutes: from as f64 / 60000.0,
            until_epoch_minutes: until as f64 / 60000.0,
            shift_id: None,
            status: RemunerationStatus::Unavailable,
            amount_cents: None,
            source,
            basis: PremiumBasis {
                rule_id: None,
                minutes: 0.0,
                hourly_rate_cents: None,
                percentage_basis_points: None,
                rounded_premium_hourly_cents: None,
                pause_method: PauseMethod::None,
            },
            issue: Some(PremiumIssue::new(
                PremiumIssueKind::DraftPremiumFactsIncomplete,
                message,
            )),
        }],
    })
}
fn number(value: &Value, key: &str) -> Result<i64, DraftPayError> {
    value[key].as_i64().ok_or(DraftPayError::InvalidInput)
}
pub fn calculate_saved_annex_a_time_premiums<'a>(
    input: &SavedAnnexPremiumInput<'a, '_>,
    resolver: &'a RuleResolver,
) -> Result<Option<TimeRemunerationResult<'a>>, DraftPayError> {
    let Some(facts) = input
        .saved_premium_facts
        .iter()
        .find(|f| f.identity().month() == input.month)
    else {
        return Ok(None);
    };
    let periods = resolve_month(
        input.month,
        input.history,
        resolver,
        &FullNativePackageValidator,
    )
    .map_err(BaseError::from)?;
    if periods.len() != 1
        || !matches!(
            periods[0].context.kind,
            ContextKind::TvoedAnnexADraft { .. }
        )
    {
        return Ok(None);
    }
    let context = &periods[0].context;
    let Some((profile, version)) = context.profile.zip(context.source.version_id) else {
        return Ok(None);
    };
    let fail = |message| unavailable(input.month, context.source.clone(), message).map(Some);
    if !input.entries_complete || !input.pause_details_complete {
        return fail("Dienst- oder Pausendaten sind noch nicht vollständig geladen.");
    }
    if !is_current_premium_facts(facts, profile, version)? {
        return fail("Zuschlagsangaben gehören zu einem früheren Profil- oder Regelstand.");
    }
    let zone = input.work_profile["timeZone"]
        .as_str()
        .ok_or(DraftPayError::InvalidInput)?;
    let shifts: BTreeMap<_, _> = input
        .shifts
        .iter()
        .map(|s| Ok((s["id"].as_str().ok_or(DraftPayError::InvalidInput)?, s)))
        .collect::<Result<_, DraftPayError>>()?;
    for decision in facts.day_decisions() {
        let Some(shift) = decision["shiftId"].as_str().and_then(|id| shifts.get(id)) else {
            return fail(
                "Bestätigte Zuschlagsangaben passen nicht mehr zu den aktuellen Diensten.",
            );
        };
        if decision["shiftBinding"].as_str() != Some(shift_binding(shift, zone)?.as_str())
            || !remuneration_shift_days(shift, zone)?
                .iter()
                .any(|d| decision["date"] == d.date && d.until > d.from)
        {
            return fail(
                "Bestätigte Zuschlagsangaben passen nicht mehr zu den aktuellen Diensten.",
            );
        }
    }
    let Some(confirmation) = resolve_saved_annex_a_month_confirmation(
        input.month,
        input.history,
        input.saved_month_confirmations,
        resolver,
    )?
    else {
        return fail("TVöD-Monatsangaben sind nicht aktuell bestätigt.");
    };
    let ContextKind::TvoedAnnexADraft {
        rule_package,
        variant,
        group_id,
        full_time_weekly_minutes,
        ..
    } = &context.kind
    else {
        return Err(DraftPayError::InvalidInput);
    };
    let evidence = calculate_with_work_evidence(
        rule_package,
        &AnnexFromWorkInput {
            month: input.month,
            variant_id: variant,
            group_id,
            full_time_weekly_minutes: *full_time_weekly_minutes as f64,
            full_time_reference_confirmed: confirmation.comparable_full_time_confirmed,
            applicability_confirmed: confirmation.applicability_confirmed,
            cash_payment_confirmed: facts.cash_confirmed(),
            local_agreement: facts.local_agreement(),
            shifts: input.shifts,
            pause_details: input.pause_details,
            work_profile: input.work_profile,
            entries_complete: input.entries_complete,
            day_decisions: facts.day_decisions(),
        },
        resolver,
    )?;
    let result = evidence.result;
    if result["kind"] != "draft-time-premiums" {
        return fail("Arbeits-, Pausen- oder Vertragsangaben reichen für Zuschläge nicht aus.");
    }
    // The source repeats this pure collection after success. The immutable snapshot
    // lets the native bridge retain its already-derived net minutes instead.
    let Some(net_minutes) = evidence.net_minutes else {
        return fail("Die tatsächliche Arbeitszeit konnte nicht vollständig geprüft werden.");
    };
    let mut positions = vec![];
    for item in result["positions"]
        .as_array()
        .ok_or(DraftPayError::InvalidInput)?
    {
        let date = item["date"].as_str().ok_or(DraftPayError::InvalidInput)?;
        let premium = item["premium"]
            .as_str()
            .ok_or(DraftPayError::InvalidInput)?;
        let label = match premium {
            "NIGHT" => "Nachtzuschlag (Entwurf)",
            "SUNDAY" => "Sonntagszuschlag (Entwurf)",
            "HOLIDAY_WITH_TIME_OFF" => "Feiertagszuschlag mit Freizeitausgleich (Entwurf)",
            "HOLIDAY_WITHOUT_TIME_OFF" => "Feiertagszuschlag ohne Freizeitausgleich (Entwurf)",
            "PRE_HOLIDAY" => "Vorfeiertagszuschlag (Entwurf)",
            "SATURDAY" => "Samstagszuschlag (Entwurf)",
            _ => return Err(DraftPayError::InvalidInput),
        };
        let (from, until) = day_bounds(date, zone)?;
        positions.push(TimeRemunerationPosition {
            id: format!("tvoed-annex-a:{}:{date}:{premium}", input.month),
            kind: PositionKind::TimePremium,
            label: label.into(),
            from: date.into(),
            through: date.into(),
            from_epoch_minutes: from as f64 / 60000.0,
            until_epoch_minutes: until as f64 / 60000.0,
            shift_id: None,
            status: RemunerationStatus::Estimated,
            amount_cents: Some(number(item, "amountCents")?),
            source: context.source.clone(),
            basis: PremiumBasis {
                rule_id: Some(format!("tvoed-annex-a:{}", premium.to_lowercase())),
                minutes: number(item, "minutes")? as f64,
                hourly_rate_cents: Some(number(&result, "referenceHourlyCents")?),
                percentage_basis_points: Some(number(item, "percentageBasisPoints")?),
                rounded_premium_hourly_cents: None,
                pause_method: PauseMethod::ConfirmedIntervals,
            },
            issue: None,
        });
    }
    let amount = number(&result, "amountCents")?;
    Ok(Some(TimeRemunerationResult {
        status: RemunerationStatus::Estimated,
        complete: true,
        total_cents: Some(amount),
        known_subtotal_cents: amount,
        net_minutes: net_minutes as f64,
        positions,
    }))
}
pub fn calculate_saved_sue_allowance_position<'a>(
    month: &str,
    history: &'a [Value],
    saved: &[SavedDraftConfirmation<'_>],
    base_confirmation: Option<&SueMonthConfirmation>,
    resolver: &'a RuleResolver,
) -> Result<Option<SupplementPosition<'a>>, DraftPayError> {
    let answers: Vec<_> = saved
        .iter()
        .filter(|a| a.kind() == ConfirmationKind::SueAllowance && a.identity().month() == month)
        .collect();
    if answers.is_empty() {
        return Ok(None);
    }
    let periods = resolve_month(month, history, resolver, &FullNativePackageValidator)
        .map_err(BaseError::from)?;
    if periods.len() != 1 || !matches!(periods[0].context.kind, ContextKind::TvoedSueDraft { .. }) {
        return Ok(None);
    }
    let context = &periods[0].context;
    let days = i32::from(
        remuneration_month_start(month)
            .map_err(BaseError::from)?
            .days_in_month(),
    );
    let mut basis = SupplementBasis::empty(days, days);
    basis.allowance_type = Some(AllowanceType::Tvoed);
    basis.proration = Proration::None;
    let mut position = SupplementPosition {
        id: format!("allowance:tvoed-sue:{month}"),
        kind: SupplementKind::Allowance,
        label: "SuE-Zulage (Entwurf)".into(),
        from: periods[0].from.clone(),
        through: periods[0].through.clone(),
        amount_cents: None,
        status: RemunerationStatus::Unavailable,
        source: context.source.clone(),
        issue: Some(SupplementIssue::context(
            IssueCode::TariffUnsupported,
            "Die SuE-Zulagenbestätigung passt nicht zum aktuellen Monats- und Tarifstand.",
        )),
        basis,
    };
    let Some((profile, version)) = context.profile.zip(context.source.version_id) else {
        return Ok(Some(position));
    };
    let Some(base) = base_confirmation.filter(|b| b.month == month) else {
        return Ok(Some(position));
    };
    if answers.len() != 1 || !is_current_confirmation(answers[0], profile, version)? {
        return Ok(Some(position));
    }
    let ConfirmationAnswers::SueAllowance {
        classification,
        entitlement,
        case_group,
        conversion_days,
    } = answers[0].answers()
    else {
        return Err(DraftPayError::InvalidInput);
    };
    let ContextKind::TvoedSueDraft {
        rule_package,
        group_id,
        step_id,
        weekly_minutes,
        ..
    } = &context.kind
    else {
        return Err(DraftPayError::InvalidInput);
    };
    let result = calculate_sue_draft_allowance(
        rule_package,
        &SueAllowanceInput {
            base: SueInput {
                month: base.month.clone(),
                group_id: group_id.clone(),
                step_id: step_id.clone(),
                contracted_weekly_minutes: *weekly_minutes as f64,
                tariff_applicability_confirmed: base.tariff_applicability_confirmed,
                sue_classification_confirmed: base.sue_classification_confirmed,
                standard_full_time_confirmed: base.standard_full_time_confirmed,
                full_month_base_entitlement_confirmed: base.full_month_base_entitlement_confirmed,
                full_month_same_contract_confirmed: base.full_month_same_contract_confirmed,
            },
            section_xxiv_classification_confirmed: *classification == Some(true),
            full_month_allowance_entitlement_confirmed: *entitlement == Some(true),
            case_group: match case_group {
                Some(CaseGroup::Six) => CaseGroupSelection::Six,
                Some(CaseGroup::Other) => CaseGroupSelection::Other,
                None => CaseGroupSelection::Unknown,
            },
            conversion_days: match conversion_days {
                Some(ConversionDays::NoneConfirmed) => ConversionSelection::NoneConfirmed,
                Some(ConversionDays::Taken) => ConversionSelection::Taken,
                None => ConversionSelection::Unknown,
            },
        },
    )?;
    match result {
        SueAllowanceResult::NotApplicable { .. } => Ok(None),
        SueAllowanceResult::Unavailable { reason } => {
            let reason = serde_json::to_value(reason).map_err(|_| DraftPayError::InvalidInput)?;
            position.issue = Some(SupplementIssue::context(
                IssueCode::TariffUnsupported,
                format!(
                    "Die SuE-Zulage kann noch nicht bestimmt werden: {}.",
                    reason.as_str().ok_or(DraftPayError::InvalidInput)?
                ),
            ));
            Ok(Some(position))
        }
        SueAllowanceResult::DraftMonthlyAllowance {
            personal_allowance_cents,
            full_time_allowance_cents,
            ..
        } => {
            position.amount_cents = Some(personal_allowance_cents);
            position.status = RemunerationStatus::Estimated;
            position.issue = None;
            position.basis.rate_cents = Some(full_time_allowance_cents);
            position.basis.personal_monthly_cents = Some(personal_allowance_cents);
            Ok(Some(position))
        }
    }
}
