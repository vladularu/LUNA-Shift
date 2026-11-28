//! Raw immutable snapshot to native gross/proof evidence. No computed financial
//! value can be deserialized into this scope or supplied by the JS adapter.
#[path = "provider_reuse.rs"]
pub mod reuse;
use super::gross_evidence::{
    EvidenceNeed, GrossEvidenceError, GrossEvidenceProvider, GrossMonthEvidence, PremiumEvidence,
    TraceCoverage,
};
use super::payment_projection::SalaryPaymentSource;
use crate::employment::profile_view::{
    CalculationProfileStore, EmploymentProfileView, FullEmploymentProfileView,
};
use crate::pay::{month::MonthPayInput, pattern::WorkPatternSettings, special};
use crate::rules::{RuleResolutionFailure, RuleResolver};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::Arc;

const MAX_CACHED_MONTHS: usize = 48;
#[derive(Default)]
struct RuleFailureCache {
    values: BTreeMap<String, RuleResolutionFailure>,
    order: VecDeque<String>,
}
impl RuleFailureCache {
    fn insert(&mut self, month: &str, failure: RuleResolutionFailure) {
        if let Some(index) = self.order.iter().position(|v| v == month) {
            self.order.remove(index);
        }
        self.order.push_back(month.to_owned());
        self.values.insert(month.to_owned(), failure);
        while self.order.len() > MAX_CACHED_MONTHS {
            if let Some(key) = self.order.pop_front() {
                self.values.remove(&key);
            }
        }
    }
    fn get(&self, month: &str) -> Option<&RuleResolutionFailure> {
        self.values.get(month)
    }
}

/// Both constructions retain one immutable resolver identity. The shared form
/// lets an owned snapshot keep its month caches across independent jobs.
#[derive(Clone)]
pub(crate) enum ResolverHandle<'a> {
    Borrowed(&'a RuleResolver),
    Shared(Arc<RuleResolver>),
}
impl AsRef<RuleResolver> for ResolverHandle<'_> {
    fn as_ref(&self) -> &RuleResolver {
        match self {
            Self::Borrowed(resolver) => resolver,
            Self::Shared(resolver) => resolver,
        }
    }
}

/// Constructed only from a validated raw snapshot. Fields contain no result,
/// derived gross, SFN classification, or externally produced proof.
pub(crate) struct SourceDataScope {
    pub(crate) profile: Arc<Value>,
    pub(crate) shifts: Arc<Vec<Value>>,
    pub(crate) assessment_shifts: Arc<Vec<Value>>,
    pub(crate) decisions: Arc<BTreeMap<String, Value>>,
    pub(crate) work_pattern_settings: WorkPatternSettings,
}

struct CachedMonth {
    evidence: Arc<GrossMonthEvidence>,
    time_account: Option<Arc<special::SpecialDutyTimeAccount>>,
}

struct SourceView {
    profile: Arc<Value>,
    profile_serialization: Arc<FullEmploymentProfileView>,
    shifts: Arc<Vec<Value>>,
}

/// A provider is scoped to one immutable profile/plan/catalog snapshot. The
/// retained side channel is captured by the pricing pass, never repriced here.
pub struct NativeGrossEvidenceProvider<'a> {
    scope: SourceDataScope,
    resolver: ResolverHandle<'a>,
    profiles: CalculationProfileStore,
    projected_regular_shifts: Arc<Vec<Value>>,
    regular_assessment_shifts: Arc<Vec<Value>>,
    has_special_duty: bool,
    months: BTreeMap<String, CachedMonth>,
    source_views: BTreeMap<String, SourceView>,
    last_rule_failure: Option<String>,
    last_failure_message: Option<(String, String)>,
    rule_failures: RuleFailureCache,
    recency: VecDeque<String>,
    pricing_passes: u64,
    reference_depth: u8,
    reuse: Option<reuse::ReuseBinding>,
    #[cfg(test)]
    calculations: usize,
}
fn has_special(shift: &Value) -> bool {
    super::js_truthy(&shift["specialDuty"])
}

