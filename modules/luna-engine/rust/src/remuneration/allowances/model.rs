use crate::remuneration::{
    base::{self, model::RemunerationStatus},
    context::model::{IssueCode, RemunerationIssue, RemunerationSource},
};
use serde::Serialize;
use serde_json::Value;
use std::borrow::Cow;
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SupplementIssueKind {
    AllowanceDecisionMissing,
    AllowanceRuleMissing,
    AllowanceRuleAmbiguous,
    OwnAllowancesUnconfigured,
    OwnOvertimeUnconfigured,
    OvertimeAllocationRequired,
    OvertimeMinutesInvalid,
    OvertimeRuleMissing,
    OvertimeRuleAmbiguous,
    OvertimeRateMissing,
}
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(untagged)]
pub enum SupplementIssueCode {
    Context(IssueCode),
    Supplement(SupplementIssueKind),
}
#[derive(Debug, Clone, Serialize)]
pub struct SupplementIssue {
    pub code: SupplementIssueCode,
    pub message: String,
}
impl From<RemunerationIssue> for SupplementIssue {
    fn from(value: RemunerationIssue) -> Self {
        Self {
            code: SupplementIssueCode::Context(value.code),
            message: value.message,
        }
    }
}
impl SupplementIssue {
    pub fn new(code: SupplementIssueKind, message: impl Into<String>) -> Self {
        Self {
            code: SupplementIssueCode::Supplement(code),
            message: message.into(),
        }
    }
    pub fn context(code: IssueCode, message: impl Into<String>) -> Self {
        Self {
            code: SupplementIssueCode::Context(code),
            message: message.into(),
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AllowanceType {
    Care,
    Tvoed,
    Shift,
    AlternatingShift,
}
impl AllowanceType {
    pub fn text(self) -> &'static str {
        match self {
            Self::Care => "care",
            Self::Tvoed => "tvoed",
            Self::Shift => "shift",
            Self::AlternatingShift => "alternating-shift",
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            Self::Care => "Pflegezulage",
            Self::Tvoed => "Tarifliche Zulage",
            Self::Shift => "Schichtzulage",
            Self::AlternatingShift => "Wechselschichtzulage",
        }
    }
    pub fn shift(self) -> bool {
        matches!(self, Self::Shift | Self::AlternatingShift)
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SupplementKind {
    Allowance,
    OvertimeBase,
    OvertimePremium,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PauseMethod {
    None,
    CenteredDurationEstimate,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Proration {
    None,
    CalendarDays,
    WorkedMinutes,
    Unconfirmed,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupplementBasis<'a> {
    pub rule_id: Option<String>,
    pub shift_id: Option<String>,
    pub allowance_type: Option<AllowanceType>,
    pub rate_cents: Option<i64>,
    pub personal_monthly_cents: Option<i64>,
    pub percentage_basis_points: Option<i64>,
    #[serde(serialize_with = "base::scalar")]
    pub minutes: f64,
    pub calendar_days: i32,
    pub month_days: i32,
    /// Original bounded input evidence is serialized without dropping extra keys or key order.
    /// It is never accepted as a calculated amount or readiness flag.
    pub entitlement: Option<Cow<'a, Value>>,
    pub pause_method: PauseMethod,
    pub proration: Proration,
}
impl SupplementBasis<'_> {
    pub fn empty(calendar_days: i32, month_days: i32) -> Self {
        Self {
            rule_id: None,
            shift_id: None,
            allowance_type: None,
            rate_cents: None,
            personal_monthly_cents: None,
            percentage_basis_points: None,
            minutes: 0.0,
            calendar_days,
            month_days,
            entitlement: None,
            pause_method: PauseMethod::None,
            proration: Proration::None,
        }
    }
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupplementPosition<'a> {
    pub id: String,
    pub kind: SupplementKind,
    pub label: String,
    pub from: String,
    pub through: String,
    pub amount_cents: Option<i64>,
    pub status: RemunerationStatus,
    pub source: RemunerationSource<'a>,
    pub basis: SupplementBasis<'a>,
    pub issue: Option<SupplementIssue>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupplementResult<'a> {
    pub status: RemunerationStatus,
    pub complete: bool,
    pub total_cents: Option<i64>,
    pub known_subtotal_cents: i64,
    pub positions: Vec<SupplementPosition<'a>>,
}
pub fn summarize_supplements(positions: Vec<SupplementPosition<'_>>) -> SupplementResult<'_> {
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
    SupplementResult {
        status,
        complete,
        total_cents: complete.then_some(known_subtotal_cents),
        known_subtotal_cents,
        positions,
    }
}
