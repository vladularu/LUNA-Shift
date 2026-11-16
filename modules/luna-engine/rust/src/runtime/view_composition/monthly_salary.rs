//! Original monthly overview selection only. Existing native producers own
//! projection, annual forecast, cents and taxes; no second financial engine.
use crate::{
    contract::SalaryPerspective,
    net::settings::collect_annual_salary_payments,
    runtime::{
        facts::SnapshotFacts,
        report::{ReportIssue, SectionOutput},
    },
};
use serde_json::{Value, json};

fn inputs(facts: &SnapshotFacts, month: &str) -> Result<Value, ReportIssue> {
    let timeline = facts.net_settings()?;
    let saved = timeline
        .resolve(month)
        .map_err(|_| ReportIssue::new("NET_SETTINGS_INVALID"))?;
    let payments = collect_annual_salary_payments(timeline.timeline())
        .map_err(|_| ReportIssue::new("ANNUAL_INPUT_INVALID"))?;
    let recurring = saved
        .pointer("/settings/automation/additionalRecurringGrossCents")
        .cloned()
        .unwrap_or_else(|| json!(0));
    Ok(json!({"saved":saved,"annualPayments":payments,"additionalRecurringGrossCents":recurring}))
}
pub(super) fn frames(
    facts: &SnapshotFacts,
    month: &str,
    perspective: SalaryPerspective,
    output: &SectionOutput,
) -> Value {
    let inputs = SectionOutput::from_result(inputs(facts, month));
    let forecast = match &inputs {
        SectionOutput::Ready { value } => {
            if value.pointer("/saved/settings/version") == Some(&json!(2))
                && perspective != SalaryPerspective::Earned
            {
                match output {
                    SectionOutput::Ready { .. } => {
                        json!({"state":"READY","value":{"kind":"MONTHLY_NET_PAY"}})
                    }
                    _ => json!(output),
                }
            } else {
                json!({"state":"READY","value":{"kind":"NONE"}})
            }
        }
        _ => json!(&inputs),
    };
    let row = if forecast["state"] == "READY" {
        let selected = if forecast["value"]["kind"] == "MONTHLY_NET_PAY" {
            match output {
                SectionOutput::Ready { value } => Some(value),
                _ => None,
            }
        } else {
            None
        };
        json!(SectionOutput::from_result(
            crate::runtime::financial_report::analysis_net_row::present(month, selected)
        ))
    } else {
        forecast.clone()
    };
    json!({"analysisSalaryInputs":inputs,"analysisSalaryForecast":forecast,"analysisNetRow":row})
}