fn compose_special_gross(mut pay: Value, lines: Vec<Value>) -> Result<Value, GrossEvidenceError> {
    if lines.is_empty() {
        return Ok(pay);
    }
    let mut notes = Vec::new();
    let mut seen = BTreeSet::new();
    let mut cents = 0.0;
    for line in &lines {
        for note in line["notes"].as_array().ok_or(GrossEvidenceError)? {
            let note = note.as_str().ok_or(GrossEvidenceError)?;
            if seen.insert(note) {
                notes.push(note.to_owned());
            }
        }
        if line["complete"] != true {
            continue;
        }
        for value in [
            &line["baseAmountCents"],
            &line["calloutPay"]["baseAmountCents"],
            &line["calloutPay"]["overtimePremiumCents"],
            &line["calloutPay"]["timePremiumCents"],
        ] {
            cents += if value.is_null() {
                0.0
            } else {
                value.as_f64().ok_or(GrossEvidenceError)?
            };
        }
    }
    let amount = cents / 100.0;
    let original_gross = pay["estimatedGrossAmount"].as_f64();
    let originally_available = pay["available"] == true;
    let incomplete = lines.iter().any(|line| line["complete"] != true);
    pay["specialDutyBreakdowns"] = json!(lines);
    pay["specialDutyAmount"] = json!(amount);
    if incomplete {
        pay["available"] = json!(false);
        pay["estimatedGrossAmount"] = Value::Null;
        if originally_available && let Some(gross) = original_gross {
            pay["knownGrossAmount"] = json!(crate::pay::legacy::round_money(gross + amount));
        }
        pay["specialDutyNotes"] = json!(notes);
    } else {
        pay["estimatedGrossAmount"] =
            json!(original_gross.map(|gross| crate::pay::legacy::round_money(gross + amount)));
    }
    Ok(pay)
}

impl<'a> NativeGrossEvidenceProvider<'a> {
    /// Diagnostic metadata only. Gross-only callers retain the trace side
    /// channel from the same price pass so a later net request never reprices.
    pub fn diagnostics(&self) -> Value {
        json!({
            "cachedMonths":self.months.len(),
            "monthCapacity":MAX_CACHED_MONTHS,
            "traceCapturePolicy":"SAME_PRICING_PASS",
            "grossOnlyRetainsTraceEvidence":true,
            "cachedTimeAccounts":self.months.values().filter(|month| month.time_account.is_some()).count(),
            "profiles":self.profiles.diagnostics(),
        })
    }

    /// Separate telemetry keeps the established source-cache diagnostics stable.
    /// Attempts include errors; failed pricing is deliberately not retained.
    pub fn reuse_diagnostics(&self) -> Value {
        json!({"nativePricingPasses":self.pricing_passes,"crossSnapshotReuseEnabled":self.reuse.is_some()})
    }

    pub(crate) fn new(
        scope: SourceDataScope,
        resolver: &'a RuleResolver,
    ) -> Result<Self, GrossEvidenceError> {
        Self::with_resolver(scope, ResolverHandle::Borrowed(resolver))
    }

