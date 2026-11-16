use serde::Serialize;
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfirmationKind {
    AnnexA,
    SueMonth,
    SueAllowance,
}
#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum FullTimeReference {
    Annex {
        #[serde(rename = "comparableFullTimeWeeklyMinutes")]
        minutes: i64,
    },
    Sue {
        #[serde(rename = "standardFullTimeWeeklyMinutes")]
        minutes: i64,
    },
}
impl FullTimeReference {
    pub fn minutes(&self) -> i64 {
        match self {
            Self::Annex { minutes } | Self::Sue { minutes } => *minutes,
        }
    }
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmationIdentity<'a> {
    pub(super) month: String,
    pub(super) profile_effective_from: &'a str,
    pub(super) profile_revision: i64,
    pub(super) package_id: &'a str,
    pub(super) rule_version_id: &'a str,
    pub(super) variant_id: &'a str,
    pub(super) region_id: &'a str,
    pub(super) group_id: &'a str,
    pub(super) step_id: &'a str,
    pub(super) contracted_weekly_minutes: i64,
    #[serde(flatten)]
    pub(super) full_time: FullTimeReference,
    pub(super) revision: i64,
    pub(super) confirmed_at: &'a str,
    pub(super) updated_at: &'a str,
}
impl ConfirmationIdentity<'_> {
    pub fn month(&self) -> &str {
        &self.month
    }
}
#[derive(Debug, Clone, Copy, Serialize)]
pub enum CaseGroup {
    #[serde(rename = "6")]
    Six,
    #[serde(rename = "OTHER")]
    Other,
}
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConversionDays {
    NoneConfirmed,
    Taken,
}
#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum ConfirmationAnswers {
    Annex {
        #[serde(rename = "applicabilityConfirmed")]
        applicability: Option<bool>,
        #[serde(rename = "comparableFullTimeConfirmed")]
        full_time: Option<bool>,
        #[serde(rename = "fullMonthBaseEntitlementConfirmed")]
        base: Option<bool>,
        #[serde(rename = "fullMonthSameContractConfirmed")]
        contract: Option<bool>,
    },
    Sue {
        #[serde(rename = "tariffApplicabilityConfirmed")]
        applicability: Option<bool>,
        #[serde(rename = "sueClassificationConfirmed")]
        classification: Option<bool>,
        #[serde(rename = "standardFullTimeConfirmed")]
        full_time: Option<bool>,
        #[serde(rename = "fullMonthBaseEntitlementConfirmed")]
        base: Option<bool>,
        #[serde(rename = "fullMonthSameContractConfirmed")]
        contract: Option<bool>,
    },
    SueAllowance {
        #[serde(rename = "sectionXxivClassificationConfirmed")]
        classification: Option<bool>,
        #[serde(rename = "fullMonthAllowanceEntitlementConfirmed")]
        entitlement: Option<bool>,
        #[serde(rename = "caseGroup")]
        case_group: Option<CaseGroup>,
        #[serde(rename = "conversionDays")]
        conversion_days: Option<ConversionDays>,
    },
}
/// Only the strict native validators can construct a persisted confirmation.
#[derive(Debug, Clone, Serialize)]
pub struct SavedDraftConfirmation<'a> {
    #[serde(flatten)]
    pub(super) identity: ConfirmationIdentity<'a>,
    #[serde(flatten)]
    pub(super) answers: ConfirmationAnswers,
}
impl SavedDraftConfirmation<'_> {
    pub fn kind(&self) -> ConfirmationKind {
        match self.answers {
            ConfirmationAnswers::Annex { .. } => ConfirmationKind::AnnexA,
            ConfirmationAnswers::Sue { .. } => ConfirmationKind::SueMonth,
            ConfirmationAnswers::SueAllowance { .. } => ConfirmationKind::SueAllowance,
        }
    }
    pub fn identity(&self) -> &ConfirmationIdentity<'_> {
        &self.identity
    }
    pub fn answers(&self) -> &ConfirmationAnswers {
        &self.answers
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LocalAgreement {
    Unknown,
    NoneConfirmed,
    Different,
}
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WorkKind {
    RegularActive,
    Special,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayDecision<'a> {
    pub(super) shift_id: &'a str,
    pub(super) date: String,
    pub(super) origin: &'static str,
    pub(super) shift_binding: &'a str,
    pub(super) work_kind: Option<WorkKind>,
    pub(super) holiday_time_off: Option<bool>,
    pub(super) shift_work: Option<bool>,
    pub(super) legacy_angestellte_class: Option<bool>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedPremiumFacts<'a> {
    #[serde(flatten)]
    pub(super) identity: ConfirmationIdentity<'a>,
    pub(super) time_zone_id: &'static str,
    pub(super) cash_payment_confirmed: Option<bool>,
    pub(super) local_agreement: LocalAgreement,
    pub(super) day_decisions: Vec<DayDecision<'a>>,
    /// Retained immutable raw facts for the native work bridge. Not a calculated input.
    #[serde(skip)]
    pub(super) original_day_decisions: &'a [serde_json::Value],
}
impl SavedPremiumFacts<'_> {
    pub fn identity(&self) -> &ConfirmationIdentity<'_> {
        &self.identity
    }
    pub fn day_decisions(&self) -> &[serde_json::Value] {
        self.original_day_decisions
    }
    pub fn cash_confirmed(&self) -> bool {
        self.cash_payment_confirmed == Some(true)
    }
    pub fn local_agreement(&self) -> &'static str {
        match self.local_agreement {
            LocalAgreement::Unknown => "UNKNOWN",
            LocalAgreement::NoneConfirmed => "NONE_CONFIRMED",
            LocalAgreement::Different => "DIFFERENT",
        }
    }
}
