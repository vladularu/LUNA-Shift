use crate::remuneration::{
    base::calculation::{AnnexAMonthConfirmation, SueMonthConfirmation},
    base::prepared::PaidAbsenceIndex,
    draft_facts::model::{SavedDraftConfirmation, SavedPremiumFacts},
    overtime::prepared::OvertimeAllocationIndex,
    tariff_annual::saved::ValidatedSavedClaims,
};
use serde_json::Value;
use std::{collections::BTreeMap, sync::Arc};
#[derive(Clone, Copy)]
pub struct MonthContext<'a> {
    pub month: &'a str,
    pub shifts: &'a [Value],
    pub work_profile: &'a Arc<Value>,
    pub history: &'a [Value],
}
/// Each bucket is admitted raw personal evidence, not a numeric engine result.
/// I/O readiness belongs to the snapshot assembler; missing relevant buckets
/// must never be represented here by fabricated empty arrays.
#[derive(Clone, Copy)]
pub struct MonthEvidence<'a, 'raw> {
    pub overtime_allocations: &'a BTreeMap<String, Vec<Value>>,
    pub saved_overtime_allocations: &'a [Value],
    pub paid_absences: &'a [Value],
    pub actual_annual_payments: &'a [Value],
    pub tariff_annual_claims: &'a ValidatedSavedClaims,
    pub tvl_shift_work: &'a [Value],
    pub saved_annex_a_confirmations: &'a [SavedDraftConfirmation<'raw>],
    pub saved_annex_a_premium_facts: &'a [SavedPremiumFacts<'raw>],
    pub annex_a_pause_details: &'a [Value],
    pub annex_a_entries_complete: bool,
    pub annex_a_pause_details_complete: bool,
    pub saved_sue_confirmations: &'a [SavedDraftConfirmation<'raw>],
    pub saved_sue_allowance_confirmations: &'a [SavedDraftConfirmation<'raw>],
}
#[derive(Clone, Copy, Default)]
pub struct MonthConfirmations<'a> {
    pub annex_a: Option<&'a AnnexAMonthConfirmation>,
    pub sue: Option<&'a SueMonthConfirmation>,
}
pub struct DatedMonthInput<'a, 'raw, 'confirmation> {
    pub context: MonthContext<'a>,
    pub evidence: MonthEvidence<'a, 'raw>,
    pub confirmations: MonthConfirmations<'confirmation>,
    pub allowance_entitlements: &'a [Value],
}
/// Production input has only source decisions. Entitlements are calculated
/// inside the native assessment and cannot be supplied as host-computed values.
pub struct AssessedMonthInput<'a, 'raw, 'confirmation> {
    pub context: MonthContext<'a>,
    pub evidence: MonthEvidence<'a, 'raw>,
    pub confirmations: MonthConfirmations<'confirmation>,
    pub settings: &'a Value,
    pub decisions: &'a [Value],
    pub legacy_decision: Option<&'a Value>,
}
/// Opaque, native-admitted indices for the very same immutable raw arrays in
/// MonthEvidence. The composer rejects a mismatched owner rather than using
/// unchecked input or falling back to repeated admission.
#[derive(Clone, Copy)]
pub struct PreparedMonthIndices<'a> {
    pub paid_absences: &'a PaidAbsenceIndex,
    pub overtime_allocations: &'a OvertimeAllocationIndex,
}
