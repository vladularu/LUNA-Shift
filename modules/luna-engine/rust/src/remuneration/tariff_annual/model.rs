use super::TariffAnnualError;
use crate::remuneration::Presence;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaimVersion {
    V1,
    V2,
    V3,
}
impl ClaimVersion {
    pub fn number(self) -> u8 {
        match self {
            Self::V1 => 1,
            Self::V2 => 2,
            Self::V3 => 3,
        }
    }
}
impl Serialize for ClaimVersion {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_u8(self.number())
    }
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimSelection {
    pub package_id: String,
    pub variant: String,
    pub region: String,
    pub group: String,
    pub confirmed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_at_september1_confirmed: Option<bool>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Takeover {
    pub immediate: Option<bool>,
    pub same_employer: Option<bool>,
    pub employed_december1: Option<bool>,
}
#[derive(Debug, Clone, Serialize)]
pub struct ClaimEmployment {
    pub start: Option<String>,
    pub end: Option<String>,
    pub confirmed: bool,
    pub takeover: Takeover,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EntitlementReason {
    Pay,
    None,
    Maternity,
    ParentalBirthYear,
    SickPaySupplement,
    MilitaryReturn,
    Unknown,
}
#[derive(Debug, Clone, Serialize)]
pub struct Entitlement {
    pub month: u8,
    pub reason: EntitlementReason,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimExceptions {
    pub birth_year: Option<i32>,
    pub pay_before_parental_leave: Option<bool>,
    pub military_return_before_december1: Option<bool>,
    #[serde(skip_serializing_if = "Presence::is_missing")]
    pub tvl_legacy_retirement_exit: Presence<bool>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimAllocation {
    pub required: Option<bool>,
    pub twelfths_numerator: Option<i64>,
    pub twelfths_denominator: Option<i64>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BasisMonth {
    pub month: String,
    pub components_confirmed: bool,
    pub base_cents: Option<i64>,
    pub fixed_cents: Option<i64>,
    pub variable_cents: Option<i64>,
    pub scheduled_overtime_cents: Option<i64>,
    pub paid_calendar_days: Option<i64>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimBasis {
    pub months: Vec<BasisMonth>,
    pub last_full_pay_month: Option<String>,
    pub parental_part_time: Option<bool>,
    pub adjusted_monthly_cents: Option<i64>,
    pub takeover_monthly_cents: Option<i64>,
}
#[derive(Debug, Clone, Serialize)]
pub struct ClaimData {
    pub version: ClaimVersion,
    pub id: String,
    pub year: i32,
    pub selection: ClaimSelection,
    pub employment: ClaimEmployment,
    pub entitlements: Vec<Entitlement>,
    pub exceptions: ClaimExceptions,
    pub allocation: ClaimAllocation,
    pub basis: ClaimBasis,
}
/// Only the complete native validator can construct this detached claim snapshot.
#[derive(Debug, Clone, Serialize)]
#[serde(transparent)]
pub struct ValidatedClaim(pub(super) ClaimData);
impl ValidatedClaim {
    pub fn data(&self) -> &ClaimData {
        &self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub enum EligibilityPolicy {
    #[serde(rename = "EMPLOYED_DECEMBER_1")]
    EmployedDecember1,
    #[serde(rename = "BT_K_EARLY_EXIT")]
    BtKEarlyExit,
    #[serde(rename = "TRAINING_OR_DIRECT_TAKEOVER_DECEMBER_1")]
    TrainingTakeover,
    #[serde(rename = "TVL_DECEMBER_1_OR_LEGACY_ATZ")]
    TvlLegacyAtz,
    #[serde(rename = "TVAL_TRAINING_OR_DIRECT_TAKEOVER_DECEMBER_1")]
    TvalTrainingTakeover,
    #[serde(rename = "CARITAS_31_EARLY_EXIT")]
    CaritasEarlyExit,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub enum CalculationPolicy {
    #[serde(rename = "TVOED_VKA_20")]
    TvoedVka20,
    #[serde(rename = "TVL_20")]
    Tvl20,
    #[serde(rename = "TVAOED_PFLEGE_14")]
    TvaoedPflege14,
    #[serde(rename = "TVAL_PFLEGE_16")]
    TvalPflege16,
    #[serde(rename = "CARITAS_16")]
    Caritas16,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EarlyExitBasis {
    None,
    LastFullMonthTableAndFixedAllowances,
    LastThreeMonthsTvl,
}
#[derive(Debug, Clone)]
pub struct AnnualCalculationRule {
    pub(crate) eligibility_policy: EligibilityPolicy,
    pub(crate) reduction_policy: CalculationPolicy,
    pub(crate) basis_policy: CalculationPolicy,
    pub(crate) early_exit_basis: EarlyExitBasis,
    pub(crate) reference_months: Vec<u8>,
    pub(crate) late_entry_after_month: u8,
}
impl AnnualCalculationRule {
    pub fn from_json(value: &Value) -> Result<Self, TariffAnnualError> {
        let rows = value["referenceMonths"]
            .as_array()
            .filter(|r| !r.is_empty() && r.len() <= 12)
            .ok_or(TariffAnnualError::Rule)?;
        let reference_months = rows
            .iter()
            .map(|v| {
                super::integer(v, 1, 12)
                    .map(|n| n as u8)
                    .map_err(|_| TariffAnnualError::Rule)
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            eligibility_policy: EligibilityPolicy::deserialize(&value["eligibilityPolicy"])
                .map_err(|_| TariffAnnualError::Rule)?,
            reduction_policy: CalculationPolicy::deserialize(&value["reductionPolicy"])
                .map_err(|_| TariffAnnualError::Rule)?,
            basis_policy: CalculationPolicy::deserialize(&value["basisPolicy"])
                .map_err(|_| TariffAnnualError::Rule)?,
            early_exit_basis: EarlyExitBasis::deserialize(&value["earlyExitBasis"])
                .map_err(|_| TariffAnnualError::Rule)?,
            reference_months,
            late_entry_after_month: super::integer(&value["lateEntryAfterMonth"], 1, 12)
                .map_err(|_| TariffAnnualError::Rule)? as u8,
        })
    }
}
#[derive(Debug, Clone, Serialize)]
pub struct Twelfths {
    pub numerator: i64,
    pub denominator: i64,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnualEligibility {
    pub eligible: Option<bool>,
    pub takeover: bool,
    pub early_exit: bool,
    pub twelfths: Option<Twelfths>,
    pub missing: Vec<String>,
}
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BasisMethod {
    ReferenceAverage,
    PaidCalendarDays,
    LastFullPayMonth,
    FirstFullMonth,
    #[serde(rename = "BT_K_LAST_MONTH")]
    BtKLastMonth,
    CaritasLastMonth,
    ParentalAdjustment,
    TakeoverConfirmed,
    NovemberTrainingPay,
}
impl BasisMethod {
    pub fn text(self) -> &'static str {
        match self {
            Self::ReferenceAverage => "REFERENCE_AVERAGE",
            Self::PaidCalendarDays => "PAID_CALENDAR_DAYS",
            Self::LastFullPayMonth => "LAST_FULL_PAY_MONTH",
            Self::FirstFullMonth => "FIRST_FULL_MONTH",
            Self::BtKLastMonth => "BT_K_LAST_MONTH",
            Self::CaritasLastMonth => "CARITAS_LAST_MONTH",
            Self::ParentalAdjustment => "PARENTAL_ADJUSTMENT",
            Self::TakeoverConfirmed => "TAKEOVER_CONFIRMED",
            Self::NovemberTrainingPay => "NOVEMBER_TRAINING_PAY",
        }
    }
}
#[derive(Debug, Clone)]
pub struct AnnualBasis {
    pub numerator: num_bigint::BigInt,
    pub denominator: num_bigint::BigInt,
    pub method: BasisMethod,
    pub months: Vec<String>,
}
#[derive(Debug, Clone)]
pub struct BasisResult {
    pub basis: Option<AnnualBasis>,
    pub missing: Vec<String>,
}
