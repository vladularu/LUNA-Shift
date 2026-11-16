use crate::remuneration::context::model::{RemunerationIssue, RemunerationSource};
use serde::Serialize;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RemunerationStatus {
    Calculated,
    Estimated,
    Unavailable,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Proration {
    None,
    CalendarDays,
    Unconfirmed,
    PaidMinutes,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum HourlyKind {
    Worked,
    Absence,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HourlyBasis {
    pub rate_cents: i64,
    #[serde(serialize_with = "super::optional_scalar")]
    pub paid_minutes: Option<f64>,
    pub kind: HourlyKind,
    pub shift_id: Option<String>,
    pub confirmation_revision: Option<i64>,
    pub pause_estimated: bool,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseBasis {
    pub full_time_monthly_cents: Option<i64>,
    pub personal_monthly_cents: Option<i64>,
    pub weekly_minutes: Option<i64>,
    pub full_time_weekly_minutes: Option<i64>,
    pub calendar_days: i32,
    pub month_days: i32,
    pub proration: Proration,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hourly: Option<HourlyBasis>,
}
impl BaseBasis {
    pub fn empty(calendar_days: i32, month_days: i32) -> Self {
        Self {
            full_time_monthly_cents: None,
            personal_monthly_cents: None,
            weekly_minutes: None,
            full_time_weekly_minutes: None,
            calendar_days,
            month_days,
            proration: Proration::Unconfirmed,
            hourly: None,
        }
    }
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BasePosition<'a> {
    pub id: String,
    pub kind: &'static str,
    pub label: String,
    pub from: String,
    pub through: String,
    pub status: RemunerationStatus,
    pub amount_cents: Option<i64>,
    pub source: RemunerationSource<'a>,
    pub basis: BaseBasis,
    pub issue: Option<RemunerationIssue>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyBase<'a> {
    pub month: String,
    pub status: RemunerationStatus,
    pub complete: bool,
    pub total_cents: Option<i64>,
    pub known_subtotal_cents: i64,
    pub positions: Vec<BasePosition<'a>>,
}
