//! Exact salary-month selection and local fixed-pay timing over native gross.
use super::{FinancialError, FinancialSnapshotInput};
use crate::net::gross_evidence::{
    EvidenceNeed, GrossEvidenceError, GrossEvidenceProvider, GrossMonthEvidence,
};
use crate::net::payment_projection::{
    ProjectionError, SalaryPaymentProjection, SalaryPaymentSource,
};
use crate::net::payment_schedule::{
    PAYMENT_GROUPS, PaymentPreferences, SalaryPerspective, add_salary_payment_months,
    resolve_salary_payment_period, salary_payment_required_months,
    validate_salary_payment_preferences,
};
use crate::net::provider::{NativeGrossEvidenceProvider, ResolverHandle, SourceDataScope};
use crate::rules::RuleResolver;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

fn truth(value: &Value) -> bool {
    crate::net::js_truthy(value)
}
fn error() -> FinancialError {
    FinancialError::invalid("Die vollständige Gehaltsprognose konnte nicht berechnet werden.")
}

pub struct FinancialContext<'a> {
    raw: SalarySourceBook<'a>,
    actual: Option<SalarySourceBook<'a>>,
    // Annual analysis uses the last decision row; salary preparation uses the
    // first. Unique persisted rows share the same native month cache.
    annual: Option<SalarySourceBook<'a>>,
    pub(crate) annual_proposals: BTreeMap<i32, super::annual_salary::AnnualSalaryProposalResult>,
    pub(crate) forecasts: BTreeMap<String, Value>,
    pub(crate) annual_net: BTreeMap<String, super::net::AnnualNetPay>,
    pub(crate) projection_keys: super::net::ProjectionKeys,
    pub(crate) net_passes: u64,
    pub(crate) semantic_fingerprints: Option<Arc<super::fingerprint::FinancialFingerprintBook>>,
    pub(crate) shared_net_cache: Option<Arc<super::net::reuse::SharedNetReuseCache>>,
}

pub struct SalarySourceBook<'a> {
    pub(crate) profile: Arc<Value>,
    pub(crate) entries: Arc<Vec<Value>>,
    pub(crate) test_months: BTreeSet<String>,
    pub(crate) resolver: ResolverHandle<'a>,
    native: NativeGrossEvidenceProvider<'a>,
    raw_shifts: Arc<Vec<Value>>,
}

fn monthly_shifts(entries: &[Value], month: &str) -> Result<Vec<Value>, FinancialError> {
    let prefix = format!("{month}-");
    let mut selected = vec![];
    for entry in entries {
        if entry["kind"] != "SHIFT" || entry.get("deletedAt") != Some(&Value::Null) {
            continue;
        }
        let included = if truth(&entry["specialDuty"]) {
            crate::credit::duty::duty_calendar_dates(entry)
                .map_err(|_| error())?
                .iter()
                .any(|date| date.starts_with(&prefix))
        } else {
            entry["date"]
                .as_str()
                .is_some_and(|date| date.starts_with(&prefix))
        };
        if included {
            selected.push(entry.clone());
        }
    }
    Ok(selected)
}

impl<'a> SalarySourceBook<'a> {
    fn new(
        input: &FinancialSnapshotInput<'_>,
        resolver: ResolverHandle<'a>,
        actual: bool,
        last_decision: bool,
    ) -> Result<Self, FinancialError> {
        let entries = if !actual || input.test_months.is_empty() {
            Arc::clone(input.entries)
        } else {
            Arc::new(
                input
                    .entries
                    .iter()
                    .filter(|entry| {
                        !entry["date"].as_str().is_some_and(|date| {
                            input.test_months.contains(date.get(..7).unwrap_or(""))
                        })
                    })
                    .cloned()
                    .collect(),
            )
        };
        let raw_shifts = if entries.iter().all(|entry| entry["kind"] == "SHIFT") {
            Arc::clone(&entries)
        } else {
            Arc::new(
                entries
                    .iter()
                    .filter(|entry| entry["kind"] == "SHIFT")
                    .cloned()
                    .collect(),
            )
        };
        let mut decisions = BTreeMap::new();
        for decision in input.tariff_decisions {
            let Some(month) = decision["month"].as_str() else {
                continue;
            };
            if !actual || !input.test_months.contains(month) {
                if last_decision {
                    decisions.insert(month.to_owned(), decision.clone());
                } else {
                    decisions
                        .entry(month.to_owned())
                        .or_insert_with(|| decision.clone());
                }
            }
        }
        let scope = SourceDataScope {
            profile: Arc::clone(input.profile),
            shifts: Arc::clone(&raw_shifts),
            assessment_shifts: Arc::clone(&raw_shifts),
            decisions: Arc::new(decisions),
            work_pattern_settings: input.work_pattern_settings.clone(),
        };
        let native = match &resolver {
            ResolverHandle::Borrowed(resolver) => NativeGrossEvidenceProvider::new(scope, resolver),
            ResolverHandle::Shared(_) => {
                NativeGrossEvidenceProvider::with_resolver(scope, resolver.clone())
            }
        }
        .map_err(|_| error())?;
        Ok(Self {
            profile: Arc::clone(input.profile),
            entries,
            test_months: input.test_months.clone(),
            resolver,
            native,
            raw_shifts,
        })
    }

