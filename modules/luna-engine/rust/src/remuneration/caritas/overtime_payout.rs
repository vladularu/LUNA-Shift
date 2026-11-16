//! Delayed Caritas overtime cash from a complete native source history; no payout is inferred.
use super::{flow::FlowError, policy, saved};
use crate::{
    employment::{ResolutionStatus, resolve_remuneration_profile_ref},
    net::js_truthy,
    remuneration::{
        base::{BaseError, shift_days::remuneration_shift_days},
        context::model::NativePackageValidator,
    },
    rules::RuleResolver,
};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
/// Native-only admitted record view; I/O completeness is supplied by Rust, with no Deserialize/wire Ready flag.
pub struct OvertimePayoutInput<'a> {
    pub month: &'a str,
    pub time_zone: &'a str,
    pub history_complete: bool,
    pub shifts: &'a [Value],
    pub allocations: &'a [Value],
    pub confirmations: &'a [Value],
    pub profiles: &'a [Value],
}
fn fail(reason: &str, shift: Option<&Value>, date: Option<&str>) -> Value {
    let mut value = json!({"kind":"unavailable","reason":reason});
    if let Some(shift) = shift {
        value["shiftId"] = shift.clone();
    }
    if let Some(date) = date {
        value["date"] = json!(date);
    }
    value
}
fn unique<'a>(records: &'a [Value], field: &str) -> Option<BTreeMap<Option<&'a str>, &'a Value>> {
    let mut result = BTreeMap::new();
    for record in records {
        if result.insert(record[field].as_str(), record).is_some() {
            return None;
        }
    }
    Some(result)
}
fn f64(value: &Value) -> f64 {
    value.as_f64().unwrap_or(f64::NAN)
}
pub fn calculate(
    input: &OvertimePayoutInput<'_>,
    resolver: &RuleResolver,
    validator: &impl NativePackageValidator,
) -> Result<Value, FlowError> {
    if crate::input::calendar::require_local_month(&json!(input.month)).is_err() {
        return Ok(fail("INVALID_MONTH", None, None));
    }
    let first =
        crate::calendar::parse_date(&format!("{}-01", input.month)).map_err(BaseError::from)?;
    let month_end = format!("{}-{:02}", input.month, first.days_in_month());
    if !input.history_complete {
        return Ok(fail("HISTORY_INCOMPLETE", None, None));
    }
    let (Some(shifts), Some(allocations), Some(confirmations)) = (
        unique(input.shifts, "id"),
        unique(input.allocations, "shiftId"),
        unique(input.confirmations, "shiftId"),
    ) else {
        return Ok(fail("DUPLICATE_RECORD", None, None));
    };
    if allocations
        .keys()
        .chain(confirmations.keys())
        .any(|id| !shifts.contains_key(id))
    {
        return Ok(fail("ORPHAN_RECORD", None, None));
    }
    for c in input.confirmations {
        if c["workPayoutMonth"] != input.month && c["premiumPayoutMonth"] != input.month {
            continue;
        }
        let shift = shifts[&c["shiftId"].as_str()];
        if shift["date"]
            .as_str()
            .is_some_and(|d| d > month_end.as_str())
            || shift.get("deletedAt") != Some(&Value::Null)
            || f64(&shift["overtimeMinutes"]) <= 0.0
            || !js_truthy(&shift["tariffOvertimeConfirmed"])
        {
            return Ok(fail(
                "CONFIRMATION_MISSING_OR_STALE",
                Some(&c["shiftId"]),
                None,
            ));
        }
    }
    let mut positions = Vec::new();
    let mut checked = BTreeSet::new();
    for shift in input.shifts {
        if shift["date"]
            .as_str()
            .is_some_and(|d| d > month_end.as_str())
            || f64(&shift["overtimeMinutes"]) <= 0.0
        {
            continue;
        }
        let id = Some(&shift["id"]);
        let days = remuneration_shift_days(shift, input.time_zone)?;
        if days.is_empty() {
            return Ok(fail("ALLOCATION_MISSING_OR_STALE", id, None));
        }
        let day_profiles = days
            .iter()
            .map(|day| resolve_remuneration_profile_ref(input.profiles, &day.date))
            .collect::<Result<Vec<_>, _>>()?;
        if day_profiles
            .iter()
            .any(|p| p.status != ResolutionStatus::Dated)
        {
            return Ok(fail("PROFILE_MISSING_OR_STALE", id, None));
        }
        let caritas = day_profiles
            .iter()
            .filter(|p| {
                p.profile.is_some_and(|p| {
                    p["data"]["selection"]["kind"] == "tariff"
                        && p["data"]["selection"]["packageId"]
                            .as_str()
                            .is_some_and(|s| s.starts_with("avr-caritas-p-"))
                })
            })
            .count();
        if caritas == 0 {
            continue;
        }
        if caritas != days.len() {
            return Ok(fail("PROFILE_MISSING_OR_STALE", id, None));
        }
        if !js_truthy(&shift["tariffOvertimeConfirmed"]) {
            return Ok(fail("CLASSIFICATION_UNCONFIRMED", id, None));
        }
        let Some(allocation) = allocations.get(&shift["id"].as_str()).filter(|a| {
            crate::remuneration::overtime::saved::is_current_overtime_allocation(
                a,
                shift,
                input.time_zone,
            )
        }) else {
            return Ok(fail("ALLOCATION_MISSING_OR_STALE", id, None));
        };
        let Some(allocated) = allocation["allocations"].as_array() else {
            return Ok(fail("ALLOCATION_MISSING_OR_STALE", id, None));
        };
        if allocated
            .iter()
            .fold(0.0, |sum, d| sum + f64(&d["minutes"]))
            != f64(&shift["overtimeMinutes"])
            || allocated.iter().any(|d| {
                days.iter()
                    .find(|day| d["date"] == day.date)
                    .is_none_or(|day| f64(&d["minutes"]) > day.until - day.from)
            })
        {
            return Ok(fail("ALLOCATION_MISSING_OR_STALE", id, None));
        }
        let active: Vec<_> = allocated
            .iter()
            .filter(|d| f64(&d["minutes"]) > 0.0)
            .collect();
        let Some(latest) = active
            .last()
            .and_then(|d| d["date"].as_str())
            .and_then(|d| d.get(..7))
        else {
            return Ok(fail("ALLOCATION_MISSING_OR_STALE", id, None));
        };
        if latest > input.month {
            continue;
        }
        let Some(c) = confirmations.get(&shift["id"].as_str()) else {
            return Ok(fail("CONFIRMATION_MISSING_OR_STALE", id, None));
        };
        if c["allocationRevision"].as_f64() != allocation["revision"].as_f64() {
            return Ok(fail("CONFIRMATION_MISSING_OR_STALE", id, None));
        }
        if ["workPayoutMonth", "premiumPayoutMonth"]
            .iter()
            .any(|key| c[*key].as_str().is_some_and(|p| p < latest))
        {
            return Ok(fail("CONFIRMATION_MISSING_OR_STALE", id, None));
        }
        if (c["workSettlement"] == "CASH" && c.get("workPayoutMonth") == Some(&Value::Null))
            || (c["premiumSettlement"] == "CASH"
                && c.get("premiumPayoutMonth") == Some(&Value::Null))
        {
            return Ok(fail("PAYOUT_MONTH_UNKNOWN", id, None));
        }
        let Some(profile) = input
            .profiles
            .iter()
            .find(|p| p.get("effectiveFrom") == c.get("profileEffectiveFrom"))
        else {
            return Ok(fail("PROFILE_MISSING_OR_STALE", id, None));
        };
        let selection = &profile["data"]["selection"];
        let mut profile_matches = selection["kind"] == "tariff";
        for d in &active {
            let resolved = resolve_remuneration_profile_ref(
                input.profiles,
                d["date"].as_str().ok_or(BaseError::InvalidCalculation)?,
            )?;
            if resolved.status != ResolutionStatus::Dated
                || resolved.profile.is_none_or(|p| !std::ptr::eq(p, profile))
            {
                profile_matches = false;
            }
        }
        if !profile_matches {
            return Ok(fail("PROFILE_MISSING_OR_STALE", id, None));
        }
        if !saved::is_current_overtime_binding(c, shift, allocation, profile, input.time_zone) {
            return Ok(fail("CONFIRMATION_MISSING_OR_STALE", id, None));
        }
        checked.insert(shift["id"].as_str());
        if c["workPayoutMonth"] != input.month && c["premiumPayoutMonth"] != input.month {
            continue;
        }
        for d in active {
            let date = d["date"].as_str().ok_or(BaseError::InvalidCalculation)?;
            let pkg = c["packageId"]
                .as_str()
                .and_then(|package| resolver.resolve_tariff(date, Some(package)).ok())
                .filter(|p| c["packageId"] == p.package_id && c["ruleVersionId"] == p.version_id);
            let Some(pkg) = pkg else {
                return Ok(fail("RULE_PACKAGE_MISSING_OR_CHANGED", id, Some(date)));
            };
            let result = policy::overtime::calculate(
                pkg,
                &json!({"date":date,"variantId":c["variantId"],"regionId":c["regionId"],"groupId":selection["group"],"stepId":selection["level"],"minutes":d["minutes"],"classification":c["classification"],"workSettlement":c["workSettlement"],"premiumSettlement":c["premiumSettlement"]}),
                validator,
            )?;
            if result["kind"] == "unavailable" {
                return Ok(fail("OVERTIME_CALCULATION_UNAVAILABLE", id, Some(date)));
            }
            for item in result["positions"]
                .as_array()
                .ok_or(BaseError::InvalidCalculation)?
            {
                let payout = if item["component"] == "WORK_HOURS" {
                    &c["workPayoutMonth"]
                } else {
                    &c["premiumPayoutMonth"]
                };
                if *payout != input.month || item["settlement"] != "CASH" {
                    continue;
                }
                positions.push(json!({"shiftId":shift["id"],"workDate":date,"payoutMonth":input.month,"component":item["component"],"minutes":d["minutes"],"amountCents":item["cashAmountCents"],"packageId":result["packageId"],"versionId":result["versionId"],"sourceIds":result["sourceIds"]}));
            }
        }
    }
    if let Some(c) = input.confirmations.iter().find(|c| {
        (c["workPayoutMonth"] == input.month || c["premiumPayoutMonth"] == input.month)
            && !checked.contains(&c["shiftId"].as_str())
    }) {
        return Ok(fail(
            "CONFIRMATION_MISSING_OR_STALE",
            Some(&c["shiftId"]),
            None,
        ));
    }
    let total = positions
        .iter()
        .fold(0.0, |sum, p| sum + f64(&p["amountCents"]));
    if !total.is_finite()
        || total.fract() != 0.0
        || total.abs() > crate::money::MAX_SAFE_INTEGER as f64
    {
        return Ok(fail("AMOUNT_OVERFLOW", None, None));
    }
    Ok(
        json!({"kind":"draft-confirmed-payouts","status":"estimated","month":input.month,"cashSubtotalCents":total as i64,"positions":positions}),
    )
}
