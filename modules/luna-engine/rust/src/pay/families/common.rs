use super::{Family, FamilyError, profile};
use crate::{
    EngineError,
    money::round_ratio,
    net::premium_trace::NetPayPremiumTrace,
    rules::{RuleKind, RulePackage, RuleResolutionFailure, RuleResolver},
    time::{self, ShiftTime},
};
use jiff::{Timestamp, ToSpan, Zoned, civil::Time};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::OnceLock};

pub(crate) fn string<'a>(v: &'a Value, key: &str) -> Result<&'a str, FamilyError> {
    v.get(key)
        .and_then(Value::as_str)
        .ok_or(FamilyError::Message("Invalid family calculation input"))
}
pub(crate) fn integer(v: &Value, key: &str) -> Result<i64, FamilyError> {
    v.get(key)
        .and_then(Value::as_i64)
        .ok_or(FamilyError::Message("Invalid family calculation input"))
}
pub(crate) fn rows(v: &Value) -> Result<&[Value], FamilyError> {
    v.as_array()
        .map(Vec::as_slice)
        .ok_or(FamilyError::Message("Invalid family calculation rules"))
}
pub(crate) fn active(date: &str, item: &Value) -> bool {
    item["validFrom"].as_str().is_some_and(|from| from <= date)
        && item["validTo"].as_str().is_none_or(|to| date <= to)
}
pub(crate) fn round(n: i64, d: i64) -> Result<i64, FamilyError> {
    Ok(round_ratio(n, d)?)
}
pub(crate) fn euros(cents: i64) -> Value {
    if cents % 100 == 0 {
        json!(cents / 100)
    } else {
        json!(cents as f64 / 100.0)
    }
}
// JSON.stringify emits integral Numbers without a decimal suffix, including -0 as 0.
// This is representation canonicalization, with no numerical tolerance or rounding.
pub(crate) fn scalar(value: f64) -> Value {
    if value.fract() == 0.0 && value.abs() <= crate::money::MAX_SAFE_INTEGER as f64 {
        json!(value as i64)
    } else {
        json!(value)
    }
}
pub(crate) fn cents(v: &Value) -> Result<i64, FamilyError> {
    let value = v
        .as_f64()
        .ok_or(FamilyError::Message("Invalid family amount"))?;
    if !value.is_finite() || value < 0.0 || value * 100.0 > crate::money::MAX_SAFE_INTEGER as f64 {
        return Err(EngineError::InvalidMoney.into());
    }
    Ok((value * 100.0).round() as i64)
}
pub(crate) fn legacy_money(value: f64) -> f64 {
    (((value + f64::EPSILON) * 100.0) + 0.5).floor() / 100.0
}
pub(crate) fn month_first(month: &str) -> Result<String, FamilyError> {
    Ok(crate::calendar::month_range(month)?.start)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Data {
    pub packages: BTreeMap<String, Vec<RulePackage>>,
    pub tvuk_tables: Vec<Value>,
    pub tvh_tables: Vec<Value>,
}
pub(crate) fn data() -> Result<&'static Data, FamilyError> {
    static DATA: OnceLock<Option<Data>> = OnceLock::new();
    DATA.get_or_init(|| serde_json::from_str(include_str!("data.json")).ok())
        .as_ref()
        .ok_or(FamilyError::Message("Invalid frozen family catalog"))
}
pub(crate) fn bundled_resolver() -> Result<&'static RuleResolver, FamilyError> {
    static BUNDLED: OnceLock<Option<RuleResolver>> = OnceLock::new();
    BUNDLED
        .get_or_init(|| RuleResolver::bundled().ok())
        .as_ref()
        .ok_or(FamilyError::Message("Invalid bundled family policy"))
}
fn family_key(family: Family) -> &'static str {
    match family {
        Family::VkaE => "VKA_E",
        Family::Training => "TRAINING",
        Family::Tvl => "TVL",
        Family::Tval => "TVAL",
        Family::Tvuk => "TVUK",
        Family::Tvh => "TVH",
    }
}
fn table_family(family: Family) -> &'static str {
    match family {
        Family::VkaE => "TVOED_VKA_E",
        Family::Training => "TVAOED_PFLEGE",
        Family::Tvl => "TVL_KR",
        Family::Tval => "TVAL_PFLEGE",
        Family::Tvuk => "TVUK_PUK",
        Family::Tvh => "TVH_KR",
    }
}

