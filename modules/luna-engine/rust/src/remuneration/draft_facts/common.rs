use super::{DraftFactsError, model::*};
use crate::{
    employment::require_remuneration_date,
    input::{calendar::require_local_month, javascript_instant_milliseconds, require_instant},
};
use serde_json::{Map, Value};
pub(super) const ID_KEYS: &[&str] = &[
    "month",
    "profileEffectiveFrom",
    "profileRevision",
    "packageId",
    "ruleVersionId",
    "variantId",
    "regionId",
    "groupId",
    "stepId",
    "contractedWeeklyMinutes",
    "revision",
    "confirmedAt",
    "updatedAt",
];
pub(super) fn exact<'a>(
    value: &'a Value,
    keys: &[&str],
    object: &'static str,
    format: &'static str,
) -> Result<&'a Map<String, Value>, DraftFactsError> {
    let row = value.as_object().ok_or(DraftFactsError::Message(object))?;
    if row.len() != keys.len() || keys.iter().any(|key| !row.contains_key(*key)) {
        return Err(DraftFactsError::Message(format));
    }
    Ok(row)
}
pub(super) fn safe(value: &Value, min: i64, max: i64) -> bool {
    value
        .as_f64()
        .is_some_and(|n| n.fract() == 0.0 && n >= min as f64 && n <= max as f64)
}
pub(super) fn integer(value: &Value) -> i64 {
    value.as_f64().unwrap_or(0.0) as i64
}
// ECMAScript /[a-z]/iu additionally folds long-s and Kelvin sign into ASCII.
pub(super) fn version_id(value: &Value) -> bool {
    value.as_str().is_some_and(|s| {
        let mut chars = s.chars();
        let alnum = |c: char| c.is_ascii_alphanumeric() || matches!(c, 'ſ' | 'K');
        chars.next().is_some_and(alnum)
            && s.chars().count() <= 101
            && chars.all(|c| alnum(c) || "._-".contains(c))
    })
}
fn annex_group(group: &str) -> bool {
    let Some(group) = group.strip_prefix("eg") else {
        return false;
    };
    let number = group.strip_suffix(['a', 'b', 'c']).unwrap_or(group);
    !number.is_empty()
        && !number.starts_with('0')
        && number.bytes().all(|b| b.is_ascii_digit())
        && number.parse::<u8>().is_ok_and(|n| (1..=15).contains(&n))
}
pub(super) fn assignment(
    row: &Map<String, Value>,
    kind: ConfirmationKind,
) -> Result<(), DraftFactsError> {
    let annex = kind == ConfirmationKind::AnnexA;
    let group = row["groupId"].as_str().unwrap_or("");
    let valid = if annex {
        row["packageId"] == "tvoed-vka-anlage-a"
            && (row["variantId"] == "BT_K" || row["variantId"] == "BT_B")
            && annex_group(group)
    } else {
        row["packageId"] == "tvoed-vka-sue-bt-b"
            && row["variantId"] == "BT_B"
            && [
                "s18", "s17", "s16", "s15", "s14", "s13", "s12", "s11b", "s11a", "s9", "s8b",
                "s8a", "s7", "s4", "s3", "s2",
            ]
            .contains(&group)
    };
    if !valid
        || row["regionId"] != "VKA"
        || !version_id(&row["ruleVersionId"])
        || !row["stepId"].as_str().is_some_and(|s| {
            s.len() == 2 && s.starts_with('s') && matches!(s.as_bytes()[1], b'1'..=b'6')
        })
    {
        return Err(DraftFactsError::Message(if annex {
            "Ungültige TVöD-Tarifzuordnung."
        } else {
            "Ungültige SuE-Tarifzuordnung."
        }));
    }
    Ok(())
}
pub(super) fn revisions_and_weekly(
    row: &Map<String, Value>,
    kind: ConfirmationKind,
) -> Result<(), DraftFactsError> {
    for key in ["profileRevision", "revision"] {
        if !safe(&row[key], 1, crate::money::MAX_SAFE_INTEGER) {
            return Err(DraftFactsError::Message(match kind {
                ConfirmationKind::AnnexA => "Ungültige Bestätigungsrevision.",
                ConfirmationKind::SueMonth => "Ungültige SuE-Bestätigungsrevision.",
                ConfirmationKind::SueAllowance => "Ungültige SuE-Zulagenrevision.",
            }));
        }
    }
    let annex = kind == ConfirmationKind::AnnexA;
    let valid = if annex {
        safe(&row["contractedWeeklyMinutes"], 1, 2520)
            && safe(&row["comparableFullTimeWeeklyMinutes"], 1, 2520)
            && integer(&row["contractedWeeklyMinutes"])
                <= integer(&row["comparableFullTimeWeeklyMinutes"])
    } else {
        safe(&row["contractedWeeklyMinutes"], 1, 2340)
            && row["standardFullTimeWeeklyMinutes"].as_f64() == Some(2340.0)
    };
    if !valid {
        return Err(DraftFactsError::Message(if annex {
            "Ungültige TVöD-Wochenarbeitszeit."
        } else {
            "Ungültige SuE-Wochenarbeitszeit."
        }));
    }
    Ok(())
}
pub(super) fn tri(value: &Value, message: &'static str) -> Result<Option<bool>, DraftFactsError> {
    if value.is_null() {
        Ok(None)
    } else {
        value
            .as_bool()
            .map(Some)
            .ok_or(DraftFactsError::Message(message))
    }
}
pub(super) fn identity<'a>(
    row: &'a Map<String, Value>,
    kind: ConfirmationKind,
) -> Result<ConfirmationIdentity<'a>, DraftFactsError> {
    let confirmed_at = require_instant(&row["confirmedAt"], "Bestätigung")?;
    let updated_at = require_instant(&row["updatedAt"], "Aktualisierung")?;
    if javascript_instant_milliseconds(confirmed_at)
        .zip(javascript_instant_milliseconds(updated_at))
        .is_some_and(|(a, b)| a > b)
    {
        return Err(DraftFactsError::Message(match kind {
            ConfirmationKind::AnnexA => "Ungültiger Bestätigungszeitpunkt.",
            ConfirmationKind::SueMonth => "Ungültiger SuE-Bestätigungszeitpunkt.",
            ConfirmationKind::SueAllowance => "Ungültiger SuE-Zulagenbestätigungszeitpunkt.",
        }));
    }
    let month = require_local_month(&row["month"])?;
    let profile_effective_from = row["profileEffectiveFrom"]
        .as_str()
        .ok_or(crate::employment::EmploymentError::InvalidDate)?;
    require_remuneration_date(profile_effective_from)?;
    let text = |key: &str| row[key].as_str().ok_or(DraftFactsError::InvalidProfile);
    Ok(ConfirmationIdentity {
        month,
        profile_effective_from,
        profile_revision: integer(&row["profileRevision"]),
        package_id: text("packageId")?,
        rule_version_id: text("ruleVersionId")?,
        variant_id: text("variantId")?,
        region_id: text("regionId")?,
        group_id: text("groupId")?,
        step_id: text("stepId")?,
        contracted_weekly_minutes: integer(&row["contractedWeeklyMinutes"]),
        full_time: if kind == ConfirmationKind::AnnexA {
            FullTimeReference::Annex {
                minutes: integer(&row["comparableFullTimeWeeklyMinutes"]),
            }
        } else {
            FullTimeReference::Sue { minutes: 2340 }
        },
        revision: integer(&row["revision"]),
        confirmed_at,
        updated_at,
    })
}
