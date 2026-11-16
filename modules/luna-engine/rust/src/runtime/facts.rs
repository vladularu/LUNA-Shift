//! Lazily checked native facts shared by every job for one immutable snapshot.
//! I/O states stay separate from domain validation. No independent source is
//! read just to make another source available, and no lock covers calculation.
use super::{
    assessed_source,
    calendar_source::PreparedCalendarSource,
    catalog::RuntimeCatalog,
    catalog_source::{self, CatalogSourceError},
    financial_source::{self, FinancialSourceError},
    sources::{RequiredCoverage, SnapshotSources, SourceReadError},
    time_source::{self, TimeSourceError},
};
use crate::{
    contract::{ImmutableSnapshot, SourceKind},
    input::{
        InputError,
        annual_rows::{RawActualAnnualPayments, RawTariffAnnualClaims},
        calculation_profile::{
            TargetProfileFacts, YouthProtectionFacts, calculation_work_profile_with_settings,
        },
        calendar_rows::{RawCalendarEntries, RawMonthlyTariffDecisions},
        draft_rows::{DraftRowsKind, RawDraftRows},
        employment::RawEmploymentHistory,
        finance_rows::{RawNetPayTimeline, RawSalaryPaymentPreferences, RawTestMonths},
        personal_context::{
            CheckedWorkPatternSettings, ContextError, load_youth_protection_preference,
        },
        profile_composition::financial_work_profile,
        remuneration_rows::{RawRemunerationRows, RemunerationRowsKind},
        stored_profile::{OpaqueStoredWorkProfile, checked_stored_work_profile},
        training_rows::{RawShiftTraining, RawTrainingProfiles},
        working_time_target::RawSavedWorkingTimeTarget,
    },
    report::{
        financial::{assessed_source::AssessedSourceBook, source::FinancialContext},
        time::TimeReportContext,
    },
    target::{InputStatus, PreparedTargetSource, TargetError},
};
use serde_json::Value;
use std::sync::{Arc, Mutex, OnceLock};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FactError {
    Clock(&'static str),
    Source {
        kind: SourceKind,
        error: SourceReadError,
    },
    Profile(InputError),
    Calendar(InputError),
    Finance(InputError),
    Annual(InputError),
    Training(InputError),
    Remuneration(InputError),
    Draft(InputError),
    Personal(ContextError),
    Target(TargetError),
    InvalidShape(SourceKind),
}
pub struct SnapshotFacts {
    snapshot: ImmutableSnapshot,
    financial_reuse: Option<Arc<super::reuse::FinancialReuseCaches>>,
    payroll_form_store: OnceLock<Arc<super::payroll_form::PayrollFormStore>>,
    payroll_net_cache: OnceLock<super::financial_report::payroll::net_cache::PayrollNetCache>,
    view_context: OnceLock<Arc<super::view_composition::ViewContextCache>>,
    checks_context: OnceLock<
        Result<Arc<super::checks_source::ChecksSnapshotSource>, super::report::ReportIssue>,
    >,
    profile: OnceLock<Result<Option<Arc<OpaqueStoredWorkProfile>>, FactError>>,
    profile_clock:
        OnceLock<Result<Option<Arc<super::profile_clock::ProfileClockEnvironment>>, FactError>>,
    financial_profile: OnceLock<Result<Option<Arc<Value>>, FactError>>,
    calculation_profile: OnceLock<Result<Option<Arc<Value>>, FactError>>,
    prepared_targets: OnceLock<Result<Option<Arc<PreparedTargetSource>>, FactError>>,
    saved_target: OnceLock<Result<Option<Arc<RawSavedWorkingTimeTarget>>, FactError>>,
    employment_history: OnceLock<Result<Arc<RawEmploymentHistory>, FactError>>,
    calendar: OnceLock<Result<Arc<RawCalendarEntries>, FactError>>,
    calendar_window_index: OnceLock<
        Result<Arc<crate::calendar::window::CalendarSourceIndex>, super::report::ReportIssue>,
    >,
    tariff_decisions: OnceLock<Result<Arc<RawMonthlyTariffDecisions>, FactError>>,
    net_settings: OnceLock<Result<Arc<RawNetPayTimeline>, FactError>>,
    salary_preferences: OnceLock<Result<Arc<RawSalaryPaymentPreferences>, FactError>>,
    test_months: OnceLock<Result<Arc<RawTestMonths>, FactError>>,
    actual_annual_payments: OnceLock<Result<Arc<RawActualAnnualPayments>, FactError>>,
    tariff_annual_claims: OnceLock<Result<Arc<RawTariffAnnualClaims>, FactError>>,
    training_profiles: OnceLock<Result<Arc<RawTrainingProfiles>, FactError>>,
    training_details: OnceLock<Result<Arc<RawShiftTraining>, FactError>>,
    annex_pause_details: OnceLock<Result<Arc<RawShiftTraining>, FactError>>,
    paid_absences: OnceLock<Result<Arc<RawRemunerationRows>, FactError>>,
    overtime_allocations: OnceLock<Result<Arc<RawRemunerationRows>, FactError>>,
    scoped_allowances: OnceLock<Result<Arc<RawRemunerationRows>, FactError>>,
    draft_rows: [OnceLock<Result<Arc<RawDraftRows>, FactError>>; 10],
    financial_context:
        OnceLock<Result<Arc<Mutex<FinancialContext<'static>>>, FinancialSourceError>>,
    assessed_book: OnceLock<Result<Arc<AssessedSourceBook>, FinancialSourceError>>,
    time_context: OnceLock<Result<Arc<Mutex<TimeReportContext>>, TimeSourceError>>,
    work_pattern: OnceLock<Result<Arc<CheckedWorkPatternSettings>, FactError>>,
    youth_preference: OnceLock<Result<bool, FactError>>,
    catalog: OnceLock<Result<RuntimeCatalog, CatalogSourceError>>,
}
impl std::fmt::Debug for SnapshotFacts {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SnapshotFacts").finish_non_exhaustive()
    }
}
impl SnapshotFacts {
    /// O(1) construction: no input traversal, domain calculation or cloning of
    /// target histories happens while the registry owns its lifecycle mutex.
    pub fn new(snapshot: ImmutableSnapshot) -> Self {
        Self::with_reuse(snapshot, None)
    }
    pub(crate) fn with_shared_reuse(
        snapshot: ImmutableSnapshot,
        reuse: Arc<super::reuse::FinancialReuseCaches>,
    ) -> Self {
        Self::with_reuse(snapshot, Some(reuse))
    }
    fn with_reuse(
        snapshot: ImmutableSnapshot,
        financial_reuse: Option<Arc<super::reuse::FinancialReuseCaches>>,
    ) -> Self {
        Self {
            snapshot,
            financial_reuse,
            payroll_form_store: OnceLock::new(),
            payroll_net_cache: OnceLock::new(),
            view_context: OnceLock::new(),
            checks_context: OnceLock::new(),
            profile: OnceLock::new(),
            profile_clock: OnceLock::new(),
            financial_profile: OnceLock::new(),
            calculation_profile: OnceLock::new(),
            prepared_targets: OnceLock::new(),
            saved_target: OnceLock::new(),
            employment_history: OnceLock::new(),
            calendar: OnceLock::new(),
            calendar_window_index: OnceLock::new(),
            tariff_decisions: OnceLock::new(),
            net_settings: OnceLock::new(),
            salary_preferences: OnceLock::new(),
            test_months: OnceLock::new(),
            actual_annual_payments: OnceLock::new(),
            tariff_annual_claims: OnceLock::new(),
            training_profiles: OnceLock::new(),
            training_details: OnceLock::new(),
            annex_pause_details: OnceLock::new(),
            paid_absences: OnceLock::new(),
            overtime_allocations: OnceLock::new(),
            scoped_allowances: OnceLock::new(),
            draft_rows: std::array::from_fn(|_| OnceLock::new()),
            financial_context: OnceLock::new(),
            assessed_book: OnceLock::new(),
            time_context: OnceLock::new(),
            work_pattern: OnceLock::new(),
            youth_preference: OnceLock::new(),
            catalog: OnceLock::new(),
        }
    }
    pub fn snapshot(&self) -> &ImmutableSnapshot {
        &self.snapshot
    }
    pub(crate) fn payroll_form_store(&self) -> &Arc<super::payroll_form::PayrollFormStore> {
        self.payroll_form_store.get_or_init(Default::default)
    }
    pub(crate) fn payroll_net_cache(
        &self,
    ) -> &super::financial_report::payroll::net_cache::PayrollNetCache {
        self.payroll_net_cache.get_or_init(Default::default)
    }
    pub(crate) fn existing_payroll_form_store(
        &self,
    ) -> Option<&Arc<super::payroll_form::PayrollFormStore>> {
        self.payroll_form_store.get()
    }
    /// The proof can only be made by native builder admission. Identity checks
    /// and Arc/enum initialization are constant-size; no parsing occurs here.
    pub(crate) fn seed_catalog(
        &self,
        admission: &super::assembly::CatalogAdmission,
    ) -> Result<(), super::RegistryError> {
        let catalog = admission.checked_for(self.snapshot.identity())?;
        let _ = self.catalog.set(catalog);
        Ok(())
    }
    pub(crate) fn seed_profile_clock(
        &self,
        admission: &super::profile_clock::ProfileClockAdmission,
    ) -> Result<(), super::RegistryError> {
        let value = admission.checked_for(&self.snapshot)?;
        if let Ok(Some(env)) = &value {
            let _ = self.profile.set(Ok(env.profile.clone()));
            if let Some(history) = &env.history {
                let _ = self.employment_history.set(Ok(Arc::clone(history)));
            }
        }
        let _ = self.profile_clock.set(value);
        Ok(())
    }
    pub(crate) fn profile_projection_date(&self) -> Result<&str, FactError> {
        Ok(self
            .profile_clock_environment()?
            .and_then(|env| env.projection_date())
            .unwrap_or(self.snapshot.reference_date()))
    }
    pub(crate) fn profile_clock_environment(
        &self,
    ) -> Result<Option<&Arc<super::profile_clock::ProfileClockEnvironment>>, FactError> {
        self.profile_clock
            .get_or_init(|| super::profile_clock::from_snapshot(&self.snapshot))
            .as_ref()
            .map(Option::as_ref)
            .map_err(Clone::clone)
    }
    /// Small clock-derived UI profiles only; no ready target/source input.
    pub(crate) fn profile_display_metadata(&self) -> Result<Value, FactError> {
        let environment = self
            .profile_clock_environment()?
            .ok_or(FactError::Clock("PROFILE_CLOCK_REQUIRED"))?;
        let state = self
            .snapshot
            .sources()
            .iter()
            .find(|group| group.kind() == SourceKind::WorkPatternSettings)
            .expect("checked complete source set")
            .state();
        environment.profiles(state)
    }
    #[cfg(test)]
    pub(crate) fn catalog_initialized(&self) -> bool {
        self.catalog.get().is_some()
    }
    pub(crate) fn view_context(&self) -> &Arc<super::view_composition::ViewContextCache> {
        self.view_context
            .get_or_init(|| Arc::new(super::view_composition::ViewContextCache::default()))
    }
    pub(crate) fn financial_reuse(&self) -> Option<&Arc<super::reuse::FinancialReuseCaches>> {
        self.financial_reuse.as_ref()
    }
    /// Shares only immutable checked owners; the source does not retain Facts.
    pub fn checks_context(
        &self,
    ) -> Result<&Arc<super::checks_source::ChecksSnapshotSource>, super::report::ReportIssue> {
        self.checks_context
            .get_or_init(|| {
                super::checks_source::ChecksSnapshotSource::from_facts(self).map(Arc::new)
            })
            .as_ref()
            .map_err(Clone::clone)
    }
    fn raw_nullable(&self, kind: SourceKind) -> Result<Option<&Value>, FactError> {
        SnapshotSources::new(&self.snapshot)
            .ready(kind, RequiredCoverage::AllHistory)
            .and_then(|v| v.nullable())
            .map_err(|error| FactError::Source { kind, error })
    }
    fn raw(&self, kind: SourceKind) -> Result<&Value, FactError> {
        self.raw_nullable(kind)?.ok_or(FactError::Source {
            kind,
            error: SourceReadError::NullRecord,
        })
    }
    /// A successful empty stored profile is None. Loading, missing and failed
    /// reads remain errors and cannot create a valid default work profile.
    pub fn profile(&self) -> Result<Option<&Arc<OpaqueStoredWorkProfile>>, FactError> {
        self.profile
            .get_or_init(|| {
                self.raw_nullable(SourceKind::WorkProfile)?
                    .map(|v| {
                        let value = v
                            .as_object()
                            .filter(|v| {
                                v.len() == 2
                                    && v.contains_key("profileRow")
                                    && v.contains_key("salaryRows")
                            })
                            .ok_or(FactError::InvalidShape(SourceKind::WorkProfile))?;
                        let salary_rows = value["salaryRows"]
                            .as_array()
                            .ok_or(FactError::InvalidShape(SourceKind::WorkProfile))?;
                        checked_stored_work_profile(
                            Arc::new(value["profileRow"].clone()),
                            Arc::new(salary_rows.clone()),
                        )
                        .map(Arc::new)
                        .map_err(FactError::Profile)
                    })
                    .transpose()
            })
            .as_ref()
            .map(Option::as_ref)
            .map_err(Clone::clone)
    }
    pub fn work_pattern(&self) -> Result<&Arc<CheckedWorkPatternSettings>, FactError> {
        self.work_pattern
            .get_or_init(|| {
                CheckedWorkPatternSettings::try_from_raw_rows(
                    self.raw(SourceKind::WorkPatternSettings)?,
                )
                .map(Arc::new)
                .map_err(FactError::Personal)
            })
            .as_ref()
            .map_err(Clone::clone)
    }
    /// Salary setup depends on profile/history, never target-plan or youth
    /// loading. The snapshot's explicit reference date binds compatibility
    /// projection; no wall clock is consulted by a worker.
    pub fn financial_profile(&self) -> Result<Option<&Arc<Value>>, FactError> {
        self.financial_profile
            .get_or_init(|| {
                let Some(profile) = self.profile()? else {
                    return Ok(None);
                };
                financial_work_profile(
                    profile,
                    self.employment_history()?,
                    self.profile_projection_date()?,
                )
                .map(Some)
                .map_err(FactError::Profile)
            })
            .as_ref()
            .map(Option::as_ref)
            .map_err(Clone::clone)
    }
    /// Full native plan binding is performed once, after successful all-history
    /// reads. Unknown youth settings retain their status; non-training time
    /// models need not wait for an unrelated youth preference acquisition.
    pub fn calculation_profile(&self) -> Result<Option<&Arc<Value>>, FactError> {
        self.calculation_profile
            .get_or_init(|| {
                let Some(profile) = self.profile()? else {
                    return Ok(None);
                };
                let history = self.employment_history()?;
                let saved = self.saved_target()?;
                let calendar = self.calendar()?;
                let youth = match self.youth_preference() {
                    Ok(value) => YouthProtectionFacts {
                        value: Some(value),
                        status: InputStatus::Ready,
                    },
                    Err(FactError::Source {
                        error: SourceReadError::Loading | SourceReadError::NotRequested,
                        ..
                    }) => YouthProtectionFacts {
                        value: None,
                        status: InputStatus::Loading,
                    },
                    Err(_) => YouthProtectionFacts {
                        value: None,
                        status: InputStatus::Error,
                    },
                };
                let own_pattern = self.financial_profile()?.is_some_and(|profile| {
                    profile
                        .get("workPattern")
                        .is_some_and(|value| !value.is_null())
                });
                let settings = if own_pattern {
                    None
                } else {
                    Some(self.work_pattern()?.as_ref())
                };
                calculation_work_profile_with_settings(
                    profile,
                    history,
                    self.profile_projection_date()?,
                    TargetProfileFacts::Ready {
                        saved: saved.map(Arc::as_ref),
                        calendar,
                    },
                    youth,
                    settings,
                )
                .map(Some)
                .map_err(FactError::Profile)
            })
            .as_ref()
            .map(Option::as_ref)
            .map_err(Clone::clone)
    }
    /// Once per snapshot, shared even when separate period windows or workers
    /// construct native time-report contexts. The constructor does no parsing.
    pub fn prepared_targets(&self) -> Result<Option<&Arc<PreparedTargetSource>>, FactError> {
        self.prepared_targets
            .get_or_init(|| {
                self.calculation_profile().map(|profile| {
                    profile.map(|profile| Arc::new(PreparedTargetSource::new(Arc::clone(profile))))
                })
            })
            .as_ref()
            .map(Option::as_ref)
            .map_err(Clone::clone)
    }
    /// Only raw saved settings are retained here. Native roster signatures and
    /// history are combined later, without accepting a prepared UI context.
    pub fn saved_target(&self) -> Result<Option<&Arc<RawSavedWorkingTimeTarget>>, FactError> {
        self.saved_target
            .get_or_init(|| {
                self.raw_nullable(SourceKind::WorkingTimeTarget)?
                    .map(|row| {
                        RawSavedWorkingTimeTarget::try_from_raw_row_chunks(row)
                            .map(Arc::new)
                            .map_err(FactError::Target)
                    })
                    .transpose()
            })
            .as_ref()
            .map(Option::as_ref)
            .map_err(Clone::clone)
    }
    pub fn employment_history(&self) -> Result<&Arc<RawEmploymentHistory>, FactError> {
        self.employment_history
            .get_or_init(|| {
                let rows = self
                    .raw(SourceKind::RemunerationProfiles)?
                    .as_array()
                    .ok_or(FactError::InvalidShape(SourceKind::RemunerationProfiles))?;
                RawEmploymentHistory::try_from_rows(Arc::new(rows.clone()))
                    .map(Arc::new)
                    .map_err(FactError::Profile)
            })
            .as_ref()
            .map_err(Clone::clone)
    }
    pub fn youth_preference(&self) -> Result<bool, FactError> {
        self.youth_preference
            .get_or_init(|| {
                load_youth_protection_preference(
                    self.raw_nullable(SourceKind::YouthPreference)?
                        .unwrap_or(&Value::Null),
                )
                .map_err(FactError::Personal)
            })
            .clone()
    }
    /// Successful original SQL reads are normalized and sorted once per
    /// snapshot. Sender-computed entries or occurrences cannot bypass this.
    pub fn calendar(&self) -> Result<&Arc<RawCalendarEntries>, FactError> {
        self.calendar
            .get_or_init(|| {
                PreparedCalendarSource::try_from_value(self.raw(SourceKind::CalendarEntries)?)
                    .and_then(PreparedCalendarSource::into_ready)
                    .map(Arc::new)
                    .map_err(FactError::Calendar)
            })
            .as_ref()
            .map_err(Clone::clone)
    }
    /// One index per immutable source owner, outside lifecycle/pool mutexes.
    /// No profile, target, tariff or financial getter participates.
    pub fn calendar_window_index(
        &self,
    ) -> Result<&Arc<crate::calendar::window::CalendarSourceIndex>, super::report::ReportIssue>
    {
        self.calendar_window_index
            .get_or_init(|| {
                let rows = self
                    .calendar()
                    .map_err(super::report::ReportIssue::from)?
                    .entries()
                    .clone();
                crate::calendar::window::CalendarSourceIndex::new(rows)
                    .map(Arc::new)
                    .map_err(|error| super::report::ReportIssue::new(error.code()))
            })
            .as_ref()
            .map_err(Clone::clone)
    }
    pub fn tariff_decisions(&self) -> Result<&Arc<RawMonthlyTariffDecisions>, FactError> {
        self.tariff_decisions
            .get_or_init(|| {
                let rows = self
                    .raw(SourceKind::LegacyTariffDecisions)?
                    .as_array()
                    .ok_or(FactError::InvalidShape(SourceKind::LegacyTariffDecisions))?;
                RawMonthlyTariffDecisions::try_from_rows(Arc::new(rows.clone()))
                    .map(Arc::new)
                    .map_err(FactError::Calendar)
            })
            .as_ref()
            .map_err(Clone::clone)
    }
    pub fn net_settings(&self) -> Result<&Arc<RawNetPayTimeline>, FactError> {
        self.net_settings
            .get_or_init(|| {
                let kind = SourceKind::NetPaySettingsTimeline;
                let rows = self
                    .raw(kind)?
                    .as_array()
                    .ok_or(FactError::InvalidShape(kind))?;
                RawNetPayTimeline::try_from_rows(Arc::new(rows.clone()))
                    .map(Arc::new)
                    .map_err(FactError::Finance)
            })
            .as_ref()
            .map_err(Clone::clone)
    }
    pub fn salary_preferences(&self) -> Result<&Arc<RawSalaryPaymentPreferences>, FactError> {
        self.salary_preferences
            .get_or_init(|| {
                let row = self
                    .raw_nullable(SourceKind::SalaryPaymentPreferences)?
                    .map(|v| Arc::new(v.clone()));
                RawSalaryPaymentPreferences::try_from_row(row)
                    .map(Arc::new)
                    .map_err(FactError::Finance)
            })
            .as_ref()
            .map_err(Clone::clone)
    }
    pub fn test_months(&self) -> Result<&Arc<RawTestMonths>, FactError> {
        self.test_months
            .get_or_init(|| {
                let kind = SourceKind::TestMonths;
                let rows = self
                    .raw(kind)?
                    .as_array()
                    .ok_or(FactError::InvalidShape(kind))?;
                RawTestMonths::try_from_rows(Arc::new(rows.clone()))
                    .map(Arc::new)
                    .map_err(FactError::Finance)
            })
            .as_ref()
            .map_err(Clone::clone)
    }
    /// Shared monetary caches are owned by this immutable snapshot. No native
    /// registry/lifecycle mutex is held during setup or monetary calculation.
    pub fn financial_context(
        &self,
    ) -> Result<&Arc<Mutex<FinancialContext<'static>>>, FinancialSourceError> {
        self.financial_context
            .get_or_init(|| {
                financial_source::from_facts(self).map(|context| Arc::new(Mutex::new(context)))
            })
            .as_ref()
            .map_err(Clone::clone)
    }
    /// Reuse native month results across independent report sessions. The
    /// book's bounded cache never holds a lock while a month is calculated.
    pub fn assessed_book(&self) -> Result<&Arc<AssessedSourceBook>, FinancialSourceError> {
        self.assessed_book
            .get_or_init(|| assessed_source::from_facts(self).map(Arc::new))
            .as_ref()
            .map_err(Clone::clone)
    }
    pub fn time_context(&self) -> Result<&Arc<Mutex<TimeReportContext>>, TimeSourceError> {
        self.time_context
            .get_or_init(|| {
                time_source::from_facts(self).map(|context| Arc::new(Mutex::new(context)))
            })
            .as_ref()
            .map_err(Clone::clone)
    }
    pub fn actual_annual_payments(&self) -> Result<&Arc<RawActualAnnualPayments>, FactError> {
        self.actual_annual_payments
            .get_or_init(|| {
                let kind = SourceKind::ActualAnnualPayments;
                let rows = self
                    .raw(kind)?
                    .as_array()
                    .ok_or(FactError::InvalidShape(kind))?;
                RawActualAnnualPayments::try_from_rows(Arc::new(rows.clone()))
                    .map(Arc::new)
                    .map_err(FactError::Annual)
            })
            .as_ref()
            .map_err(Clone::clone)
    }
    pub fn tariff_annual_claims(&self) -> Result<&Arc<RawTariffAnnualClaims>, FactError> {
        self.tariff_annual_claims
            .get_or_init(|| {
                let kind = SourceKind::TariffAnnualClaims;
                let rows = self
                    .raw(kind)?
                    .as_array()
                    .ok_or(FactError::InvalidShape(kind))?;
                RawTariffAnnualClaims::try_from_rows(Arc::new(rows.clone()))
                    .map(Arc::new)
                    .map_err(FactError::Annual)
            })
            .as_ref()
            .map_err(Clone::clone)
    }
    pub fn training_profiles(&self) -> Result<&Arc<RawTrainingProfiles>, FactError> {
        self.training_profiles
            .get_or_init(|| {
                let kind = SourceKind::TrainingProfiles;
                let rows = self
                    .raw(kind)?
                    .as_array()
                    .ok_or(FactError::InvalidShape(kind))?;
                RawTrainingProfiles::try_from_rows(Arc::new(rows.clone()))
                    .map(Arc::new)
                    .map_err(FactError::Training)
            })
            .as_ref()
            .map_err(Clone::clone)
    }
    pub fn training_details(&self) -> Result<&Arc<RawShiftTraining>, FactError> {
        self.training_details
            .get_or_init(|| {
                let kind = SourceKind::TrainingShiftDetails;
                let rows = self
                    .raw(kind)?
                    .as_array()
                    .ok_or(FactError::InvalidShape(kind))?;
                RawShiftTraining::try_from_rows(Arc::new(rows.clone()))
                    .map(Arc::new)
                    .map_err(FactError::Training)
            })
            .as_ref()
            .map_err(Clone::clone)
    }
    pub fn annex_pause_details(&self) -> Result<&Arc<RawShiftTraining>, FactError> {
        self.annex_pause_details
            .get_or_init(|| {
                let kind = SourceKind::AnnexAPauseDetails;
                let rows = self
                    .raw(kind)?
                    .as_array()
                    .ok_or(FactError::InvalidShape(kind))?;
                RawShiftTraining::try_from_rows(Arc::new(rows.clone()))
                    .map(Arc::new)
                    .map_err(FactError::Training)
            })
            .as_ref()
            .map_err(Clone::clone)
    }
    fn remuneration_rows<'a>(
        &'a self,
        kind: SourceKind,
        rows_kind: RemunerationRowsKind,
        cell: &'a OnceLock<Result<Arc<RawRemunerationRows>, FactError>>,
    ) -> Result<&'a Arc<RawRemunerationRows>, FactError> {
        cell.get_or_init(|| {
            let rows = self
                .raw(kind)?
                .as_array()
                .ok_or(FactError::InvalidShape(kind))?;
            RawRemunerationRows::try_from_rows(rows_kind, Arc::new(rows.clone()))
                .map(Arc::new)
                .map_err(FactError::Remuneration)
        })
        .as_ref()
        .map_err(Clone::clone)
    }
    pub fn paid_absences(&self) -> Result<&Arc<RawRemunerationRows>, FactError> {
        self.remuneration_rows(
            SourceKind::PaidAbsences,
            RemunerationRowsKind::PaidAbsences,
            &self.paid_absences,
        )
    }
    pub fn overtime_allocations(&self) -> Result<&Arc<RawRemunerationRows>, FactError> {
        self.remuneration_rows(
            SourceKind::OvertimeAllocations,
            RemunerationRowsKind::OvertimeAllocations,
            &self.overtime_allocations,
        )
    }
    pub fn scoped_allowances(&self) -> Result<&Arc<RawRemunerationRows>, FactError> {
        self.remuneration_rows(
            SourceKind::ScopedAllowanceDecisions,
            RemunerationRowsKind::ScopedAllowances,
            &self.scoped_allowances,
        )
    }
    pub fn draft_evidence(&self, kind: DraftRowsKind) -> Result<&Arc<RawDraftRows>, FactError> {
        let (index, source) = match kind {
            DraftRowsKind::AnnexAMonth => (0, SourceKind::AnnexAMonthConfirmations),
            DraftRowsKind::AnnexAPremium => (1, SourceKind::AnnexAPremiumFacts),
            DraftRowsKind::SueMonth => (2, SourceKind::SueMonthConfirmations),
            DraftRowsKind::SueAllowance => (3, SourceKind::SueAllowanceConfirmations),
            DraftRowsKind::TvlShiftWork => (4, SourceKind::TvlShiftWork),
            DraftRowsKind::DrkEmployee => (5, SourceKind::DrkEmployeeMonthConfirmations),
            DraftRowsKind::DrkTraining => (6, SourceKind::DrkTrainingMonthConfirmations),
            DraftRowsKind::CaritasMonth => (7, SourceKind::CaritasMonthFacts),
            DraftRowsKind::CaritasWorkDay => (8, SourceKind::CaritasWorkDays),
            DraftRowsKind::CaritasOvertime => (9, SourceKind::CaritasOvertimeConfirmations),
        };
        self.draft_rows[index]
            .get_or_init(|| {
                let rows = self
                    .raw(source)?
                    .as_array()
                    .ok_or(FactError::InvalidShape(source))?;
                RawDraftRows::try_from_rows(kind, Arc::new(rows.clone()))
                    .map(Arc::new)
                    .map_err(FactError::Draft)
            })
            .as_ref()
            .map_err(Clone::clone)
    }
    /// Only resolver-dependent work calls this getter. Legal/check sources are
    /// not made a prerequisite of basic calendar facts or work-profile access.
    pub fn catalog(&self) -> Result<&RuntimeCatalog, CatalogSourceError> {
        self.catalog
            .get_or_init(|| catalog_source::from_snapshot(&self.snapshot))
            .as_ref()
            .map_err(Clone::clone)
    }
}