pub(crate) fn selected_update(
    resolver: &RuleResolver,
    family: Family,
    date: &str,
) -> Result<Option<Value>, FamilyError> {
    let Some(data) = resolver.simple_tariff_data_ref() else {
        return Ok(None);
    };
    let matching: Vec<_> = rows(data.tables)?
        .iter()
        .filter(|t| t["tariffId"] == table_family(family) && active(date, t))
        .collect();
    if matching.len() > 1 {
        return Err(FamilyError::Message("Mehrdeutige geprüfte Tariftabelle."));
    }
    Ok(matching.first().map(|value| (*value).clone()))
}
pub(crate) fn table_amount(table: &Value, group: &str, step: &str) -> Result<i64, FamilyError> {
    let matching: Vec<_> = rows(&table["entries"])?
        .iter()
        .filter(|e| e["groupId"] == group && e["stepId"] == step)
        .collect();
    if matching.len() != 1 {
        return Err(FamilyError::Message(
            "Unvollständige geprüfte Tariftabelle.",
        ));
    }
    integer(matching[0], "monthlyCents")
}
fn overlay(
    local: &RulePackage,
    table: Option<Value>,
    resolver: &RuleResolver,
) -> Result<RulePackage, FamilyError> {
    let Some(table) = table else {
        return Ok(local.clone());
    };
    let data = resolver
        .simple_tariff_data_ref()
        .ok_or(FamilyError::Message("Missing simple tariff data"))?;
    let mut pkg =
        serde_json::to_value(local).map_err(|_| FamilyError::Message("Invalid family package"))?;
    pkg["validFrom"] = table["validFrom"].clone();
    pkg["validTo"] = table["validTo"].clone();
    let ids = rows(&table["sourceIds"])?;
    let mut sources: Vec<_> = rows(&pkg["sources"])?
        .iter()
        .filter(|s| !ids.contains(&s["id"]))
        .cloned()
        .collect();
    sources.extend(
        rows(
            data.sources
                .ok_or(FamilyError::Message("Missing tariff sources"))?,
        )?
        .iter()
        .filter(|s| ids.contains(&s["id"]))
        .cloned(),
    );
    pkg["sources"] = Value::Array(sources);
    let table_id = pkg["rules"]["selector"]["payTableId"].clone();
    for pay_table in pkg["rules"]["payTables"]
        .as_array_mut()
        .ok_or(FamilyError::Message("Invalid pay table"))?
    {
        if pay_table["id"] == table_id {
            pay_table["entries"] = table["entries"].clone();
            pay_table["sourceIds"] = table["sourceIds"].clone();
        }
    }
    serde_json::from_value(pkg).map_err(|_| FamilyError::Message("Invalid family package"))
}

