//! Native monthly payroll-page display over the retained source snapshot.
pub(crate) mod net_cache;
pub mod panels;
mod policy;
mod statement;
use super::model;
use crate::{
    contract::SalaryPerspective,
    net::settings::collect_annual_salary_payments,
    report::financial::annual_salary::annual_salary_forecast,
    runtime::{
        facts::SnapshotFacts,
        report::{ReportIssue, SectionOutput},
    },
};
use serde_json::{Value, json};
pub(super) fn failure() -> ReportIssue {
    ReportIssue::new("PAYROLL_PAGE_INVALID")
}
pub(super) fn number(value: &Value) -> Result<f64, ReportIssue> {
    value.as_f64().filter(|n| n.is_finite()).ok_or_else(failure)
}
pub(super) fn title(month: &str) -> Result<String, ReportIssue> {
    crate::runtime::target_ui::month_title(month).map_err(|_| failure())
}
pub(crate) fn annual_editor_visible(
    month: &str,
    profile: &Value,
    payments: &[Value],
) -> Result<bool, ReportIssue> {
    policy::annual_visible(month, profile, payments)
}
/// Source-only timing form metadata; no gross, annual or net work.
pub(crate) fn timing_source(facts: &SnapshotFacts, month: &str) -> Result<Value, ReportIssue> {
    let preferences = model::preferences(facts, SalaryPerspective::Payout)?;
    policy::timing(month, &preferences)
}
pub(super) fn has_tariff(profile: &Value) -> bool {
    [
        "tariff",
        "vkaETariff",
        "tvlKrTariff",
        "tvhKrTariff",
        "tvUkNursingTariff",
        "nursingTrainingTariff",
        "tvalPflegeTariff",
    ]
    .iter()
    .any(|key| crate::net::js_truthy(&profile[*key]))
}
#[derive(Debug)]
pub struct PayrollPageOutput {
    pub page: Value,
    pub ui: Value,
}
/// Explicit Finance-view computation. Setup/test gates precede personal tax work.
/// No caller can provide a ready forecast or calculated money at this boundary.
pub fn calculate(facts: &SnapshotFacts, month: &str) -> Result<Value, ReportIssue> {
    calculate_with_ui(facts, month).map(|output| output.page)
}
pub fn calculate_with_ui(
    facts: &SnapshotFacts,
    month: &str,
) -> Result<PayrollPageOutput, ReportIssue> {
    calculate_selected(facts, month, None)
}
/// An explicitly requested panel uses the same source/net preparation and does
/// not allocate the other panels or the main-page DTO.
pub fn calculate_panel(
    facts: &SnapshotFacts,
    month: &str,
    panel: panels::PayrollPanel,
) -> Result<Value, ReportIssue> {
    if panel == panels::PayrollPanel::TariffAssessment {
        return panels::calculate(facts, month);
    }
    calculate_selected(facts, month, Some(panel)).map(|output| output.page)
}
fn calculate_selected(
    facts: &SnapshotFacts,
    month: &str,
    panel: Option<panels::PayrollPanel>,
) -> Result<PayrollPageOutput, ReportIssue> {
    if panel == Some(panels::PayrollPanel::SpecialDuties) {
        let preferences = model::preferences(facts, SalaryPerspective::Payout)?;
        let owner = facts.financial_context().map_err(model::source_error)?;
        let mut context = owner
            .lock()
            .map_err(|_| ReportIssue::new("FINANCIAL_CONTEXT_UNAVAILABLE"))?;
        let projection = context
            .salary_projection(
                month,
                &preferences,
                model::perspective(SalaryPerspective::Payout),
            )
            .map_err(model::calculation_error)?;
        return Ok(PayrollPageOutput {
            page: panels::present_special(&projection.pay)?,
            ui: Value::Null,
        });
    }
    let blocked = facts.test_months()?.months().contains(month);
    let configured = !blocked
        && facts
            .net_settings()
            .ok()
            .and_then(|timeline| timeline.resolve(month).ok())
            .is_some_and(|selected| selected["settings"]["version"].as_f64() == Some(2.0));
    let net = if configured {
        facts
            .payroll_net_cache()
            .get_or_prepare(month, SalaryPerspective::Payout, || {
                SectionOutput::from_result(super::legacy::net(
                    facts,
                    &crate::contract::ReportPeriod::Month {
                        month: month.into(),
                    },
                    SalaryPerspective::Payout,
                ))
            })?
    } else {
        std::sync::Arc::new(SectionOutput::NotRequested {})
    };
    for_month(facts, month, &net, panel)
}
fn for_month(
    facts: &SnapshotFacts,
    month: &str,
    net: &SectionOutput,
    panel: Option<panels::PayrollPanel>,
) -> Result<PayrollPageOutput, ReportIssue> {
    let blocked = facts.test_months()?.months().contains(month);
    let preferences = model::preferences(facts, SalaryPerspective::Payout)?;
    let timeline = facts.net_settings();
    let selected_result = timeline
        .as_ref()
        .map_err(|e| ReportIssue::from(e.clone()))
        .and_then(|t| {
            t.resolve(month)
                .map_err(|_| ReportIssue::new("NET_SETTINGS_INVALID"))
        });
    let status = if blocked {
        policy::SettingsStatus::Ready
    } else {
        match &selected_result {
            Ok(_) => policy::SettingsStatus::Ready,
            Err(e) if matches!(e.code, "SOURCE_NOT_REQUESTED" | "SOURCE_LOADING") => {
                policy::SettingsStatus::Loading
            }
            Err(_) => policy::SettingsStatus::Error,
        }
    };
    let selected = if blocked {
        Value::Null
    } else {
        selected_result.unwrap_or(Value::Null)
    };
    let settings = selected.get("settings").filter(|v| !v.is_null());
    let configured = settings.is_some_and(|s| s["version"].as_f64() == Some(2.0));
    let owner = facts.financial_context().map_err(model::source_error)?;
    let mut context = owner
        .lock()
        .map_err(|_| ReportIssue::new("FINANCIAL_CONTEXT_UNAVAILABLE"))?;
    let projection = context
        .salary_projection(
            month,
            &preferences,
            model::perspective(SalaryPerspective::Payout),
        )
        .map_err(model::calculation_error)?;
    let annual = if blocked || !matches!(status, policy::SettingsStatus::Ready) {
        json!({"payments":[],"proposal":null,"automatic":false,"issue":null})
    } else {
        let saved = collect_annual_salary_payments(
            timeline
                .as_ref()
                .map_err(|e| ReportIssue::from(e.clone()))?
                .timeline(),
        )
        .map_err(|_| ReportIssue::new("ANNUAL_INPUT_INVALID"))?;
        let year = month
            .get(..4)
            .and_then(|v| v.parse().ok())
            .ok_or_else(failure)?;
        annual_salary_forecast(year, &mut context, saved.as_array().ok_or_else(failure)?)
            .map_err(model::calculation_error)?
    };
    let profile = projection
        .sources
        .iter()
        .find(|s| s.month() == month)
        .map(|s| s.calculation_profile())
        .unwrap_or(context.calculation_profile());
    let forecast = if configured {
        match net {
            SectionOutput::Ready { value } => Some(value),
            _ => None,
        }
    } else {
        None
    };
    if let Some(panel) = panel {
        return Ok(PayrollPageOutput {
            page: panels::present(
                panel,
                panels::PanelInput {
                    month,
                    profile,
                    projection: &projection,
                    settings,
                    annual: &annual,
                    forecast,
                },
            )?,
            ui: Value::Null,
        });
    }
    let statement = statement::present(
        month,
        profile,
        &projection,
        settings,
        &annual,
        forecast,
        blocked,
    )?;
    let extra = policy::extras(&policy::ExtraInput {
        month,
        profile,
        settings,
        selected: &selected,
        annual: &annual,
        forecast,
        preferences: &preferences,
        blocked,
        status,
    })?;
    let mut value = json!({"month":month,"statement":statement,"policy":{"blocked":blocked,"hasTariff":has_tariff(profile),"hasBasis":has_tariff(profile)||!profile["manualMonthlyGrossCents"].is_null(),"configured":configured,"noDuties":!blocked&&projection.pay["available"]==true&&has_tariff(profile)&&projection.sources.iter().all(|s|s.shifts().is_empty())}});
    for (key, item) in extra.as_object().ok_or_else(failure)? {
        value[key] = item.clone();
    }
    let unavailable = if blocked {
        Some("TEST_MONTH")
    } else if !matches!(status, policy::SettingsStatus::Ready) {
        Some("NET_SETTINGS_UNAVAILABLE")
    } else if !configured {
        Some("NET_NOT_CONFIGURED")
    } else {
        None
    };
    super::super::payroll_form::retain_native_seed(
        facts,
        month,
        profile,
        settings,
        &annual,
        unavailable,
    );
    // The original disabled useNetPayProfile remains loading for test data.
    // These UI facts are independent of the financial-ready status above.
    let settings_status = if blocked {
        "loading"
    } else {
        match status {
            policy::SettingsStatus::Ready => "ready",
            policy::SettingsStatus::Loading => "loading",
            policy::SettingsStatus::Error => "error",
        }
    };
    let settings_action = if !blocked && matches!(status, policy::SettingsStatus::Ready) {
        Some(if settings.is_some() { "OPEN" } else { "SETUP" })
    } else {
        None
    };
    let retry = !blocked && matches!(status, policy::SettingsStatus::Error);
    Ok(PayrollPageOutput {
        page: value,
        ui: json!({"settingsStatus":settings_status,"settingsAction":settings_action,"retrySettings":{"net":retry,"salary":retry}}),
    })
}
