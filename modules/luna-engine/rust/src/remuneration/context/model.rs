use super::{rows, text};
use crate::{
    employment::EmploymentError,
    remuneration::{
        care::{TvalCareAllowances, TvlCareAllowances},
        own_config::OwnConfiguration,
        profile::{TrainingSpecialDutyAllowance, TvalEmployerScope, TvlEmploymentCategory},
    },
    rules::RulePackage,
};
use serde::Serialize;
use serde_json::Value;
use std::borrow::Cow;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IssueCode {
    ProfileMissing,
    EffectiveDateUnknown,
    ProfileInvalid,
    RemunerationUnconfigured,
    TariffUnsupported,
    RulePackageNotFound,
    RulePackageAmbiguous,
    TableSelectionInvalid,
    TableEntryMissing,
    TableEntryAmbiguous,
    WeeklyTimeMissing,
    OwnProrationUnconfirmed,
    OwnHourlyInputMissing,
    PaidAbsenceUnconfirmed,
    WorkTimeMissing,
    OwnComponentsNotConnected,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RemunerationIssue {
    pub code: IssueCode,
    pub message: String,
}
impl RemunerationIssue {
    pub fn new(code: IssueCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}
#[derive(Debug, Clone, Serialize)]
pub struct SourceReference<'a> {
    pub id: Option<Cow<'a, str>>,
    pub title: Option<&'a str>,
    pub url: Option<&'a str>,
    pub section: Option<&'a str>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemunerationSource<'a> {
    pub kind: &'static str,
    pub profile_effective_from: Option<&'a str>,
    pub profile_revision: Option<i64>,
    pub requested_package_id: Option<&'a str>,
    pub package_id: Option<&'a str>,
    pub version_id: Option<&'a str>,
    pub package_valid_from: Option<&'a str>,
    pub package_valid_to: Option<&'a str>,
    pub references: Vec<SourceReference<'a>>,
}
impl<'a> RemunerationSource<'a> {
    pub fn new(profile: Option<&'a Value>, pkg: Option<&'a RulePackage>) -> Self {
        let selection = profile.map(|p| &p["data"]["selection"]);
        Self {
            kind: if pkg.is_some() { "tariff" } else { "profile" },
            profile_effective_from: profile.and_then(|p| text(p, "effectiveFrom")),
            profile_revision: profile.and_then(|p| {
                p["revision"]
                    .as_f64()
                    .filter(|n| {
                        n.fract() == 0.0 && n.abs() <= crate::money::MAX_SAFE_INTEGER as f64
                    })
                    .map(|n| n as i64)
            }),
            requested_package_id: selection
                .filter(|s| s["kind"] == "tariff")
                .and_then(|s| text(s, "packageId")),
            package_id: pkg.map(|p| p.package_id.as_str()),
            version_id: pkg.map(|p| p.version_id.as_str()),
            package_valid_from: pkg.map(|p| p.valid_from.as_str()),
            package_valid_to: pkg.and_then(|p| p.valid_to.as_deref()),
            references: pkg
                .and_then(RulePackage::sources)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .map(|r| SourceReference {
                    id: text(r, "id").map(Cow::Borrowed),
                    title: text(r, "title"),
                    url: text(r, "url"),
                    section: text(r, "section"),
                })
                .collect(),
        }
    }
}
#[derive(Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ContextKind<'a> {
    Unavailable {
        issue: RemunerationIssue,
    },
    OwnConfigured {
        configuration: OwnConfiguration,
        weekly_minutes: i64,
    },
    OwnMonthly {
        monthly_cents: i64,
        weekly_minutes: i64,
    },
    Tariff {
        rule_package: &'a RulePackage,
        monthly_cents: i64,
        weekly_minutes: i64,
        full_time_weekly_minutes: i64,
    },
    TrainingTariff {
        rule_package: &'a RulePackage,
        monthly_cents: i64,
        weekly_minutes: i64,
        full_time_weekly_minutes: i64,
        category_label: &'a str,
        training_year: u8,
        sector: String,
        tariff_region: String,
        special_duty_allowance: Option<TrainingSpecialDutyAllowance>,
    },
    TvlKr {
        rule_package: &'a RulePackage,
        monthly_cents: i64,
        weekly_minutes: i64,
        full_time_weekly_minutes: i64,
        group_id: String,
        employment_category: Option<TvlEmploymentCategory>,
        care_allowances: Option<TvlCareAllowances>,
    },
    TvalTraining {
        rule_package: &'a RulePackage,
        monthly_cents: i64,
        weekly_minutes: i64,
        full_time_weekly_minutes: i64,
        category_label: &'a str,
        period_label: &'a str,
        employer_scope: Option<TvalEmployerScope>,
        employment_category: Option<TvlEmploymentCategory>,
        care_allowances: Option<TvalCareAllowances>,
    },
    TvoedAnnexADraft {
        rule_package: &'a RulePackage,
        weekly_minutes: i64,
        full_time_weekly_minutes: i64,
        variant: String,
        group_id: String,
        step_id: String,
    },
    TvoedSueDraft {
        rule_package: &'a RulePackage,
        weekly_minutes: i64,
        full_time_weekly_minutes: i64,
        group_id: String,
        step_id: String,
    },
}
impl ContextKind<'_> {
    pub fn rule_package(&self) -> Option<&RulePackage> {
        match self {
            Self::Tariff { rule_package, .. }
            | Self::TrainingTariff { rule_package, .. }
            | Self::TvlKr { rule_package, .. }
            | Self::TvalTraining { rule_package, .. }
            | Self::TvoedAnnexADraft { rule_package, .. }
            | Self::TvoedSueDraft { rule_package, .. } => Some(*rule_package),
            _ => None,
        }
    }
}
#[derive(Debug, Serialize)]
pub struct RemunerationContext<'a> {
    pub profile: Option<&'a Value>,
    pub source: RemunerationSource<'a>,
    #[serde(flatten)]
    pub kind: ContextKind<'a>,
}
impl<'a> RemunerationContext<'a> {
    pub fn unavailable(
        profile: Option<&'a Value>,
        code: IssueCode,
        message: impl Into<String>,
        pkg: Option<&'a RulePackage>,
    ) -> Self {
        Self {
            profile,
            source: RemunerationSource::new(profile, pkg),
            kind: ContextKind::Unavailable {
                issue: RemunerationIssue::new(code, message),
            },
        }
    }
}
#[derive(Debug, Serialize)]
pub struct RemunerationPeriod<'a> {
    pub from: String,
    pub through: String,
    pub context: RemunerationContext<'a>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContextError {
    Employment(EmploymentError),
    RuleValidationUnavailable,
    InvalidRule,
    InvalidMonth,
}
impl From<EmploymentError> for ContextError {
    fn from(e: EmploymentError) -> Self {
        Self::Employment(e)
    }
}
impl std::fmt::Display for ContextError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Employment(e) => e.fmt(f),
            Self::RuleValidationUnavailable => {
                f.write_str("Native rule validation is not implemented")
            }
            Self::InvalidRule => f.write_str("Invalid remuneration rule"),
            Self::InvalidMonth => f.write_str("Ungültiger Vergütungsmonat."),
        }
    }
}
impl std::error::Error for ContextError {}

/// Mandatory in-process native validation dependency. There is no wire validation flag.
/// The production implementation must cache full schema+semantic validation per immutable package.
pub trait NativePackageValidator {
    fn validate(&self, package: &RulePackage) -> Result<bool, ContextError>;
}
/// Full native schema/common/family/generic validation cached by the immutable
/// package body and guarded header identity. No caller validity flag is used.
#[derive(Debug, Clone, Copy, Default)]
pub struct FullNativePackageValidator;
impl NativePackageValidator for FullNativePackageValidator {
    fn validate(&self, package: &RulePackage) -> Result<bool, ContextError> {
        crate::rules::validation::validate_tariff_package(package)
            .map_err(|_| ContextError::RuleValidationUnavailable)
    }
}

pub(super) fn entries<'a>(pkg: &'a RulePackage, group: &str, step: &str) -> Vec<&'a Value> {
    let r = pkg.rules();
    rows(r, "payTables")
        .iter()
        .filter(|t| t["id"] == r["selector"]["payTableId"])
        .flat_map(|t| rows(t, "entries"))
        .filter(|e| e["groupId"] == group && e["stepId"] == step)
        .collect()
}