pub(crate) fn package(
    family: Family,
    date: &str,
    resolver: &RuleResolver,
) -> Result<Option<RulePackage>, FamilyError> {
    crate::calendar::parse_date(date)?;
    let locals = data()?
        .packages
        .get(family_key(family))
        .ok_or(FamilyError::Message("Missing local family packages"))?;
    let Some(local) = locals.iter().find(|p| {
        p.valid_from.as_str() <= date && p.valid_to.as_deref().is_none_or(|to| date <= to)
    }) else {
        return Ok(None);
    };
    let pkg = overlay(local, selected_update(resolver, family, date)?, resolver)?;
    if family != Family::VkaE {
        return Ok(Some(pkg));
    }
    let base = match resolver.resolve_tariff(date, None) {
        Ok(base) => base,
        Err(error) if error.code == "RULE_PACKAGE_NOT_FOUND" => {
            let fallback = bundled_resolver()?;
            let Ok(base) = fallback.resolve_tariff(date, None) else {
                return Ok(None);
            };
            base
        }
        Err(_) => return Ok(None),
    };
    let mut raw =
        serde_json::to_value(pkg).map_err(|_| FamilyError::Message("Invalid E package"))?;
    let policy = raw["rules"]["tvoedAnnexATimePremiumPolicy"].clone();
    raw["rules"]["hourlyCalculation"] = json!({"monthlyFactorThousandths":policy["monthlyFactorThousandths"],"rounding":"HALF_UP","sourceIds":policy["sourceIds"]});
    raw["rules"]["premiumRules"] = Value::Array(
        rows(&base.rules()["premiumRules"])?
            .iter()
            .filter(|r| r["premiumType"] != "OVERTIME")
            .cloned()
            .collect(),
    );
    for key in ["combinationRules", "workPatternPolicy", "workPatternRules"] {
        raw["rules"][key] = base.rules()[key].clone();
    }
    raw["rules"]["allowanceRules"] = Value::Array(
        rows(&base.rules()["allowanceRules"])?
            .iter()
            .filter(|r| {
                matches!(
                    r["allowanceType"].as_str(),
                    Some("shift" | "alternating-shift")
                )
            })
            .cloned()
            .collect(),
    );
    serde_json::from_value(raw)
        .map(Some)
        .map_err(|_| FamilyError::Message("Invalid E package"))
}

pub(crate) fn raw_table(
    family: Family,
    date: &str,
    resolver: &RuleResolver,
) -> Result<Option<Value>, FamilyError> {
    crate::calendar::parse_date(date)?;
    let tables = if family == Family::Tvuk {
        &data()?.tvuk_tables
    } else {
        &data()?.tvh_tables
    };
    let Some(local) = tables.iter().find(|t| active(date, t)) else {
        return Ok(None);
    };
    let Some(update) = selected_update(resolver, family, date)? else {
        return Ok(Some(local.clone()));
    };
    let mut table = local.clone();
    table["validFrom"] = update["validFrom"].clone();
    table["validTo"] = update["validTo"].clone();
    if family == Family::Tvuk {
        for (group, steps) in table["groups"]
            .as_object_mut()
            .ok_or(FamilyError::Message("Invalid TV-UK groups"))?
        {
            for (step, amount) in steps
                .as_object_mut()
                .ok_or(FamilyError::Message("Invalid TV-UK steps"))?
            {
                *amount = json!(table_amount(&update, group, step)?);
            }
        }
    } else {
        for (group, amounts) in table["monthlyCents"]
            .as_object_mut()
            .ok_or(FamilyError::Message("Invalid TV-H groups"))?
        {
            let levels = profile::tvh_kr_levels_for_group(group);
            *amounts = Value::Array(
                levels
                    .iter()
                    .map(|step| {
                        table_amount(
                            &update,
                            group,
                            step.as_str()
                                .map(str::to_owned)
                                .unwrap_or_else(|| step.to_string())
                                .as_str(),
                        )
                        .map(|v| json!(v))
                    })
                    .collect::<Result<_, _>>()?,
            );
        }
    }
    Ok(Some(table))
}

