//! Native-only persisted candidate composition. SQLite I/O remains outside this pure engine.
use super::{
    annual,
    flow::{self, CatalogMonthSources, FlowError},
    overtime_payout::{self, OvertimePayoutInput},
};
use crate::{
    net::js_truthy,
    remuneration::{
        base::BaseError,
        context::model::NativePackageValidator,
        tariff_annual::{TariffAnnualError, saved::ValidatedSavedClaims},
    },
    rules::RuleResolver,
};
use serde_json::{Value, json};
/// Raw is a native admission boundary; snapshots that retain a checked owner use Checked across months.
pub enum AnnualClaims<'a> {
    Raw(&'a Value),
    Checked(&'a ValidatedSavedClaims),
}
/// Borrowed native source facts, not a deserializable computed/Ready payload. Completeness derives from I/O coverage.
/// Shifts preserve the original full-history SQLite date,id order rather than display sorting.
pub struct CandidateSnapshot<'a> {
    pub profile: Option<&'a Value>,
    pub shifts: &'a [Value],
    pub pause_details: &'a [Value],
    pub remuneration_profiles: &'a [Value],
    pub allowance_decisions: &'a [Value],
    pub overtime_allocations: &'a [Value],
    pub overtime_confirmations: &'a [Value],
    pub month_facts: &'a [Value],
    pub work_day_confirmations: &'a [Value],
    pub annual_claims: AnnualClaims<'a>,
    pub entries_complete: bool,
    pub history_complete: bool,
}
#[derive(Debug)]
pub enum CandidateError {
    Flow(FlowError),
    Annual(TariffAnnualError),
}
impl From<FlowError> for CandidateError {
    fn from(e: FlowError) -> Self {
        Self::Flow(e)
    }
}
impl From<TariffAnnualError> for CandidateError {
    fn from(e: TariffAnnualError) -> Self {
        Self::Annual(e)
    }
}
impl std::fmt::Display for CandidateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Flow(e) => e.fmt(f),
            Self::Annual(e) => e.fmt(f),
        }
    }
}
impl std::error::Error for CandidateError {}
impl CandidateError {
    pub fn name(&self) -> &str {
        match self {
            Self::Flow(e) => e.name(),
            Self::Annual(e) => e.class_name(),
        }
    }
}
fn safe(n: f64) -> Option<i64> {
    (n.is_finite() && n.fract() == 0.0 && n.abs() <= crate::money::MAX_SAFE_INTEGER as f64)
        .then_some(n as i64)
}
fn overflow() -> Value {
    json!({"kind":"unavailable","stage":"monthly-pay","reason":"AMOUNT_OVERFLOW"})
}
fn partial(
    issue: Value,
    month: &str,
    known: i64,
    has_cash: bool,
    exclusions: Vec<&str>,
    overtime: Value,
    annual: Value,
) -> Value {
    if !has_cash {
        return issue;
    }
    let mut excluded = vec!["MONTHLY_PAY"];
    excluded.extend(exclusions);
    let mut out = json!({"kind":"draft-known-cash","month":month,"knownSubtotalCents":known,"completeGross":false,"excludedComponents":excluded});
    out["monthly"] = issue;
    out["overtime"] = overtime;
    out["annual"] = annual;
    out
}
pub fn calculate(
    snapshot: &CandidateSnapshot<'_>,
    month: &str,
    resolver: &RuleResolver,
    validator: &impl NativePackageValidator,
) -> Result<Value, CandidateError> {
    let Some(profile) = snapshot.profile.filter(|p| js_truthy(p)) else {
        return Ok(json!({"kind":"unavailable","stage":"work-profile","reason":"PROFILE_MISSING"}));
    };
    let overtime = overtime_payout::calculate(
        &OvertimePayoutInput {
            month,
            time_zone: profile["timeZone"]
                .as_str()
                .ok_or(FlowError::from(BaseError::InvalidCalculation))?,
            history_complete: snapshot.history_complete,
            shifts: snapshot.shifts,
            allocations: snapshot.overtime_allocations,
            confirmations: snapshot.overtime_confirmations,
            profiles: snapshot.remuneration_profiles,
        },
        resolver,
        validator,
    )?;
    let annual = match &snapshot.annual_claims {
        AnnualClaims::Raw(raw) => annual::payout_month(month, raw, resolver, validator)?,
        AnnualClaims::Checked(claims) => {
            annual::payout_month_checked(month, claims, resolver, validator)?
        }
    };
    let overtime_known = overtime["kind"] == "draft-confirmed-payouts";
    let annual_known = annual["kind"] == "draft-known-payments";
    let known = (if overtime_known {
        overtime["cashSubtotalCents"].as_f64().unwrap()
    } else {
        0.0
    }) + (if annual_known {
        annual["knownSubtotalCents"].as_f64().unwrap()
    } else {
        0.0
    });
    let Some(known) = safe(known) else {
        return Ok(overflow());
    };
    let has_cash = (overtime_known
        && overtime["positions"]
            .as_array()
            .is_some_and(|p| !p.is_empty()))
        || (annual_known
            && annual["positions"]
                .as_array()
                .is_some_and(|p| !p.is_empty()));
    let mut exclusions = Vec::new();
    if overtime["kind"] == "unavailable" {
        exclusions.push("OVERTIME");
    }
    exclusions.push(if annual["kind"] == "unavailable" {
        "ANNUAL_PAYMENT_UNAVAILABLE"
    } else {
        "ANNUAL_PAYMENT_UNCONFIRMED"
    });
    exclusions.push("OTHER_LOCAL_TERMS");
    let allowance = flow::derive_entitlements(
        month,
        snapshot.remuneration_profiles,
        snapshot.allowance_decisions,
    )?;
    if allowance["kind"] == "unavailable" {
        let issue = json!({"kind":"unavailable","stage":"allowance-decisions","reason":allowance["reason"]});
        return Ok(partial(
            issue, month, known, has_cash, exclusions, overtime, annual,
        ));
    }
    let entitlements = allowance["entitlements"]
        .as_array()
        .ok_or(FlowError::from(BaseError::InvalidCalculation))?;
    let monthly = flow::from_catalog_sources(
        &CatalogMonthSources {
            month,
            work_profile: profile,
            shifts: snapshot.shifts,
            pause_details: snapshot.pause_details,
            entries_complete: snapshot.entries_complete,
            shift_entitlements: entitlements,
            work_day_confirmations: snapshot.work_day_confirmations,
            remuneration_profiles: snapshot.remuneration_profiles,
            month_facts: snapshot.month_facts,
        },
        resolver,
        validator,
    )?;
    if monthly["kind"] == "unavailable" {
        let mut issue =
            json!({"kind":"unavailable","stage":"monthly-pay","reason":monthly["reason"]});
        issue["detail"] = monthly;
        return Ok(partial(
            issue, month, known, has_cash, exclusions, overtime, annual,
        ));
    }
    let total = monthly["knownSubtotalCents"].as_f64().unwrap() + known as f64;
    let Some(total) = safe(total) else {
        return Ok(overflow());
    };
    let mut out = json!({"kind":"draft-known-subtotal","month":month,"status":"estimated","knownSubtotalCents":total,"completeGross":false,"excludedComponents":exclusions});
    out["monthly"] = monthly;
    out["overtime"] = overtime;
    out["annual"] = annual;
    Ok(out)
}
