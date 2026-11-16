use super::{DraftPayError, rows, safe};
use crate::{
    remuneration::{
        base::{
            draft::{DraftBase, DraftFailure, SueInput, calculate_sue_draft_base},
            round_remuneration_cents,
        },
        context::model::FullNativePackageValidator,
    },
    rules::RulePackage,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SueAllowanceFailure {
    SectionXxivUnconfirmed,
    AllowanceEntitlementUnconfirmed,
    CaseGroupUnconfirmed,
    ConversionDaysUnresolved,
    AllowancePolicyMissing,
    AmountOverflow,
}
#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum SueFailure {
    Base(DraftFailure),
    Allowance(SueAllowanceFailure),
}
#[derive(Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum SueAllowanceResult<'a> {
    Unavailable {
        reason: SueFailure,
    },
    NotApplicable {
        group_id: String,
        source_ids: Vec<&'a str>,
    },
    DraftMonthlyAllowance {
        complete_gross: bool,
        full_time_allowance_cents: i64,
        personal_allowance_cents: i64,
        group_id: String,
        package_id: &'a str,
        version_id: &'a str,
        source_ids: Vec<&'a str>,
        excluded_components: [&'static str; 2],
    },
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SueAllowanceInput {
    #[serde(flatten)]
    pub base: SueInput,
    pub section_xxiv_classification_confirmed: bool,
    pub full_month_allowance_entitlement_confirmed: bool,
    pub case_group: CaseGroupSelection,
    pub conversion_days: ConversionSelection,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CaseGroupSelection {
    Unknown,
    #[serde(rename = "6")]
    Six,
    Other,
}
impl CaseGroupSelection {
    fn text(self) -> &'static str {
        match self {
            Self::Unknown => "UNKNOWN",
            Self::Six => "6",
            Self::Other => "OTHER",
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConversionSelection {
    Unknown,
    NoneConfirmed,
    Taken,
}
pub fn calculate_sue_draft_allowance<'a>(
    pkg: &'a RulePackage,
    input: &SueAllowanceInput,
) -> Result<SueAllowanceResult<'a>, DraftPayError> {
    let base = calculate_sue_draft_base(pkg, &input.base, &FullNativePackageValidator)?;
    let base = match base {
        DraftBase::Unavailable { reason } => {
            return Ok(SueAllowanceResult::Unavailable {
                reason: SueFailure::Base(reason),
            });
        }
        DraftBase::DraftTableBase(base) => base,
    };
    let unavailable = |reason| SueAllowanceResult::Unavailable {
        reason: SueFailure::Allowance(reason),
    };
    if !input.section_xxiv_classification_confirmed {
        return Ok(unavailable(SueAllowanceFailure::SectionXxivUnconfirmed));
    }
    if !input.full_month_allowance_entitlement_confirmed {
        return Ok(unavailable(
            SueAllowanceFailure::AllowanceEntitlementUnconfirmed,
        ));
    }
    let Some(policy) = pkg.rules().get("tvoedSueAllowancePolicy") else {
        return Ok(unavailable(SueAllowanceFailure::AllowancePolicyMissing));
    };
    let sources = || {
        rows(policy, "sourceIds")
            .iter()
            .filter_map(Value::as_str)
            .collect()
    };
    let Some(band) = rows(policy, "bands").iter().find(|b| {
        rows(b, "groupIds")
            .iter()
            .any(|g| g.as_str() == Some(base.group_id.as_str()))
    }) else {
        return Ok(SueAllowanceResult::NotApplicable {
            group_id: base.group_id,
            source_ids: sources(),
        });
    };
    if !band["caseGroup"].is_null() {
        if input.case_group == CaseGroupSelection::Unknown {
            return Ok(unavailable(SueAllowanceFailure::CaseGroupUnconfirmed));
        }
        if band["caseGroup"] != input.case_group.text() {
            return Ok(SueAllowanceResult::NotApplicable {
                group_id: base.group_id,
                source_ids: sources(),
            });
        }
    }
    if input.conversion_days != ConversionSelection::NoneConfirmed {
        return Ok(unavailable(SueAllowanceFailure::ConversionDaysUnresolved));
    }
    let monthly = band["monthlyCents"]
        .as_i64()
        .ok_or(DraftPayError::InvalidInput)?;
    let numerator = monthly as f64 * base.contracted_weekly_minutes;
    if !safe(numerator) {
        return Ok(unavailable(SueAllowanceFailure::AmountOverflow));
    }
    let full = base
        .standard_full_time_weekly_minutes
        .ok_or(DraftPayError::InvalidInput)?;
    Ok(SueAllowanceResult::DraftMonthlyAllowance {
        complete_gross: false,
        full_time_allowance_cents: monthly,
        personal_allowance_cents: round_remuneration_cents(numerator, full as f64)?,
        group_id: base.group_id,
        package_id: base.package_id,
        version_id: base.version_id,
        source_ids: sources(),
        excluded_components: ["CONVERSION_DAY_DEDUCTIONS", "OTHER_ALLOWANCES"],
    })
}