    pub(crate) fn with_resolver(
        scope: SourceDataScope,
        resolver: ResolverHandle<'a>,
    ) -> Result<Self, GrossEvidenceError> {
        let profiles = CalculationProfileStore::new(Arc::clone(&scope.profile))
            .map_err(|_| GrossEvidenceError)?;
        let has_special_duty = scope
            .shifts
            .iter()
            .chain(scope.assessment_shifts.iter())
            .any(has_special);
        let projected_regular_shifts = if has_special_duty && scope.shifts.iter().any(has_special) {
            Arc::new(
                crate::credit::duty::project_regular_pay_shifts(&scope.shifts)
                    .map_err(|_| GrossEvidenceError)?,
            )
        } else {
            Arc::clone(&scope.shifts)
        };
        let regular_assessment_shifts =
            if has_special_duty && scope.assessment_shifts.iter().any(has_special) {
                Arc::new(
                    scope
                        .assessment_shifts
                        .iter()
                        .filter(|shift| !has_special(shift))
                        .cloned()
                        .collect(),
                )
            } else {
                Arc::clone(&scope.assessment_shifts)
            };
        let mut regular_assessment_shifts = regular_assessment_shifts;
        if scope.profile["tariff"].is_object() || scope.profile["vkaETariff"].is_object() {
            for shift in scope.assessment_shifts.iter() {
                if let Some(planned) = super::absence_pay::planned_assessment(shift) {
                    Arc::make_mut(&mut regular_assessment_shifts).push(planned);
                }
            }
        }
        Ok(Self {
            scope,
            resolver,
            profiles,
            projected_regular_shifts,
            regular_assessment_shifts,
            has_special_duty,
            months: BTreeMap::new(),
            source_views: BTreeMap::new(),
            last_rule_failure: None,
            last_failure_message: None,
            rule_failures: RuleFailureCache::default(),
            recency: VecDeque::new(),
            pricing_passes: 0,
            reference_depth: 0,
            reuse: None,
            #[cfg(test)]
            calculations: 0,
        })
    }

    pub(crate) fn enable_reuse(
        &mut self,
        fingerprints: Arc<crate::report::financial::fingerprint::FinancialFingerprintBook>,
        view: crate::report::financial::fingerprint::LegacyFinancialView,
        cache: Arc<reuse::SharedGrossReuseCache>,
    ) {
        self.reuse = Some(reuse::ReuseBinding {
            fingerprints,
            view,
            cache,
        });
    }

    fn touch(&mut self, month: &str) {
        if let Some(position) = self.recency.iter().position(|entry| entry == month) {
            self.recency.remove(position);
        }
        self.recency.push_back(month.to_owned());
        while self.recency.len() > MAX_CACHED_MONTHS {
            if let Some(oldest) = self.recency.pop_front() {
                self.months.remove(&oldest);
                self.source_views.remove(&oldest);
            }
        }
    }

    fn price_core(
        &mut self,
        month: &str,
        calculation_profile: &Arc<Value>,
    ) -> Result<reuse::GrossCore, GrossEvidenceError> {
        self.pricing_passes = self.pricing_passes.saturating_add(1);
        let regular_result = crate::pay::month::calculate_regular_month_with_evidence(
            &MonthPayInput {
                month,
                shifts: &self.projected_regular_shifts,
                profile: calculation_profile,
                decision: self.scope.decisions.get(month),
                assessment_shifts: &self.regular_assessment_shifts,
                settings: &self.scope.work_pattern_settings,
            },
            self.resolver.as_ref(),
        );
        let regular = match regular_result {
            Ok(regular) => regular,
            Err(error) => {
                self.last_failure_message = Some((month.to_owned(), error.to_string()));
                use crate::pay::{
                    legacy::PayError, month::MonthPayError, premium_minutes::PremiumError,
                };
                let rule_failure = match &error {
                    MonthPayError::Family(error) => error.rule_failure(),
                    MonthPayError::Legacy(error) => match error.as_ref() {
                        PayError::Premium(PremiumError::Holiday(
                            crate::rules::holidays::HolidayError::Resolution(failure),
                        )) => Some(failure.as_ref()),
                        _ => None,
                    },
                    _ => None,
                };
                if let Some(failure) = rule_failure {
                    self.last_rule_failure = Some(month.to_owned());
                    self.rule_failures.insert(month, failure.clone());
                }
                return Err(GrossEvidenceError);
            }
        };
        let special_lines = if self.has_special_duty {
            special::calculate_special_duty_pay(
                month,
                &self.scope.shifts,
                calculation_profile,
                self.resolver.as_ref(),
            )
            .map_err(|_| GrossEvidenceError)?
        } else {
            vec![]
        };
        let special_duty_traces = special::trace::payroll_traces_from_lines(&special_lines);
        let special_duty_shift_ids = special_duty_traces
            .iter()
            .map(|trace| {
                trace["id"]
                    .as_str()
                    .map(str::to_owned)
                    .ok_or(GrossEvidenceError)
            })
            .collect::<Result<_, _>>()?;
        let premium_evidence: Vec<PremiumEvidence> = regular
            .premium_evidence
            .into_iter()
            .map(|evidence| PremiumEvidence {
                shift_id: evidence.shift_id,
                payroll: crate::pay::trace::PayrollTrace {
                    breakdown: evidence.breakdown,
                    trace: evidence.trace,
                    night_compensatory_minutes: evidence.night_compensatory_minutes,
                },
            })
            .collect();
        let regular_shift_ids = premium_evidence
            .iter()
            .map(|evidence| evidence.shift_id.clone())
            .collect();
        Ok(reuse::GrossCore {
            pay: compose_special_gross(regular.estimate, special_lines)?,
            premium_evidence,
            special_duty_traces,
            coverage: TraceCoverage::Complete {
                regular_shift_ids,
                special_duty_shift_ids,
            },
        })
    }

