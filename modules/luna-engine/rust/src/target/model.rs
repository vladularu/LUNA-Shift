use serde::{Deserialize, Serialize};
use std::sync::Arc;

fn deserialize_shared_input<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<Arc<TargetInput>>, D::Error> {
    Option::<TargetInput>::deserialize(d).map(|value| value.map(Arc::new))
}
fn serialize_shared_input<S: serde::Serializer>(
    value: &Option<Arc<TargetInput>>,
    s: S,
) -> Result<S::Ok, S::Error> {
    value.as_deref().serialize(s)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetProfile {
    pub federal_state: String,
    pub weekly_minutes: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub holiday_region: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_shared_input",
        serialize_with = "serialize_shared_input"
    )]
    pub working_time_target: Option<Arc<TargetInput>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InputStatus {
    Loading,
    Ready,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TargetMode {
    Forecast,
    Roster,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetInput {
    pub status: InputStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<TargetContext>,
    #[serde(default, deserialize_with = "deserialize_optional_notices")]
    pub notices: Vec<TargetNotice>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<TargetMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub youth_protection: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub youth_protection_status: Option<InputStatus>,
}
fn deserialize_optional_notices<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Vec<TargetNotice>, D::Error> {
    Ok(Option::<Vec<TargetNotice>>::deserialize(d)?.unwrap_or_default())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WorkModel {
    FixedWeek {
        #[serde(rename = "weekdayMinutes")]
        weekday_minutes: Vec<i64>,
    },
    RotatingFiveInSeven {
        #[serde(rename = "monthlyReference")]
        monthly_reference: String,
        #[serde(
            rename = "sevenDayShiftPlanConfirmed",
            deserialize_with = "required_nullable_bool"
        )]
        seven_day_shift_plan_confirmed: Option<bool>,
    },
    Unknown,
}
impl WorkModel {
    pub(crate) fn fixed(&self) -> Option<&[i64]> {
        if let Self::FixedWeek { weekday_minutes } = self {
            Some(weekday_minutes)
        } else {
            None
        }
    }
    pub(crate) fn rotating(&self) -> bool {
        matches!(self, Self::RotatingFiveInSeven { .. })
    }
    pub(crate) fn confirmed(&self) -> Option<bool> {
        match self {
            Self::RotatingFiveInSeven {
                seven_day_shift_plan_confirmed,
                ..
            } => *seven_day_shift_plan_confirmed,
            Self::FixedWeek { .. } | Self::Unknown => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TariffKind {
    TvoedK,
    TvoedB,
    TvlKr,
    TvhKr,
    TvaoedK,
    TvaoedB,
    TvalCommon,
    TvalGeneral,
    TvalKr,
    TvukNursing,
    Custom,
    Unverified,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetTariff {
    pub kind: TariffKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    // Presence of nullable required fields is checked at the JSON/domain boundary, not inferred here.
    #[serde(default)]
    pub scope_confirmed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_rule_confirmed: Option<bool>,
}
impl<'de> Deserialize<'de> for TargetTariff {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = serde_json::Value::deserialize(deserializer)?;
        let object = value
            .as_object()
            .ok_or_else(|| serde::de::Error::custom("Invalid target tariff"))?;
        let kind: TariffKind = serde_json::from_value(
            object
                .get("kind")
                .cloned()
                .ok_or_else(|| serde::de::Error::custom("Missing target tariff kind"))?,
        )
        .map_err(|_| serde::de::Error::custom("Invalid target tariff kind"))?;
        let nullable = |key: &str, required: bool| -> Result<Option<bool>, D::Error> {
            match object.get(key) {
                Some(serde_json::Value::Null) => Ok(None),
                Some(serde_json::Value::Bool(value)) => Ok(Some(*value)),
                None if !required => Ok(None),
                _ => Err(serde::de::Error::custom(
                    "Invalid target tariff confirmation",
                )),
            }
        };
        let reviewed = !matches!(kind, TariffKind::Custom | TariffKind::Unverified);
        let version = object
            .get("version")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned);
        if reviewed && version.is_none() {
            return Err(serde::de::Error::custom("Missing target tariff version"));
        }
        let id = object
            .get("id")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned);
        Ok(Self {
            kind,
            version,
            id,
            scope_confirmed: nullable("scopeConfirmed", reviewed)?,
            account_rule_confirmed: nullable(
                "accountRuleConfirmed",
                kind == TariffKind::TvukNursing,
            )?,
        })
    }
}
impl TargetTariff {
    pub(crate) fn reviewed_kind(&self) -> bool {
        !matches!(self.kind, TariffKind::Custom | TariffKind::Unverified)
    }
    pub(crate) fn training(&self) -> bool {
        matches!(
            self.kind,
            TariffKind::TvaoedK
                | TariffKind::TvaoedB
                | TariffKind::TvalCommon
                | TariffKind::TvalGeneral
                | TariffKind::TvalKr
        ) || self.kind == TariffKind::Unverified
            && self.id.as_deref().is_some_and(|id| id.starts_with("TVA_L"))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetPeriod {
    pub valid_from: String,
    #[serde(deserialize_with = "required_nullable_string")]
    pub valid_to: Option<String>,
    pub weekly_minutes: i64,
    pub federal_state: String,
    pub holiday_region: String,
    pub model: WorkModel,
    pub tariff: TargetTariff,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RosterStatus {
    Final,
    Draft,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Disposition {
    WorkRequired,
    RosterFree,
    Released,
    Unknown,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetDayFact {
    pub date: String,
    pub roster_status: RosterStatus,
    pub disposition: Disposition,
    #[serde(default)]
    pub lost_minutes: Option<i64>,
    #[serde(default)]
    pub must_work_elsewhere: Option<bool>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EmploymentBounds {
    pub from: String,
    #[serde(deserialize_with = "required_nullable_string")]
    pub to: Option<String>,
}
fn required_nullable_bool<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<bool>, D::Error> {
    Option::<bool>::deserialize(d)
}
fn required_nullable_string<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(d)
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TargetContext {
    pub periods: Vec<TargetPeriod>,
    pub days: Vec<TargetDayFact>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub employment: Option<EmploymentBounds>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetNotice {
    pub date: Option<String>,
    pub code: String,
    pub message: String,
    pub affects_target: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AdjustmentKind {
    StatutoryHoliday,
    TariffSpecialDay,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AdjustmentStatus {
    Confirmed,
    Pending,
    LegacyEstimate,
    PlanEstimate,
    ProfileEstimate,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleSource {
    pub rule_id: String,
    pub legal_basis: String,
    pub source_url: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetAdjustment {
    pub date: String,
    pub kind: AdjustmentKind,
    pub label: String,
    pub minutes: i64,
    #[serde(flatten)]
    pub source: RuleSource,
    pub condition: String,
    pub status: AdjustmentStatus,
}
#[derive(Debug, Clone)]
pub(crate) struct RawAdjustment {
    pub date: String,
    pub kind: AdjustmentKind,
    pub label: String,
    pub numerator: i64,
    pub source: RuleSource,
    pub condition: String,
    pub status: AdjustmentStatus,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyTarget {
    pub date: String,
    pub base_minutes: i64,
    pub statutory_reduction_minutes: i64,
    pub tariff_reduction_minutes: i64,
    pub rounding_minutes: i64,
    pub target_minutes: Option<i64>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TargetStatus {
    Final,
    Provisional,
    Unavailable,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyTarget {
    pub month: String,
    pub status: TargetStatus,
    pub base_minutes: i64,
    pub statutory_reduction_minutes: i64,
    pub tariff_reduction_minutes: i64,
    pub rounding_minutes: i64,
    pub target_minutes: Option<i64>,
    pub adjustments: Vec<TargetAdjustment>,
    pub notices: Vec<TargetNotice>,
    pub days: Vec<DailyTarget>,
}
