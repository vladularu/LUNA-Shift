//! Strict versions 1–8, normalized exactly as the persisted domain profile.
use super::{
    Presence, RemunerationError,
    care::{TvalCareAllowances, TvlCareAllowances, validate_tval_care, validate_tvl_care},
    own_config::{OwnConfiguration, validate_own_configuration},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TrainingSpecialDutyAllowance {
    None,
    Pe1Only,
    OtherOrMultiple,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TvlEmploymentCategory {
    #[serde(rename = "SALARIED_SECTION_38_5_1")]
    SalariedSection3851,
    #[serde(rename = "OTHER")]
    Other,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TvalEmployerScope {
    General,
    #[serde(rename = "SECTION_43")]
    Section43,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TariffSelection {
    pub package_id: String,
    pub variant: String,
    pub region: String,
    pub group: String,
    pub level: String,
    pub full_time_weekly_minutes: i64,
    #[serde(skip_serializing_if = "Presence::is_missing")]
    pub tval_employer_scope: Presence<TvalEmployerScope>,
    #[serde(skip_serializing_if = "Presence::is_missing")]
    pub tvl_employment_category: Presence<TvlEmploymentCategory>,
    #[serde(skip_serializing_if = "Presence::is_missing")]
    pub tvl_care_allowances: Presence<TvlCareAllowances>,
    #[serde(skip_serializing_if = "Presence::is_missing")]
    pub tval_care_allowances: Presence<TvalCareAllowances>,
    #[serde(skip_serializing_if = "Presence::is_missing")]
    pub special_duty_allowance: Presence<TrainingSpecialDutyAllowance>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Selection {
    Unconfigured,
    OwnMonthly {
        #[serde(rename = "monthlyGrossCents")]
        monthly_gross_cents: i64,
    },
    OwnConfigured {
        configuration: OwnConfiguration,
    },
    Tariff(TariffSelection),
}
/// Private fields prevent constructing unsupported version/selection combinations.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemunerationProfile {
    version: u8,
    weekly_minutes: i64,
    selection: Selection,
}
impl RemunerationProfile {
    pub fn version(&self) -> u8 {
        self.version
    }
    pub fn weekly_minutes(&self) -> i64 {
        self.weekly_minutes
    }
    pub fn selection(&self) -> &Selection {
        &self.selection
    }
}
impl<'de> Deserialize<'de> for RemunerationProfile {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let value = Value::deserialize(d)?;
        validate_profile(&value).map_err(serde::de::Error::custom)
    }
}

fn exact<'a>(
    value: &'a Value,
    keys: &[&str],
) -> Result<&'a serde_json::Map<String, Value>, RemunerationError> {
    let map = value.as_object().ok_or(RemunerationError::Profile)?;
    if map.len() != keys.len() || keys.iter().any(|k| !map.contains_key(*k)) {
        return Err(RemunerationError::Profile);
    }
    Ok(map)
}
fn integer(v: &Value, min: i64, max: i64) -> Result<i64, RemunerationError> {
    v.as_i64()
        .filter(|n| (min..=max).contains(n))
        .ok_or(RemunerationError::Profile)
}
fn identifier(v: &Value) -> Result<String, RemunerationError> {
    let s = v.as_str().ok_or(RemunerationError::Profile)?;
    if s.is_empty()
        || s.len() > 120
        || !s.as_bytes()[0].is_ascii_alphanumeric()
        || !s
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
    {
        return Err(RemunerationError::Profile);
    }
    Ok(s.into())
}
fn presence<T: serde::de::DeserializeOwned>(v: &Value) -> Result<Presence<T>, RemunerationError> {
    Presence::deserialize(v).map_err(|_| RemunerationError::Profile)
}

pub fn validate_profile(value: &Value) -> Result<RemunerationProfile, RemunerationError> {
    let root = exact(value, &["version", "weeklyMinutes", "selection"])?;
    let version = integer(&root["version"], 1, 8)? as u8;
    let weekly_minutes = integer(&root["weeklyMinutes"], 60, 4800)?;
    let raw = &root["selection"];
    let kind = raw
        .get("kind")
        .and_then(Value::as_str)
        .ok_or(RemunerationError::Profile)?;
    let selection = if version == 2 {
        let own = exact(raw, &["kind", "configuration"])?;
        if kind != "own-configured" {
            return Err(RemunerationError::Profile);
        }
        Selection::OwnConfigured {
            configuration: validate_own_configuration(&own["configuration"])?,
        }
    } else {
        if version >= 3 && kind != "tariff" {
            return Err(RemunerationError::Profile);
        }
        match kind {
            "unconfigured" => {
                exact(raw, &["kind"])?;
                Selection::Unconfigured
            }
            "own-monthly" => {
                let own = exact(raw, &["kind", "monthlyGrossCents"])?;
                Selection::OwnMonthly {
                    monthly_gross_cents: integer(&own["monthlyGrossCents"], 1, 10_000_000)?,
                }
            }
            "tariff" => {
                let mut keys = vec![
                    "kind",
                    "packageId",
                    "variant",
                    "region",
                    "group",
                    "level",
                    "fullTimeWeeklyMinutes",
                ];
                if version == 3 {
                    keys.push("specialDutyAllowance")
                }
                if matches!(version, 4 | 5 | 7 | 8) {
                    keys.push("tvlEmploymentCategory")
                }
                if version == 5 {
                    keys.push("tvlCareAllowances")
                }
                if version >= 6 {
                    keys.push("tvalEmployerScope")
                }
                if version == 8 {
                    keys.push("tvalCareAllowances")
                }
                let tariff = exact(raw, &keys)?;
                let mut scope = Presence::Missing;
                let mut category = Presence::Missing;
                let mut special = Presence::Missing;
                if version >= 6 {
                    if tariff["packageId"] != "tval-pflege-tdl" {
                        return Err(RemunerationError::Profile);
                    }
                    scope = presence(&tariff["tvalEmployerScope"])?;
                }
                if matches!(version, 4 | 5 | 7 | 8) {
                    if tariff["packageId"]
                        != if version >= 7 {
                            "tval-pflege-tdl"
                        } else {
                            "tvl-kr-tdl"
                        }
                    {
                        return Err(RemunerationError::Profile);
                    }
                    category = presence(&tariff["tvlEmploymentCategory"])?;
                }
                if version == 3 {
                    if tariff["packageId"] != "tvaoed-pflege-vka" {
                        return Err(RemunerationError::Profile);
                    }
                    special = presence(&tariff["specialDutyAllowance"])?;
                }
                Selection::Tariff(TariffSelection {
                    package_id: identifier(&tariff["packageId"])?,
                    variant: identifier(&tariff["variant"])?,
                    region: identifier(&tariff["region"])?,
                    group: identifier(&tariff["group"])?,
                    level: identifier(&tariff["level"])?,
                    full_time_weekly_minutes: integer(&tariff["fullTimeWeeklyMinutes"], 60, 4800)?,
                    tval_employer_scope: scope,
                    tvl_employment_category: category,
                    tvl_care_allowances: if version == 5 {
                        match validate_tvl_care(&tariff["tvlCareAllowances"])? {
                            None => Presence::Null,
                            Some(v) => Presence::Value(v),
                        }
                    } else {
                        Presence::Missing
                    },
                    tval_care_allowances: if version == 8 {
                        match validate_tval_care(&tariff["tvalCareAllowances"])? {
                            None => Presence::Null,
                            Some(v) => Presence::Value(v),
                        }
                    } else {
                        Presence::Missing
                    },
                    special_duty_allowance: special,
                })
            }
            _ => return Err(RemunerationError::Profile),
        }
    };
    Ok(RemunerationProfile {
        version,
        weekly_minutes,
        selection,
    })
}

/// Legacy migration copies known fields and does not invent an effective date.
pub fn remuneration_from_legacy(profile: &Value) -> Result<RemunerationProfile, RemunerationError> {
    let tariff = &profile["tariff"];
    let selection = if !tariff.is_null() {
        let level = match &tariff["payLevel"] {
            Value::String(s) => s.clone(),
            v if !v.is_null() => v.to_string(),
            _ => return Err(RemunerationError::Profile),
        };
        json!({"kind":"tariff","packageId":"tvoed-vka-bt-k","variant":tariff["sector"],"region":tariff["tariffRegion"],"group":tariff["payGroup"],"level":level,"fullTimeWeeklyMinutes":tariff["fullTimeWeeklyMinutes"]})
    } else if !profile["manualMonthlyGrossCents"].is_null() {
        json!({"kind":"own-monthly","monthlyGrossCents":profile["manualMonthlyGrossCents"]})
    } else {
        json!({"kind":"unconfigured"})
    };
    validate_profile(
        &json!({"version":1,"weeklyMinutes":profile["weeklyMinutes"],"selection":selection}),
    )
}