    fn calculate(&mut self, month: &str) -> Result<Arc<GrossMonthEvidence>, GrossEvidenceError> {
        self.last_rule_failure = None;
        self.last_failure_message = None;
        let range = crate::calendar::month_range(month).map_err(|_| GrossEvidenceError)?;
        let calculation_profile = Arc::clone(self.profiles.base());
        let periods = crate::pay::periods::payroll_employment_periods(
            &calculation_profile,
            month,
            &range.end,
        )
        .map_err(|failure| {
            self.last_failure_message = Some((month.to_owned(), failure.to_string()));
            GrossEvidenceError
        })?;
        let employment_periods = match periods {
            Value::Array(periods) => Arc::new(periods),
            _ => return Err(GrossEvidenceError),
        };
        let effective_profile = self
            .profiles
            .at(&range.start)
            .map_err(|_| GrossEvidenceError)?
            .calculation;
        let reuse_key = self
            .reuse
            .as_ref()
            .and_then(|reuse| reuse.fingerprints.legacy_month(month, reuse.view).ok());
        let cached_core = match (&self.reuse, &reuse_key) {
            (Some(reuse), Some(key)) => reuse.cache.get(key),
            _ => None,
        };
        let core = match cached_core {
            Some(core) => core,
            None => {
                let core = Arc::new(self.price_core(month, &calculation_profile)?);
                if let (Some(reuse), Some(key)) = (&self.reuse, reuse_key) {
                    reuse.cache.insert(key, Arc::clone(&core));
                }
                core
            }
        };
        // The shared payload excludes source metadata. Every hit binds the current
        // snapshot's profile, employment periods and complete projected plan.
        let mut core = Arc::unwrap_or_clone(core);
        let shifts = Arc::clone(&self.scope.shifts);
        let profile = Arc::clone(&self.scope.profile);
        let resolver = self.resolver.clone();
        let mut tariff_days = BTreeSet::new();
        for shift in shifts.iter().filter(|s| super::absence_pay::absence(s)) {
            if let Some(date) = shift["date"].as_str().filter(|d| d.starts_with(month))
                && super::absence_pay::eligible(
                    &self
                        .profiles
                        .at(date)
                        .map_err(|_| GrossEvidenceError)?
                        .calculation,
                )
            {
                tariff_days.insert(date.to_owned());
            }
        }
        if !tariff_days.is_empty() {
            super::absence_pay::apply(
                month,
                &mut core.pay,
                &shifts,
                &profile["workingTimeTarget"]["context"],
                |date| tariff_days.contains(date),
                |date| {
                    crate::rules::holidays::holiday_map_for_month(
                        &date[..7],
                        profile["federalState"].as_str()?,
                        profile["holidayRegion"].as_str().unwrap_or("NONE"),
                        resolver.as_ref(),
                    )
                    .ok()
                    .map(|map| map.contains_key(date))
                },
                |reference| {
                    if self.reference_depth >= 36 {
                        return None;
                    }
                    self.reference_depth += 1;
                    let pay = self.source(reference).ok().map(|source| source.pay);
                    self.reference_depth -= 1;
                    pay
                },
            );
        }
        let evidence = Arc::new(GrossMonthEvidence {
            source: SalaryPaymentSource {
                month: month.into(),
                profile_serialization: self
                    .source_views
                    .get(month)
                    .map(|view| Arc::clone(&view.profile_serialization)),
                profile: Arc::clone(
                    self.source_views
                        .get(month)
                        .map_or(&self.scope.profile, |view| &view.profile),
                ),
                shifts: Arc::clone(
                    self.source_views
                        .get(month)
                        .map_or(&self.scope.shifts, |view| &view.shifts),
                ),
                pay: core.pay,
            },
            effective_profile,
            employment_periods,
            projected_regular_shifts: Arc::clone(&self.projected_regular_shifts),
            premium_evidence: core.premium_evidence,
            special_duty_traces: core.special_duty_traces,
            coverage: core.coverage,
        });
        #[cfg(test)]
        {
            self.calculations += 1;
        }
        self.months.insert(
            month.to_owned(),
            CachedMonth {
                evidence: Arc::clone(&evidence),
                time_account: None,
            },
        );
        self.touch(month);
        Ok(evidence)
    }

