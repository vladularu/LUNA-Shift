//! Exact existing family selections. This layer validates facts; it selects no rates.
use crate::tax::Decimal;
use serde_json::{Value, json};

pub const VKA_E_GROUPS: &[&str] = &[
    "E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "E9a", "E9b", "E9c", "E10", "E11", "E12",
    "E13", "E14", "E15",
];
pub const TVL_KR_GROUPS: &[&str] = &[
    "KR5", "KR6", "KR7", "KR8", "KR9", "KR10", "KR11", "KR12", "KR13", "KR14", "KR15", "KR16",
    "KR17",
];
pub const TVH_KR_GROUPS: &[&str] = &[
    "KR5", "KR6", "KR7", "KR8", "KR9", "KR10", "KR11", "KR12", "KR13", "KR14", "KR15", "KR16",
];
pub const TVUK_NURSING_GROUPS: &[&str] = &[
    "PUK5", "PUK6", "PUK7", "PUK8", "PUK9", "PUK9L", "PUK10", "PUK11", "PUK12", "PUK13", "PUK14",
    "PUK15",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FamilyProfileError(pub &'static str);
impl std::fmt::Display for FamilyProfileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}
impl std::error::Error for FamilyProfileError {}

pub fn e_pay_levels(group: &str) -> &'static [i64] {
    if group == "E1" {
        &[2, 3, 4, 5, 6]
    } else {
        &[1, 2, 3, 4, 5, 6]
    }
}
pub fn tvl_kr_levels_for_group(group: &str) -> &'static [i64] {
    if ["KR5", "KR6"].contains(&group) {
        &[1, 2, 3, 4, 5, 6]
    } else {
        &[2, 3, 4, 5, 6]
    }
}
pub fn tvuk_levels_for_group(group: &str) -> &'static [i64] {
    match group {
        "PUK5" | "PUK6" => &[1, 2, 3, 4, 5, 6],
        "PUK7" | "PUK8" => &[2, 3, 4, 5, 6, 7],
        "PUK9" => &[3, 4, 5, 6, 7],
        "PUK10" => &[3, 4, 5, 6],
        _ => &[2, 3, 4, 5, 6],
    }
}
pub fn tvh_kr_levels_for_group(group: &str) -> Vec<Value> {
    if ["KR5", "KR6"].contains(&group) {
        vec![
            json!("1a"),
            json!("1b"),
            json!(2),
            json!(3),
            json!(4),
            json!(5),
            json!(6),
        ]
    } else {
        vec![json!(2), json!(3), json!(4), json!(5), json!(6)]
    }
}
pub fn tariff_full_time_weekly_minutes(sector: &str, region: &str) -> i64 {
    if sector == "BT_K" && region == "OTHER" {
        2310
    } else {
        2340
    }
}

fn exact(value: &Value, keys: &[&str]) -> bool {
    value.as_object().is_some_and(|object| {
        object.len() == keys.len() && keys.iter().all(|key| object.contains_key(*key))
    })
}
fn integer(value: &Value) -> Option<i64> {
    let number = value.as_number()?;
    if let Some(value) = number.as_i64() {
        return Some(value);
    }
    let decimal = Decimal::parse(&number.to_string()).ok()?;
    let integer = decimal.trunc_i64().ok()?;
    (decimal == Decimal::from_i64(integer)).then_some(integer)
}
fn level(value: &Value, levels: &[i64]) -> Option<i64> {
    integer(value).filter(|value| levels.contains(value))
}
fn sector(value: &Value) -> Option<&str> {
    value
        .as_str()
        .filter(|value| ["BT_K", "BT_B"].contains(value))
}
fn region(value: &Value) -> Option<&str> {
    value
        .as_str()
        .filter(|value| ["OTHER", "KAV_BW"].contains(value))
}
fn university_region(value: &Value) -> Option<&str> {
    value
        .as_str()
        .filter(|value| ["WEST", "EAST"].contains(value))
}

pub fn require_vka_e_tariff(value: &Value) -> Result<Option<Value>, FamilyProfileError> {
    if value.is_null() {
        return Ok(None);
    }
    value.as_object().ok_or(FamilyProfileError(
        "Bitte einen gültigen TVöD-E-Tarif wählen.",
    ))?;
    let bad = FamilyProfileError(
        "Bitte eine gültige Entgeltgruppe und Stufe aus deinem Arbeitsvertrag wählen.",
    );
    let group = value["payGroup"]
        .as_str()
        .filter(|group| VKA_E_GROUPS.contains(group))
        .ok_or(bad)?;
    let level = level(&value["payLevel"], e_pay_levels(group)).ok_or(bad)?;
    let sector = sector(&value["sector"]).ok_or(bad)?;
    let region = region(&value["tariffRegion"]).ok_or(bad)?;
    if !exact(value, &["payGroup", "payLevel", "sector", "tariffRegion"]) {
        return Err(bad);
    }
    Ok(Some(
        json!({"payGroup":group,"payLevel":level,"sector":sector,"tariffRegion":region}),
    ))
}

