use super::{
    super::{
        FinancialError,
        fingerprint::{
            FinancialFingerprint, FinancialFingerprintPlan, StableFinancialDataSpace,
            canonical::{resolver_digest, value_digest, values_digest},
        },
    },
    book::AssessedSourceBook,
    input::EvidenceKind,
    row_index::{EvidenceRows, Scope},
};
use crate::remuneration::{
    assessment::{calculation::observation_shifts, model::AssessmentInput},
    base::shift_days::{remuneration_month_shifts, remuneration_shift_days},
};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
/// Immutable source digests computed once; period keys only traverse selected
/// native facts and genuine observation windows, never target contexts.
pub(super) struct AssessedFingerprintIndex {
    profile: [u8; 32],
    history: [u8; 32],
    settings: [u8; 32],
    resolver: [u8; 32],
    plan: FinancialFingerprintPlan,
    groups: BTreeMap<EvidenceKind, EvidenceRows>,
    pauses: EvidenceRows,
}
impl AssessedFingerprintIndex {
    pub fn new(book: &AssessedSourceBook) -> Result<Self, FinancialError> {
        use EvidenceKind::*;
        let input = &book.input;
        let mut groups = BTreeMap::new();
        groups.insert(
            ActualAnnualPayments,
            EvidenceRows::new(
                &input.actual_annual_payments,
                |o| o.active_payments().as_slice(),
                Scope::All,
            )?,
        );
        groups.insert(
            TariffAnnualClaims,
            EvidenceRows::new(
                &input.tariff_annual_claims,
                |o| o.saved().as_slice(),
                Scope::All,
            )?,
        );
        groups.insert(
            PaidAbsences,
            EvidenceRows::new(&input.paid_absences, |o| o.raw().as_slice(), Scope::Shift)?,
        );
        groups.insert(
            OvertimeAllocations,
            EvidenceRows::new(
                &input.overtime_allocations,
                |o| o.raw().as_slice(),
                Scope::Shift,
            )?,
        );
        groups.insert(
            ScopedAllowances,
            EvidenceRows::new(
                &input.scoped_decisions,
                |o| o.saved().as_slice(),
                Scope::Month,
            )?,
        );
        groups.insert(
            TvlShiftWork,
            EvidenceRows::new(
                &input.tvl_shift_work,
                |o| o.saved().as_slice(),
                Scope::Shift,
            )?,
        );
        groups.insert(
            AnnexMonth,
            EvidenceRows::new(&input.annex_month, |o| o.raw().as_slice(), Scope::Month)?,
        );
        groups.insert(
            AnnexPremium,
            EvidenceRows::new(&input.annex_premium, |o| o.raw().as_slice(), Scope::Month)?,
        );
        groups.insert(
            SueMonth,
            EvidenceRows::new(&input.sue_month, |o| o.raw().as_slice(), Scope::Month)?,
        );
        groups.insert(
            SueAllowance,
            EvidenceRows::new(&input.sue_allowance, |o| o.raw().as_slice(), Scope::Month)?,
        );
        Ok(Self {
            profile: value_digest(&input.work_profile, true)?.0,
            history: values_digest(&input.history, true)?.0,
            settings: value_digest(&book.settings, false)?.0,
            resolver: resolver_digest(&input.resolver)?,
            plan: FinancialFingerprintPlan::new(Arc::clone(&input.active_shifts))?,
            groups,
            pauses: EvidenceRows::new(
                &input.pause_details,
                |o| o.saved().as_slice(),
                Scope::Shift,
            )?,
        })
    }
    pub fn key(
        &self,
        book: &AssessedSourceBook,
        space: &StableFinancialDataSpace,
        month: &str,
    ) -> Result<FinancialFingerprint, FinancialError> {
        use EvidenceKind::*;
        let input = &book.input;
        let range = crate::calendar::month_range(month)
            .map_err(|_| FinancialError::invalid("Ungültiger Vergütungsmonat."))?;
        let required = book.requirements(month)?;
        let mut selected = BTreeSet::new();
        for shift in input.active_shifts.iter() {
            let date = shift["date"]
                .as_str()
                .ok_or_else(|| FinancialError::invalid("Ungültiges Dienstdatum."))?;
            if (date >= range.start.as_str() && date <= range.end.as_str())
                || (crate::net::js_truthy(&shift["specialDuty"])
                    && crate::credit::duty::duty_calendar_dates(shift)
                        .map_err(|_| FinancialError::invalid("Ungültiger Dienstraum."))?
                        .iter()
                        .any(|d| d.starts_with(month)))
            {
                selected.insert(shift as *const Value as usize);
            }
        }
        for shift in remuneration_month_shifts(month, &input.active_shifts)
            .map_err(|e| FinancialError::invalid(e.to_string()))?
        {
            let zone = input.work_profile["timeZone"].as_str().unwrap_or("");
            if remuneration_shift_days(shift, zone)
                .map_err(|e| FinancialError::invalid(e.to_string()))?
                .iter()
                .any(|day| day.date.starts_with(month))
            {
                selected.insert(shift as *const Value as usize);
            }
        }
        for shift in observation_shifts(&AssessmentInput {
            month,
            shifts: &input.active_shifts,
            work_profile: &input.work_profile,
            history: &input.history,
            settings: &book.settings,
            decisions: &[],
            legacy_decision: None,
            resolver: &input.resolver,
        })
        .map_err(|e| FinancialError::invalid(e.to_string()))?
        {
            selected.insert(shift as *const Value as usize);
        }
        let entries = input
            .active_shifts
            .iter()
            .filter(|shift| selected.contains(&(*shift as *const Value as usize)))
            .collect::<Vec<_>>();
        let ids = entries
            .iter()
            .filter_map(|s| s["id"].as_str())
            .collect::<BTreeSet<_>>();
        let mut hash = space.part_hash("ASSESSED_MONTH", month);
        hash.array(9);
        for digest in [&self.profile, &self.history, &self.settings, &self.resolver] {
            hash.bytes(digest);
        }
        hash.array(required.len());
        for kind in &required {
            hash.string(&format!("{kind:?}"));
        }
        hash.array(entries.len());
        for entry in entries {
            hash.bytes(
                self.plan
                    .digest_for_entry(entry)
                    .ok_or_else(|| FinancialError::invalid("Finanzquelle wurde ausgetauscht."))?,
            );
        }
        let legacy = book
            .legacy
            .get(month)
            .map(|index| &input.legacy_decisions[*index as usize]);
        if let Some(row) = legacy {
            hash.value(row, false)?;
        } else {
            hash.null();
        }
        hash.array(self.groups.len());
        for (kind, rows) in &self.groups {
            rows.feed(
                &mut hash,
                required.contains(kind)
                    || (required.contains(&AnnexMonth) && *kind == AnnexPremium),
                month,
                &ids,
                matches!(
                    kind,
                    ScopedAllowances | AnnexMonth | AnnexPremium | SueMonth | SueAllowance
                ),
                *kind == ScopedAllowances,
            );
        }
        self.pauses.feed(
            &mut hash,
            required.contains(&AnnexMonth),
            month,
            &ids,
            false,
            false,
        );
        Ok(FinancialFingerprint::from_native_digest(hash.finish()))
    }
}