    /// Only the Rust salary selector registers these views. They carry raw
    /// dated/month-window facts, never money, and must precede monthly pricing.
    pub(crate) fn register_source_view(
        &mut self,
        month: &str,
        profile: EmploymentProfileView,
        shifts: Arc<Vec<Value>>,
    ) -> Result<(), GrossEvidenceError> {
        if self.source_views.contains_key(month) && self.months.contains_key(month) {
            return Err(GrossEvidenceError);
        }
        // A reference month can have been priced before its presentation view was requested.
        self.months.remove(month);
        self.source_views.insert(
            month.to_owned(),
            SourceView {
                profile: profile.calculation,
                profile_serialization: profile.serialization,
                shifts,
            },
        );
        self.touch(month);
        Ok(())
    }
    pub(crate) fn has_source_view(&self, month: &str) -> bool {
        self.source_views.contains_key(month)
    }
    pub(crate) fn profile_view_at(
        &mut self,
        date: &str,
    ) -> Result<EmploymentProfileView, crate::employment::EmploymentError> {
        self.profiles.at(date)
    }
    pub(crate) fn calculation_profile(&self) -> &Arc<Value> {
        self.profiles.base()
    }
    pub(crate) fn last_failure_is_rule(&self, month: &str) -> bool {
        self.last_rule_failure.as_deref() == Some(month)
    }
    pub(crate) fn last_rule_failure_details(&self, month: &str) -> Option<&RuleResolutionFailure> {
        self.rule_failures.get(month)
    }
    pub(crate) fn last_failure_message(&self, month: &str) -> Option<&str> {
        self.last_failure_message
            .as_ref()
            .filter(|(failed, _)| failed == month)
            .map(|(_, message)| message.as_str())
    }

    pub(crate) fn source(
        &mut self,
        month: &str,
    ) -> Result<SalaryPaymentSource, GrossEvidenceError> {
        let resolver = self.resolver.clone();
        let evidence = self.month_evidence(
            month,
            Arc::clone(&self.scope.profile),
            Arc::clone(&self.scope.shifts),
            EvidenceNeed::GrossOnly,
            resolver.as_ref(),
        )?;
        Ok(evidence.source.clone())
    }