pub(crate) fn selection(family: Family, profile: &Value) -> Result<Option<Value>, FamilyError> {
    let value = &profile[family.field()];
    Ok(match family {
        Family::VkaE => profile::require_vka_e_tariff(value)?,
        Family::Training => profile::require_nursing_training_tariff(value)?,
        Family::Tvl => profile::require_tvl_kr_salary_tariff(value)?,
        Family::Tvuk => profile::require_tvuk_nursing_tariff(value)?,
        Family::Tvh => profile::require_tvh_kr_tariff(value)?,
        Family::Tval => profile::require_tval_pflege_tariff(value)?,
    })
}
pub(crate) fn empty_shift(shift: &Value) -> Value {
    json!({"shiftId":shift["id"],"date":shift["date"],"netMinutes":0,"premiumLines":[],"overtimeBaseAmount":0,"overtimePremiumAmount":0,"totalAmount":0})
}
pub(crate) fn work(shift: &Value) -> bool {
    shift.get("deletedAt") == Some(&Value::Null) && crate::pay::pattern::is_pay_work_shift(shift)
}
pub(crate) struct FamilyBounds {
    pub start_epoch_milliseconds: i64,
    pub gross_minutes: i64,
    pub net_minutes: i64,
}
pub(crate) fn bounds(shift: &Value, profile: &Value) -> Result<Option<FamilyBounds>, FamilyError> {
    let projected: ShiftTime = serde_json::from_value(shift.clone())
        .map_err(|_| FamilyError::Message("Invalid family shift"))?;
    let Some(instants) = time::shift_instants(&projected, string(profile, "timeZone")?)? else {
        return Ok(None);
    };
    let gross = (instants.end_epoch_milliseconds - instants.start_epoch_milliseconds + 30000)
        .div_euclid(60000);
    Ok(Some(FamilyBounds {
        start_epoch_milliseconds: instants.start_epoch_milliseconds,
        gross_minutes: gross,
        net_minutes: (gross - projected.break_minutes).max(0),
    }))
}
pub(crate) fn traced(
    shift: &Value,
    bounds: &FamilyBounds,
    capture: bool,
    paid: bool,
) -> Result<Option<NetPayPremiumTrace>, FamilyError> {
    if !capture {
        return Ok(None);
    }
    let pause = integer(shift, "breakMinutes")?.min(bounds.gross_minutes);
    Ok(Some(NetPayPremiumTrace::new_milliseconds(
        string(shift, "id")?.into(),
        bounds.start_epoch_milliseconds,
        bounds.gross_minutes,
        pause,
        paid,
    )?))
}
pub(crate) fn missing(family: Family, date: &str) -> FamilyError {
    let message = match family {
        Family::VkaE => "Für einen Dienst fehlt eine gültige E-Tabelle.",
        Family::Training => "Für einen Dienst fehlt eine gültige Ausbildungstabelle.",
        Family::Tvl => "Für einen Dienst fehlt eine gültige TV-L-Pflegetabelle oder Vollzeitbasis.",
        Family::Tval => {
            "Für einen Dienst fehlt eine gültige TVA-L-Ausbildungstabelle oder Vollzeitbasis."
        }
        Family::Tvuk => {
            "Für einen Dienst fehlt eine gültige TV-UK-Pflegetabelle oder Vollzeitbasis."
        }
        Family::Tvh => "Für einen Dienst fehlt eine gültige TV-H-Pflegetabelle oder Vollzeitbasis.",
    };
    FamilyError::Rule(Box::new(RuleResolutionFailure {
        code: "RULE_PACKAGE_NOT_FOUND",
        kind: RuleKind::Tariff,
        package_id: family.package_id().into(),
        effective_date: date.into(),
        message: message.into(),
    }))
}