    fn ensure_view(&mut self, month: &str) -> Result<(), FinancialError> {
        if self.native.has_source_view(month) {
            return Ok(());
        }
        let profile = self
            .native
            .profile_view_at(&format!("{month}-01"))
            .map_err(|failure| FinancialError::invalid(failure.to_string()))?;
        let selected = monthly_shifts(&self.entries, month)?;
        let shifts = if selected == *self.raw_shifts {
            Arc::clone(&self.raw_shifts)
        } else {
            Arc::new(selected)
        };
        self.native
            .register_source_view(month, profile, shifts)
            .map_err(|_| error())
    }

    /// Original (unprojected) month entries and dated profile; native money and
    /// retained minute evidence still come from the one shared snapshot.
    pub fn salary_month(&mut self, month: &str) -> Result<SalaryPaymentSource, FinancialError> {
        self.ensure_view(month)?;
        self.native.source(month).map_err(|_| FinancialError {
            message: self
                .native
                .last_failure_message(month)
                .map(str::to_owned)
                .unwrap_or_else(|| error().message),
            rule_failure: self.native.last_failure_is_rule(month),
            rule_failure_details: self
                .native
                .last_rule_failure_details(month)
                .cloned()
                .map(Box::new),
        })
    }

    fn failed_source(&mut self, month: &str) -> Result<SalaryPaymentSource, FinancialError> {
        let mut pay = crate::pay::manual::create_manual_monthly_pay_estimate(month, 0)
            .map_err(|_| error())?;
        pay["available"] = json!(false);
        pay["personalBaseAmount"] = Value::Null;
        pay["estimatedGrossAmount"] = Value::Null;
        pay["tariffLabel"] = Value::Null;
        let profile = self
            .native
            .profile_view_at(&format!("{month}-01"))
            .map_err(|failure| FinancialError::invalid(failure.to_string()))?;
        Ok(SalaryPaymentSource {
            month: month.into(),
            profile: profile.calculation,
            profile_serialization: Some(profile.serialization),
            shifts: Arc::new(monthly_shifts(&self.entries, month)?),
            pay,
        })
    }

    fn source(
        &mut self,
        month: &str,
        requested: &str,
    ) -> Result<SalaryPaymentSource, FinancialError> {
        match self.salary_month(month) {
            Err(failure) if month != requested && failure.rule_failure => self.failed_source(month),
            result => result,
        }
    }

    fn manual_fixed_month(&self, month: &str) -> Result<bool, FinancialError> {
        if truth(&self.profile["salaryBasisConflict"]) {
            return Ok(false);
        }
        if self.profile["employmentTimeline"]
            .as_array()
            .is_some_and(|history| !history.is_empty())
        {
            let resolved = crate::employment::resolve_remuneration_profile_ref(
                self.profile["employmentTimeline"]
                    .as_array()
                    .ok_or_else(error)?,
                &format!("{month}-01"),
            )
            .map_err(|failure| FinancialError::invalid(failure.to_string()))?;
            if resolved
                .profile
                .is_none_or(|profile| !truth(&profile["employment"]))
            {
                return Ok(false);
            }
        }
        let periods = crate::employment::employment_month_periods(
            self.native.calculation_profile(),
            month,
            &format!("{month}-31"),
        )
        .map_err(|failure| FinancialError::invalid(failure.to_string()))?;
        Ok(periods.as_array().ok_or_else(error)?.iter().all(|period| {
            let p = &period["profile"];
            !p["manualMonthlyGrossCents"].is_null()
                && [
                    "tariff",
                    "nursingTrainingTariff",
                    "vkaETariff",
                    "tvlKrTariff",
                    "tvhKrTariff",
                    "tvUkNursingTariff",
                    "tvalPflegeTariff",
                ]
                .iter()
                .all(|field| !truth(&p[*field]))
        }))
    }

