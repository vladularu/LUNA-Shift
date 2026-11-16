//! Worker-only domain composition. It never publishes a result by itself.
//! Cancellation is checked between sections and periods; Work::finish must
//! separately fence the completed result before a transport may return it.
use super::financial_collation::{FinancialAdmissionProof, FinancialPoolError};
use super::{
    jobs::{JobError, Work},
    report::SectionOutput,
    view_composition::{SectionPresentation, ViewCompositionSource},
};
use crate::contract::{self, CalculationRequest, ReportPeriod};
use serde::Serialize;
use std::sync::Arc;

#[derive(Debug, Serialize)]
pub struct ReportSections {
    pub time: SectionOutput,
    pub gross: SectionOutput,
    pub net: SectionOutput,
    pub checks: SectionOutput,
    #[serde(rename = "financialDetails", skip_serializing_if = "Option::is_none")]
    pub financial_details: Option<SectionOutput>,
    #[serde(rename = "exportReport", skip_serializing_if = "Option::is_none")]
    pub export_report: Option<SectionOutput>,
    #[serde(rename = "checksDetails", skip_serializing_if = "Option::is_none")]
    pub checks_details: Option<SectionOutput>,
}
#[derive(Debug, Serialize)]
pub struct PeriodReport {
    pub period: ReportPeriod,
    pub sections: ReportSections,
    pub views: ReportViews,
}
#[derive(Debug, Serialize)]
pub struct ReportViews {
    pub core: SectionOutput,
    pub time: SectionOutput,
    pub gross: SectionOutput,
    pub net: SectionOutput,
    pub checks: SectionOutput,
    #[serde(rename = "financialDetails", skip_serializing_if = "Option::is_none")]
    pub financial_details: Option<SectionOutput>,
    #[serde(rename = "payrollPage", skip_serializing_if = "Option::is_none")]
    pub payroll_page: Option<SectionOutput>,
    #[serde(rename = "payrollPageUi", skip_serializing_if = "Option::is_none")]
    pub payroll_page_ui: Option<SectionOutput>,
    #[serde(rename = "payrollPanel", skip_serializing_if = "Option::is_none")]
    pub payroll_panel: Option<SectionOutput>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputedCalculation {
    wire_schema_version: u32,
    engine_version: &'static str,
    calculation_contract_version: &'static str,
    #[serde(serialize_with = "crate::contract::financial_details::serialize_public_request")]
    request: CalculationRequest,
    reports: Vec<PeriodReport>,
    #[serde(skip)]
    financial_details_proof: Option<Arc<FinancialAdmissionProof>>,
}
impl ComputedCalculation {
    pub(crate) fn is_export_report(&self) -> bool {
        self.request.export_report().is_some()
    }
    pub(crate) fn requires_large_output(&self) -> bool {
        self.is_export_report() || self.request.checks_details().is_some()
    }
    #[cfg(test)]
    pub(crate) fn replace_export_artifact_for_writer_test(&mut self, value: serde_json::Value) {
        assert!(self.is_export_report());
        self.reports[0].sections.export_report = Some(SectionOutput::Ready { value });
    }
    pub fn financial_details_proof(&self) -> Option<&Arc<FinancialAdmissionProof>> {
        self.financial_details_proof.as_ref()
    }
    pub fn financial_details_is_current(&self) -> Result<bool, FinancialPoolError> {
        self.financial_details_proof
            .as_ref()
            .map(|p| p.is_current())
            .transpose()
            .map(|current| current.unwrap_or(true))
    }
    pub fn matches_request(&self, request: &CalculationRequest) -> bool {
        &self.request == request
    }
}

fn not_requested() -> SectionPresentation {
    SectionPresentation {
        output: SectionOutput::NotRequested {},
        overlay: SectionOutput::NotRequested {},
        core: None,
    }
}

pub fn calculate(work: &Work) -> Result<Option<ComputedCalculation>, JobError> {
    if !work.is_current()? {
        return Ok(None);
    }
    let lease = work.lease();
    let request = lease.request();
    let requested = request.sections();
    // Reservations/publication slots are lane-specific. A valid mixed request
    // must never execute an unreserved section on the other physical worker.
    let finance_lane = lease.lane() == super::JobLane::Finance;
    let source = ViewCompositionSource::from_facts(lease.facts());
    let mut reports = Vec::with_capacity(request.periods().len());
    for period in request.periods() {
        if !work.is_current()? {
            return Ok(None);
        }
        let time = if finance_lane && requested.time() {
            source.time(period)
        } else {
            not_requested()
        };
        if !work.is_current()? {
            return Ok(None);
        }
        let gross = if finance_lane && requested.gross() {
            source.gross(period, request.perspective())
        } else {
            not_requested()
        };
        if !work.is_current()? {
            return Ok(None);
        }
        let net = if finance_lane && requested.net() {
            source.net(period, request.perspective())
        } else {
            not_requested()
        };
        if !work.is_current()? {
            return Ok(None);
        }
        let checks = if !finance_lane && requested.checks() {
            source.checks(period)
        } else {
            not_requested()
        };
        if !work.is_current()? {
            return Ok(None);
        }
        let (financial_details, financial_details_view) = if let Some(intent) =
            request.financial_details()
        {
            if lease.lane() != super::JobLane::Finance {
                return Err(super::RegistryError::InvalidLane.into());
            }
            let ReportPeriod::Month { month } = period else {
                return Err(super::RegistryError::InvalidFinancialProof.into());
            };
            let proof = lease
                .financial_details()
                .ok_or(super::RegistryError::FinancialProofRequired)?;
            let value = super::financial_report::presentation::details_with_collation(
                lease.facts(),
                month,
                request.perspective(),
                intent.filter(),
                intent.include_special_duty_pay(),
                proof.ranks(),
            );
            match value {
                Ok((details, view)) => (Some(SectionOutput::Ready { value: details }), Some(view)),
                Err(reason) => (
                    Some(SectionOutput::Unavailable {
                        reason: reason.clone(),
                    }),
                    Some(SectionOutput::Unavailable { reason }),
                ),
            }
        } else {
            (None, None)
        };
        if !work.is_current()? {
            return Ok(None);
        }
        let (payroll_page, payroll_page_ui) = if request.payroll_page() {
            if !finance_lane {
                return Err(super::RegistryError::InvalidLane.into());
            }
            let ReportPeriod::Month { month } = period else {
                return Err(super::RegistryError::InvalidLane.into());
            };
            match super::financial_report::payroll::calculate_with_ui(lease.facts(), month) {
                Ok(output) => (
                    Some(SectionOutput::Ready { value: output.page }),
                    Some(SectionOutput::Ready { value: output.ui }),
                ),
                Err(reason) => (
                    Some(SectionOutput::Unavailable {
                        reason: reason.clone(),
                    }),
                    Some(SectionOutput::Unavailable { reason }),
                ),
            }
        } else {
            (None, None)
        };
        if !work.is_current()? {
            return Ok(None);
        }
        let payroll_panel = if let Some(panel) = request.payroll_panel() {
            if !finance_lane {
                return Err(super::RegistryError::InvalidLane.into());
            }
            let ReportPeriod::Month { month } = period else {
                return Err(super::RegistryError::InvalidLane.into());
            };
            Some(SectionOutput::from_result(
                super::financial_report::payroll::calculate_panel(lease.facts(), month, panel).map(
                    |mut value| {
                        if panel == crate::contract::PayrollPanel::TariffAssessment {
                            value["month"] = serde_json::json!(month);
                            value["panel"] = serde_json::json!(panel);
                            value
                        } else {
                            serde_json::json!({"month":month,"panel":panel,"blocks":value})
                        }
                    },
                ),
            ))
        } else {
            None
        };
        if !work.is_current()? {
            return Ok(None);
        }
        let export_report = if let Some(intent) = request.export_report() {
            if !finance_lane {
                return Err(super::RegistryError::InvalidLane.into());
            }
            Some(SectionOutput::from_result(
                super::export_report::direct::calculate(lease.facts(), period, intent),
            ))
        } else {
            None
        };
        if !work.is_current()? {
            return Ok(None);
        }
        let checks_details = if let Some(intent) = request.checks_details() {
            if finance_lane {
                return Err(super::RegistryError::InvalidLane.into());
            }
            let ReportPeriod::Month { month } = period else {
                return Err(super::RegistryError::InvalidLane.into());
            };
            Some(SectionOutput::from_result(
                crate::compliance::details::profile::calculate(lease.facts(), month, intent),
            ))
        } else {
            None
        };
        if !work.is_current()? {
            return Ok(None);
        }
        reports.push(PeriodReport {
            period: period.clone(),
            sections: ReportSections {
                time: time.output,
                gross: gross.output,
                net: net.output,
                checks: checks.output,
                financial_details,
                export_report,
                checks_details,
            },
            views: ReportViews {
                core: time.core.unwrap_or(SectionOutput::NotRequested {}),
                time: time.overlay,
                gross: gross.overlay,
                net: net.overlay,
                checks: checks.overlay,
                financial_details: financial_details_view,
                payroll_page,
                payroll_page_ui,
                payroll_panel,
            },
        });
    }
    if !work.is_current()? {
        return Ok(None);
    }
    Ok(Some(ComputedCalculation {
        wire_schema_version: contract::SCHEMA_VERSION,
        engine_version: crate::ENGINE_VERSION,
        calculation_contract_version: contract::CONTRACT_VERSION,
        request: request.clone(),
        reports,
        financial_details_proof: lease.financial_details().cloned(),
    }))
}
