use super::{MonthlyRemunerationError, checked_total, input::*, model::*};
use crate::{
    remuneration::{
        allowances::{
            calculation::{
                AllowanceContextInput, AllowanceInput, calculate_allowances_from_native_assessment,
                calculate_monthly_dated_allowances,
            },
            model::summarize_supplements,
        },
        annual::{
            coverage::missing_tariff_annual_claims, model::summarize_annual,
            own::calculate_own_annual_payment_rows, tariff::calculate_tariff_annual_payments,
        },
        assessment::{
            calculation::derive_dated_allowance_assessments,
            model::{AllowanceAssessment, AssessmentInput},
        },
        base::{
            calculation::{BaseMonthInput, calculate_monthly_base_with_paid_absences},
            hourly::OwnHourlyInput,
            model::RemunerationStatus,
        },
        context::model::FullNativePackageValidator,
        draft_facts::resolve::{
            resolve_saved_annex_a_month_confirmation, resolve_saved_sue_month_confirmation,
        },
        draft_pay::saved::{
            SavedAnnexPremiumInput, calculate_saved_annex_a_time_premiums,
            calculate_saved_sue_allowance_position,
        },
        overtime::calculation::{
            OvertimeInput, calculate_monthly_dated_overtime,
            calculate_monthly_dated_overtime_prepared,
        },
        premiums::calculation::{PremiumInput, calculate_monthly_time_remuneration},
    },
    rules::RuleResolver,
};
use serde_json::Value;
use std::sync::Arc;
enum AllowanceMode<'raw, 'derived> {
    Raw(&'raw [Value]),
    Derived(&'derived AllowanceAssessment<'raw>),
}
pub fn calculate_dated_monthly_remuneration<'a, 'raw: 'a>(
    input: &DatedMonthInput<'a, 'raw, '_>,
    resolver: &'a RuleResolver,
) -> Result<MonthlyRemuneration<'a>, MonthlyRemunerationError> {
    calculate(
        input.context,
        input.evidence,
        input.confirmations,
        AllowanceMode::Raw(input.allowance_entitlements),
        None,
        resolver,
    )
}
pub fn calculate_assessed_monthly_remuneration<'a, 'raw: 'a>(
    input: &AssessedMonthInput<'a, 'raw, '_>,
    resolver: &'a RuleResolver,
) -> Result<AssessedMonthlyRemuneration<'a>, MonthlyRemunerationError> {
    assessed(input, None, resolver)
}
pub fn calculate_dated_monthly_remuneration_prepared<'a, 'raw: 'a>(
    input: &DatedMonthInput<'a, 'raw, '_>,
    prepared: PreparedMonthIndices<'_>,
    resolver: &'a RuleResolver,
) -> Result<MonthlyRemuneration<'a>, MonthlyRemunerationError> {
    calculate(
        input.context,
        input.evidence,
        input.confirmations,
        AllowanceMode::Raw(input.allowance_entitlements),
        Some(prepared),
        resolver,
    )
}
pub fn calculate_assessed_monthly_remuneration_prepared<'a, 'raw: 'a>(
    input: &AssessedMonthInput<'a, 'raw, '_>,
    prepared: PreparedMonthIndices<'_>,
    resolver: &'a RuleResolver,
) -> Result<AssessedMonthlyRemuneration<'a>, MonthlyRemunerationError> {
    assessed(input, Some(prepared), resolver)
}
fn assessed<'a, 'raw: 'a>(
    input: &AssessedMonthInput<'a, 'raw, '_>,
    prepared: Option<PreparedMonthIndices<'_>>,
    resolver: &'a RuleResolver,
) -> Result<AssessedMonthlyRemuneration<'a>, MonthlyRemunerationError> {
    let context = input.context;
    let assessment = derive_dated_allowance_assessments(&AssessmentInput {
        month: context.month,
        shifts: context.shifts,
        work_profile: context.work_profile.as_ref(),
        history: context.history,
        settings: input.settings,
        decisions: input.decisions,
        legacy_decision: input.legacy_decision,
        resolver,
    })?;
    let remuneration = calculate(
        context,
        input.evidence,
        input.confirmations,
        AllowanceMode::Derived(&assessment),
        prepared,
        resolver,
    )?;
    Ok(AssessedMonthlyRemuneration {
        remuneration,
        allowance_assessment: assessment,
    })
}
fn calculate<'a, 'raw: 'a>(
    context: MonthContext<'a>,
    evidence: MonthEvidence<'a, 'raw>,
    confirmations: MonthConfirmations<'_>,
    allowance_mode: AllowanceMode<'a, '_>,
    prepared: Option<PreparedMonthIndices<'_>>,
    resolver: &'a RuleResolver,
) -> Result<MonthlyRemuneration<'a>, MonthlyRemunerationError> {
    let MonthContext {
        month,
        shifts,
        work_profile,
        history,
    } = context;
    if prepared.is_some_and(|indices| {
        !indices.paid_absences.matches(evidence.paid_absences)
            || !indices
                .overtime_allocations
                .matches(evidence.saved_overtime_allocations)
    }) {
        return Err(MonthlyRemunerationError::InvalidInput);
    }
    let work = work_profile.as_ref();
    let resolved_sue = if confirmations.sue.is_none() {
        resolve_saved_sue_month_confirmation(
            month,
            history,
            evidence.saved_sue_confirmations,
            resolver,
        )?
    } else {
        None
    };
    let sue = confirmations.sue.or(resolved_sue.as_ref());
    let resolved_annex = if confirmations.annex_a.is_none() {
        resolve_saved_annex_a_month_confirmation(
            month,
            history,
            evidence.saved_annex_a_confirmations,
            resolver,
        )?
    } else {
        None
    };
    let annex = confirmations.annex_a.or(resolved_annex.as_ref());
    let base = calculate_monthly_base_with_paid_absences(
        &BaseMonthInput {
            month,
            history,
            hourly_input: Some(OwnHourlyInput {
                shifts,
                time_zone: work["timeZone"]
                    .as_str()
                    .ok_or(MonthlyRemunerationError::InvalidInput)?,
                paid_absences: evidence.paid_absences,
            }),
            annex_a_confirmation: annex,
            sue_confirmation: sue,
        },
        resolver,
        &FullNativePackageValidator,
        prepared.map(|index| index.paid_absences),
    )?;
    let time_premiums = match calculate_saved_annex_a_time_premiums(
        &SavedAnnexPremiumInput {
            month,
            shifts,
            work_profile: work,
            history,
            saved_month_confirmations: evidence.saved_annex_a_confirmations,
            saved_premium_facts: evidence.saved_annex_a_premium_facts,
            pause_details: evidence.annex_a_pause_details,
            entries_complete: evidence.annex_a_entries_complete,
            pause_details_complete: evidence.annex_a_pause_details_complete,
        },
        resolver,
    )? {
        Some(result) => result,
        None => calculate_monthly_time_remuneration(
            month,
            shifts,
            &PremiumInput {
                work_profile: Arc::clone(work_profile),
                history,
                tvl_shift_work: evidence.tvl_shift_work,
            },
            resolver,
        )?,
    };
    let mut allowances = match allowance_mode {
        AllowanceMode::Raw(entitlements) => calculate_monthly_dated_allowances(
            month,
            shifts,
            &AllowanceInput {
                work_profile: work,
                history,
                entitlements,
                tvl_shift_work: evidence.tvl_shift_work,
            },
            resolver,
        )?,
        AllowanceMode::Derived(assessment) => calculate_allowances_from_native_assessment(
            month,
            shifts,
            &AllowanceContextInput {
                work_profile: work,
                history,
                tvl_shift_work: evidence.tvl_shift_work,
            },
            resolver,
            assessment,
        )?,
    };
    if let Some(position) = calculate_saved_sue_allowance_position(
        month,
        history,
        evidence.saved_sue_allowance_confirmations,
        sue,
        resolver,
    )? {
        allowances.positions.push(position);
        allowances = summarize_supplements(allowances.positions);
    }
    let overtime_input = OvertimeInput {
        work_profile: work,
        history,
    };
    let overtime = match prepared {
        Some(index) => calculate_monthly_dated_overtime_prepared(
            month,
            shifts,
            &overtime_input,
            resolver,
            evidence.overtime_allocations,
            index.overtime_allocations,
        )?,
        None => calculate_monthly_dated_overtime(
            month,
            shifts,
            &overtime_input,
            resolver,
            evidence.overtime_allocations,
            evidence.saved_overtime_allocations,
        )?,
    };
    let mut annual_positions = calculate_own_annual_payment_rows(
        month,
        history,
        evidence.actual_annual_payments,
        resolver,
    )?
    .positions;
    annual_positions.extend(
        calculate_tariff_annual_payments(month, evidence.tariff_annual_claims, resolver)?.positions,
    );
    annual_positions.extend(
        missing_tariff_annual_claims(month, history, evidence.tariff_annual_claims, resolver)?
            .positions,
    );
    let annual_payments = summarize_annual(annual_positions);
    let complete = base.complete
        && time_premiums.complete
        && allowances.complete
        && overtime.complete
        && annual_payments.complete;
    let subtotal = checked_total([
        base.known_subtotal_cents,
        time_premiums.known_subtotal_cents,
        allowances.known_subtotal_cents,
        overtime.known_subtotal_cents,
        annual_payments.known_subtotal_cents,
    ])?;
    let estimated = [
        base.status,
        time_premiums.status,
        allowances.status,
        overtime.status,
        annual_payments.status,
    ]
    .into_iter()
    .any(|s| s == RemunerationStatus::Estimated);
    let status = if !complete {
        RemunerationStatus::Unavailable
    } else if estimated {
        RemunerationStatus::Estimated
    } else {
        RemunerationStatus::Calculated
    };
    Ok(MonthlyRemuneration {
        month: month.into(),
        complete,
        status,
        known_subtotal_cents: subtotal,
        estimated_gross_cents: complete.then_some(subtotal),
        base,
        time_premiums,
        allowances,
        overtime,
        annual_payments,
    })
}
