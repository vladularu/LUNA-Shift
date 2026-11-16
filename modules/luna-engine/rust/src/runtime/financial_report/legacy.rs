use super::model;
use crate::{
    contract::{ReportPeriod, SalaryPerspective},
    net::payment_projection::SalaryPaymentProjection,
    report::financial::{
        gross::annual_legacy_financial_report,
        net::{PaymentNetPreparation, annual_net_pay, prepare_automatic_net_pay},
    },
    runtime::{facts::SnapshotFacts, report::ReportIssue},
};
use serde_json::{Value, json};
fn compact_projection(projection: &SalaryPaymentProjection) -> Value {
    json!({"month":projection.month,"perspective":projection.perspective,"pay":projection.pay,"contributions":projection.contributions,"outgoingContributions":projection.outgoing_contributions,"issues":projection.issues,"warnings":projection.warnings,"available":projection.available,"sources":projection.sources.iter().map(|source|json!({"month":source.month(),"pay":source.pay()})).collect::<Vec<_>>()})
}
pub(super) fn gross(
    facts: &SnapshotFacts,
    period: &ReportPeriod,
    perspective: SalaryPerspective,
) -> Result<Value, ReportIssue> {
    let preferences = if perspective == SalaryPerspective::Payout {
        Some(model::preferences(facts, perspective)?)
    } else {
        None
    };
    let owner = facts.financial_context().map_err(model::source_error)?;
    let mut context = owner
        .lock()
        .map_err(|_| ReportIssue::new("FINANCIAL_CONTEXT_UNAVAILABLE"))?;
    match period {
        ReportPeriod::Month { month } => {
            if let Some(preferences) = preferences {
                let projection = context
                    .salary_projection(month, &preferences, model::perspective(perspective))
                    .map_err(model::calculation_error)?;
                Ok(compact_projection(&projection))
            } else {
                Ok(context
                    .salary_month(month)
                    .map_err(model::calculation_error)?
                    .pay()
                    .clone())
            }
        }
        ReportPeriod::Year { year } => {
            let earned = annual_legacy_financial_report(i32::from(*year), &mut context)
                .map_err(model::calculation_error)?;
            if let Some(preferences) = preferences {
                let mut payment_months = Vec::with_capacity(12);
                for index in 1..=12 {
                    let projection = context
                        .salary_projection(
                            &format!("{year}-{index:02}"),
                            &preferences,
                            model::perspective(perspective),
                        )
                        .map_err(model::calculation_error)?;
                    payment_months.push(compact_projection(&projection));
                }
                Ok(json!({"earned":earned,"paymentMonths":payment_months}))
            } else {
                model::output(&earned)
            }
        }
    }
}
pub(super) fn net(
    facts: &SnapshotFacts,
    period: &ReportPeriod,
    perspective: SalaryPerspective,
) -> Result<Value, ReportIssue> {
    let timeline = facts.net_settings()?;
    let preferences = model::preferences(facts, perspective)?;
    let owner = facts.financial_context().map_err(model::source_error)?;
    let mut context = owner
        .lock()
        .map_err(|_| ReportIssue::new("FINANCIAL_CONTEXT_UNAVAILABLE"))?;
    match period {
        ReportPeriod::Year { year } => {
            let result = annual_net_pay(
                i32::from(*year),
                timeline.timeline(),
                &preferences,
                &mut context,
                model::perspective(perspective),
            )
            .map_err(model::calculation_error)?;
            model::output(&result)
        }
        ReportPeriod::Month { month } => {
            let selected = timeline
                .resolve(month)
                .map_err(|_| ReportIssue::new("NET_SETTINGS_INVALID"))?;
            let payment = PaymentNetPreparation {
                preferences: &preferences,
                perspective: model::perspective(perspective),
                source_settings: timeline.timeline(),
                projection: None,
            };
            Ok(prepare_automatic_net_pay(
                month,
                &selected["settings"],
                &mut context,
                Some(&payment),
            ))
        }
    }
}
