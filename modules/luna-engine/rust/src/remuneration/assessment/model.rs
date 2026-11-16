use crate::{
    remuneration::context::model::{IssueCode, RemunerationSource},
    rules::RuleResolver,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
pub struct AssessmentInput<'a> {
    pub month: &'a str,
    pub shifts: &'a [Value],
    pub work_profile: &'a Value,
    pub history: &'a [Value],
    pub settings: &'a Value,
    pub decisions: &'a [Value],
    pub legacy_decision: Option<&'a Value>,
    pub resolver: &'a RuleResolver,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TariffIdentity {
    pub package_id: String,
    pub variant: String,
    pub region: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entitlement {
    pub from: String,
    pub through: String,
    pub status: AllowanceStatus,
    pub origin: EntitlementOrigin,
    pub revision: Option<i64>,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AllowanceStatus {
    None,
    ShiftMonthly,
    ShiftHourly,
    AlternatingMonthly,
    AlternatingHourly,
}
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntitlementOrigin {
    Estimated,
    Confirmed,
}
#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum AssessmentIssueCode {
    Context(IssueCode),
    Assessment(SpecificIssueCode),
}
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SpecificIssueCode {
    OwnAssessmentUnsupported,
    WorkplaceSettingsUnconfirmed,
    AllowanceReconfirmationRequired,
    AllowanceDecisionTariffMismatch,
}
#[derive(Debug, Clone, Serialize)]
pub struct AssessmentIssue {
    pub code: AssessmentIssueCode,
    pub message: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriodAssessment<'a> {
    pub tariff: Option<TariffIdentity>,
    pub night_sequence: Option<Value>,
    pub from: String,
    pub through: String,
    pub source: RemunerationSource<'a>,
    pub assessment: Option<Value>,
    pub entitlement: Option<Entitlement>,
    pub observed_from: Option<String>,
    pub observed_through: Option<String>,
    pub settings_updated_at: Option<String>,
    pub issue: Option<AssessmentIssue>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AllowanceAssessment<'a> {
    pub periods: Vec<PeriodAssessment<'a>>,
    pub entitlements: Vec<Entitlement>,
    pub complete: bool,
    pub legacy_decision: Option<&'a Value>,
}
