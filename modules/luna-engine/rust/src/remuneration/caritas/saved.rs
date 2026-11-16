//! Saved Caritas confirmations and their source-exact revision bindings.
use crate::{
    employment::require_remuneration_date,
    input::{
        InputError, javascript_instant_milliseconds, raw_json::normalize_integral_numbers,
        require_instant, trim_javascript,
    },
    net::js_truthy,
    remuneration::overtime::saved::is_current_overtime_allocation,
};
use serde_json::{Map, Value};
pub const MONTH_FIELDS: &[&str] = &[
    "month",
    "profileEffectiveFrom",
    "profileRevision",
    "packageId",
    "ruleVersionId",
    "variantId",
    "regionId",
    "fullMonthEmploymentConfirmed",
    "fullMonthlyBaseEntitlementConfirmed",
    "fixedAllowanceClaim",
    "careAllowanceClaim",
    "localAgreement",
    "revision",
    "confirmedAt",
    "updatedAt",
];
pub const WORK_FIELDS: &[&str] = &[
    "shiftId",
    "date",
    "shiftRevision",
    "shiftDate",
    "shiftUpdatedAt",
    "timeZone",
    "origin",
    "holidayTimeOff",
    "shiftWork",
    "revision",
    "confirmedAt",
    "updatedAt",
];
pub const OVERTIME_FIELDS: &[&str] = &[
    "version",
    "shiftId",
    "shiftRevision",
    "shiftUpdatedAt",
    "timeZone",
    "allocationRevision",
    "profileEffectiveFrom",
    "profileRevision",
    "packageId",
    "ruleVersionId",
    "variantId",
    "regionId",
    "classification",
    "classificationCase",
    "employerOrderConfirmed",
    "applicableRuleConfirmed",
    "workSettlement",
    "premiumSettlement",
    "workPayoutMonth",
    "premiumPayoutMonth",
    "revision",
    "confirmedAt",
    "updatedAt",
];
fn fail(message: &str) -> InputError {
    InputError::source(message, "Error")
}
fn record<'a>(value: &'a Value, fields: &[&str], kind: &str) -> Result<&'a Value, InputError> {
    let row = value
        .as_object()
        .ok_or_else(|| fail(&format!("Ungültige Caritas-{kind}.")))?;
    if row.len() != fields.len() || fields.iter().any(|k| !row.contains_key(*k)) {
        return Err(fail(&format!("Unbekanntes Format der Caritas-{kind}.")));
    }
    Ok(value)
}
fn month_syntax(value: &Value) -> Option<&str> {
    value.as_str().filter(|s| {
        s.len() == 7
            && s.as_bytes()[4] == b'-'
            && s.bytes()
                .enumerate()
                .all(|(i, b)| i == 4 || b.is_ascii_digit())
    })
}
pub fn require_month(value: &Value) -> Result<Value, InputError> {
    let text = month_syntax(value).ok_or_else(|| fail("Ungültiger Caritas-Abrechnungsmonat."))?;
    if !("01"..="12").contains(&&text[5..]) {
        return Err(InputError::source("Ungültiger Monat.", "RangeError"));
    }
    Ok(value.clone())
}
fn payout_month(value: &Value) -> Result<(), InputError> {
    if value.is_null() {
        return Ok(());
    }
    if month_syntax(value).is_some_and(|s| ("01"..="12").contains(&&s[5..])) {
        Ok(())
    } else {
        Err(fail("Ungültiger Auszahlungsmonat."))
    }
}
fn integer(value: &Value) -> bool {
    value
        .as_f64()
        .is_some_and(|n| n.fract() == 0.0 && (1.0..=9007199254740991.0).contains(&n))
}
fn revisions(row: &Value, keys: &[&str]) -> Result<(), InputError> {
    if keys.iter().any(|k| !integer(&row[*k])) {
        Err(fail("Ungültige Bestätigungsrevision."))
    } else {
        Ok(())
    }
}
fn shift_id(value: &Value) -> Result<(), InputError> {
    if value
        .as_str()
        .is_some_and(|s| !trim_javascript(s).is_empty() && s.encode_utf16().count() <= 200)
    {
        Ok(())
    } else {
        Err(fail("Ungültige Dienstzuordnung."))
    }
}
fn identifier(value: &Value) -> Result<(), InputError> {
    let valid = value.as_str().is_some_and(|s| {
        let mut chars = s.chars();
        let alnum = |c: char| c.is_ascii_alphanumeric() || matches!(c, '\u{212A}' | '\u{017F}');
        chars.next().is_some_and(alnum)
            && s.chars().count() <= 101
            && chars.all(|c| alnum(c) || matches!(c, '.' | '_' | '-'))
    });
    if valid {
        Ok(())
    } else {
        Err(fail("Ungültige Caritas-Tarifzuordnung."))
    }
}
fn identifiers(row: &Value) -> Result<(), InputError> {
    for k in ["packageId", "ruleVersionId", "variantId", "regionId"] {
        identifier(&row[k])?;
    }
    Ok(())
}
fn date(value: &Value) -> Result<(), InputError> {
    if value
        .as_str()
        .is_some_and(|s| require_remuneration_date(s).is_ok())
    {
        Ok(())
    } else {
        Err(InputError::user_facing_source(
            "Bitte ein gültiges Gültigkeitsdatum angeben.",
            "RemunerationProfileError",
        ))
    }
}
fn chronology(row: &Value) -> Result<(), InputError> {
    let a = require_instant(&row["confirmedAt"], "Bestätigung")?;
    let b = require_instant(&row["updatedAt"], "Aktualisierung")?;
    if javascript_instant_milliseconds(a)
        .zip(javascript_instant_milliseconds(b))
        .is_some_and(|(a, b)| a > b)
    {
        Err(fail("Ungültiger Bestätigungszeitpunkt."))
    } else {
        Ok(())
    }
}
fn zone(value: &Value) -> Result<(), InputError> {
    let text = value
        .as_str()
        .filter(|s| !s.is_empty() && !s.starts_with(['+', '-']))
        .ok_or_else(|| fail("Ungültige Zeitzone."))?;
    crate::time_zone::zone(text)
        .map(|_| ())
        .map_err(|_| InputError::source("Ungültige Zeitzone.", "RangeError"))
}
fn normalized(value: &Value, fields: &[&str]) -> Value {
    let mut out = Map::new();
    for k in fields {
        out.insert((*k).to_owned(), value[*k].clone());
    }
    let mut out = Value::Object(out);
    normalize_integral_numbers(&mut out);
    out
}
fn answer(value: &Value) -> bool {
    value.is_boolean() || value.is_null()
}
pub fn validate_month(value: &Value) -> Result<Value, InputError> {
    let row = record(value, MONTH_FIELDS, "Monatsbestätigung")?;
    revisions(row, &["profileRevision", "revision"])?;
    if !answer(&row["fullMonthEmploymentConfirmed"])
        || !answer(&row["fullMonthlyBaseEntitlementConfirmed"])
        || !["ENTITLED", "NOT_ENTITLED", "UNKNOWN"]
            .iter()
            .any(|s| row["fixedAllowanceClaim"] == *s)
        || !["ENTITLED", "NOT_ENTITLED", "UNKNOWN"]
            .iter()
            .any(|s| row["careAllowanceClaim"] == *s)
        || !["NONE_CONFIRMED", "UNKNOWN", "DIFFERENT"]
            .iter()
            .any(|s| row["localAgreement"] == *s)
    {
        return Err(fail("Ungültige Caritas-Anspruchsbestätigung."));
    }
    chronology(row)?;
    require_month(&row["month"])?;
    date(&row["profileEffectiveFrom"])?;
    identifiers(row)?;
    Ok(normalized(row, MONTH_FIELDS))
}
pub fn validate_work_day(value: &Value) -> Result<Value, InputError> {
    let row = record(value, WORK_FIELDS, "Dienstbestätigung")?;
    shift_id(&row["shiftId"])?;
    revisions(row, &["shiftRevision", "revision"])?;
    if row["origin"] != "confirmed" || !answer(&row["holidayTimeOff"]) || !answer(&row["shiftWork"])
    {
        return Err(fail("Ungültige Caritas-Bestätigung."));
    }
    zone(&row["timeZone"])?;
    chronology(row)?;
    date(&row["date"])?;
    date(&row["shiftDate"])?;
    require_instant(&row["shiftUpdatedAt"], "Dienständerung")?;
    Ok(normalized(row, WORK_FIELDS))
}
pub fn validate_overtime(value: &Value) -> Result<Value, InputError> {
    let row = record(value, OVERTIME_FIELDS, "Überstundenbestätigung")?;
    if row["version"].as_f64() != Some(1.0) {
        return Err(fail(
            "Unbekannte Version der Caritas-Überstundenbestätigung.",
        ));
    }
    shift_id(&row["shiftId"])?;
    revisions(
        row,
        &[
            "shiftRevision",
            "allocationRevision",
            "profileRevision",
            "revision",
        ],
    )?;
    zone(&row["timeZone"])?;
    if row["classification"] != "CONFIRMED_AVR_OVERTIME"
        || ![
            "STANDARD_WEEK",
            "WORK_CORRIDOR",
            "DAILY_FRAME",
            "SHIFT_PLAN",
        ]
        .iter()
        .any(|s| row["classificationCase"] == *s)
        || row["employerOrderConfirmed"] != true
        || row["applicableRuleConfirmed"] != true
        || !["CASH", "TIME"].iter().any(|s| row["workSettlement"] == *s)
        || !["CASH", "TIME"]
            .iter()
            .any(|s| row["premiumSettlement"] == *s)
    {
        return Err(fail(
            "Die tarifliche Einstufung und Abrechnung müssen bestätigt sein.",
        ));
    }
    payout_month(&row["workPayoutMonth"])?;
    payout_month(&row["premiumPayoutMonth"])?;
    if (row["workSettlement"] == "TIME" && !row["workPayoutMonth"].is_null())
        || (row["premiumSettlement"] == "TIME" && !row["premiumPayoutMonth"].is_null())
    {
        return Err(fail(
            "Bei Zeitausgleich darf kein Auszahlungsmonat angegeben sein.",
        ));
    }
    chronology(row)?;
    require_instant(&row["shiftUpdatedAt"], "Dienständerung")?;
    date(&row["profileEffectiveFrom"])?;
    identifiers(row)?;
    Ok(normalized(row, OVERTIME_FIELDS))
}
fn equal(a: Option<&Value>, b: Option<&Value>) -> bool {
    match (a, b) {
        (Some(Value::Number(a)), Some(Value::Number(b))) => a.as_f64() == b.as_f64(),
        _ => a == b,
    }
}
fn same(a: &Value, ak: &str, b: &Value, bk: &str) -> bool {
    equal(a.get(ak), b.get(bk))
}
fn profile_matches(saved: &Value, profile: &Value) -> bool {
    let selection = &profile["data"]["selection"];
    same(profile, "effectiveFrom", saved, "profileEffectiveFrom")
        && same(profile, "revision", saved, "profileRevision")
        && selection["kind"] == "tariff"
        && same(selection, "packageId", saved, "packageId")
        && same(selection, "variant", saved, "variantId")
        && same(selection, "region", saved, "regionId")
}
pub fn is_current_month(saved: &Value, profile: &Value, package_id: &str, version: &str) -> bool {
    profile_matches(saved, profile)
        && saved["packageId"] == package_id
        && saved["ruleVersionId"] == version
}
pub fn is_current_work_day(saved: &Value, shift: &Value, time_zone: &str) -> bool {
    same(saved, "shiftId", shift, "id")
        && same(saved, "shiftRevision", shift, "revision")
        && same(saved, "shiftDate", shift, "date")
        && same(saved, "shiftUpdatedAt", shift, "updatedAt")
        && saved["timeZone"] == time_zone
        && shift.get("deletedAt") == Some(&Value::Null)
        && !js_truthy(&shift["allDay"])
        && shift.get("startTime") != Some(&Value::Null)
        && shift.get("endTime") != Some(&Value::Null)
        && !matches!(shift["type"].as_str(), Some("VACATION" | "SICK" | "FREE"))
}
pub fn is_current_overtime(
    saved: &Value,
    shift: &Value,
    allocation: &Value,
    profile: &Value,
    version: &str,
    time_zone: &str,
) -> bool {
    is_current_overtime_binding(saved, shift, allocation, profile, time_zone)
        && saved["ruleVersionId"] == version
}
// The payout source first checks the saved binding against its own version; the
// resolved package/version is checked later, preserving its precise diagnostic.
pub(super) fn is_current_overtime_binding(
    saved: &Value,
    shift: &Value,
    allocation: &Value,
    profile: &Value,
    time_zone: &str,
) -> bool {
    same(saved, "shiftId", shift, "id")
        && same(saved, "shiftRevision", shift, "revision")
        && same(saved, "shiftUpdatedAt", shift, "updatedAt")
        && saved["timeZone"] == time_zone
        && is_current_overtime_allocation(allocation, shift, time_zone)
        && same(saved, "allocationRevision", allocation, "revision")
        && profile_matches(saved, profile)
}
