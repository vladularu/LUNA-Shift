use super::{
    FinancialError, FinancialFingerprint, FinancialFingerprintBook, LegacyFinancialView,
    canonical::CanonicalHash,
};
use crate::{
    employment::{employment_month_boundaries, profile_view::EmploymentProfileRef},
    pay::{families, month, tariff},
};
use serde_json::Value;
use std::collections::BTreeSet;
impl FinancialFingerprintBook {
    fn included(&self, entry: &Value, view: LegacyFinancialView) -> bool {
        view != LegacyFinancialView::Actual
            || !entry["date"]
                .as_str()
                .is_some_and(|date| self.input.test_months.contains(date.get(..7).unwrap_or("")))
    }
    fn selected(
        &self,
        month: &str,
        view: LegacyFinancialView,
    ) -> Result<BTreeSet<usize>, FinancialError> {
        let range = crate::calendar::month_range(month)
            .map_err(|_| FinancialError::invalid("Ungültiger Finanzmonat."))?;
        let mut selected = BTreeSet::new();
        for (index, record) in self.plan.records.iter().enumerate() {
            if record.months.contains(month)
                && self.included(&self.plan.entries[record.position], view)
            {
                selected.insert(index);
            }
        }
        for period in employment_month_boundaries(&self.input.profile, month, &range.end)
            .map_err(|e| FinancialError::invalid(e.to_string()))?
        {
            let profile = EmploymentProfileRef::at(&self.input.profile, &period.from)
                .map_err(|e| FinancialError::invalid(e.to_string()))?;
            let assessment =
                if let Some(family) = month::selected_family_from(|key| profile.get(key)) {
                    families::select_assessment_shifts(family, &self.plan.entries, month)
                        .map_err(|e| FinancialError::invalid(e.to_string()))?
                } else if profile.get("tariff").is_some_and(|v| !v.is_null()) {
                    let package = tariff::get_tariff_rule_package(&range.start, &self.resolver)
                        .ok_or_else(|| {
                            FinancialError::invalid("Tarifgrundlage für den Finanzschlüssel fehlt.")
                        })?;
                    month::select_legacy_assessment_shifts(month, &self.plan.entries, package)
                        .map_err(|e| FinancialError::invalid(e.to_string()))?
                } else {
                    Vec::new()
                };
            for entry in assessment {
                if !self.included(entry, view) {
                    continue;
                }
                if let Some(index) = self.plan.by_pointer.get(&(entry as *const Value as usize))
                    && !self.plan.records[*index].special
                {
                    selected.insert(*index);
                }
            }
        }
        Ok(selected)
    }
    pub(super) fn make_key(
        &self,
        month: &str,
        view: LegacyFinancialView,
        engine: &str,
    ) -> Result<FinancialFingerprint, FinancialError> {
        let selected = self.selected(month, view)?;
        let mut h = CanonicalHash::new("luna:financial:legacy-month:v1");
        h.array(9);
        h.string(engine);
        h.string(&self.space.0);
        h.string(month);
        h.string(match view {
            LegacyFinancialView::Salary => "SALARY_FIRST_DECISION",
            LegacyFinancialView::Annual => "ANNUAL_LAST_DECISION",
            LegacyFinancialView::Actual => "ACTUAL_PAYOUT_FIRST_DECISION",
        });
        h.bytes(&self.resolver_digest);
        h.bytes(&self.profile_digest);
        h.bytes(&self.settings_digest);
        let decision =
            if view == LegacyFinancialView::Actual && self.input.test_months.contains(month) {
                None
            } else if view == LegacyFinancialView::Annual {
                self.input
                    .tariff_decisions
                    .iter()
                    .rev()
                    .find(|d| d["month"] == month)
            } else {
                self.input
                    .tariff_decisions
                    .iter()
                    .find(|d| d["month"] == month)
            };
        if let Some(decision) = decision {
            h.value(decision, false)?;
        } else {
            h.null();
        }
        h.array(selected.len());
        for index in selected {
            h.bytes(&self.plan.records[index].digest);
        }
        Ok(FinancialFingerprint(h.finish()))
    }
    pub fn legacy_month(
        &self,
        month: &str,
        view: LegacyFinancialView,
    ) -> Result<FinancialFingerprint, FinancialError> {
        let slot = (month.to_owned(), view);
        if let Some(key) = self
            .keys
            .lock()
            .map_err(|_| FinancialError::invalid("Finanzschlüsselspeicher nicht verfügbar."))?
            .get(&slot)
        {
            return Ok(key.clone());
        }
        let key = self.make_key(month, view, crate::ENGINE_VERSION)?;
        let mut cache = self
            .keys
            .lock()
            .map_err(|_| FinancialError::invalid("Finanzschlüsselspeicher nicht verfügbar."))?;
        if cache.len() >= 144
            && let Some(oldest) = cache.keys().next().cloned()
        {
            cache.remove(&oldest);
        }
        cache.insert(slot, key.clone());
        Ok(key)
    }
}