pub fn require_nursing_training_tariff(value: &Value) -> Result<Option<Value>, FamilyProfileError> {
    if value.is_null() {
        return Ok(None);
    }
    value.as_object().ok_or(FamilyProfileError(
        "Bitte einen gültigen Pflege-Ausbildungstarif wählen.",
    ))?;
    let bad =
        FamilyProfileError("Bitte Ausbildungsjahr 1–3 und einen gültigen Tarifbereich wählen.");
    let year = level(&value["trainingYear"], &[1, 2, 3]).ok_or(bad)?;
    let sector = sector(&value["sector"]).ok_or(bad)?;
    let region = region(&value["tariffRegion"]).ok_or(bad)?;
    if !exact(value, &["sector", "tariffRegion", "trainingYear"]) {
        return Err(bad);
    }
    Ok(Some(
        json!({"trainingYear":year,"sector":sector,"tariffRegion":region}),
    ))
}

pub fn require_tvl_kr_tariff(value: &Value) -> Result<Option<Value>, FamilyProfileError> {
    if value.is_null() {
        return Ok(None);
    }
    let bad = FamilyProfileError("Bitte eine gültige TV-L-Pflegegruppe und Stufe wählen.");
    let group = value["payGroup"]
        .as_str()
        .filter(|group| TVL_KR_GROUPS.contains(group))
        .ok_or(bad)?;
    let level = level(&value["payLevel"], tvl_kr_levels_for_group(group)).ok_or(bad)?;
    if !exact(value, &["payGroup", "payLevel"]) {
        return Err(bad);
    }
    Ok(Some(json!({"payGroup":group,"payLevel":level})))
}

pub fn require_tvl_kr_salary_tariff(value: &Value) -> Result<Option<Value>, FamilyProfileError> {
    if value.is_null() {
        return Ok(None);
    }
    value.as_object().ok_or(FamilyProfileError(
        "Bitte eine gültige TV-L-Pflegegruppe, Stufe und ein Tarifgebiet wählen.",
    ))?;
    let bad = FamilyProfileError("Bitte das TV-L-Tarifgebiet West oder Ost wählen.");
    if !exact(value, &["payGroup", "payLevel", "universityRegion"]) {
        return Err(bad);
    }
    let region = university_region(&value["universityRegion"]).ok_or(bad)?;
    let selection =
        require_tvl_kr_tariff(&json!({"payGroup":value["payGroup"],"payLevel":value["payLevel"]}))?
            .ok_or(bad)?;
    Ok(Some(
        json!({"payGroup":selection["payGroup"],"payLevel":selection["payLevel"],"universityRegion":region}),
    ))
}

pub fn require_tvuk_nursing_tariff(value: &Value) -> Result<Option<Value>, FamilyProfileError> {
    if value.is_null() {
        return Ok(None);
    }
    let bad = FamilyProfileError("Bitte eine gültige TV-UK-Pflegegruppe und Stufe wählen.");
    let group = value["payGroup"]
        .as_str()
        .filter(|group| TVUK_NURSING_GROUPS.contains(group))
        .ok_or(bad)?;
    let level = level(&value["payLevel"], tvuk_levels_for_group(group)).ok_or(bad)?;
    if !exact(value, &["payGroup", "payLevel"]) {
        return Err(bad);
    }
    Ok(Some(json!({"payGroup":group,"payLevel":level})))
}

pub fn require_tvh_kr_tariff(value: &Value) -> Result<Option<Value>, FamilyProfileError> {
    if value.is_null() {
        return Ok(None);
    }
    let bad = FamilyProfileError(
        "Bitte eine gültige TV-H-Pflegegruppe, Stufe und tarifliche Vollzeit wählen.",
    );
    let group = value["payGroup"]
        .as_str()
        .filter(|group| TVH_KR_GROUPS.contains(group))
        .ok_or(bad)?;
    let pay_level = if ["KR5", "KR6"].contains(&group)
        && [Some("1a"), Some("1b")].contains(&value["payLevel"].as_str())
    {
        value["payLevel"].clone()
    } else {
        json!(level(&value["payLevel"], &[2, 3, 4, 5, 6]).ok_or(bad)?)
    };
    let full_time = level(&value["fullTimeWeeklyMinutes"], &[2310, 2400]).ok_or(bad)?;
    if !exact(value, &["fullTimeWeeklyMinutes", "payGroup", "payLevel"]) {
        return Err(bad);
    }
    Ok(Some(
        json!({"payGroup":group,"payLevel":pay_level,"fullTimeWeeklyMinutes":full_time}),
    ))
}

pub fn require_tval_pflege_tariff(value: &Value) -> Result<Option<Value>, FamilyProfileError> {
    if value.is_null() {
        return Ok(None);
    }
    let object = value.as_object().ok_or(FamilyProfileError(
        "Bitte einen gültigen TVA-L-Pflegetarif wählen.",
    ))?;
    let bad = FamilyProfileError("Bitte Ausbildungsjahr 1–3 und Tarifgebiet West oder Ost wählen.");
    if object
        .keys()
        .any(|key| !["trainingYear", "universityRegion", "employerScope"].contains(&key.as_str()))
    {
        return Err(bad);
    }
    let year = level(&value["trainingYear"], &[1, 2, 3]).ok_or(bad)?;
    let region = university_region(&value["universityRegion"]).ok_or(bad)?;
    if object.contains_key("employerScope")
        && !value["employerScope"].is_null()
        && ![Some("GENERAL"), Some("SECTION_43")].contains(&value["employerScope"].as_str())
    {
        return Err(bad);
    }
    let mut result = json!({"trainingYear":year,"universityRegion":region});
    if object.contains_key("employerScope") {
        result["employerScope"] = value["employerScope"].clone();
    }
    Ok(Some(result))
}
