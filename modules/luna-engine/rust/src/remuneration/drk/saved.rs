//! Exact saved DRK confirmation documents and raw-fact freshness; no assumed personal answers.
use crate::{
    employment::require_remuneration_date,
    input::{
        InputError, calendar::require_local_month, javascript_instant_milliseconds,
        raw_json::normalize_integral_numbers, require_instant, trim_javascript,
    },
};
use serde_json::{Map, Value};
pub const EMPLOYEE_FIELDS: &[&str] = &[
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
    "fullTimeWeeklyMinutes",
    "drkApplicabilityConfirmed",
    "annexAssignmentConfirmed",
    "payGroupAndStepConfirmed",
    "weeklyTimeBasisConfirmed",
    "fullMonthBaseEntitlementConfirmed",
    "revision",
    "confirmedAt",
    "updatedAt",
];
pub const TRAINING_FIELDS: &[&str] = &[
    "month",
    "remunerationProfileEffectiveFrom",
    "remunerationProfileRevision",
    "trainingProfileEffectiveFrom",
    "trainingProfileRevision",
    "packageId",
    "ruleVersionId",
    "variantId",
    "regionId",
    "groupId",
    "trainingYear",
    "weeklyMinutes",
    "fullTimeWeeklyMinutes",
    "trainingProfession",
    "trainingLegalBasis",
    "trainingStartedOn",
    "trainingExpectedEndOn",
    "trainingYearConfirmedFrom",
    "drkApplicabilityConfirmed",
    "trainingCategoryConfirmed",
    "trainingYearConfirmed",
    "fullMonthBaseEntitlementConfirmed",
    "fullTimeTrainingConfirmed",
    "revision",
    "confirmedAt",
    "updatedAt",
];
fn fail(message: &str) -> InputError {
    InputError::source(message, "Error")
}
fn record<'a>(
    value: &'a Value,
    keys: &[&str],
    invalid: &str,
    format: &str,
) -> Result<&'a Value, InputError> {
    let Some(row) = value.as_object() else {
        return Err(fail(invalid));
    };
    if row.len() != keys.len() || keys.iter().any(|k| !row.contains_key(*k)) {
        return Err(fail(format));
    }
    Ok(value)
}
fn integer(value: &Value, min: f64, max: f64) -> bool {
    value
        .as_f64()
        .is_some_and(|n| n.fract() == 0.0 && (min..=max).contains(&n))
}
fn rule_version(value: &Value) -> bool {
    let Some(text) = value.as_str() else {
        return false;
    };
    let mut chars = text.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    let alnum = |c: char| c.is_ascii_alphanumeric() || matches!(c, '\u{212A}' | '\u{017F}');
    alnum(first)
        && text.chars().count() <= 101
        && chars.all(|c| alnum(c) || matches!(c, '.' | '_' | '-'))
}
fn answer(value: &Value) -> bool {
    value.is_boolean() || value.is_null()
}
fn date(value: &Value) -> Result<&str, InputError> {
    value
        .as_str()
        .filter(|s| require_remuneration_date(s).is_ok())
        .ok_or_else(|| {
            InputError::user_facing_source(
                "Bitte ein gültiges Gültigkeitsdatum angeben.",
                "RemunerationProfileError",
            )
        })
}
fn chronology(row: &Value, message: &str) -> Result<(), InputError> {
    let confirmed = require_instant(&row["confirmedAt"], "Bestätigung")?;
    let updated = require_instant(&row["updatedAt"], "Aktualisierung")?;
    if javascript_instant_milliseconds(confirmed)
        .zip(javascript_instant_milliseconds(updated))
        .is_some_and(|(a, b)| a > b)
    {
        return Err(fail(message));
    }
    Ok(())
}
fn normalized(row: &Value, keys: &[&str]) -> Value {
    let mut out = Map::new();
    for key in keys {
        out.insert((*key).to_owned(), row[*key].clone());
    }
    let mut out = Value::Object(out);
    normalize_integral_numbers(&mut out);
    out
}
pub fn is_employee_package_id(value: &Value) -> bool {
    matches!(
        value.as_str(),
        Some("drk-rtv-e" | "drk-rtv-p" | "drk-rtv-s")
    )
}
pub fn is_training_variant(value: &Value) -> bool {
    matches!(
        value.as_str(),
        Some("ANLAGE_3" | "ANLAGE_3A_A" | "ANLAGE_3A_B")
    )
}
pub fn validate_employee(value: &Value) -> Result<Value, InputError> {
    let row = record(
        value,
        EMPLOYEE_FIELDS,
        "Ungültige DRK-Monatsbestätigung.",
        "Unbekanntes Format der DRK-Monatsbestätigung.",
    )?;
    let variant = match row["packageId"].as_str() {
        Some("drk-rtv-e") => "ANLAGE_A1",
        Some("drk-rtv-p") => "ANLAGE_A2",
        Some("drk-rtv-s") => "ANLAGE_A3",
        _ => "",
    };
    let group = row["groupId"].as_str();
    let step = row["stepId"].as_str();
    if variant.is_empty()
        || row["variantId"] != variant
        || row["regionId"] != "BTG"
        || !rule_version(&row["ruleVersionId"])
        || !group.is_some_and(|s| {
            !s.is_empty()
                && s.len() <= 16
                && s.as_bytes()[0].is_ascii_lowercase()
                && s.bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        })
        || !step.is_some_and(|s| {
            s.len() == 2 && s.as_bytes()[0] == b's' && (b'1'..=b'6').contains(&s.as_bytes()[1])
        })
    {
        return Err(fail("Ungültige DRK-Tarifzuordnung."));
    }
    for key in ["profileRevision", "revision"] {
        if !integer(&row[key], 1.0, 9007199254740991.0) {
            return Err(fail("Ungültige DRK-Bestätigungsrevision."));
        }
    }
    for key in ["contractedWeeklyMinutes", "fullTimeWeeklyMinutes"] {
        if !integer(&row[key], 1.0, 2520.0) {
            return Err(fail("Ungültige DRK-Wochenarbeitszeit."));
        }
    }
    if row["contractedWeeklyMinutes"].as_f64() > row["fullTimeWeeklyMinutes"].as_f64() {
        return Err(fail("Ungültige DRK-Wochenarbeitszeit."));
    }
    for key in [
        "drkApplicabilityConfirmed",
        "annexAssignmentConfirmed",
        "payGroupAndStepConfirmed",
        "weeklyTimeBasisConfirmed",
        "fullMonthBaseEntitlementConfirmed",
    ] {
        if !answer(&row[key]) {
            return Err(fail("Ungültige DRK-Anspruchsbestätigung."));
        }
    }
    chronology(row, "Ungültiger DRK-Bestätigungszeitpunkt.")?;
    require_local_month(&row["month"])?;
    date(&row["profileEffectiveFrom"])?;
    Ok(normalized(row, EMPLOYEE_FIELDS))
}
pub fn validate_training(value: &Value) -> Result<Value, InputError> {
    let row = record(
        value,
        TRAINING_FIELDS,
        "Ungültige DRK-Ausbildungsbestätigung.",
        "Unbekanntes Format der DRK-Ausbildungsbestätigung.",
    )?;
    if row["packageId"] != "drk-rtv-training"
        || !is_training_variant(&row["variantId"])
        || row["regionId"] != "BTG"
        || row["groupId"].as_str() != row["variantId"].as_str().and_then(super::base::category)
        || !rule_version(&row["ruleVersionId"])
    {
        return Err(fail("Ungültige DRK-Ausbildungstarifzuordnung."));
    }
    for key in [
        "remunerationProfileRevision",
        "trainingProfileRevision",
        "revision",
    ] {
        if !integer(&row[key], 1.0, 9007199254740991.0) {
            return Err(fail("Ungültige DRK-Ausbildungsrevision."));
        }
    }
    if !integer(&row["trainingYear"], 1.0, 6.0) {
        return Err(fail("Ungültiges DRK-Ausbildungsjahr."));
    }
    for key in ["weeklyMinutes", "fullTimeWeeklyMinutes"] {
        if !integer(&row[key], 1.0, 2520.0) {
            return Err(fail("Ungültige DRK-Ausbildungszeit."));
        }
    }
    if row["weeklyMinutes"].as_f64() != row["fullTimeWeeklyMinutes"].as_f64() {
        return Err(fail(
            "Teilzeit-Ausbildung benötigt eine gesonderte Berechnung.",
        ));
    }
    if !row["trainingProfession"].as_str().is_some_and(|s| {
        !trim_javascript(s).is_empty() && s.encode_utf16().count() <= 200 && s == trim_javascript(s)
    }) || !matches!(
        row["trainingLegalBasis"].as_str(),
        Some("PFLBG" | "BBIG" | "OTHER")
    ) || row["variantId"] == "ANLAGE_3" && row["trainingLegalBasis"] == "PFLBG"
    {
        return Err(fail("Ungültige DRK-Ausbildungsgrundlage."));
    }
    for key in [
        "drkApplicabilityConfirmed",
        "trainingCategoryConfirmed",
        "trainingYearConfirmed",
        "fullMonthBaseEntitlementConfirmed",
        "fullTimeTrainingConfirmed",
    ] {
        if !answer(&row[key]) {
            return Err(fail("Ungültige DRK-Ausbildungsantwort."));
        }
    }
    let month = require_local_month(&row["month"])?;
    let bounds = super::base::month_bounds(&month).expect("validated month");
    let remuneration_date = date(&row["remunerationProfileEffectiveFrom"])?;
    let training_date = date(&row["trainingProfileEffectiveFrom"])?;
    let started = date(&row["trainingStartedOn"])?;
    let end = if row["trainingExpectedEndOn"].is_null() {
        None
    } else {
        Some(date(&row["trainingExpectedEndOn"])?)
    };
    let year_date = date(&row["trainingYearConfirmedFrom"])?;
    if remuneration_date > bounds.start.as_str()
        || training_date > bounds.start.as_str()
        || started > bounds.start.as_str()
        || end.is_some_and(|e| e < bounds.end.as_str())
        || year_date < started
        || year_date > bounds.start.as_str()
    {
        return Err(fail(
            "DRK-Ausbildungsstand gilt nicht für den ganzen Monat.",
        ));
    }
    chronology(row, "Ungültiger DRK-Ausbildungsbestätigungszeitpunkt.")?;
    Ok(normalized(row, TRAINING_FIELDS))
}
fn equals(a: Option<&Value>, b: Option<&Value>) -> bool {
    match (a, b) {
        (Some(Value::Number(a)), Some(Value::Number(b))) => a.as_f64() == b.as_f64(),
        _ => a == b,
    }
}
fn field(a: &Value, ak: &str, b: &Value, bk: &str) -> bool {
    equals(a.get(ak), b.get(bk))
}
pub fn is_current_employee(saved: &Value, profile: &Value, version: &str) -> bool {
    let data = &profile["data"];
    let selection = &data["selection"];
    field(saved, "profileEffectiveFrom", profile, "effectiveFrom")
        && field(saved, "profileRevision", profile, "revision")
        && saved["ruleVersionId"] == version
        && selection["kind"] == "tariff"
        && field(selection, "packageId", saved, "packageId")
        && field(selection, "variant", saved, "variantId")
        && selection["region"] == "BTG"
        && selection["group"]
            .as_str()
            .map(str::to_lowercase)
            .as_deref()
            == saved["groupId"].as_str()
        && saved["stepId"].as_str().and_then(|s| s.strip_prefix('s')) == selection["level"].as_str()
        && field(
            selection,
            "fullTimeWeeklyMinutes",
            saved,
            "fullTimeWeeklyMinutes",
        )
        && field(data, "weeklyMinutes", saved, "contractedWeeklyMinutes")
}
pub fn is_current_training(
    saved: &Value,
    profile: &Value,
    training_profile: &Value,
    version: &str,
) -> bool {
    let data = &profile["data"];
    let selection = &data["selection"];
    let training = &training_profile["data"]["training"];
    let year = saved["trainingYear"]
        .as_f64()
        .filter(|n| n.fract() == 0.0 && (1.0..=6.0).contains(n))
        .map(|n| ["1", "2", "3", "4", "5", "6"][(n as usize) - 1]);
    field(
        saved,
        "remunerationProfileEffectiveFrom",
        profile,
        "effectiveFrom",
    ) && field(saved, "remunerationProfileRevision", profile, "revision")
        && field(
            saved,
            "trainingProfileEffectiveFrom",
            &training_profile["data"],
            "effectiveFrom",
        )
        && field(
            saved,
            "trainingProfileRevision",
            training_profile,
            "revision",
        )
        && saved["ruleVersionId"] == version
        && selection["kind"] == "tariff"
        && selection["packageId"] == "drk-rtv-training"
        && field(selection, "variant", saved, "variantId")
        && selection["region"] == "BTG"
        && selection["group"]
            .as_str()
            .map(str::to_lowercase)
            .as_deref()
            == saved["groupId"].as_str()
        && selection["level"].as_str() == year
        && field(
            selection,
            "fullTimeWeeklyMinutes",
            saved,
            "fullTimeWeeklyMinutes",
        )
        && field(data, "weeklyMinutes", saved, "weeklyMinutes")
        && training_profile["data"]["status"] == "training"
        && !training.is_null()
        && [
            ("profession", "trainingProfession"),
            ("legalBasis", "trainingLegalBasis"),
            ("startedOn", "trainingStartedOn"),
            ("expectedEndOn", "trainingExpectedEndOn"),
            ("year", "trainingYear"),
            ("yearConfirmedFrom", "trainingYearConfirmedFrom"),
        ]
        .iter()
        .all(|(a, b)| field(training, a, saved, b))
}
