use super::{TariffAnnualError, integer, model::*};
use crate::remuneration::Presence;
use serde_json::{Map, Value};
use std::collections::BTreeSet;
fn object<'a>(v: &'a Value, keys: &[&str]) -> Result<&'a Map<String, Value>, TariffAnnualError> {
    v.as_object()
        .filter(|o| o.len() == keys.len() && keys.iter().all(|key| o.contains_key(*key)))
        .ok_or(TariffAnnualError::Claim)
}
fn boolean(v: &Value) -> Result<bool, TariffAnnualError> {
    v.as_bool().ok_or(TariffAnnualError::Claim)
}
fn optional_bool(v: &Value) -> Result<Option<bool>, TariffAnnualError> {
    if v.is_null() {
        Ok(None)
    } else {
        boolean(v).map(Some)
    }
}
fn optional_int(v: &Value, min: i64, max: i64) -> Result<Option<i64>, TariffAnnualError> {
    if v.is_null() {
        Ok(None)
    } else {
        integer(v, min, max).map(Some)
    }
}
fn identifier(v: &Value) -> Result<String, TariffAnnualError> {
    v.as_str()
        .filter(|s| {
            !s.is_empty()
                && s.len() <= 100
                && s.as_bytes()[0].is_ascii_alphanumeric()
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        })
        .map(str::to_owned)
        .ok_or(TariffAnnualError::Claim)
}
fn date(v: &Value) -> Result<Option<String>, TariffAnnualError> {
    if v.is_null() {
        return Ok(None);
    }
    let s = v
        .as_str()
        .filter(|s| {
            s.len() == 10
                && s.bytes().enumerate().all(|(i, b)| {
                    if [4, 7].contains(&i) {
                        b == b'-'
                    } else {
                        b.is_ascii_digit()
                    }
                })
        })
        .ok_or(TariffAnnualError::Claim)?;
    if !s
        .get(..4)
        .and_then(|n| n.parse::<i32>().ok())
        .is_some_and(|y| (1900..=4099).contains(&y))
    {
        return Err(TariffAnnualError::Claim);
    }
    s.parse::<jiff::civil::Date>()
        .map_err(|_| TariffAnnualError::Date)?;
    Ok(Some(s.into()))
}
pub(super) fn month(v: &Value) -> Result<String, TariffAnnualError> {
    let s = v
        .as_str()
        .filter(|s| {
            s.len() == 7
                && s.as_bytes()[4] == b'-'
                && s.bytes()
                    .enumerate()
                    .all(|(i, b)| i == 4 || b.is_ascii_digit())
                && s.get(5..)
                    .and_then(|m| m.parse::<u8>().ok())
                    .is_some_and(|m| (1..=12).contains(&m))
        })
        .ok_or(TariffAnnualError::Month)?;
    if !s
        .get(..4)
        .and_then(|y| y.parse::<i32>().ok())
        .is_some_and(|y| (1900..=4099).contains(&y))
    {
        return Err(TariffAnnualError::Claim);
    }
    Ok(s.into())
}
pub fn is_caritas_annual_package_id(id: &str) -> bool {
    matches!(
        id,
        "avr-caritas-p-bw"
            | "avr-caritas-p-bayern"
            | "avr-caritas-p-mitte"
            | "avr-caritas-p-nord"
            | "avr-caritas-p-nrw"
            | "avr-caritas-p-ost"
    )
}

