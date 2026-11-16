use super::{
    DraftPayError,
    annex::{AnnexPremiumInput, calculate_annex_a_time_premiums},
};
use crate::{
    remuneration::{
        caritas::work_slices::derive_month_work_slices, draft_facts::premium::shift_binding,
    },
    rules::{RulePackage, RuleResolver, holidays::holiday_map_for_month},
};
use serde_json::{Value, json};
use std::collections::BTreeMap;
pub struct AnnexFromWorkInput<'a> {
    pub month: &'a str,
    pub variant_id: &'a str,
    pub group_id: &'a str,
    pub full_time_weekly_minutes: f64,
    pub full_time_reference_confirmed: bool,
    pub applicability_confirmed: bool,
    pub cash_payment_confirmed: bool,
    pub local_agreement: &'a str,
    pub shifts: &'a [Value],
    pub pause_details: &'a [Value],
    pub work_profile: &'a Value,
    pub entries_complete: bool,
    pub day_decisions: &'a [Value],
}
fn unavailable(stage: &str, reason: &str) -> Value {
    json!({"kind":"unavailable","stage":stage,"reason":reason})
}
fn invalid_decision(reason: &str, decision: &Value) -> Value {
    json!({"kind":"unavailable","stage":"work-facts","reason":reason,"shiftId":decision["shiftId"],"date":decision["date"]})
}
fn real_date(value: &Value) -> bool {
    value.as_str().is_some_and(|s| {
        s.len() == 10
            && s.as_bytes()[4] == b'-'
            && s.as_bytes()[7] == b'-'
            && s.parse::<jiff::civil::Date>()
                .is_ok_and(|d| d.to_string() == s)
    })
}
fn tri(value: Option<&Value>) -> bool {
    value.is_some_and(|v| v.is_null() || v.is_boolean())
}
/// Derives actual work natively from raw shifts and recorded pauses. No numeric
/// work-slice result or tariff-readiness flag arrives from TypeScript.
pub fn calculate_annex_a_time_premiums_from_work(
    pkg: &RulePackage,
    input: &AnnexFromWorkInput<'_>,
    resolver: &RuleResolver,
) -> Result<Value, DraftPayError> {
    Ok(calculate_with_work_evidence(pkg, input, resolver)?.result)
}
pub(crate) struct AnnexWorkEvidence {
    pub result: Value,
    pub net_minutes: Option<i64>,
}
pub(crate) fn calculate_with_work_evidence(
    pkg: &RulePackage,
    input: &AnnexFromWorkInput<'_>,
    resolver: &RuleResolver,
) -> Result<AnnexWorkEvidence, DraftPayError> {
    let mut net_minutes = None;
    let result = calculate_inner(pkg, input, resolver, &mut net_minutes)?;
    Ok(AnnexWorkEvidence {
        result,
        net_minutes,
    })
}
fn calculate_inner(
    pkg: &RulePackage,
    input: &AnnexFromWorkInput<'_>,
    resolver: &RuleResolver,
    net_minutes: &mut Option<i64>,
) -> Result<Value, DraftPayError> {
    if input.work_profile["timeZone"] != "Europe/Berlin" {
        return Ok(unavailable("work-slices", "TIME_ZONE_UNSUPPORTED"));
    }
    if input.day_decisions.len() > 100_000 {
        return Err(DraftPayError::InvalidInput);
    }
    let mut work = derive_month_work_slices(
        input.month,
        input.shifts,
        input.pause_details,
        "Europe/Berlin",
        input.entries_complete,
    );
    if work["kind"] == "unavailable" {
        work["stage"] = json!("work-slices");
        return Ok(work);
    }
    *net_minutes = Some(
        work["slices"]
            .as_array()
            .ok_or(DraftPayError::InvalidInput)?
            .iter()
            .try_fold(0_i64, |total, s| {
                let from = s["fromMinute"]
                    .as_i64()
                    .ok_or(DraftPayError::InvalidInput)?;
                let through = s["throughMinute"]
                    .as_i64()
                    .ok_or(DraftPayError::InvalidInput)?;
                total
                    .checked_add(through - from)
                    .ok_or(DraftPayError::InvalidInput)
            })?,
    );
    let first = format!("{}-01", input.month)
        .parse::<jiff::civil::Date>()
        .map_err(|_| DraftPayError::InvalidInput)?;
    let previous = first
        .checked_sub(jiff::Span::new().days(1))
        .map_err(|_| DraftPayError::InvalidInput)?
        .to_string();
    if let Some(training) = input.shifts.iter().find(|s| {
        s.get("deletedAt") == Some(&Value::Null)
            && s["type"] == "TRAINING"
            && (s["date"]
                .as_str()
                .is_some_and(|d| d.starts_with(&format!("{}-", input.month)))
                || s["date"] == previous
                    && s["startTime"]
                        .as_str()
                        .zip(s["endTime"].as_str())
                        .is_some_and(|(a, b)| b <= a && b != "00:00"))
    }) {
        return Ok(
            json!({"kind":"unavailable","stage":"work-slices","reason":"TRAINING_WORK_UNRESOLVED","shiftId":training["id"]}),
        );
    }
    if input.work_profile["holidayRegion"] == "UNKNOWN" {
        return Ok(unavailable("work-facts", "HOLIDAY_REGION_UNKNOWN"));
    }
    let mut decisions = BTreeMap::new();
    for decision in input.day_decisions {
        if !decision["shiftId"].as_str().is_some_and(|s| !s.is_empty())
            || !real_date(&decision["date"])
            || decision["origin"] != "confirmed"
            || !decision["shiftBinding"]
                .as_str()
                .is_some_and(|s| !s.is_empty())
            || !decision
                .get("workKind")
                .is_some_and(|v| v.is_null() || v == "REGULAR_ACTIVE" || v == "SPECIAL")
            || !["holidayTimeOff", "shiftWork", "legacyAngestellteClass"]
                .iter()
                .all(|k| tri(decision.get(*k)))
        {
            return Ok(invalid_decision("INVALID_DECISION", decision));
        }
        let key = (
            decision["shiftId"]
                .as_str()
                .ok_or(DraftPayError::InvalidInput)?,
            decision["date"]
                .as_str()
                .ok_or(DraftPayError::InvalidInput)?,
        );
        if decisions.insert(key, decision).is_some() {
            return Ok(invalid_decision("DECISION_AMBIGUOUS", decision));
        }
    }
    let Some(state) = input.work_profile["federalState"].as_str() else {
        return Ok(unavailable("work-facts", "HOLIDAY_RULES_UNAVAILABLE"));
    };
    let Some(region) = input.work_profile["holidayRegion"].as_str() else {
        return Ok(unavailable("work-facts", "HOLIDAY_RULES_UNAVAILABLE"));
    };
    let Ok(holidays) = holiday_map_for_month(input.month, state, region, resolver) else {
        return Ok(unavailable("work-facts", "HOLIDAY_RULES_UNAVAILABLE"));
    };
    let mut worked_slices = vec![];
    for slice in work["slices"]
        .as_array()
        .ok_or(DraftPayError::InvalidInput)?
    {
        let id = slice["shiftId"]
            .as_str()
            .ok_or(DraftPayError::InvalidInput)?;
        let date = slice["date"].as_str().ok_or(DraftPayError::InvalidInput)?;
        let Some(decision) = decisions
            .get(&(id, date))
            .filter(|d| !d["workKind"].is_null())
        else {
            return Ok(
                json!({"kind":"unavailable","stage":"work-facts","reason":"WORK_KIND_UNCONFIRMED","shiftId":id,"date":date}),
            );
        };
        let current = input.shifts.iter().find(|s| s["id"] == id);
        let bound = current
            .map(|s| shift_binding(s, "Europe/Berlin"))
            .transpose()
            .map_err(|_| DraftPayError::InvalidInput)?;
        if bound.as_deref() != decision["shiftBinding"].as_str() {
            return Ok(
                json!({"kind":"unavailable","stage":"work-facts","reason":"DECISION_STALE","shiftId":id,"date":date}),
            );
        }
        let holiday = holidays.contains_key(date);
        let from = slice["fromMinute"]
            .as_i64()
            .ok_or(DraftPayError::InvalidInput)?;
        let through = slice["throughMinute"]
            .as_i64()
            .ok_or(DraftPayError::InvalidInput)?;
        let mut worked = json!({"date":date,"fromMinute":from,"throughMinute":through,"actualElapsedMinutes":through-from,"workKind":decision["workKind"],"publicHoliday":holiday});
        if holiday && let Some(value) = decision.get("holidayTimeOff").filter(|v| !v.is_null()) {
            worked["holidayTimeOff"] = (*value).clone();
        }
        for key in ["shiftWork", "legacyAngestellteClass"] {
            if let Some(value) = decision.get(key).filter(|v| !v.is_null()) {
                worked[key] = value.clone();
            }
        }
        worked_slices.push(worked);
    }
    let result = calculate_annex_a_time_premiums(
        pkg,
        &AnnexPremiumInput {
            month: input.month,
            variant_id: input.variant_id,
            group_id: input.group_id,
            full_time_weekly_minutes: input.full_time_weekly_minutes,
            full_time_reference_confirmed: input.full_time_reference_confirmed,
            applicability_confirmed: input.applicability_confirmed,
            work_data_complete: true,
            cash_payment_confirmed: input.cash_payment_confirmed,
            local_agreement: input.local_agreement,
            worked_slices: &worked_slices,
        },
    )?;
    let mut result = serde_json::to_value(result).map_err(|_| DraftPayError::InvalidInput)?;
    if result["kind"] == "unavailable" {
        result["stage"] = json!("premium");
    }
    Ok(result)
}
