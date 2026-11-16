use super::{
    super::{
        FinancialError,
        assessed::{AssessedMonthProvider, NativeAssessedMonth},
    },
    book::AssessedSourceBook,
    input::EvidenceKind,
};
use crate::{
    pay::premium_minutes::PremiumError as MinuteError,
    remuneration::{
        draft_facts::model::{SavedDraftConfirmation, SavedPremiumFacts},
        month::{
            MonthlyRemunerationError,
            calculation::calculate_assessed_monthly_remuneration_prepared, input::*,
        },
        premiums::PremiumError,
    },
    rules::holidays::HolidayError,
};
use serde_json::Value;
use std::collections::BTreeMap;
struct MonthViews<T> {
    rows: Vec<T>,
    first: BTreeMap<String, u32>,
}
impl<T> MonthViews<T> {
    fn new(rows: Vec<T>, month: impl Fn(&T) -> &str) -> Self {
        let mut first = BTreeMap::new();
        for (i, row) in rows.iter().enumerate() {
            first.entry(month(row).to_owned()).or_insert(i as u32);
        }
        Self { rows, first }
    }
    fn month(&self, month: &str) -> &[T] {
        self.first
            .get(month)
            .map(|i| &self.rows[*i as usize..=*i as usize])
            .unwrap_or(&[])
    }
}
/// One borrowed session constructs its evidence views once, then serves all
/// twelve months without self-references, input clones or repeated admission.
pub struct AssessedSession<'a> {
    book: &'a AssessedSourceBook,
    annex: MonthViews<SavedDraftConfirmation<'a>>,
    premiums: MonthViews<SavedPremiumFacts<'a>>,
    sue: MonthViews<SavedDraftConfirmation<'a>>,
    sue_allowances: MonthViews<SavedDraftConfirmation<'a>>,
    allocations: BTreeMap<String, Vec<Value>>,
}
impl<'a> AssessedSession<'a> {
    pub(super) fn new(book: &'a AssessedSourceBook) -> Self {
        let input = &book.input;
        Self {
            book,
            annex: MonthViews::new(
                input
                    .annex_month
                    .ready()
                    .map_or_else(Vec::new, |v| v.views()),
                |v| v.identity().month(),
            ),
            premiums: MonthViews::new(
                input
                    .annex_premium
                    .ready()
                    .map_or_else(Vec::new, |v| v.views()),
                |v| v.identity().month(),
            ),
            sue: MonthViews::new(
                input.sue_month.ready().map_or_else(Vec::new, |v| v.views()),
                |v| v.identity().month(),
            ),
            sue_allowances: MonthViews::new(
                input
                    .sue_allowance
                    .ready()
                    .map_or_else(Vec::new, |v| v.views()),
                |v| v.identity().month(),
            ),
            allocations: BTreeMap::new(),
        }
    }
}
fn rule_failure(error: &MonthlyRemunerationError) -> bool {
    if let MonthlyRemunerationError::Premium(error) = error {
        match error.as_ref() {
            PremiumError::Holiday(HolidayError::Resolution(_)) => true,
            PremiumError::Interval(error) => error.rule_failure().is_some(),
            PremiumError::Classification(error) => matches!(
                error.as_ref(),
                MinuteError::Holiday(HolidayError::Resolution(_))
            ),
            _ => false,
        }
    } else {
        false
    }
}
impl AssessedMonthProvider for AssessedSession<'_> {
    fn assessed_month(
        &mut self,
        month: &str,
    ) -> Result<Option<NativeAssessedMonth>, FinancialError> {
        use EvidenceKind::*;
        crate::remuneration::context::periods::remuneration_month_start(month)
            .map_err(|e| FinancialError::invalid(e.to_string()))?;
        if let Some(value) = self.book.cache.get(month)? {
            return Ok(value);
        }
        let required = self.book.requirements(month)?;
        let book = self.book;
        let input = &book.input;
        // Both annual sources are relevant to cash-month pay independently of
        // the currently active family or entitlement year.
        let annual = input.actual_annual_payments.require(ActualAnnualPayments)?;
        let claims = input.tariff_annual_claims.require(TariffAnnualClaims)?;
        if required.contains(&ScopedAllowances) {
            input.scoped_decisions.require(ScopedAllowances)?;
        }
        if required.contains(&TvlShiftWork) {
            input.tvl_shift_work.require(TvlShiftWork)?;
        }
        if required.contains(&AnnexMonth) {
            input.annex_month.require(AnnexMonth)?;
            input.annex_premium.require(AnnexPremium)?;
        }
        if required.contains(&SueMonth) {
            input.sue_month.require(SueMonth)?;
            input.sue_allowance.require(SueAllowance)?;
        }
        let paid = if required.contains(&PaidAbsences) {
            input.paid_absences.require(PaidAbsences)?
        } else {
            input
                .paid_absences
                .ready()
                .map_or(&book.inactive_paid, |v| v.as_ref())
        };
        let overtime = if required.contains(&OvertimeAllocations) {
            input.overtime_allocations.require(OvertimeAllocations)?
        } else {
            input
                .overtime_allocations
                .ready()
                .map_or(&book.inactive_overtime, |v| v.as_ref())
        };
        let decisions = input
            .scoped_decisions
            .ready()
            .and_then(|rows| {
                book.scoped
                    .get(month)
                    .map(|i| &rows.saved()[*i as usize]["decisions"])
            })
            .map_or(&[][..], |v| {
                v.as_array().expect("checked scoped decisions").as_slice()
            });
        let legacy = book
            .legacy
            .get(month)
            .map(|i| &input.legacy_decisions[*i as usize]);
        let tvl = input
            .tvl_shift_work
            .ready()
            .map_or(&[][..], |v| v.saved().as_slice());
        let pauses = input.pause_details.ready();
        let raw = AssessedMonthInput {
            context: MonthContext {
                month,
                shifts: &input.active_shifts,
                work_profile: &input.work_profile,
                history: &input.history,
            },
            evidence: MonthEvidence {
                overtime_allocations: &self.allocations,
                saved_overtime_allocations: overtime.raw(),
                paid_absences: paid.raw(),
                actual_annual_payments: annual.active_payments(),
                tariff_annual_claims: claims.validated(),
                tvl_shift_work: tvl,
                saved_annex_a_confirmations: self.annex.month(month),
                saved_annex_a_premium_facts: self.premiums.month(month),
                annex_a_pause_details: pauses.map_or(&[][..], |p| p.saved().as_slice()),
                annex_a_entries_complete: true,
                annex_a_pause_details_complete: pauses.is_some(),
                saved_sue_confirmations: self.sue.month(month),
                saved_sue_allowance_confirmations: self.sue_allowances.month(month),
            },
            confirmations: MonthConfirmations::default(),
            settings: &book.settings,
            decisions,
            legacy_decision: legacy,
        };
        let reuse_key = book
            .reuse
            .as_ref()
            .and_then(|reuse| reuse.index.key(book, &reuse.space, month).ok());
        if let (Some(reuse), Some(key)) = (&book.reuse, &reuse_key)
            && let Ok(Some(value)) = reuse.cache.cache.get(&key.to_string())
        {
            book.cache.insert(month, value.clone())?;
            return Ok(value);
        }
        book.cache.calculation()?;
        if let Some(reuse) = &book.reuse {
            let _ = reuse.cache.cache.calculation();
        }
        let calculated = match calculate_assessed_monthly_remuneration_prepared(
            &raw,
            PreparedMonthIndices {
                paid_absences: paid,
                overtime_allocations: overtime,
            },
            &input.resolver,
        ) {
            Ok(value) => value,
            Err(error) if rule_failure(&error) => {
                book.cache.insert(month, None)?;
                if let (Some(reuse), Some(key)) = (&book.reuse, &reuse_key) {
                    let _ = reuse.cache.cache.insert(&key.to_string(), None);
                }
                return Ok(None);
            }
            Err(error) => return Err(FinancialError::invalid(error.to_string())),
        };
        let value =
            NativeAssessedMonth::from_native(serde_json::to_value(calculated).map_err(|_| {
                FinancialError::invalid("Vergütungsmonat konnte nicht dargestellt werden.")
            })?);
        book.cache.insert(month, Some(value.clone()))?;
        if let (Some(reuse), Some(key)) = (&book.reuse, &reuse_key) {
            let _ = reuse
                .cache
                .cache
                .insert(&key.to_string(), Some(value.clone()));
        }
        Ok(Some(value))
    }
}
