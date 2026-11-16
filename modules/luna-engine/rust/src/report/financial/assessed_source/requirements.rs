use super::{super::FinancialError, input::EvidenceKind};
use crate::{
    pay::pattern::is_pay_work_shift,
    remuneration::{
        base::shift_days::remuneration_month_shifts,
        context::{
            model::{ContextKind, FullNativePackageValidator},
            periods::resolve_month,
        },
        own_config::OwnBase,
    },
    rules::RuleResolver,
};
use serde_json::Value;
use std::collections::BTreeSet;
/// Computes dependencies from the actual native dated contexts. It accepts no
/// host-derived family flags and does not depend on legal/compliance readiness.
pub fn required_sources(
    month: &str,
    history: &[Value],
    shifts: &[Value],
    resolver: &RuleResolver,
) -> Result<BTreeSet<EvidenceKind>, FinancialError> {
    use EvidenceKind::*;
    let periods = resolve_month(month, history, resolver, &FullNativePackageValidator)
        .map_err(|e| FinancialError::invalid(e.to_string()))?;
    // Cash confirmations may belong to another family or an older entitlement
    // year. They cannot be gated by the current employment family.
    let mut result = BTreeSet::from([ActualAnnualPayments, TariffAnnualClaims]);
    for period in &periods {
        match &period.context.kind {
            ContextKind::OwnConfigured { configuration, .. }
                if matches!(configuration.base(), OwnBase::Hourly { .. }) =>
            {
                result.insert(PaidAbsences);
            }
            ContextKind::Tariff { .. } | ContextKind::TrainingTariff { .. } => {
                result.insert(ScopedAllowances);
            }
            ContextKind::TvlKr { .. } | ContextKind::TvalTraining { .. } => {
                result.extend([TvlShiftWork, ScopedAllowances]);
            }
            ContextKind::TvoedAnnexADraft { .. } if periods.len() == 1 => {
                result.extend([AnnexMonth, AnnexPremium]);
            }
            ContextKind::TvoedSueDraft { .. } if periods.len() == 1 => {
                result.extend([SueMonth, SueAllowance]);
            }
            _ => {}
        }
    }
    if remuneration_month_shifts(month, shifts)
        .map_err(|e| FinancialError::invalid(e.to_string()))?
        .iter()
        .any(|shift| {
            is_pay_work_shift(shift)
                && shift["tariffOvertimeConfirmed"] == true
                && shift["overtimeMinutes"].as_f64() != Some(0.0)
        })
    {
        result.insert(OvertimeAllocations);
    }
    Ok(result)
}
