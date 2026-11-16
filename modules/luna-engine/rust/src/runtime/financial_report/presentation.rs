//! Salary-detail DTOs derived only from native payroll/projection/net results.
use super::{legacy, model};
use crate::{
    contract::{ReportPeriod, SalaryPerspective},
    report::financial::presentation as money,
    runtime::{
        facts::SnapshotFacts,
        report::{ReportIssue, SectionOutput},
    },
};
use serde_json::{Map, Value, json};
use std::collections::BTreeSet;

fn array(value: &Value) -> &[Value] {
    value.as_array().map(Vec::as_slice).unwrap_or_default()
}
fn compact_shift(shift: &Value) -> Value {
    // These are the source row's visible date/time/title/style facts. Never copy
    // notes, notification/location payloads, payroll proof or raw profile/plan.
    Value::Object(
        [
            "id",
            "date",
            "title",
            "type",
            "allDay",
            "startTime",
            "endTime",
            "breakMinutes",
            "color",
            "symbol",
        ]
        .into_iter()
        .filter_map(|key| shift.get(key).map(|value| (key.to_owned(), value.clone())))
        .collect::<Map<_, _>>(),
    )
}
struct DetailsInput {
    pay: Value,
    shifts: Vec<Value>,
    projection_state: Value,
    net: Result<Value, ReportIssue>,
}
fn input(
    facts: &SnapshotFacts,
    month: &str,
    perspective: SalaryPerspective,
    include_special_duty_pay: bool,
) -> Result<DetailsInput, ReportIssue> {
    let preferences = model::preferences(facts, perspective)?;
    let owner = facts.financial_context().map_err(model::source_error)?;
    let (pay, shifts, projection_state, raw_test_month) = {
        let mut context = owner
            .lock()
            .map_err(|_| ReportIssue::new("FINANCIAL_CONTEXT_UNAVAILABLE"))?;
        if include_special_duty_pay && perspective == SalaryPerspective::Earned {
            // The original route consumes salaryMonthInput, not a cash-book
            // projection. Keep raw earned service rows, including test plans
            // and supported future gross whose payout proof is unavailable.
            let source = context
                .salary_month(month)
                .map_err(model::calculation_error)?;
            let blocked = context.test_months().contains(month);
            let state = if blocked {
                json!({"available":source.pay()["available"],"issues":[],"warnings":[]})
            } else {
                // Retain existing S6 diagnostic fields, using the already
                // cached raw source; this performs no second gross pricing.
                let projection = context
                    .earned_provider()
                    .salary_projection(month, &preferences, model::perspective(perspective))
                    .map_err(model::calculation_error)?;
                json!({"available":projection.available,"issues":projection.issues,"warnings":projection.warnings})
            };
            (
                source.pay().clone(),
                source.shifts().iter().map(compact_shift).collect(),
                state,
                blocked,
            )
        } else {
            let projection = context
                .salary_projection(month, &preferences, model::perspective(perspective))
                .map_err(model::calculation_error)?;
            let premium_months = projection
                .contributions
                .iter()
                .filter(|part| part.group == "PREMIUMS")
                .map(|part| part.claim_month.as_str())
                .collect::<BTreeSet<_>>();
            let sources = projection
                .sources
                .iter()
                .filter(|source| premium_months.contains(source.month()))
                .collect::<Vec<_>>();
            let mut pay = projection.pay.clone();
            pay["shiftBreakdowns"] = Value::Array(
                sources
                    .iter()
                    .flat_map(|source| array(&source.pay()["shiftBreakdowns"]).iter().cloned())
                    .collect(),
            );
            let shifts = sources
                .iter()
                .flat_map(|source| source.shifts().iter().map(compact_shift))
                .collect();
            let state = json!({"available":projection.available,"issues":projection.issues,"warnings":projection.warnings});
            (pay, shifts, state, false)
        }
    };
    // The source screen computes personal net independently. A failed/unread
    // personal setup does not suppress already available paid tariff details.
    let net = if raw_test_month {
        Err(ReportIssue::new("TEST_MONTH_NET_DISABLED"))
    } else {
        legacy::net(
            facts,
            &ReportPeriod::Month {
                month: month.to_owned(),
            },
            perspective,
        )
    };
    Ok(DetailsInput {
        pay,
        shifts,
        projection_state,
        net,
    })
}
fn classification(input: &DetailsInput) -> Option<&Value> {
    input.net.as_ref().ok().and_then(|forecast| {
        (forecast["result"]["status"] == "available")
            .then(|| &forecast["result"]["classification"])
            .filter(|v| !v.is_null())
    })
}
/// Static labels can be merged into the platform collation preflight before any
/// payroll request. Their rank never changes first-seen category ordering.
pub fn static_collation_candidates() -> BTreeSet<String> {
    money::collation_candidates(None, None, &[])
}
/// Exact additional comparison strings produced by native salary preparation.
/// No caller-computed amounts, payroll traces or comparison fallbacks enter it.
pub fn collation_candidates(
    facts: &SnapshotFacts,
    month: &str,
    perspective: SalaryPerspective,
) -> Result<BTreeSet<String>, ReportIssue> {
    let input = input(facts, month, perspective, true)?;
    Ok(money::collation_candidates(
        Some(&input.pay),
        classification(&input),
        &input.shifts,
    ))
}
/// Sibling of the original gross/net sections; their DTOs remain unchanged.
/// Filter and inclusion are raw presentation intent, never financial evidence.
pub fn details(
    facts: &SnapshotFacts,
    month: &str,
    perspective: SalaryPerspective,
    filter: Option<&str>,
    include_special_duty_pay: bool,
) -> Result<Value, ReportIssue> {
    let input = input(facts, month, perspective, include_special_duty_pay)?;
    let ranks = facts.calendar()?.collation();
    finish(
        &input,
        month,
        perspective,
        filter,
        include_special_duty_pay,
        ranks,
    )
}
/// Finance worker only: the admission lease supplies its exact native rank owner.
pub(crate) fn details_with_collation(
    facts: &SnapshotFacts,
    month: &str,
    perspective: SalaryPerspective,
    filter: Option<&str>,
    include_special_duty_pay: bool,
    ranks: &crate::calendar::recurrence::CollationRanks,
) -> Result<(Value, SectionOutput), ReportIssue> {
    let input = input(facts, month, perspective, include_special_duty_pay)?;
    let metadata = super::service_display::metadata(&input.pay, input.net.as_ref().ok());
    let details = finish(
        &input,
        month,
        perspective,
        filter,
        include_special_duty_pay,
        ranks,
    )?;
    let view = SectionOutput::from_result(
        super::service_display::present(&details, metadata).and_then(|mut view| {
            super::detail_panels::enrich(
                &mut view, facts, month, &input.pay, &input.net, &details,
            )?;
            Ok(view)
        }),
    );
    Ok((details, view))
}
fn finish(
    input: &DetailsInput,
    month: &str,
    perspective: SalaryPerspective,
    filter: Option<&str>,
    include_special_duty_pay: bool,
    ranks: &crate::calendar::recurrence::CollationRanks,
) -> Result<Value, ReportIssue> {
    let class = classification(input);
    let failure = |_| ReportIssue::new("FINANCIAL_PRESENTATION_COLLATION_UNAVAILABLE");
    let pay = Some(&input.pay);
    let mut breakdown = money::breakdown(
        array(&input.pay["shiftBreakdowns"]),
        &input.shifts,
        filter,
        ranks,
    )
    .map_err(failure)?;
    let mut salary =
        json!(money::salary_rows(pay, class, &input.shifts, filter, ranks).map_err(failure)?);
    let mut earned =
        json!(money::earned_rows(pay, class, &input.shifts, filter, ranks).map_err(failure)?);
    let mut summary = money::service_summary(
        pay,
        class,
        &input.shifts,
        include_special_duty_pay,
        filter,
        ranks,
    )
    .map_err(failure)?;
    money::decorate_rows(&mut breakdown["rows"], class.is_some());
    money::decorate_rows(&mut salary, class.is_some());
    money::decorate_rows(&mut earned, class.is_some());
    money::decorate_rows(&mut summary["rows"], class.is_some());
    let available = input
        .net
        .as_ref()
        .ok()
        .filter(|forecast| forecast["result"]["status"] == "available");
    let deduction = available.map(|forecast| money::deductions(&forecast["result"]["pay"]));
    let premium_summary = class.map(money::premium_summary);
    let net_state = input
        .net
        .as_ref()
        .map(|forecast| {
            let mut state = json!({"status":forecast["result"]["status"]});
            if let Some(stage) = forecast["result"].get("stage") {
                state["stage"] = stage.clone();
            }
            state
        })
        .map_err(Clone::clone);
    Ok(
        json!({"month":month,"perspective":perspective,"filter":filter,"includeSpecialDutyPay":include_special_duty_pay,"payAvailable":input.pay["available"],"projectionState":input.projection_state,"breakdown":breakdown,"salaryRows":salary,"earnedRows":earned,"serviceSummary":summary,"premiumSummary":premium_summary,"specialAmounts":array(&input.pay["specialDutyBreakdowns"]).iter().map(money::special_amount).collect::<Vec<_>>(),"deductions":deduction,"netState":SectionOutput::from_result(net_state)}),
    )
}