pub(crate) struct Section {
    pub from: i64,
    pub until: i64,
    pub date: String,
    pub weekday: i8,
    pub start_minute: i64,
    pub transition: bool,
}
pub(crate) fn start(bounds: &FamilyBounds, profile: &Value) -> Result<Zoned, FamilyError> {
    let tz = time::zone(string(profile, "timeZone")?)?;
    Ok(Timestamp::from_millisecond(bounds.start_epoch_milliseconds)
        .map_err(|_| EngineError::InvalidTime)?
        .to_zoned(tz))
}
pub(crate) fn sections(start: &Zoned, gross: i64) -> Result<Vec<Section>, FamilyError> {
    let mut from = 0;
    let mut sections = vec![];
    while from < gross {
        let local = start
            .checked_add(from.minutes())
            .map_err(|_| EngineError::InvalidTime)?;
        let tomorrow = local
            .date()
            .checked_add(1.days())
            .map_err(|_| EngineError::InvalidDate)?;
        let midnight = start
            .time_zone()
            .to_ambiguous_zoned(tomorrow.to_datetime(Time::midnight()))
            .compatible()
            .map_err(|_| EngineError::InvalidTime)?;
        let until = gross.min(
            (midnight.timestamp().as_millisecond() - start.timestamp().as_millisecond()) / 60000,
        );
        if until <= from {
            return Err(EngineError::InvalidTime.into());
        }
        let last = start
            .checked_add((until - 1).minutes())
            .map_err(|_| EngineError::InvalidTime)?;
        sections.push(Section {
            from,
            until,
            date: local.date().to_string(),
            weekday: local.weekday().to_monday_one_offset(),
            start_minute: i64::from(local.hour()) * 60 + i64::from(local.minute()),
            transition: local.offset() != last.offset(),
        });
        from = until;
    }
    Ok(sections)
}
pub(crate) fn minute(start: &Zoned, section: &Section, offset: i64) -> Result<i64, FamilyError> {
    if section.transition {
        let cursor = start
            .checked_add(offset.minutes())
            .map_err(|_| EngineError::InvalidTime)?;
        Ok(i64::from(cursor.hour()) * 60 + i64::from(cursor.minute()))
    } else {
        Ok(section.start_minute + offset - section.from)
    }
}
pub(crate) fn window(minute: i64, value: &Value) -> Result<bool, FamilyError> {
    let start = integer(value, "startMinute")?;
    let end = integer(value, "endMinute")?;
    Ok(if start < end {
        minute >= start && minute < end
    } else {
        minute >= start || minute < end
    })
}
pub(crate) fn empty_month(
    month: &str,
    family: Family,
    available: bool,
) -> Result<Value, FamilyError> {
    let mut value = crate::pay::manual::create_manual_monthly_pay_estimate(month, 0)?;
    value["tariffLabel"] = json!(family.label());
    if !available {
        value["available"] = json!(false);
        value["fullTimeTableAmount"] = Value::Null;
        value["personalBaseAmount"] = Value::Null;
        value["estimatedGrossAmount"] = Value::Null;
    }
    Ok(value)
}
pub(crate) fn sum_breakdowns(breakdowns: &[Value]) -> Result<(i64, i64), FamilyError> {
    let mut premium = 0;
    let mut overtime = 0;
    for b in breakdowns {
        for line in rows(&b["premiumLines"])? {
            premium += cents(&line["amount"])?;
        }
        overtime += cents(&b["overtimeBaseAmount"])? + cents(&b["overtimePremiumAmount"])?;
    }
    Ok((premium, overtime))
}

pub(crate) struct RateContext {
    pub pkg: Option<RulePackage>,
    pub full_time: i64,
    pub monthly: i64,
    pub premium_hourly: i64,
    pub overtime_hourly: i64,
    pub overtime_bps: i64,
    pub policy: Value,
    pub care_monthly: i64,
    pub allowance_rates: Value,
}
#[derive(Clone)]
struct Candidate {
    key: &'static str,
    label: &'static str,
    rule_id: String,
    hourly: i64,
    bps: i64,
}
struct Bucket {
    candidate: Candidate,
    minutes: i64,
    id: String,
}
struct OvertimeBucket {
    base: i64,
    premium: i64,
    bps: i64,
    minutes: i64,
}

