use super::{
    ProfileFormError,
    changes::{ProfileFields, string},
};
use crate::input::{javascript_json, profile_form};
use bigdecimal::{BigDecimal, RoundingMode};
use std::str::FromStr;
pub(super) fn state(value: Option<&str>) -> &'static str {
    match value {
        Some("BW") => "Baden-Württemberg",
        Some("BY") => "Bayern",
        Some("BE") => "Berlin",
        Some("BB") => "Brandenburg",
        Some("HB") => "Bremen",
        Some("HH") => "Hamburg",
        Some("HE") => "Hessen",
        Some("MV") => "Mecklenburg-Vorpommern",
        Some("NI") => "Niedersachsen",
        Some("NW") => "Nordrhein-Westfalen",
        Some("RP") => "Rheinland-Pfalz",
        Some("SL") => "Saarland",
        Some("SN") => "Sachsen",
        Some("ST") => "Sachsen-Anhalt",
        Some("SH") => "Schleswig-Holstein",
        Some("TH") => "Thüringen",
        _ => "undefined",
    }
}
pub(super) fn holiday(value: Option<&str>) -> &'static str {
    match value {
        Some("UNKNOWN") => "Bitte auswählen",
        Some("NONE") => "Keine regionale Sonderregel",
        Some("BY_MARIA_HIMMELFAHRT") => "Mariä Himmelfahrt gilt am Arbeitsort",
        Some("BY_AUGSBURG") => "Stadt Augsburg",
        Some("SN_FRONLEICHNAM") => "Sächsische Fronleichnamsregion",
        Some("TH_FRONLEICHNAM") => "Thüringer Fronleichnamsregion",
        _ => "undefined",
    }
}
pub(super) fn industry(value: Option<&str>) -> &'static str {
    match value {
        Some("HEALTHCARE") => "Pflege & Gesundheitswesen",
        Some("EMERGENCY_SERVICES") => "Rettungsdienst",
        Some("SOCIAL_SERVICES") => "Soziale Dienste",
        Some("OTHER_SHIFT_WORK") => "Andere Schichtarbeit",
        _ => "undefined",
    }
}
fn currency(value: f64) -> Result<String, ProfileFormError> {
    let amount = value / 100.0;
    let rounded = BigDecimal::from_str(&javascript_json::number_text(amount.abs()))
        .map_err(|_| profile_form::shape_error())?
        .with_scale_round(2, RoundingMode::HalfUp)
        .to_plain_string();
    let (integer, fraction) = rounded.split_once('.').unwrap_or((&rounded, "00"));
    let mut grouped = String::new();
    for (n, c) in integer.chars().rev().enumerate() {
        if n > 0 && n.is_multiple_of(3) {
            grouped.push('.')
        }
        grouped.push(c)
    }
    let integer = grouped.chars().rev().collect::<String>();
    Ok(format!(
        "{}{integer},{fraction}\u{a0}€",
        if amount.is_sign_negative() { "-" } else { "" }
    ))
}
pub fn work_label(profile: &impl ProfileFields) -> Result<String, ProfileFormError> {
    let hours = profile
        .field("weeklyMinutes")
        .and_then(serde_json::Value::as_f64)
        .ok_or_else(profile_form::shape_error)?
        / 60.0;
    // Intl rounds the source IEEE division to at most three decimal places.
    let rounded = BigDecimal::from_str(&javascript_json::number_text(hours.abs()))
        .map_err(|_| profile_form::shape_error())?
        .with_scale_round(3, RoundingMode::HalfUp)
        .to_plain_string();
    let (integer, fraction) = rounded.split_once('.').unwrap_or((&rounded, ""));
    let mut grouped = String::new();
    for (index, digit) in integer.chars().rev().enumerate() {
        if index > 0 && index.is_multiple_of(3) {
            grouped.push('.');
        }
        grouped.push(digit);
    }
    let integer = grouped.chars().rev().collect::<String>();
    let fraction = fraction.trim_end_matches('0');
    Ok(format!(
        "{}{integer}{} Std./Woche · {}{}",
        if hours.is_sign_negative() { "-" } else { "" },
        if fraction.is_empty() {
            String::new()
        } else {
            format!(",{fraction}")
        },
        state(
            profile
                .field("federalState")
                .and_then(serde_json::Value::as_str)
        ),
        if profile
            .field("holidayRegion")
            .and_then(serde_json::Value::as_str)
            == Some("UNKNOWN")
        {
            " · Feiertagsregion offen"
        } else {
            ""
        },
    ))
}
pub fn salary_label(profile: &impl ProfileFields) -> Result<String, ProfileFormError> {
    if profile
        .field("salaryBasisConflict")
        .is_some_and(crate::net::js_truthy)
    {
        return Ok("Gehaltsgrundlage prüfen".into());
    }
    for (key, prefix, year) in [
        ("tvalPflegeTariff", "TVA-L Pflege", true),
        ("tvhKrTariff", "TV-H", false),
        ("tvUkNursingTariff", "TV-UK", false),
        ("tvlKrTariff", "TV-L", false),
        ("vkaETariff", "TVöD ·", false),
        ("nursingTrainingTariff", "TVAöD Pflege", true),
    ] {
        if let Some(v) = profile.field(key).filter(|v| crate::net::js_truthy(v)) {
            return Ok(if year {
                format!(
                    "{prefix} · {}. Ausbildungsjahr",
                    string(v.get("trainingYear"))
                )
            } else {
                let mut group = string(v.get("payGroup"));
                if key == "tvUkNursingTariff" {
                    group = group.replacen("PUK", "P-UK", 1)
                }
                format!("{prefix} {group} · Stufe {}", string(v.get("payLevel")))
            });
        }
    }
    if let Some(tariff) = profile.field("tariff").filter(|v| crate::net::js_truthy(v)) {
        let region = match tariff["tariffRegion"].as_str() {
            Some("KAV_BW") => "KAV Baden-Württemberg",
            Some("OTHER") => "Übrige VKA-Tarifgebiete",
            _ => "undefined",
        };
        return Ok(format!(
            "TVöD-P · {} · Stufe {} · {} · {region}",
            string(tariff.get("payGroup")),
            string(tariff.get("payLevel")),
            if tariff["sector"] == "BT_K" {
                "BT-K"
            } else {
                "BT-B"
            }
        ));
    }
    if let Some(value) = profile
        .field("manualMonthlyGrossCents")
        .filter(|v| !v.is_null())
    {
        return Ok(format!(
            "Manuell · {}",
            currency(value.as_f64().ok_or_else(profile_form::shape_error)?)?
        ));
    }
    Ok("Gehalt noch nicht eingerichtet".into())
}

/// Exact compact Settings row; input is the already selected native Provider role.
pub fn work_salary_summary(profile: &impl ProfileFields) -> Result<String, ProfileFormError> {
    let salary = salary_label(profile)?;
    let short = salary.split(" · ").take(2).collect::<Vec<_>>().join(" · ");
    Ok(format!("{} · {short}", work_label(profile)?))
}