pub fn validate_tariff_annual_claim(value: &Value) -> Result<ValidatedClaim, TariffAnnualError> {
    let raw = object(
        value,
        &[
            "version",
            "id",
            "year",
            "selection",
            "employment",
            "entitlements",
            "exceptions",
            "allocation",
            "basis",
        ],
    )?;
    let version = match integer(&raw["version"], 1, 3)? {
        1 => ClaimVersion::V1,
        2 => ClaimVersion::V2,
        3 => ClaimVersion::V3,
        _ => return Err(TariffAnnualError::Claim),
    };
    let mut selection_keys = vec!["packageId", "variant", "region", "group", "confirmed"];
    if version == ClaimVersion::V3 {
        selection_keys.push("groupAtSeptember1Confirmed");
    }
    let s = object(&raw["selection"], &selection_keys)?;
    if version == ClaimVersion::V2 && s["packageId"] != "tvl-kr-tdl"
        || version == ClaimVersion::V3
            && !s["packageId"]
                .as_str()
                .is_some_and(is_caritas_annual_package_id)
    {
        return Err(TariffAnnualError::Claim);
    }
    let e = object(
        &raw["employment"],
        &["start", "end", "confirmed", "takeover"],
    )?;
    let t = object(
        &e["takeover"],
        &["immediate", "sameEmployer", "employedDecember1"],
    )?;
    let mut exception_keys = vec![
        "birthYear",
        "payBeforeParentalLeave",
        "militaryReturnBeforeDecember1",
    ];
    if version == ClaimVersion::V2 {
        exception_keys.push("tvlLegacyRetirementExit");
    }
    let x = object(&raw["exceptions"], &exception_keys)?;
    let a = object(
        &raw["allocation"],
        &["required", "twelfthsNumerator", "twelfthsDenominator"],
    )?;
    let b = object(
        &raw["basis"],
        &[
            "months",
            "lastFullPayMonth",
            "parentalPartTime",
            "adjustedMonthlyCents",
            "takeoverMonthlyCents",
        ],
    )?;
    let rows = raw["entitlements"]
        .as_array()
        .filter(|r| r.len() == 12)
        .ok_or(TariffAnnualError::Claim)?;
    let mut seen = BTreeSet::new();
    let mut entitlements = vec![];
    for row in rows {
        let row = object(row, &["month", "reason"])?;
        let m = integer(&row["month"], 1, 12)? as u8;
        if !seen.insert(m) {
            return Err(TariffAnnualError::Claim);
        }
        let reason = match row["reason"].as_str() {
            Some("PAY") => EntitlementReason::Pay,
            Some("NONE") => EntitlementReason::None,
            Some("MATERNITY") => EntitlementReason::Maternity,
            Some("PARENTAL_BIRTH_YEAR") => EntitlementReason::ParentalBirthYear,
            Some("SICK_PAY_SUPPLEMENT") => EntitlementReason::SickPaySupplement,
            Some("MILITARY_RETURN") => EntitlementReason::MilitaryReturn,
            Some("UNKNOWN") => EntitlementReason::Unknown,
            _ => return Err(TariffAnnualError::Claim),
        };
        entitlements.push(Entitlement { month: m, reason });
    }
    entitlements.sort_by_key(|e| e.month);
    let rows = b["months"]
        .as_array()
        .filter(|r| r.len() <= 36)
        .ok_or(TariffAnnualError::Claim)?;
    let mut seen_months = BTreeSet::new();
    let mut months = vec![];
    for row in rows {
        let row = object(
            row,
            &[
                "month",
                "componentsConfirmed",
                "baseCents",
                "fixedCents",
                "variableCents",
                "scheduledOvertimeCents",
                "paidCalendarDays",
            ],
        )?;
        let m = month(&row["month"])?;
        if !seen_months.insert(m.clone()) {
            return Err(TariffAnnualError::Claim);
        }
        let days = format!("{m}-01")
            .parse::<jiff::civil::Date>()
            .map_err(|_| TariffAnnualError::Month)?
            .days_in_month();
        months.push(BasisMonth {
            month: m,
            components_confirmed: boolean(&row["componentsConfirmed"])?,
            base_cents: optional_int(&row["baseCents"], 0, 1_000_000_000)?,
            fixed_cents: optional_int(&row["fixedCents"], 0, 1_000_000_000)?,
            variable_cents: optional_int(&row["variableCents"], 0, 1_000_000_000)?,
            scheduled_overtime_cents: optional_int(
                &row["scheduledOvertimeCents"],
                0,
                1_000_000_000,
            )?,
            paid_calendar_days: optional_int(&row["paidCalendarDays"], 0, i64::from(days))?,
        });
    }
    months.sort_by(|a, b| a.month.cmp(&b.month));
    let start = date(&e["start"])?;
    let end = date(&e["end"])?;
    if start
        .as_ref()
        .zip(end.as_ref())
        .is_some_and(|(start, end)| end < start)
    {
        return Err(TariffAnnualError::Claim);
    }
    let numerator = optional_int(&a["twelfthsNumerator"], 0, 120_000)?;
    let denominator = optional_int(&a["twelfthsDenominator"], 1, 10_000)?;
    if numerator.zip(denominator).is_some_and(|(n, d)| n > 12 * d) {
        return Err(TariffAnnualError::Claim);
    }
    Ok(ValidatedClaim(ClaimData {
        version,
        id: identifier(&raw["id"])?,
        year: integer(&raw["year"], 1900, 4099)? as i32,
        selection: ClaimSelection {
            package_id: identifier(&s["packageId"])?,
            variant: identifier(&s["variant"])?,
            region: identifier(&s["region"])?,
            group: identifier(&s["group"])?,
            confirmed: boolean(&s["confirmed"])?,
            group_at_september1_confirmed: if version == ClaimVersion::V3 {
                Some(boolean(&s["groupAtSeptember1Confirmed"])?)
            } else {
                None
            },
        },
        employment: ClaimEmployment {
            start,
            end,
            confirmed: boolean(&e["confirmed"])?,
            takeover: Takeover {
                immediate: optional_bool(&t["immediate"])?,
                same_employer: optional_bool(&t["sameEmployer"])?,
                employed_december1: optional_bool(&t["employedDecember1"])?,
            },
        },
        entitlements,
        exceptions: ClaimExceptions {
            birth_year: optional_int(&x["birthYear"], 1900, 4099)?.map(|n| n as i32),
            pay_before_parental_leave: optional_bool(&x["payBeforeParentalLeave"])?,
            military_return_before_december1: optional_bool(&x["militaryReturnBeforeDecember1"])?,
            tvl_legacy_retirement_exit: if version == ClaimVersion::V2 {
                match optional_bool(&x["tvlLegacyRetirementExit"])? {
                    Some(v) => Presence::Value(v),
                    None => Presence::Null,
                }
            } else {
                Presence::Missing
            },
        },
        allocation: ClaimAllocation {
            required: optional_bool(&a["required"])?,
            twelfths_numerator: numerator,
            twelfths_denominator: denominator,
        },
        basis: ClaimBasis {
            months,
            last_full_pay_month: if b["lastFullPayMonth"].is_null() {
                None
            } else {
                Some(month(&b["lastFullPayMonth"])?)
            },
            parental_part_time: optional_bool(&b["parentalPartTime"])?,
            adjusted_monthly_cents: optional_int(&b["adjustedMonthlyCents"], 0, 1_000_000_000)?,
            takeover_monthly_cents: optional_int(&b["takeoverMonthlyCents"], 0, 1_000_000_000)?,
        },
    }))
}
