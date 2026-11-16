use super::{DraftFactsError, common::*, model::*};
use serde_json::Value;
pub fn validate_saved_draft_confirmation(
    value: &Value,
    kind: ConfirmationKind,
) -> Result<SavedDraftConfirmation<'_>, DraftFactsError> {
    let (fields, object, format): (&[&str], _, _) = match kind {
        ConfirmationKind::AnnexA => (
            &[
                "comparableFullTimeWeeklyMinutes",
                "applicabilityConfirmed",
                "comparableFullTimeConfirmed",
                "fullMonthBaseEntitlementConfirmed",
                "fullMonthSameContractConfirmed",
            ],
            "Ungültige TVöD-Monatsbestätigung.",
            "Unbekanntes Format der TVöD-Monatsbestätigung.",
        ),
        ConfirmationKind::SueMonth => (
            &[
                "standardFullTimeWeeklyMinutes",
                "tariffApplicabilityConfirmed",
                "sueClassificationConfirmed",
                "standardFullTimeConfirmed",
                "fullMonthBaseEntitlementConfirmed",
                "fullMonthSameContractConfirmed",
            ],
            "Ungültige SuE-Monatsbestätigung.",
            "Unbekanntes Format der SuE-Monatsbestätigung.",
        ),
        ConfirmationKind::SueAllowance => (
            &[
                "standardFullTimeWeeklyMinutes",
                "sectionXxivClassificationConfirmed",
                "fullMonthAllowanceEntitlementConfirmed",
                "caseGroup",
                "conversionDays",
            ],
            "Ungültige SuE-Zulagenbestätigung.",
            "Unbekanntes Format der SuE-Zulagenbestätigung.",
        ),
    };
    let keys: Vec<_> = ID_KEYS.iter().chain(fields).copied().collect();
    let raw = exact(value, &keys, object, format)?;
    assignment(raw, kind)?;
    revisions_and_weekly(raw, kind)?;
    let answers = match kind {
        ConfirmationKind::AnnexA => {
            let read = |key: &str| tri(&raw[key], "Ungültige TVöD-Anspruchsbestätigung.");
            ConfirmationAnswers::Annex {
                applicability: read("applicabilityConfirmed")?,
                full_time: read("comparableFullTimeConfirmed")?,
                base: read("fullMonthBaseEntitlementConfirmed")?,
                contract: read("fullMonthSameContractConfirmed")?,
            }
        }
        ConfirmationKind::SueMonth => {
            let read = |key: &str| tri(&raw[key], "Ungültige SuE-Anspruchsbestätigung.");
            ConfirmationAnswers::Sue {
                applicability: read("tariffApplicabilityConfirmed")?,
                classification: read("sueClassificationConfirmed")?,
                full_time: read("standardFullTimeConfirmed")?,
                base: read("fullMonthBaseEntitlementConfirmed")?,
                contract: read("fullMonthSameContractConfirmed")?,
            }
        }
        ConfirmationKind::SueAllowance => {
            let classification = tri(
                &raw["sectionXxivClassificationConfirmed"],
                "Ungültige SuE-Zulagenvoraussetzung.",
            )?;
            let entitlement = tri(
                &raw["fullMonthAllowanceEntitlementConfirmed"],
                "Ungültige SuE-Zulagenvoraussetzung.",
            )?;
            let case_group = match &raw["caseGroup"] {
                Value::Null => None,
                Value::String(s) if s == "6" => Some(CaseGroup::Six),
                Value::String(s) if s == "OTHER" => Some(CaseGroup::Other),
                _ => return Err(DraftFactsError::Message("Ungültige SuE-Fallgruppenangabe.")),
            };
            if raw["groupId"] != "s15" && case_group.is_some() {
                return Err(DraftFactsError::Message("Ungültige SuE-Fallgruppenangabe."));
            }
            let conversion_days = match &raw["conversionDays"] {
                Value::Null => None,
                Value::String(s) if s == "NONE_CONFIRMED" => Some(ConversionDays::NoneConfirmed),
                Value::String(s) if s == "TAKEN" => Some(ConversionDays::Taken),
                _ => {
                    return Err(DraftFactsError::Message(
                        "Ungültige SuE-Umwandlungstagsangabe.",
                    ));
                }
            };
            ConfirmationAnswers::SueAllowance {
                classification,
                entitlement,
                case_group,
                conversion_days,
            }
        }
    };
    Ok(SavedDraftConfirmation {
        identity: identity(raw, kind)?,
        answers,
    })
}
pub fn is_current_confirmation(
    value: &SavedDraftConfirmation<'_>,
    profile: &Value,
    rule_version_id: &str,
) -> Result<bool, DraftFactsError> {
    is_current_identity(&value.identity, profile, rule_version_id)
}
pub(super) fn is_current_identity(
    v: &ConfirmationIdentity<'_>,
    profile: &Value,
    rule_version_id: &str,
) -> Result<bool, DraftFactsError> {
    let selection = &profile["data"]["selection"];
    if profile["effectiveFrom"].as_str() != Some(v.profile_effective_from)
        || profile["revision"].as_f64() != Some(v.profile_revision as f64)
        || v.rule_version_id != rule_version_id
        || selection["kind"] != "tariff"
        || selection["packageId"] != v.package_id
        || selection["variant"] != v.variant_id
        || selection["region"] != v.region_id
    {
        return Ok(false);
    }
    let group = selection["group"]
        .as_str()
        .ok_or(DraftFactsError::InvalidProfile)?;
    Ok(group.to_lowercase() == v.group_id
        && selection["level"]
            .as_str()
            .is_some_and(|l| format!("s{l}") == v.step_id)
        && selection["fullTimeWeeklyMinutes"].as_f64() == Some(v.full_time.minutes() as f64)
        && profile["data"]["weeklyMinutes"].as_f64() == Some(v.contracted_weekly_minutes as f64))
}