    fn effective_preferences(
        &mut self,
        month: &str,
        preferences: &PaymentPreferences,
        perspective: SalaryPerspective,
    ) -> Result<PaymentPreferences, FinancialError> {
        let deltas: &[i32] = if perspective == SalaryPerspective::Payout {
            &[-2, -1, 0]
        } else {
            &[0]
        };
        let candidates: Vec<String> = deltas
            .iter()
            .map(|delta| {
                add_salary_payment_months(month, *delta)
                    .map_err(|failure| FinancialError::invalid(failure.to_string()))
            })
            .collect::<Result<_, _>>()?;
        let mut fixed = BTreeSet::new();
        for candidate in &candidates {
            if !self.manual_fixed_month(candidate)? || self.test_months.contains(candidate) {
                continue;
            }
            let source = self.source(candidate, month)?;
            if source.pay()["available"] == true
                && [
                    "timePremiumAmount",
                    "allowanceAmount",
                    "overtimeAmount",
                    "specialDutyAmount",
                ]
                .iter()
                .all(|field| {
                    source
                        .pay()
                        .get(*field)
                        .filter(|value| !value.is_null())
                        .map_or(*field == "specialDutyAmount", |value| {
                            value.as_f64() == Some(0.0)
                        })
                })
            {
                fixed.insert(candidate.clone());
            }
        }
        if fixed.is_empty() {
            return Ok(preferences.clone());
        }
        let mut value = serde_json::to_value(preferences).map_err(|_| error())?;
        let mut periods: Vec<Value> = value["periods"]
            .as_array()
            .ok_or_else(error)?
            .iter()
            .filter(|period| {
                !period["effectiveMonth"]
                    .as_str()
                    .is_some_and(|period| candidates.iter().any(|candidate| candidate == period))
            })
            .cloned()
            .collect();
        for candidate in &candidates {
            let delays = if fixed.contains(candidate) {
                None
            } else {
                resolve_salary_payment_period(preferences, candidate)
                    .map_err(|failure| FinancialError::invalid(failure.to_string()))?
            };
            let zero: serde_json::Map<String, Value> = PAYMENT_GROUPS
                .iter()
                .map(|group| (group.label().to_owned(), json!(0)))
                .collect();
            periods.push(json!({"effectiveMonth":candidate,"delays":delays.map_or_else(|| Value::Object(zero), |period| serde_json::to_value(&period.delays).unwrap_or(Value::Null))}));
        }
        value["periods"] = json!(periods);
        validate_salary_payment_preferences(&value)
            .map_err(|failure| FinancialError::invalid(failure.to_string()))
    }

