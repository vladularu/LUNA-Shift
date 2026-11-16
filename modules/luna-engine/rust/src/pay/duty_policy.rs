//! Monetary duty factors are distinct from recorded/legal working time.
use crate::EngineError;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub enum DutyTariffFamily {
    #[serde(rename = "TVOED_K")]
    TvoedK,
    #[serde(rename = "TVOED_B")]
    TvoedB,
    #[serde(rename = "TVL_43")]
    Tvl43,
    #[serde(rename = "TVH_43")]
    Tvh43,
    #[serde(rename = "TVUK")]
    Tvuk,
}
pub struct DutyRuleSource {
    pub version: &'static str,
    pub standby: &'static str,
    pub on_call: &'static str,
}
pub fn rule_source(family: DutyTariffFamily) -> DutyRuleSource {
    match family {
        DutyTariffFamily::TvoedK => DutyRuleSource {
            version: "2026-01-01",
            standby: "§§ 45–46 TVöD BT-K / Anlage G",
            on_call: "§ 8 Abs. 3 TVöD AT",
        },
        DutyTariffFamily::TvoedB => DutyRuleSource {
            version: "2026-01-01",
            standby: "§§ 45–46 TVöD BT-B / Anlage G",
            on_call: "§ 8 Abs. 3 TVöD AT",
        },
        DutyTariffFamily::Tvl43 => DutyRuleSource {
            version: "2026-02-14",
            standby: "§ 42 Nr. 6 / § 43 Nr. 5 TV-L / Anlage E",
            on_call: "§ 8 Abs. 5 TV-L",
        },
        DutyTariffFamily::Tvh43 => DutyRuleSource {
            version: "2026-03-27",
            standby: "§ 42 Nr. 6 / § 43 Nr. 5 TV-H / Anlage D",
            on_call: "§ 8 Abs. 5 TV-H",
        },
        DutyTariffFamily::Tvuk => DutyRuleSource {
            version: "2025-01-01",
            standby: "§ 12 Abs. 1 TV-UK",
            on_call: "§ 12 Abs. 2 TV-UK",
        },
    }
}
fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) | Some(Value::Bool(false)) => false,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|n| n != 0.0),
        Some(Value::String(s)) => !s.is_empty(),
        _ => true,
    }
}
pub fn duty_tariff_family(profile: &Value) -> Option<DutyTariffFamily> {
    if truthy(profile.get("tvUkNursingTariff")) {
        return Some(DutyTariffFamily::Tvuk);
    }
    if truthy(profile.get("tvhKrTariff")) {
        return Some(DutyTariffFamily::Tvh43);
    }
    if truthy(profile.get("tvalPflegeTariff")) {
        return (profile["tvalPflegeTariff"]["employerScope"] == "SECTION_43")
            .then_some(DutyTariffFamily::Tvl43);
    }
    if truthy(profile.get("tvlKrTariff")) {
        return Some(DutyTariffFamily::Tvl43);
    }
    let sector = profile
        .get("nursingTrainingTariff")
        .and_then(|v| v.get("sector"))
        .filter(|v| !v.is_null())
        .or_else(|| {
            profile
                .get("vkaETariff")
                .and_then(|v| v.get("sector"))
                .filter(|v| !v.is_null())
        })
        .or_else(|| profile.get("tariff").and_then(|v| v.get("sector")))
        .and_then(Value::as_str);
    match sector {
        Some("BT_K") => Some(DutyTariffFamily::TvoedK),
        Some("BT_B") => Some(DutyTariffFamily::TvoedB),
        _ => None,
    }
}
pub fn standby_levels(family: Option<DutyTariffFamily>) -> &'static [&'static str] {
    match family {
        Some(DutyTariffFamily::Tvuk) => &["I", "II"],
        Some(DutyTariffFamily::TvoedK) => &["I", "II", "III"],
        Some(_) => &["A", "B", "C", "D"],
        None => &["I", "II", "III", "A", "B", "C", "D"],
    }
}
pub fn standby_normal_factor(
    family: DutyTariffFamily,
    level: &str,
    ordinal: Option<f64>,
    confirmed: bool,
    date: &str,
) -> Option<f64> {
    if !confirmed || date < rule_source(family).version || date > "2026-12-31" {
        return None;
    }
    if family == DutyTariffFamily::Tvuk {
        return match level {
            "I" => Some(0.7),
            "II" => Some(0.9),
            _ => None,
        };
    }
    if family == DutyTariffFamily::TvoedK {
        return match level {
            "I" => Some(0.6),
            "II" => Some(0.75),
            "III" => Some(0.9),
            _ => None,
        };
    }
    let ordinal =
        ordinal.filter(|n| n.is_finite() && n.fract() == 0.0 && (1.0..=100.0).contains(n))?;
    let base = match level {
        "A" => 15.0,
        "B" => 25.0,
        "C" => 40.0,
        "D" => 55.0,
        _ => return None,
    };
    Some(
        (base
            + if ordinal <= 8.0 {
                25.0
            } else if ordinal <= 12.0 {
                35.0
            } else {
                45.0
            })
            / 100.0,
    )
}
pub fn on_call_base_hours(
    family: DutyTariffFamily,
    minutes: f64,
    weekend_or_holiday: bool,
) -> Option<f64> {
    if !minutes.is_finite() || minutes <= 0.0 || minutes > 1440.0 {
        return None;
    }
    if family == DutyTariffFamily::Tvuk {
        return Some((minutes / 60.0) * 0.125);
    }
    if minutes >= 720.0 {
        return Some(if weekend_or_holiday { 4.0 } else { 2.0 });
    }
    Some(
        (if matches!(family, DutyTariffFamily::Tvl43 | DutyTariffFamily::Tvh43) {
            (minutes / 60.0).ceil()
        } else {
            minutes / 60.0
        }) * 0.125,
    )
}
pub fn on_call_paid_minutes(
    family: DutyTariffFamily,
    onsite: &[f64],
    remote: &[f64],
) -> Result<f64, EngineError> {
    if onsite.len() > 100
        || remote.len() > 100
        || onsite
            .iter()
            .chain(remote)
            .any(|m| !m.is_finite() || m.fract() != 0.0 || !(0.0..=1440.0).contains(m))
    {
        return Err(EngineError::InvalidDuration);
    }
    let remote: f64 = remote.iter().sum();
    if family == DutyTariffFamily::Tvuk {
        let external: f64 = onsite.iter().sum();
        return Ok(remote
            + external
            + if onsite.is_empty() {
                0.0
            } else {
                (180.0 - onsite.iter().copied().fold(f64::INFINITY, f64::min)).max(0.0)
            });
    }
    Ok(onsite.iter().map(|m| (m / 60.0).ceil() * 60.0).sum::<f64>()
        + (remote
            / if matches!(family, DutyTariffFamily::Tvl43 | DutyTariffFamily::Tvh43) {
                30.0
            } else {
                60.0
            })
        .ceil()
            * if matches!(family, DutyTariffFamily::Tvl43 | DutyTariffFamily::Tvh43) {
                30.0
            } else {
                60.0
            })
}