    /// Reuses the complete cached financial lines; this never calls a pricer.
    pub(crate) fn special_duty_time_account(
        &mut self,
        month: &str,
    ) -> Result<Arc<special::SpecialDutyTimeAccount>, GrossEvidenceError> {
        let resolver = self.resolver.clone();
        let evidence = self.month_evidence(
            month,
            Arc::clone(&self.scope.profile),
            Arc::clone(&self.scope.shifts),
            EvidenceNeed::GrossOnly,
            resolver.as_ref(),
        )?;
        if let Some(account) = self
            .months
            .get(month)
            .and_then(|cached| cached.time_account.as_ref())
        {
            return Ok(Arc::clone(account));
        }
        let lines = evidence.source.pay()["specialDutyBreakdowns"]
            .as_array()
            .map_or(&[][..], Vec::as_slice);
        let account = Arc::new(
            special::time_account::special_duty_time_account_with_pay(
                month,
                &self.scope.shifts,
                self.profiles.base(),
                lines,
            )
            .map_err(|_| GrossEvidenceError)?,
        );
        self.months
            .get_mut(month)
            .ok_or(GrossEvidenceError)?
            .time_account = Some(Arc::clone(&account));
        Ok(account)
    }
}

impl GrossEvidenceProvider for NativeGrossEvidenceProvider<'_> {
    fn month_evidence(
        &mut self,
        month: &str,
        profile: Arc<Value>,
        shifts: Arc<Vec<Value>>,
        _need: EvidenceNeed,
        resolver: &RuleResolver,
    ) -> Result<Arc<GrossMonthEvidence>, GrossEvidenceError> {
        // Do not serve a result from another snapshot or catalog, even if its
        // package IDs or monthly keys happen to match.
        let view = self.source_views.get(month);
        let same_profile = Arc::ptr_eq(&profile, &self.scope.profile)
            || Arc::ptr_eq(&profile, self.profiles.base())
            || profile == self.scope.profile
            || view.is_some_and(|view| {
                Arc::ptr_eq(&profile, &view.profile) || profile == view.profile
            });
        let same_shifts = Arc::ptr_eq(&shifts, &self.scope.shifts)
            || shifts == self.scope.shifts
            || view.is_some_and(|view| Arc::ptr_eq(&shifts, &view.shifts) || shifts == view.shifts);
        if !std::ptr::eq(resolver, self.resolver.as_ref()) || !same_profile || !same_shifts {
            return Err(GrossEvidenceError);
        }
        if let Some(cached) = self.months.get(month) {
            let evidence = Arc::clone(&cached.evidence);
            self.touch(month);
            return Ok(evidence);
        }
        self.calculate(month)
    }
}

#[cfg(test)]
#[path = "provider_tests.rs"]
mod tests;

#[cfg(test)]
mod failure_cache_tests {
    use super::*;
    #[test]
    fn typed_failure_evidence_is_per_month_and_bounded_without_message_inference() {
        let mut cache = RuleFailureCache::default();
        for year in 2000..2060 {
            cache.insert(
                &format!("{year}-01"),
                RuleResolutionFailure {
                    code: "RULE_PACKAGE_NOT_FOUND",
                    kind: crate::rules::RuleKind::Holiday,
                    package_id: "fixture".into(),
                    effective_date: format!("{year}-01-01"),
                    message: format!("typed failure {year}"),
                },
            );
        }
        assert_eq!(cache.values.len(), MAX_CACHED_MONTHS);
        assert_eq!(cache.order.len(), MAX_CACHED_MONTHS);
        assert!(cache.get("2000-01").is_none());
        assert_eq!(cache.get("2059-01").unwrap().effective_date, "2059-01-01");
        assert_eq!(
            cache.get("2012-01").unwrap().kind,
            crate::rules::RuleKind::Holiday
        );
    }
}
