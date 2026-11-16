//! Import-only bindings to already checked profile rows. No source admission.
use super::{InputError, draft_rows::DraftRowsKind};
use crate::remuneration::draft_facts::{self, model::ConfirmationKind};
use serde_json::Value;
fn fail(message: &str) -> InputError {
    InputError::source(message, "Error")
}
fn draft_error(error: draft_facts::DraftFactsError) -> InputError {
    match error {
        draft_facts::DraftFactsError::Input(error) => error,
        draft_facts::DraftFactsError::Employment(error) => {
            InputError::user_facing_source(error.to_string(), "RemunerationProfileError")
        }
        other => fail(&other.to_string()),
    }
}
/// Same historical-profile rule as the original backup helpers: an older
/// revision is inert, a missing/future profile is invalid, and only a current
/// revision must match the original tariff identity.
pub fn require_profile_parent(
    kind: DraftRowsKind,
    value: &Value,
    profiles: &[Value],
) -> Result<(), InputError> {
    let (missing, mismatch) = match kind {
        DraftRowsKind::AnnexAMonth => (
            "Ungültige Vergütungsprofilreferenz der TVöD-Monatsbestätigung.",
            "Widersprüchliche TVöD-Tarifzuordnung.",
        ),
        DraftRowsKind::SueMonth => (
            "Ungültige Vergütungsprofilreferenz der SuE-Monatsbestätigung.",
            "Widersprüchliche SuE-Tarifzuordnung.",
        ),
        DraftRowsKind::SueAllowance => (
            "Ungültige Vergütungsprofilreferenz der SuE-Zulagenbestätigung.",
            "Widersprüchliche SuE-Tarifzuordnung.",
        ),
        DraftRowsKind::AnnexAPremium => (
            "Ungültige Vergütungsprofilreferenz der TVöD-Zuschlagsdaten.",
            "Widersprüchliche TVöD-Zuschlagszuordnung.",
        ),
        DraftRowsKind::DrkEmployee => (
            "Ungültige Vergütungsprofilreferenz der DRK-Monatsbestätigung.",
            "Widersprüchliche DRK-Tarifzuordnung.",
        ),
        DraftRowsKind::CaritasMonth => (
            "Ungültige Vergütungsprofilreferenz der Caritas-Monatsbestätigung.",
            "Widersprüchliche Caritas-Tarifzuordnung.",
        ),
        _ => return Err(fail("Nicht unterstützte Import-Profilreferenz.")),
    };
    let profile = profiles
        .iter()
        .find(|profile| profile["effectiveFrom"] == value["profileEffectiveFrom"]);
    let Some(profile) = profile else {
        return Err(fail(missing));
    };
    let child_revision = value["profileRevision"]
        .as_f64()
        .ok_or_else(|| fail(missing))?;
    let profile_revision = profile["revision"].as_f64().ok_or_else(|| fail(missing))?;
    if child_revision > profile_revision {
        return Err(fail(missing));
    }
    if child_revision != profile_revision {
        return Ok(());
    }
    let version = value["ruleVersionId"].as_str().unwrap_or("");
    let current = match kind {
        DraftRowsKind::AnnexAMonth | DraftRowsKind::SueMonth | DraftRowsKind::SueAllowance => {
            let confirmation_kind = match kind {
                DraftRowsKind::AnnexAMonth => ConfirmationKind::AnnexA,
                DraftRowsKind::SueMonth => ConfirmationKind::SueMonth,
                _ => ConfirmationKind::SueAllowance,
            };
            let checked =
                draft_facts::month::validate_saved_draft_confirmation(value, confirmation_kind)
                    .map_err(draft_error)?;
            draft_facts::month::is_current_confirmation(&checked, profile, version)
                .map_err(draft_error)?
        }
        DraftRowsKind::AnnexAPremium => {
            let checked = draft_facts::premium::validate_saved_annex_a_premium_facts(value)
                .map_err(draft_error)?;
            draft_facts::premium::is_current_premium_facts(&checked, profile, version)
                .map_err(draft_error)?
        }
        DraftRowsKind::DrkEmployee => {
            crate::remuneration::drk::saved::is_current_employee(value, profile, version)
        }
        DraftRowsKind::CaritasMonth => {
            let selection = &profile["data"]["selection"];
            selection["kind"] == "tariff"
                && selection["packageId"] == value["packageId"]
                && selection["variant"] == value["variantId"]
                && selection["region"] == value["regionId"]
        }
        _ => unreachable!(),
    };
    if current { Ok(()) } else { Err(fail(mismatch)) }
}

#[cfg(test)]
mod original_reference {
    use super::*;
    use serde_json::json;
    #[test]
    fn original_profile_parent_revisions_and_tariff_identity_match() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../reference/backup-profile-parents-golden.json"
        ))
        .unwrap();
        assert_eq!(fixture["cases"].as_array().unwrap().len(), 2850);
        for case in fixture["cases"].as_array().unwrap() {
            let kind = match case["kind"].as_str().unwrap() {
                "annex" => DraftRowsKind::AnnexAMonth,
                "sue" => DraftRowsKind::SueMonth,
                "sueAllowance" => DraftRowsKind::SueAllowance,
                "premium" => DraftRowsKind::AnnexAPremium,
                "drkEmployee" => DraftRowsKind::DrkEmployee,
                "caritasMonth" => DraftRowsKind::CaritasMonth,
                other => panic!("unknown original family {other}"),
            };
            let input = &case["input"];
            let actual = match require_profile_parent(
                kind,
                &input["value"],
                input["profiles"].as_array().unwrap(),
            ) {
                Ok(()) => json!({"value":null}),
                Err(error) => {
                    json!({"error":{"name":error.name(),"message":error.message(),"userFacing":error.user_facing_message().is_some()}})
                }
            };
            assert_eq!(actual, case["expected"], "{}", case["id"]);
        }
    }
}