    pub fn salary_projection(
        &mut self,
        month: &str,
        preferences: &PaymentPreferences,
        perspective: SalaryPerspective,
    ) -> Result<SalaryPaymentProjection, FinancialError> {
        let effective = self.effective_preferences(month, preferences, perspective)?;
        let mut months = salary_payment_required_months(month, &effective, perspective)
            .map_err(|failure| FinancialError::invalid(failure.to_string()))?;
        let incoming = add_salary_payment_months(month, -2)
            .map_err(|e| FinancialError::invalid(e.to_string()))?;
        let mut has_incoming = false;
        if perspective == SalaryPerspective::Payout {
            for s in self
                .raw_shifts
                .iter()
                .filter(|s| crate::net::absence_pay::absence(s))
            {
                if let Some(date) = s["date"].as_str().filter(|d| d.starts_with(&incoming))
                    && crate::net::absence_pay::eligible(
                        &self
                            .native
                            .profile_view_at(date)
                            .map_err(|_| error())?
                            .calculation,
                    )
                {
                    has_incoming = true;
                    break;
                }
            }
        }
        let incoming = has_incoming.then_some(incoming);
        if let Some(claim) = &incoming
            && !months.contains(claim)
        {
            months.push(claim.clone());
        }
        let mut sources = BTreeMap::new();
        for source in months {
            sources.insert(source.clone(), self.source(&source, month)?);
        }
        let mut result = crate::net::payment_projection::project_with_absences(
            month,
            perspective,
            &effective,
            incoming.as_deref(),
            |month| {
                sources
                    .get(month)
                    .cloned()
                    .ok_or(ProjectionError::MissingSource)
            },
        )
        .map_err(|failure| FinancialError::invalid(failure.to_string()))?;
        let blocked: Vec<_> = result
            .sources
            .iter()
            .filter(|source| self.test_months.contains(source.month()))
            .collect();
        if !blocked.is_empty() {
            result.available = false;
            result.pay["available"] = json!(false);
            result.pay["estimatedGrossAmount"] = Value::Null;
            for source in blocked {
                result.issues.push(json!({"kind":"UNAVAILABLE","month":source.month(),"message":format!("Für {} ist ein Testmonat aktiv. Beende den Testlauf, um tatsächliche Gehaltsansprüche zu berechnen.",source.month())}));
            }
        }
        Ok(result)
    }

    pub fn diagnostics(&self) -> Value {
        self.native.diagnostics()
    }
}

impl GrossEvidenceProvider for SalarySourceBook<'_> {
    fn month_evidence(
        &mut self,
        month: &str,
        profile: Arc<Value>,
        shifts: Arc<Vec<Value>>,
        need: EvidenceNeed,
        resolver: &RuleResolver,
    ) -> Result<Arc<GrossMonthEvidence>, GrossEvidenceError> {
        self.ensure_view(month).map_err(|_| GrossEvidenceError)?;
        self.native
            .month_evidence(month, profile, shifts, need, resolver)
    }
}

impl<'a> FinancialContext<'a> {
    pub fn new(
        input: &FinancialSnapshotInput<'_>,
        resolver: &'a RuleResolver,
    ) -> Result<Self, FinancialError> {
        Self::with_resolver(input, ResolverHandle::Borrowed(resolver))
    }
    fn with_resolver(
        input: &FinancialSnapshotInput<'_>,
        resolver: ResolverHandle<'a>,
    ) -> Result<Self, FinancialError> {
        let mut seen = BTreeSet::new();
        let repeated_decision = input.tariff_decisions.iter().any(|row| {
            row["month"]
                .as_str()
                .is_some_and(|month| !seen.insert(month))
        });
        Ok(Self {
            raw: SalarySourceBook::new(input, resolver.clone(), false, false)?,
            annual_proposals: BTreeMap::new(),
            forecasts: BTreeMap::new(),
            annual_net: BTreeMap::new(),
            projection_keys: super::net::ProjectionKeys::default(),
            net_passes: 0,
            semantic_fingerprints: None,
            shared_net_cache: None,
            actual: if input.test_months.is_empty() {
                None
            } else {
                Some(SalarySourceBook::new(input, resolver.clone(), true, false)?)
            },
            annual: if repeated_decision {
                Some(SalarySourceBook::new(input, resolver, false, true)?)
            } else {
                None
            },
        })
    }
    pub fn profile(&self) -> &Arc<Value> {
        &self.raw.profile
    }
    pub fn calculation_profile(&self) -> &Arc<Value> {
        self.raw.native.calculation_profile()
    }
    pub fn test_months(&self) -> &BTreeSet<String> {
        &self.raw.test_months
    }
    pub fn resolver(&self) -> &RuleResolver {
        self.raw.resolver.as_ref()
    }
    pub(crate) fn resolver_handle(&self) -> ResolverHandle<'a> {
        self.raw.resolver.clone()
    }
    pub fn salary_month(&mut self, month: &str) -> Result<SalaryPaymentSource, FinancialError> {
        self.raw.salary_month(month)
    }
    pub(crate) fn annual_salary_month(
        &mut self,
        month: &str,
    ) -> Result<SalaryPaymentSource, FinancialError> {
        self.annual
            .as_mut()
            .unwrap_or(&mut self.raw)
            .salary_month(month)
    }
    pub fn salary_projection(
        &mut self,
        month: &str,
        preferences: &PaymentPreferences,
        perspective: SalaryPerspective,
    ) -> Result<SalaryPaymentProjection, FinancialError> {
        self.payout_provider()
            .salary_projection(month, preferences, perspective)
    }
    pub fn payout_provider(&mut self) -> &mut SalarySourceBook<'a> {
        self.actual.as_mut().unwrap_or(&mut self.raw)
    }
    pub fn earned_provider(&mut self) -> &mut SalarySourceBook<'a> {
        &mut self.raw
    }
    pub fn special_duty_time_account(
        &mut self,
        month: &str,
        perspective: SalaryPerspective,
    ) -> Result<Arc<crate::pay::special::SpecialDutyTimeAccount>, FinancialError> {
        let book = if perspective == SalaryPerspective::Payout {
            self.payout_provider()
        } else {
            self.earned_provider()
        };
        book.ensure_view(month)?;
        book.native
            .special_duty_time_account(month)
            .map_err(|_| error())
    }
    pub fn diagnostics(&self) -> Value {
        json!({"raw":self.raw.diagnostics(),"actual":self.actual.as_ref().map(SalarySourceBook::diagnostics),"annual":self.annual.as_ref().map(SalarySourceBook::diagnostics),"cachedForecasts":self.forecasts.len(),"cachedNetYears":self.annual_net.len(),"projectionIdentities":self.projection_keys.diagnostics()})
    }
    pub fn reuse_diagnostics(&self) -> Value {
        json!({"raw":self.raw.native.reuse_diagnostics(),"actual":self.actual.as_ref().map(|book|book.native.reuse_diagnostics()),"annual":self.annual.as_ref().map(|book|book.native.reuse_diagnostics()),"nativeNetPasses":self.net_passes})
    }
    pub fn enable_shared_net_reuse(
        &mut self,
        cache: Arc<super::net::reuse::SharedNetReuseCache>,
    ) -> bool {
        if self.semantic_fingerprints.is_none() {
            return false;
        }
        self.shared_net_cache = Some(cache);
        true
    }
}

