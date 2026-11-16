//! Independent platform-local native presentations. Never a cross-Wasm book,
//! never a constructor receiving calculated host values or Ready flags.
use super::{
    facts::SnapshotFacts,
    report::{ReportIssue, SectionOutput},
};
mod monthly_salary;
use crate::compliance::selection::PreparedComplianceEntries;
use crate::contract::{ReportPeriod, SalaryPerspective};
use crate::{
    compliance::model::ComplianceError,
    report::{
        computation::Computation,
        financial::{
            FinancialError,
            annual_salary::annual_salary_forecast,
            gross::{annual_legacy_financial_report, with_annual_salary_payments},
        },
        view::{annual, dated, monthly},
    },
    rules::holidays::HolidayError,
};
use serde::Serialize;
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicUsize, Ordering},
    },
};
#[derive(Default)]
pub struct ViewContextCache {
    entries: OnceLock<Result<PreparedComplianceEntries, ReportIssue>>,
    cores: Mutex<VecDeque<(i32, Arc<Value>, u64)>>,
    core_computations: AtomicUsize,
    index_builds: AtomicUsize,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewPreparationStats {
    pub core_computations: usize,
    pub legal_index_builds: usize,
    pub cached_core_years: usize,
}
fn financial_source(error: super::financial_source::FinancialSourceError) -> ReportIssue {
    use super::financial_source::FinancialSourceError as Error;
    match error {
        Error::Facts(e) => e.into(),
        Error::Catalog(e) => e.into(),
        Error::MissingProfile => ReportIssue::new("PROFILE_MISSING"),
        Error::InvalidNativeInput => ReportIssue::new("FINANCIAL_INPUT_INVALID"),
    }
}
fn financial_calculation(error: FinancialError) -> ReportIssue {
    ReportIssue::new(if error.rule_failure {
        "FINANCIAL_RULES_UNAVAILABLE"
    } else {
        "FINANCIAL_CALCULATION_FAILED"
    })
}
fn unavailable(output: &SectionOutput) -> SectionOutput {
    match output {
        SectionOutput::NotRequested {} => SectionOutput::NotRequested {},
        SectionOutput::Unavailable { reason } => SectionOutput::Unavailable {
            reason: reason.clone(),
        },
        SectionOutput::Ready { .. } => SectionOutput::Unavailable {
            reason: ReportIssue::new("VIEW_OUTPUT_INVALID"),
        },
    }
}
fn json_value(value: &impl Serialize) -> Result<Value, ReportIssue> {
    serde_json::to_value(value).map_err(|_| ReportIssue::new("VIEW_OUTPUT_INVALID"))
}

#[derive(Debug)]
pub struct SectionPresentation {
    /// Original C/S5 section payload; the presentation is an additional sibling.
    pub output: SectionOutput,
    pub overlay: SectionOutput,
    /// Original provisional AnnualReport, independent of target/finance/checks.
    pub core: Option<SectionOutput>,
}
pub struct ViewCompositionSource<'a> {
    facts: &'a SnapshotFacts,
}
impl<'a> ViewCompositionSource<'a> {
    pub fn from_facts(facts: &'a SnapshotFacts) -> Self {
        Self { facts }
    }
    /// Optional provisional paint path; does not load/validate the target source.
    pub fn core_year(&self, year: i32) -> SectionOutput {
        SectionOutput::from_result(self.core(year))
    }
    pub fn preparation_stats(&self) -> Result<ViewPreparationStats, ReportIssue> {
        let cache = self.facts.view_context();
        Ok(ViewPreparationStats {
            core_computations: cache.core_computations.load(Ordering::Relaxed),
            legal_index_builds: cache.index_builds.load(Ordering::Relaxed),
            cached_core_years: cache
                .cores
                .lock()
                .map_err(|_| ReportIssue::new("VIEW_CACHE_UNAVAILABLE"))?
                .len(),
        })
    }
    pub fn time(&self, period: &ReportPeriod) -> SectionPresentation {
        // Core has no target, money or check readiness dependency.
        let core = match period {
            ReportPeriod::Year { year } => {
                Some(SectionOutput::from_result(self.core(i32::from(*year))))
            }
            _ => None,
        };
        let output = SectionOutput::from_result(self.time_value(period));
        let mut overlay = match &output {
            SectionOutput::Ready { value } => SectionOutput::from_result(match period {
                ReportPeriod::Month { month } => self
                    .compliance_shifts(month)
                    .and_then(|shifts| monthly::time(value, shifts)),
                ReportPeriod::Year { .. } => annual::time(value),
            }),
            _ => unavailable(&output),
        };
        if let ReportPeriod::Month { month } = period {
            overlay = super::target_ui::with_time_overlay(
                super::time_ui::with_month_overlay(overlay),
                super::target_ui::time_presentation(self.facts, month),
            );
        } else {
            overlay = super::time_ui::with_year_overlay(overlay, &output, core.as_ref());
        }
        SectionPresentation {
            output,
            overlay,
            core,
        }
    }
    pub fn gross(
        &self,
        period: &ReportPeriod,
        perspective: SalaryPerspective,
    ) -> SectionPresentation {
        let output = SectionOutput::from_result(super::financial_report::gross(
            self.facts,
            period,
            perspective,
        ));
        let dated = dated::presentation(self.facts, period, &output)
            .unwrap_or_else(|reason| json!(SectionOutput::Unavailable { reason }));
        let field = match period {
            ReportPeriod::Month { .. } => "datedMonthlyRemuneration",
            ReportPeriod::Year { .. } => "datedAnnualReport",
        };
        let overlay = match self.gross_view(period) {
            Ok(mut value) => {
                value[field] = dated;
                SectionOutput::Ready { value }
            }
            Err(reason) if matches!(output, SectionOutput::Ready { .. }) => SectionOutput::Ready {
                value: json!({"legacyState":SectionOutput::Unavailable {reason},field:dated}),
            },
            Err(reason) => SectionOutput::Unavailable { reason },
        };
        SectionPresentation {
            output,
            overlay,
            core: None,
        }
    }
    pub fn checks(&self, period: &ReportPeriod) -> SectionPresentation {
        let output = SectionOutput::from_result((|| {
            let owner = self.facts.checks_context()?;
            let value = match period {
                ReportPeriod::Month { month } => owner.month_shared(month)?,
                ReportPeriod::Year { year } => owner.year_shared(i32::from(*year))?,
            };
            Ok(value.as_ref().clone())
        })());
        let overlay = match &output {
            SectionOutput::Ready { value } => SectionOutput::from_result(match period {
                ReportPeriod::Month { .. } => monthly::checks(value),
                ReportPeriod::Year { .. } => annual::checks(value),
            }),
            _ => unavailable(&output),
        };
        SectionPresentation {
            output,
            overlay,
            core: None,
        }
    }
    pub fn net(
        &self,
        period: &ReportPeriod,
        perspective: SalaryPerspective,
    ) -> SectionPresentation {
        let output = SectionOutput::from_result(super::financial_report::net(
            self.facts,
            period,
            perspective,
        ));
        let overlay = match period {
            ReportPeriod::Month { month } => {
                let mut value = monthly_salary::frames(self.facts, month, perspective, &output);
                match &output {
                    SectionOutput::Ready { value: net } => value["monthlyNetPay"] = net.clone(),
                    _ => value["legacyState"] = json!(unavailable(&output)),
                }
                SectionOutput::Ready { value }
            }
            ReportPeriod::Year { .. } => match &output {
                SectionOutput::Ready { value } => SectionOutput::Ready {
                    value: json!({"annualNetPay":value,"annualNetAmountDisplay":SectionOutput::from_result(super::financial_report::annual_display::net_amounts(value))}),
                },
                _ => unavailable(&output),
            },
        };
        SectionPresentation {
            output,
            overlay,
            core: None,
        }
    }
    fn time_value(&self, period: &ReportPeriod) -> Result<Value, ReportIssue> {
        use super::time_source::TimeSourceError as Error;
        let owner = self.facts.time_context().map_err(|error| match error {
            Error::Facts(e) => ReportIssue::from(e),
            Error::Catalog(e) => ReportIssue::from(e),
            Error::MissingProfile => ReportIssue::new("PROFILE_MISSING"),
            Error::InvalidNativeInput => ReportIssue::new("TIME_INPUT_INVALID"),
        })?;
        let mut context = owner
            .lock()
            .map_err(|_| ReportIssue::new("TIME_CONTEXT_UNAVAILABLE"))?;
        match period {
            ReportPeriod::Month { month } => json_value(
                context
                    .month_shared(month)
                    .map_err(|_| ReportIssue::new("TIME_CALCULATION_FAILED"))?
                    .as_ref(),
            ),
            ReportPeriod::Year { year } => Ok(context
                .annual_shared(i32::from(*year))
                .map_err(|_| ReportIssue::new("TIME_CALCULATION_FAILED"))?
                .as_ref()
                .clone()),
        }
    }
    fn compliance_shifts(&self, month: &str) -> Result<Value, ReportIssue> {
        let resolver = self.facts.catalog().map_err(ReportIssue::from)?.resolver();
        // Exactly the original MonthlyAnalysis.prepare guard before selecting
        // the wider legal/planning window; no adult/youth calculation required.
        if let Err(failure) = resolver.resolve_holiday(&format!("{month}-01")) {
            return json_value(&Computation::<Value>::rule(&failure));
        }
        let cache = self.facts.view_context();
        let source = cache
            .entries
            .get_or_init(|| {
                let calendar = self.facts.calendar().map_err(ReportIssue::from)?;
                cache.index_builds.fetch_add(1, Ordering::Relaxed);
                PreparedComplianceEntries::from_shared(Arc::clone(calendar.entries()))
                    .map_err(|_| ReportIssue::new("CHECKS_INPUT_INVALID"))
            })
            .as_ref()
            .map_err(Clone::clone)?;
        match source.select(month, resolver) {
            Ok(shifts) => json_value(&Computation::Ready(shifts)),
            Err(ComplianceError::Rules(failure)) => {
                json_value(&Computation::<Value>::rule(&failure))
            }
            Err(ComplianceError::Holiday(HolidayError::Resolution(failure))) => {
                json_value(&Computation::<Value>::rule(&failure))
            }
            Err(_) => Err(ReportIssue::new("CHECKS_CALCULATION_FAILED")),
        }
    }
    fn core(&self, year: i32) -> Result<Value, ReportIssue> {
        if !(1900..=4099).contains(&year) {
            return Err(ReportIssue::new("VIEW_PERIOD_INVALID"));
        }
        let cache = self.facts.view_context();
        {
            let mut cores = cache
                .cores
                .lock()
                .map_err(|_| ReportIssue::new("VIEW_CACHE_UNAVAILABLE"))?;
            if let Some(index) = cores.iter().position(|(y, _, _)| *y == year) {
                let item = cores.remove(index).expect("located core");
                let output = Arc::clone(&item.1);
                cores.push_back(item);
                return Ok(output.as_ref().clone());
            }
        }
        let stored = self
            .facts
            .profile()
            .map_err(ReportIssue::from)?
            .ok_or_else(|| ReportIssue::new("PROFILE_MISSING"))?;
        let profile = stored.flat_profile();
        let history = self.facts.employment_history().map_err(ReportIssue::from)?;
        let overlay = crate::employment::employment_overlay_from_profiles(
            profile.get("salaryBasisConflict"),
            history.profiles(),
            self.facts
                .profile_projection_date()
                .map_err(ReportIssue::from)?,
        )
        .map_err(|_| ReportIssue::new("PROFILE_INVALID"))?;
        let zone = overlay
            .and_then(|v| v.get("timeZone"))
            .or_else(|| profile.get("timeZone"))
            .and_then(Value::as_str)
            .ok_or_else(|| ReportIssue::new("PROFILE_INVALID"))?;
        let calendar = self.facts.calendar().map_err(ReportIssue::from)?;
        let output = Arc::new(
            crate::report::core::build_annual_core_report(
                year,
                calendar.entries(),
                &json!({"timeZone":zone}),
                calendar.collation(),
            )
            .map_err(|_| ReportIssue::new("CORE_CALCULATION_FAILED"))?,
        );
        cache.core_computations.fetch_add(1, Ordering::Relaxed);
        if let Some(bytes) =
            crate::report::cache_budget::serialized_bytes(output.as_ref(), 4 * 1024 * 1024)
        {
            let mut cores = cache
                .cores
                .lock()
                .map_err(|_| ReportIssue::new("VIEW_CACHE_UNAVAILABLE"))?;
            if let Some(index) = cores.iter().position(|(y, _, _)| *y == year) {
                cores.remove(index);
            }
            while cores.len() >= 3
                || cores.iter().map(|(_, _, b)| *b).sum::<u64>() + bytes > 16 * 1024 * 1024
            {
                cores.pop_front();
            }
            cores.push_back((year, Arc::clone(&output), bytes));
        }
        Ok(output.as_ref().clone())
    }
    fn gross_view(&self, period: &ReportPeriod) -> Result<Value, ReportIssue> {
        // Supplement state is independent of base earned gross; a missing tax
        // setup cannot turn a valid salary into an unavailable/zero amount.
        let timeline =
            matches!(period, ReportPeriod::Year { .. }).then(|| self.facts.net_settings());
        let owner = self.facts.financial_context().map_err(financial_source)?;
        let mut context = owner
            .lock()
            .map_err(|_| ReportIssue::new("FINANCIAL_CONTEXT_UNAVAILABLE"))?;
        match period {
            ReportPeriod::Month { month } => {
                let blocked = context.test_months().contains(month);
                let (pay, page) = match context.salary_month(month) {
                    Ok(source) => (
                        json_value(&Computation::Ready(source.pay()))?,
                        SectionOutput::from_result(
                            super::financial_report::earned_services_page::present(
                                month,
                                source.profile(),
                                source.pay(),
                                blocked,
                            ),
                        ),
                    ),
                    Err(error) => {
                        if let Some(failure) = error.rule_failure_details() {
                            (
                                json_value(&Computation::<Value>::rule(failure))?,
                                SectionOutput::NotRequested {},
                            )
                        } else {
                            return Err(financial_calculation(error));
                        }
                    }
                };
                let mut overlay = monthly::gross(pay);
                overlay["earnedServicesPageUi"] = json!(page);
                Ok(overlay)
            }
            ReportPeriod::Year { year } => {
                let year = i32::from(*year);
                let base = annual_legacy_financial_report(year, &mut context)
                    .map_err(financial_calculation)?;
                let base_ui = annual::gross(&json_value(&base)?, json!({"state":"NOT_REQUESTED"}))?
                    ["annualReport"]
                    .take();
                let (report, state) = match timeline.expect("annual timeline option") {
                    Err(error) => {
                        let issue = ReportIssue::from(error);
                        let state = if issue.code == "SOURCE_NOT_REQUESTED" {
                            json!({"state":"NOT_REQUESTED"})
                        } else {
                            json!({"state":"UNAVAILABLE","reason":issue})
                        };
                        (base, state)
                    }
                    Ok(timeline) => {
                        let supplement = (|| {
                            let saved = crate::net::settings::collect_annual_salary_payments(
                                timeline.timeline(),
                            )
                            .map_err(|_| ReportIssue::new("ANNUAL_INPUT_INVALID"))?;
                            let saved = saved
                                .as_array()
                                .ok_or_else(|| ReportIssue::new("ANNUAL_INPUT_INVALID"))?;
                            let forecast = annual_salary_forecast(year, &mut context, saved)
                                .map_err(financial_calculation)?;
                            let payments =
                                crate::net::annual_payment::validate_annual_salary_payments(
                                    &forecast["payments"],
                                )
                                .map_err(|_| ReportIssue::new("ANNUAL_INPUT_INVALID"))?;
                            let report = with_annual_salary_payments(
                                &base,
                                timeline.timeline(),
                                Some(&payments),
                            )
                            .map_err(financial_calculation)?;
                            Ok::<_, ReportIssue>((
                                report,
                                json!({"state":"READY","value":forecast}),
                            ))
                        })();
                        match supplement {
                            Ok(value) => value,
                            Err(reason) => (base, json!({"state":"UNAVAILABLE","reason":reason})),
                        }
                    }
                };
                let supplement_ready = state["state"] == "READY";
                let supplement_failure = (!supplement_ready).then(|| state.clone());
                let mut overlay = annual::gross(&json_value(&report)?, state)?;
                // The original annual UI suppresses one-off supplements when
                // the displayed year contains a test month. Monthly salary
                // consumers retain the separate original forecast frame.
                let prefix = format!("{year}-");
                let blocked = self
                    .facts
                    .test_months()
                    .map_err(ReportIssue::from)?
                    .months()
                    .iter()
                    .any(|month| month.starts_with(&prefix));
                overlay["annualSalaryPolicy"] = json!({"allowAnnualPayments":!blocked});
                overlay["annualBaseReport"] = json!({"state":"READY","value":base_ui});
                overlay["annualSalaryUiReport"] = if blocked {
                    overlay["annualBaseReport"].clone()
                } else if supplement_ready {
                    json!({"state":"READY","value":overlay["annualReport"]})
                } else {
                    supplement_failure.expect("unavailable supplement state")
                };
                overlay["annualFinancialOverview"] =
                    if overlay["annualSalaryUiReport"]["state"] == "READY" {
                        json!(SectionOutput::from_result(
                            super::financial_report::annual_display::gross_overview(
                                &overlay["annualSalaryUiReport"]["value"],
                            ),
                        ))
                    } else {
                        overlay["annualSalaryUiReport"].clone()
                    };
                let salary_details = if overlay["annualSalaryUiReport"]["state"] == "READY" {
                    json!(SectionOutput::from_result(
                        super::financial_report::annual_details::salary(
                            &overlay["annualSalaryUiReport"]["value"],
                        ),
                    ))
                } else {
                    overlay["annualSalaryUiReport"].clone()
                };
                let base = &overlay["annualBaseReport"]["value"];
                let premium_details = SectionOutput::from_result(
                    super::financial_report::annual_details::premium(base, false),
                );
                let pending_premium_details = SectionOutput::from_result(
                    super::financial_report::annual_details::premium(base, true),
                );
                overlay["annualFinancialDetails"] = json!({
                    "salary":salary_details,
                    "premium":premium_details,
                    "pending":pending_premium_details
                });
                Ok(overlay)
            }
        }
    }
}