/// Shared elapsed-time traversal only; rate selection and rounding policy remain tariff-specific.
pub(crate) struct PolicyShiftOptions<'a> {
    pub saturday_shift_work: bool,
    pub allowance_status: &'a str,
}
pub(crate) fn policy_shift(
    family: Family,
    shift: &Value,
    profile: &Value,
    options: PolicyShiftOptions<'_>,
    resolver: &RuleResolver,
    capture_trace: bool,
    context: impl Fn(&str) -> Result<Option<RateContext>, FamilyError>,
) -> Result<Value, FamilyError> {
    let PolicyShiftOptions {
        saturday_shift_work,
        allowance_status,
    } = options;
    let mut empty = empty_shift(shift);
    if family == Family::Tvh {
        empty["hourlyAllowanceAmount"] = json!(0);
    }
    if !work(shift) {
        return Ok(empty);
    }
    let Some(bounds) = bounds(shift, profile)? else {
        return Ok(empty);
    };
    let paid_breaks = family == Family::Tvh && allowance_status.starts_with("ALTERNATING");
    let paid_minutes = if paid_breaks {
        bounds.gross_minutes
    } else {
        bounds.net_minutes
    };
    let pause = if paid_breaks {
        0
    } else {
        integer(shift, "breakMinutes")?.min(bounds.gross_minutes)
    };
    let pause_from = (bounds.gross_minutes - pause).div_euclid(2);
    let mut trace = traced(shift, &bounds, capture_trace, paid_breaks)?;
    let start = start(&bounds, profile)?;
    let confirmed = if shift["tariffOvertimeConfirmed"] == true {
        integer(shift, "overtimeMinutes")?.min(paid_minutes)
    } else {
        0
    };
    let mut remaining = paid_minutes;
    let mut buckets: Vec<Bucket> = vec![];
    let mut overtime: Vec<OvertimeBucket> = vec![];
    let mut allowances: BTreeMap<i64, i64> = BTreeMap::new();
    let prefix = match family {
        Family::Tvl => "tvl",
        Family::Tval => "tval",
        Family::Tvh => "tvh",
        Family::VkaE | Family::Training | Family::Tvuk => {
            return Err(FamilyError::Message("Invalid policy family"));
        }
    };
    for section in sections(&start, bounds.gross_minutes)? {
        let ctx = context(&section.date)?.ok_or_else(|| missing(family, &section.date))?;
        let holidays = crate::rules::holidays::holiday_map_for_month(
            &section.date[..7],
            string(profile, "federalState")?,
            profile["holidayRegion"].as_str().unwrap_or("NONE"),
            resolver,
        )?;
        let percentage = |key: &'static str, label: &'static str, bps: i64| Candidate {
            key,
            label,
            rule_id: format!("{prefix}-{key}"),
            hourly: ctx.premium_hourly,
            bps,
        };
        for offset in section.from..section.until {
            if offset >= pause_from && offset < pause_from + pause {
                continue;
            }
            let minute = minute(&start, &section, offset)?;
            let mut count = |candidate: Candidate| -> Result<(), FamilyError> {
                let id = json!([candidate.key, candidate.hourly, candidate.bps]).to_string();
                if let Some(bucket) = buckets.iter_mut().find(|b| b.id == id) {
                    bucket.minutes += 1
                } else {
                    buckets.push(Bucket {
                        candidate,
                        minutes: 1,
                        id: id.clone(),
                    });
                }
                if let Some(trace) = &mut trace {
                    trace
                        .add_milliseconds(&id, bounds.start_epoch_milliseconds + offset * 60000)?;
                }
                Ok(())
            };
            if window(minute, &ctx.policy["nightWindow"])? {
                count(percentage(
                    "night",
                    "Nacht",
                    integer(&ctx.policy, "nightBasisPoints")?,
                ))?;
            }
            let mut competing = vec![];
            if section.weekday == 7 {
                competing.push(percentage(
                    "sunday",
                    "Sonntag",
                    integer(&ctx.policy, "sundayBasisPoints")?,
                ));
            }
            if holidays.contains_key(&section.date) {
                let with_time_off = shift["holidayPremiumMode"] == "WITH_TIME_OFF";
                competing.push(percentage(
                    "holiday",
                    if with_time_off {
                        "Feiertag mit Freizeitausgleich"
                    } else {
                        "Feiertag ohne Freizeitausgleich"
                    },
                    integer(
                        &ctx.policy,
                        if with_time_off {
                            "holidayWithTimeOffBasisPoints"
                        } else {
                            "holidayWithoutTimeOffBasisPoints"
                        },
                    )?,
                ));
            }
            if rows(&ctx.policy["preHolidayMonthDays"])?
                .iter()
                .any(|d| d == &section.date[5..])
                && window(minute, &ctx.policy["preHolidayWindow"])?
            {
                competing.push(percentage(
                    "preholiday",
                    "24./31. Dezember",
                    integer(&ctx.policy, "preHolidayBasisPoints")?,
                ));
            }
            if section.weekday == 6
                && window(minute, &ctx.policy["saturdayWindow"])?
                && !(family == Family::Tvh && saturday_shift_work)
            {
                competing.push(if saturday_shift_work {
                    Candidate {
                        key: "saturday",
                        label: "Samstag",
                        rule_id: format!("{prefix}-saturday-fixed"),
                        hourly: integer(&ctx.policy, "saturdaySalariedShiftHourlyCents")?,
                        bps: 10000,
                    }
                } else {
                    percentage(
                        "saturday",
                        "Samstag",
                        integer(&ctx.policy, "saturdayBasisPoints")?,
                    )
                });
            }
            let mut winner: Option<Candidate> = None;
            for candidate in competing {
                if winner
                    .as_ref()
                    .is_none_or(|best| candidate.hourly * candidate.bps > best.hourly * best.bps)
                {
                    winner = Some(candidate)
                }
            }
            if let Some(winner) = winner {
                count(winner)?;
            }
            if remaining <= confirmed {
                if let Some(bucket) = overtime.iter_mut().find(|b| {
                    b.base == ctx.overtime_hourly
                        && b.premium == ctx.premium_hourly
                        && b.bps == ctx.overtime_bps
                }) {
                    bucket.minutes += 1
                } else {
                    overtime.push(OvertimeBucket {
                        base: ctx.overtime_hourly,
                        premium: ctx.premium_hourly,
                        bps: ctx.overtime_bps,
                        minutes: 1,
                    });
                }
            }
            if family == Family::Tvh && allowance_status.ends_with("HOURLY") {
                let rate = integer(
                    &ctx.allowance_rates,
                    if allowance_status.starts_with("ALTERNATING") {
                        "alternatingHourlyCents"
                    } else {
                        "shiftHourlyCents"
                    },
                )?;
                *allowances.entry(rate).or_default() += 1;
            }
            remaining -= 1;
        }
    }
    let round_hourly = family != Family::Tvl;
    let mut lines: Vec<Value> = vec![];
    let mut premium_total = 0;
    for bucket in buckets {
        let c = bucket.candidate;
        let amount = if round_hourly {
            round(round(c.hourly * c.bps, 10000)? * bucket.minutes, 60)?
        } else {
            round(c.hourly * c.bps * bucket.minutes, 600000)?
        };
        premium_total += amount;
        if let Some(trace) = &mut trace {
            trace.pay(
                &bucket.id,
                crate::net::premium_trace::premium_kind(c.key),
                amount,
                Some(crate::net::premium_trace::premium_category(c.key)),
            )?;
        }
        if let Some(previous) = lines.iter_mut().find(|line| line["key"] == c.key) {
            let before = integer(previous, "minutes")?;
            let minutes = before + bucket.minutes;
            let rate = legacy_money(
                (previous["hourlyRate"]
                    .as_f64()
                    .ok_or(FamilyError::Message("Invalid hourly rate"))?
                    * before as f64
                    + (c.hourly as f64 / 100.0) * bucket.minutes as f64)
                    / minutes as f64,
            );
            previous["hourlyRate"] = scalar(rate);
            previous["minutes"] = json!(minutes);
            previous["amount"] = euros(cents(&previous["amount"])? + amount);
            previous["percentage"] = scalar(c.bps as f64 / 100.0);
            previous["label"] = json!(c.label);
            previous["ruleId"] = json!(c.rule_id);
        } else {
            lines.push(json!({"key":c.key,"label":c.label,"ruleId":c.rule_id,"minutes":bucket.minutes,"percentage":scalar(c.bps as f64/100.0),"hourlyRate":euros(c.hourly),"amount":euros(amount)}));
        }
    }
    let (mut base, mut overtime_premium) = (0, 0);
    for bucket in overtime {
        base += round(bucket.base * bucket.minutes, 60)?;
        overtime_premium += if round_hourly {
            round(
                round(bucket.premium * bucket.bps, 10000)? * bucket.minutes,
                60,
            )?
        } else {
            round(bucket.premium * bucket.bps * bucket.minutes, 600000)?
        };
    }
    empty["netMinutes"] = json!(paid_minutes);
    empty["premiumLines"] = Value::Array(lines);
    empty["overtimeBaseAmount"] = euros(base);
    empty["overtimePremiumAmount"] = euros(overtime_premium);
    empty["totalAmount"] = euros(premium_total + base + overtime_premium);
    if family == Family::Tvh {
        let mut total = 0;
        for (rate, minutes) in allowances {
            total += round(rate * minutes, 60)?;
        }
        empty["hourlyAllowanceAmount"] = euros(total);
    }
    if let Some(trace) = trace {
        empty["payrollTrace"] = trace.finish()?;
    }
    Ok(empty)
}
