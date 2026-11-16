use crate::remuneration::{
    base::{self, model::RemunerationStatus},
    context::model::{IssueCode, RemunerationIssue, RemunerationSource},
};
use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PremiumIssueKind {
    OwnPremiumsUnconfigured,
    PremiumRateMissing,
    HolidayRulesUnavailable,
    DraftPremiumFactsIncomplete,
}
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(untagged)]
pub enum PremiumIssueCode {
    Context(IssueCode),
    Premium(PremiumIssueKind),
}
#[derive(Debug, Clone, Serialize)]
pub struct PremiumIssue {
    pub code: PremiumIssueCode,
    pub message: String,
}
impl From<RemunerationIssue> for PremiumIssue {
    fn from(value: RemunerationIssue) -> Self {
        Self {
            code: PremiumIssueCode::Context(value.code),
            message: value.message,
        }
    }
}
impl PremiumIssue {
    pub fn new(kind: PremiumIssueKind, message: impl Into<String>) -> Self {
        Self {
            code: PremiumIssueCode::Premium(kind),
            message: message.into(),
        }
    }
    pub fn context(kind: IssueCode, message: impl Into<String>) -> Self {
        Self {
            code: PremiumIssueCode::Context(kind),
            message: message.into(),
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PauseMethod {
    None,
    CenteredDurationEstimate,
    ConfirmedIntervals,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PremiumBasis {
    pub rule_id: Option<String>,
    #[serde(serialize_with = "base::scalar")]
    pub minutes: f64,
    pub hourly_rate_cents: Option<i64>,
    pub percentage_basis_points: Option<i64>,
    /// Outer absence omits this field; Some(None) explicitly emits null.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rounded_premium_hourly_cents: Option<Option<i64>>,
    pub pause_method: PauseMethod,
}
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PositionKind {
    TimePremium,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeRemunerationPosition<'a> {
    pub id: String,
    pub kind: PositionKind,
    pub label: String,
    pub from: String,
    pub through: String,
    #[serde(serialize_with = "base::scalar")]
    pub from_epoch_minutes: f64,
    #[serde(serialize_with = "base::scalar")]
    pub until_epoch_minutes: f64,
    pub shift_id: Option<String>,
    pub source: RemunerationSource<'a>,
    pub status: RemunerationStatus,
    pub amount_cents: Option<i64>,
    pub issue: Option<PremiumIssue>,
    pub basis: PremiumBasis,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeRemunerationResult<'a> {
    pub positions: Vec<TimeRemunerationPosition<'a>>,
    #[serde(serialize_with = "base::scalar")]
    pub net_minutes: f64,
    pub complete: bool,
    pub total_cents: Option<i64>,
    pub known_subtotal_cents: i64,
    pub status: RemunerationStatus,
}
