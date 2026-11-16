//! Small native dashboard siblings over retained snapshot facts, never wire money.
use super::model;
use crate::{
    contract::SalaryPerspective,
    report::financial::{
        annual_salary::annual_salary_forecast,
        dashboard::{DashboardInput, present},
    },
    runtime::{
        facts::SnapshotFacts,
        report::{ReportIssue, SectionOutput},
    },
};
use serde_json::{Value, json};
struct Supplement {
    forecast: Value,
    recurring: f64,
}
fn supplement(facts: &SnapshotFacts, month: &str) -> Result<Supplement, ReportIssue> {
    let timeline = facts.net_settings()?;
    let selected = timeline
        .resolve(month)
        .map_err(|_| ReportIssue::new("NET_SETTINGS_INVALID"))?;
    let recurring = selected
        .pointer("/settings/automation/additionalRecurringGrossCents")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let saved = crate::net::settings::collect_annual_salary_payments(timeline.timeline())
        .map_err(|_| ReportIssue::new("ANNUAL_INPUT_INVALID"))?;
    let saved = saved
        .as_array()
        .ok_or_else(|| ReportIssue::new("ANNUAL_INPUT_INVALID"))?;
    let year = month
        .get(..4)
        .and_then(|y| y.parse().ok())
        .ok_or_else(|| ReportIssue::new("INVALID_PERIOD"))?;
    let owner = facts.financial_context().map_err(model::source_error)?;
    let mut context = owner
        .lock()
        .map_err(|_| ReportIssue::new("FINANCIAL_CONTEXT_UNAVAILABLE"))?;
    let forecast =
        annual_salary_forecast(year, &mut context, saved).map_err(model::calculation_error)?;
    Ok(Supplement {
        forecast,
        recurring,
    })
}
fn annual_state(result: &Result<Supplement, ReportIssue>) -> Value {
    match result {
        Ok(_) => json!({"state":"READY","value":{"known":true}}),
        Err(reason) if reason.code == "SOURCE_NOT_REQUESTED" => json!({"state":"NOT_REQUESTED"}),
        Err(reason) => json!({"state":"UNAVAILABLE","reason":reason}),
    }
}
pub(super) fn for_gross(
    facts: &SnapshotFacts,
    month: &str,
    perspective: SalaryPerspective,
    legacy: &SectionOutput,
) -> Result<Value, ReportIssue> {
    let profile = facts
        .financial_profile()?
        .ok_or_else(|| ReportIssue::new("PROFILE_MISSING"))?;
    let blocked = facts.test_months()?.months().contains(month);
    let policy = json!({"isTestMonth":blocked,"allowNet":!blocked,"allowProjection":!blocked,"allowRecurring":!blocked});
    let paid_source = if perspective == SalaryPerspective::Payout {
        let owner = facts.financial_context().map_err(model::source_error)?;
        owner
            .lock()
            .map_err(|_| ReportIssue::new("FINANCIAL_CONTEXT_UNAVAILABLE"))?
            .salary_month(month)
            .ok()
    } else {
        None
    };
    let earned = if perspective == SalaryPerspective::Earned {
        if let SectionOutput::Ready { value } = legacy {
            Some(value)
        } else {
            None
        }
    } else {
        paid_source.as_ref().map(|s| s.pay())
    };
    let error = |_| ReportIssue::new("MONTHLY_DASHBOARD_INVALID");
    if perspective == SalaryPerspective::Earned && !blocked {
        let value = present(&DashboardInput {
            month,
            profile,
            pay: earned,
            projection: None,
            annual_payments: None,
            annual_issue: None,
            additional_recurring_gross_cents: 0.0,
            projection_pending: false,
            salary_loading: false,
            salary_error: None,
        })
        .map_err(error)?;
        return Ok(
            json!({"kind":"EARNED_PREMIUMS","policy":policy,"manualSalary":value["manualSalary"],"salaryReady":value["salaryReady"],"premium":value["premium"]}),
        );
    }
    let projection = if blocked {
        None
    } else {
        match legacy {
            SectionOutput::Ready { value } => Some(value),
            SectionOutput::Unavailable { reason } => return Err(reason.clone()),
            SectionOutput::NotRequested {} => return Err(ReportIssue::new("SOURCE_NOT_REQUESTED")),
        }
    };
    let supplement = supplement(facts, month);
    if !blocked && let Err(reason) = &supplement {
        return Err(reason.clone());
    }
    let payments = supplement
        .as_ref()
        .ok()
        .and_then(|s| s.forecast["payments"].as_array())
        .map(Vec::as_slice);
    let issue = supplement
        .as_ref()
        .ok()
        .and_then(|s| s.forecast.get("issue"));
    let recurring = if blocked {
        0.0
    } else {
        supplement.as_ref().map_err(Clone::clone)?.recurring
    };
    let mut value = present(&DashboardInput {
        month,
        profile,
        pay: earned,
        projection,
        annual_payments: payments,
        annual_issue: issue,
        additional_recurring_gross_cents: recurring,
        projection_pending: false,
        salary_loading: false,
        salary_error: None,
    })
    .map_err(error)?;
    value["kind"] = json!(if blocked {
        "TEST_MONTH_EARNED"
    } else {
        "PAYOUT"
    });
    value["policy"] = policy;
    value["annualState"] = annual_state(&supplement);
    Ok(value)
}
