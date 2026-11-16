use super::{
    DraftFactsError,
    model::{ConfirmationAnswers, ConfirmationKind, SavedDraftConfirmation},
    month::is_current_confirmation,
};
use crate::{
    remuneration::{
        base::calculation::{AnnexAMonthConfirmation, SueMonthConfirmation},
        context::{
            model::{ContextKind, FullNativePackageValidator},
            periods::resolve_month,
        },
    },
    rules::RuleResolver,
};
use serde_json::Value;
pub fn resolve_saved_annex_a_month_confirmation(
    month: &str,
    history: &[Value],
    saved: &[SavedDraftConfirmation<'_>],
    resolver: &RuleResolver,
) -> Result<Option<AnnexAMonthConfirmation>, DraftFactsError> {
    let Some(answer) = saved
        .iter()
        .find(|v| v.kind() == ConfirmationKind::AnnexA && v.identity.month == month)
    else {
        return Ok(None);
    };
    let periods = resolve_month(month, history, resolver, &FullNativePackageValidator)?;
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
    if !is_current_confirmation(answer, profile, version)? {
        return Ok(None);
    }
    let ConfirmationAnswers::Annex {
        applicability,
        full_time,
        base,
        contract,
    } = answer.answers
    else {
        return Ok(None);
    };
    Ok(Some(AnnexAMonthConfirmation {
        month: month.into(),
        applicability_confirmed: applicability == Some(true),
        comparable_full_time_confirmed: full_time == Some(true),
        full_month_base_entitlement_confirmed: base == Some(true),
        full_month_same_contract_confirmed: contract == Some(true),
    }))
}
pub fn resolve_saved_sue_month_confirmation(
    month: &str,
    history: &[Value],
    saved: &[SavedDraftConfirmation<'_>],
    resolver: &RuleResolver,
) -> Result<Option<SueMonthConfirmation>, DraftFactsError> {
    let Some(answer) = saved
        .iter()
        .find(|v| v.kind() == ConfirmationKind::SueMonth && v.identity.month == month)
    else {
        return Ok(None);
    };
    let periods = resolve_month(month, history, resolver, &FullNativePackageValidator)?;
    if periods.len() != 1 || !matches!(periods[0].context.kind, ContextKind::TvoedSueDraft { .. }) {
        return Ok(None);
    }
    let context = &periods[0].context;
    let Some((profile, version)) = context.profile.zip(context.source.version_id) else {
        return Ok(None);
    };
    if !is_current_confirmation(answer, profile, version)? {
        return Ok(None);
    }
    let ConfirmationAnswers::Sue {
        applicability,
        classification,
        full_time,
        base,
        contract,
    } = answer.answers
    else {
        return Ok(None);
    };
    Ok(Some(SueMonthConfirmation {
        month: month.into(),
        tariff_applicability_confirmed: applicability == Some(true),
        sue_classification_confirmed: classification == Some(true),
        standard_full_time_confirmed: full_time == Some(true),
        full_month_base_entitlement_confirmed: base == Some(true),
        full_month_same_contract_confirmed: contract == Some(true),
    }))
}