impl FinancialContext<'static> {
    pub fn new_shared_with_reuse(
        input: &FinancialSnapshotInput<'_>,
        resolver: Arc<RuleResolver>,
        space: super::fingerprint::StableFinancialDataSpace,
        cache: Arc<crate::net::provider::reuse::SharedGrossReuseCache>,
    ) -> Result<Self, FinancialError> {
        use super::fingerprint::{
            FinancialFingerprintBook, FinancialFingerprintInput, LegacyFinancialView,
        };
        // Optional cache admission cannot make otherwise valid calculations fail.
        let fingerprints = FinancialFingerprintBook::new(
            space,
            FinancialFingerprintInput {
                profile: Arc::clone(input.profile),
                entries: Arc::clone(input.entries),
                tariff_decisions: Arc::new(input.tariff_decisions.to_vec()),
                settings: input.work_pattern_settings.clone(),
                test_months: input.test_months.clone(),
            },
            Arc::clone(&resolver),
        )
        .ok()
        .map(Arc::new);
        let mut context = Self::new_shared(input, resolver)?;
        if let Some(fingerprints) = fingerprints {
            context.raw.native.enable_reuse(
                Arc::clone(&fingerprints),
                LegacyFinancialView::Salary,
                Arc::clone(&cache),
            );
            if let Some(actual) = &mut context.actual {
                actual.native.enable_reuse(
                    Arc::clone(&fingerprints),
                    LegacyFinancialView::Actual,
                    Arc::clone(&cache),
                );
            }
            if let Some(annual) = &mut context.annual {
                annual.native.enable_reuse(
                    Arc::clone(&fingerprints),
                    LegacyFinancialView::Annual,
                    cache,
                );
            }
            context.semantic_fingerprints = Some(fingerprints);
        }
        Ok(context)
    }
    /// Own the resolver and all immutable raw Arc handles. No self-reference,
    /// leaked allocation, or lifetime borrowed from the snapshot assembler.
    pub fn new_shared(
        input: &FinancialSnapshotInput<'_>,
        resolver: Arc<RuleResolver>,
    ) -> Result<Self, FinancialError> {
        Self::with_resolver(input, ResolverHandle::Shared(resolver))
    }
}
