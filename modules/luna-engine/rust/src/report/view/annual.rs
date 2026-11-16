//! Explicit field ownership prevents one section from replacing another's month.
use super::{AnnualReportOverlay, fields, required};
use crate::runtime::report::{ReportIssue, SectionOutput};
use serde_json::{Value, json};
pub(crate) fn time(value: &Value) -> Result<Value, ReportIssue> {
    let mut report = fields(
        value,
        &[
            "year",
            "workMinutes",
            "trainingMinutes",
            "vacationDays",
            "sickDays",
            "freeDays",
            "entryCount",
            "activeMonthCount",
            "distribution",
            "actualMinutes",
            "targetMinutes",
            "targetStatus",
            "balanceMinutes",
            "timeAccountMinutes",
            "shiftTypeAnalysis",
            "worktimeCoverageComplete",
        ],
    );
    report["months"] = json!(
        required(value, "months")?
            .as_array()
            .ok_or_else(|| ReportIssue::new("VIEW_OUTPUT_INVALID"))?
            .iter()
            .map(|m| fields(
                m,
                &[
                    "month",
                    "entryCount",
                    "targetMinutes",
                    "targetStatus",
                    "actualMinutes",
                    "timeAccountMinutes",
                    "balanceMinutes"
                ]
            ))
            .collect::<Vec<_>>()
    );
    Ok(json!(AnnualReportOverlay {
        annual_report: report,
        annual_payments_state: None,
        training_state: None
    }))
}
pub(crate) fn gross(value: &Value, annual_payments_state: Value) -> Result<Value, ReportIssue> {
    let mut report = fields(
        value,
        &[
            "year",
            "salarySource",
            "availablePayMonthCount",
            "estimatedGrossAmount",
            "premiumAmount",
            "overtimeAmount",
            "allowanceAmount",
            "annualPaymentAmount",
        ],
    );
    report["months"] = json!(
        required(value, "months")?
            .as_array()
            .ok_or_else(|| ReportIssue::new("VIEW_OUTPUT_INVALID"))?
            .iter()
            .map(|m| fields(
                m,
                &[
                    "month",
                    "timePremiumAmount",
                    "estimatedGrossAmount",
                    "premiumAmount",
                    "annualPaymentAmount"
                ]
            ))
            .collect::<Vec<_>>()
    );
    Ok(json!(AnnualReportOverlay {
        annual_report: report,
        annual_payments_state: Some(annual_payments_state),
        training_state: None
    }))
}
pub(crate) fn checks(value: &Value) -> Result<Value, ReportIssue> {
    let mut report = fields(
        value,
        &[
            "year",
            "criticalCount",
            "warningCount",
            "complianceCoverageComplete",
        ],
    );
    report["months"] = required(value, "months")?.clone();
    let display = |show| {
        SectionOutput::from_result(
            crate::compliance::checks::select_annual_check_display(&report, show)
                .map_err(|_| ReportIssue::new("CHECKS_DISPLAY_INVALID")),
        )
    };
    let visible = display(true);
    let hidden = display(false);
    let mut output = json!(AnnualReportOverlay {
        annual_report: report,
        annual_payments_state: None,
        training_state: Some(required(value, "trainingState")?.clone())
    });
    output["planningVisibleAnnualReport"] = json!(visible);
    output["planningHiddenAnnualReport"] = json!(hidden);
    Ok(output)
}
