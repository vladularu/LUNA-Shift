use crate::remuneration::{base::model::RemunerationStatus, context::model::RemunerationSource};
use serde::Serialize;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AnnualIssueCode {
    AnnualInputMissing,
    AnnualTermsAmbiguous,
    AnnualRuleMissing,
    AnnualRuleAmbiguous,
    AnnualRuleInvalid,
    AnnualAllocationUnconfirmed,
}
#[derive(Debug, Clone, Serialize)]
pub struct AnnualIssue {
    pub code: AnnualIssueCode,
    pub message: String,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AnnualMethod {
    Fixed,
    Percent,
    Actual,
}
#[derive(Debug, Clone, Serialize)]
pub struct Twelfths {
    pub numerator: i64,
    pub denominator: i64,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TariffBasis {
    pub claim_revision: Option<i64>,
    pub rule_id: Option<String>,
    pub versions: Vec<String>,
    pub basis_method: Option<String>,
    pub basis_months: Vec<String>,
    pub twelfths: Option<Twelfths>,
    pub missing: Vec<String>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnualBasis {
    pub payment_id: String,
    pub entitlement_year: i32,
    pub method: AnnualMethod,
    pub full_amount_cents: Option<i64>,
    pub confirmed_basis_cents: Option<i64>,
    pub percentage_basis_points: Option<i64>,
    #[serde(serialize_with = "crate::remuneration::base::optional_scalar")]
    pub entitlement_months: Option<f64>,
    pub actual_revision: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tariff: Option<TariffBasis>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnualPosition<'a> {
    pub id: String,
    pub kind: AnnualPositionKind,
    pub label: String,
    pub from: String,
    pub through: String,
    pub amount_cents: Option<i64>,
    pub status: RemunerationStatus,
    pub source: RemunerationSource<'a>,
    pub basis: AnnualBasis,
    pub issue: Option<AnnualIssue>,
}
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AnnualPositionKind {
    AnnualPayment,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnualResult<'a> {
    pub positions: Vec<AnnualPosition<'a>>,
    pub complete: bool,
    pub status: RemunerationStatus,
    pub known_subtotal_cents: i64,
    pub total_cents: Option<i64>,
}
pub fn summarize_annual(positions: Vec<AnnualPosition<'_>>) -> AnnualResult<'_> {
    let complete = positions.iter().all(|p| p.amount_cents.is_some());
    let known_subtotal_cents = positions.iter().map(|p| p.amount_cents.unwrap_or(0)).sum();
    let status = if !complete {
        RemunerationStatus::Unavailable
    } else if positions
        .iter()
        .any(|p| p.status == RemunerationStatus::Estimated)
    {
        RemunerationStatus::Estimated
    } else {
        RemunerationStatus::Calculated
    };
    AnnualResult {
        positions,
        complete,
        status,
        known_subtotal_cents,
        total_cents: complete.then_some(known_subtotal_cents),
    }
}
