use super::{Family, FamilyError, common::*, profile};
use crate::{
    net::premium_trace::{premium_category, premium_kind},
    pay::{
        conditions::{RuleConditions, conditions_match},
        pattern::{
            WorkPatternSettings, assess_tvoed_k_calendar_month_refs, assess_tvoed_pattern_refs,
        },
        premium_minutes::{
            PremiumMinuteInterval, PremiumRules, count_premium_minutes, span_from_shift,
        },
    },
    rules::{RulePackage, RuleResolver},
};
use jiff::ToSpan;
use serde_json::{Value, json};

struct Context {
    pkg: RulePackage,
    monthly: i64,
    premium_monthly: i64,
    overtime_monthly: i64,
    full_time: i64,
    overtime_bps: i64,
}
fn context(
    family: Family,
    date: &str,
    work_profile: &Value,
    resolver: &RuleResolver,
) -> Result<Option<Context>, FamilyError> {
    let Some(selection) = selection(family, work_profile)? else {
        return Ok(None);
    };
    let Some(pkg) = package(family, date, resolver)? else {
        return Ok(None);
    };
    let mut entries = vec![];
    let table_id = &pkg.rules()["selector"]["payTableId"];
    for table in rows(&pkg.rules()["payTables"])? {
        if &table["id"] == table_id {
            entries.extend(rows(&table["entries"])?);
        }
    }
    let weekly = integer(work_profile, "weeklyMinutes")?;
    if family == Family::VkaE {
        let group = string(&selection, "payGroup")?;
        let table_group = group.to_lowercase().replacen('e', "eg", 1);
        let level = integer(&selection, "payLevel")?;
        let amount = |level: i64| {
            entries
                .iter()
                .find(|e| e["groupId"] == table_group && e["stepId"] == format!("s{level}"))
                .and_then(|e| e["monthlyCents"].as_i64())
        };
        let (Some(monthly), Some(premium_monthly), Some(overtime_monthly)) =
            (amount(level), amount(3), amount(level.min(4)))
        else {
            return Ok(None);
        };
        let full_time = profile::tariff_full_time_weekly_minutes(
            string(&selection, "sector")?,
            string(&selection, "tariffRegion")?,
        );
        if weekly > full_time {
            return Ok(None);
        }
        Ok(Some(Context {
            pkg,
            monthly,
            premium_monthly,
            overtime_monthly,
            full_time,
            overtime_bps: if ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "E9a", "E9b"]
                .contains(&group)
            {
                3000
            } else {
                1500
            },
        }))
    } else {
        let year = integer(&selection, "trainingYear")?;
        let matching: Vec<_> = entries
            .iter()
            .filter(|e| e["groupId"] == "b" && e["stepId"] == format!("s{year}"))
            .collect();
        let weekly_rules = pkg.rules()["weeklyWorkingTimeRules"]
            .as_array()
            .map(|rules| {
                rules
                    .iter()
                    .filter(|r| {
                        r["sectors"]
                            .as_array()
                            .is_some_and(|values| values.contains(&selection["sector"]))
                            && r["tariffRegions"]
                                .as_array()
                                .is_some_and(|values| values.contains(&selection["tariffRegion"]))
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        if matching.len() != 1 || weekly_rules.len() != 1 {
            return Ok(None);
        }
        let full_time = integer(weekly_rules[0], "fullTimeWeeklyMinutes")?;
        if weekly > full_time {
            return Ok(None);
        }
        let monthly = integer(matching[0], "monthlyCents")?;
        Ok(Some(Context {
            pkg,
            monthly,
            premium_monthly: monthly,
            overtime_monthly: monthly,
            full_time,
            overtime_bps: 0,
        }))
    }
}

fn hourly_cents(ctx: &Context, monthly: i64) -> Result<i64, FamilyError> {
    round(
        monthly * 60000,
        ctx.full_time
            * integer(
                &ctx.pkg.rules()["hourlyCalculation"],
                "monthlyFactorThousandths",
            )?,
    )
}

pub fn calculate_assessment(
    family: Family,
    month: &str,
    shifts: &[Value],
    settings: &WorkPatternSettings,
    resolver: &RuleResolver,
    work_profile: &Value,
) -> Result<Value, FamilyError> {
    let date = month_first(month)?;
    let Some(pkg) = package(family, &date, resolver)? else {
        return Ok(json!({"available":false,"assessment":null,"tariffLabel":family.label()}));
    };
    let first = crate::calendar::parse_date(&date)?;
    let from = first
        .checked_sub(2.months())
        .map_err(|_| crate::EngineError::InvalidDate)?
        .to_string();
    let through = crate::calendar::month_range(month)?.end;
    let relevant: Vec<_> = shifts
        .iter()
        .filter(|s| {
            s.get("deletedAt") == Some(&Value::Null)
                && s["date"]
                    .as_str()
                    .is_some_and(|date| date >= from.as_str() && date <= through.as_str())
        })
        .collect();
    let mut result = if work_profile[family.field()]["sector"] == "BT_K" {
        assess_tvoed_k_calendar_month_refs(
            month,
            &relevant,
            settings,
            resolver,
            string(work_profile, "timeZone")?,
            None,
            Some(&pkg),
        )?
    } else {
        json!({"assessment":assess_tvoed_pattern_refs(&relevant,settings,resolver,Some(&date),None,Some(&pkg))?})
    };
    result["available"] = json!(true);
    result["tariffLabel"] = json!(family.label());
    Ok(result)
}

pub fn calculate_shift(
    family: Family,
    shift: &Value,
    work_profile: &Value,
    resolver: &RuleResolver,
    capture_trace: bool,
) -> Result<Value, FamilyError> {
    let mut empty = empty_shift(shift);
    if !work(shift) {
        return Ok(empty);
    }
    let Some(bounds) = bounds(shift, work_profile)? else {
        return Ok(empty);
    };
    let pause = integer(shift, "breakMinutes")?.min(bounds.gross_minutes);
    let break_start = (bounds.gross_minutes - pause).div_euclid(2);
    let mut trace = traced(shift, &bounds, capture_trace, false)?;
    let classify_profile = json!({"timeZone":work_profile["timeZone"],"federalState":work_profile["federalState"],"holidayRegion":work_profile["holidayRegion"],"tariff":null});
    let span = span_from_shift(shift, &classify_profile)?;
    let start = start(&bounds, work_profile)?;
    let mut lines: Vec<Value> = vec![];
    let mut overtime_remaining = if shift["tariffOvertimeConfirmed"] == true {
        integer(shift, "overtimeMinutes")?.min(bounds.net_minutes)
    } else {
        0
    };
    let (mut overtime_base, mut overtime_premium) = (0, 0);
    for section in sections(&start, bounds.gross_minutes)? {
        let ctx = context(family, &section.date, work_profile, resolver)?
            .ok_or_else(|| missing(family, &section.date))?;
        let hourly = hourly_cents(&ctx, ctx.premium_monthly)?;
        let rules = PremiumRules::from_json(ctx.pkg.rules())?;
        let interval = if trace.is_some() {
            PremiumMinuteInterval::new(section.from, section.until).with_capture()
        } else {
            PremiumMinuteInterval::new(section.from, section.until)
        };
        let counted = count_premium_minutes(
            shift,
            &classify_profile,
            &span,
            &rules,
            resolver,
            Some(&interval),
        )?;
        if let Some(trace) = &mut trace {
            for counted in &counted.counted {
                trace.add_milliseconds(
                    &format!("{}:{}", section.from, counted.rule_id),
                    counted.epoch_milliseconds,
                )?;
            }
        }
        for id in &counted.rule_order {
            let minutes = *counted
                .by_rule_id
                .get(id)
                .ok_or(FamilyError::Message("Missing premium count"))?;
            let rule = rows(&ctx.pkg.rules()["premiumRules"])?
                .iter()
                .find(|r| r["id"] == id.as_str())
                .ok_or(FamilyError::Message("Missing premium rule"))?;
            let kind = string(rule, "premiumType")?;
            if kind == "OVERTIME" {
                continue;
            }
            let bps = integer(rule, "percentageBasisPoints")?;
            let floor = family == Family::Training
                && kind == "NIGHT"
                && hourly * bps
                    < integer(&ctx.pkg.rules()["trainingPay"], "minimumNightHourlyCents")? * 10000;
            let percentage = if floor { 10000 } else { bps };
            let rate = if floor {
                integer(&ctx.pkg.rules()["trainingPay"], "minimumNightHourlyCents")?
            } else {
                hourly
            };
            let key = if kind.starts_with("HOLIDAY_") {
                String::from("holiday")
            } else if kind == "PRE_HOLIDAY" {
                String::from("preholiday")
            } else {
                kind.to_lowercase()
            };
            let amount = round(rate * minutes * percentage, 600000)?;
            if let Some(trace) = &mut trace {
                trace.pay(
                    &format!("{}:{id}", section.from),
                    premium_kind(kind),
                    amount,
                    Some(premium_category(kind)),
                )?;
            }
            if let Some(previous) = lines.iter_mut().find(|line| line["key"] == key) {
                let before = integer(previous, "minutes")?;
                let total = before + minutes;
                let average = legacy_money(
                    (previous["hourlyRate"]
                        .as_f64()
                        .ok_or(FamilyError::Message("Invalid premium rate"))?
                        * before as f64
                        + (rate as f64 / 100.0) * minutes as f64)
                        / total as f64,
                );
                previous["minutes"] = json!(total);
                previous["hourlyRate"] = scalar(average);
                previous["amount"] = euros(cents(&previous["amount"])? + amount);
                previous["percentage"] = scalar(percentage as f64 / 100.0);
                previous["label"] = rule["label"].clone();
            } else {
                lines.push(json!({"key":key,"label":rule["label"],"minutes":minutes,"percentage":scalar(percentage as f64/100.0),"hourlyRate":euros(rate),"amount":euros(amount)}));
            }
        }
        let break_in_section =
            (section.until.min(break_start + pause) - section.from.max(break_start)).max(0);
        let work_in_section = section.until - section.from - break_in_section;
        let worked_after = (bounds.gross_minutes
            - section.until
            - (break_start + pause - section.until.max(break_start)).max(0))
        .max(0);
        let overtime_in_section = work_in_section.min((overtime_remaining - worked_after).max(0));
        if overtime_in_section > 0 {
            let base = hourly_cents(&ctx, ctx.overtime_monthly)?;
            let bps = if family == Family::VkaE {
                ctx.overtime_bps
            } else {
                let rule = rows(&ctx.pkg.rules()["premiumRules"])?
                    .iter()
                    .find(|r| r["premiumType"] == "OVERTIME")
                    .ok_or(FamilyError::Message("Missing training overtime rate"))?;
                integer(rule, "percentageBasisPoints")?
            };
            overtime_base += round(base * overtime_in_section, 60)?;
            overtime_premium += round(hourly * overtime_in_section * bps, 600000)?;
            overtime_remaining -= overtime_in_section;
        }
    }
    let mut premium_total = 0;
    for line in &lines {
        premium_total += cents(&line["amount"])?;
    }
    empty["netMinutes"] = json!(bounds.net_minutes);
    empty["premiumLines"] = Value::Array(lines);
    empty["overtimeBaseAmount"] = euros(overtime_base);
    empty["overtimePremiumAmount"] = euros(overtime_premium);
    empty["totalAmount"] = euros(premium_total + overtime_base + overtime_premium);
    if let Some(trace) = trace {
        empty["payrollTrace"] = trace.finish()?;
    }
    Ok(empty)
}

pub fn calculate_month(
    family: Family,
    input: &super::FamilyMonthInput<'_>,
    resolver: &RuleResolver,
) -> Result<Value, FamilyError> {
    calculate_month_with_capture(family, input, resolver, false)
}
pub(super) fn calculate_month_with_capture(
    family: Family,
    input: &super::FamilyMonthInput<'_>,
    resolver: &RuleResolver,
    capture: bool,
) -> Result<Value, FamilyError> {
    let super::FamilyMonthInput {
        month,
        shifts,
        profile: work_profile,
        decision,
        assessment_shifts,
        settings,
    } = *input;
    let date = month_first(month)?;
    let Some(ctx) = context(family, &date, work_profile, resolver)? else {
        return empty_month(month, family, false);
    };
    let assessment = calculate_assessment(
        family,
        month,
        assessment_shifts,
        settings,
        resolver,
        work_profile,
    )?;
    let assessment = &assessment["assessment"];
    let mut breakdowns = vec![];
    for shift in shifts.iter().filter(|s| {
        work(s)
            && s["date"]
                .as_str()
                .is_some_and(|date| date.starts_with(&format!("{month}-")))
    }) {
        breakdowns.push(calculate_shift(
            family,
            shift,
            work_profile,
            resolver,
            capture,
        )?);
    }
    let weekly = integer(work_profile, "weeklyMinutes")?;
    let base = round(ctx.monthly * weekly, ctx.full_time)?;
    let (premiums, overtime) = sum_breakdowns(&breakdowns)?;
    let confirmed = decision
        .and_then(|d| d.get("allowanceStatus"))
        .filter(|v| !v.is_null());
    let status = confirmed
        .and_then(Value::as_str)
        .or_else(|| assessment["suggestedAllowance"].as_str())
        .ok_or(FamilyError::Message("Missing allowance assessment"))?;
    let selected = &work_profile[family.field()];
    let allowance_type = if status.starts_with("ALTERNATING") {
        "alternating-shift"
    } else {
        "shift"
    };
    let mut allowances = vec![];
    if status != "NONE" {
        for rule in rows(&ctx.pkg.rules()["allowanceRules"])? {
            if rule["allowanceType"] != allowance_type || !active(&date, rule) {
                continue;
            }
            let conditions = &rule["conditions"];
            if conditions["sectors"]
                .as_array()
                .is_some_and(|v| !v.contains(&selected["sector"]))
                || conditions["tariffRegions"]
                    .as_array()
                    .is_some_and(|v| !v.contains(&selected["tariffRegion"]))
            {
                continue;
            }
            let mut conditions = conditions.clone();
            conditions["sectors"] = Value::Null;
            conditions["tariffRegions"] = Value::Null;
            let conditions: RuleConditions = serde_json::from_value(conditions)
                .map_err(|_| FamilyError::Message("Invalid allowance conditions"))?;
            if conditions_match(
                &conditions,
                None,
                string(work_profile, "federalState")?,
                &date,
                None,
                Some(status),
            ) {
                allowances.push(rule);
            }
        }
    }
    if allowances.len() > 1 {
        return Err(FamilyError::Message(if family == Family::VkaE {
            "Mehrere E-Schichtzulagen für diesen Monat."
        } else {
            "Mehrere Pflege-Ausbildungszulagen für diesen Monat."
        }));
    }
    let work_minutes = breakdowns
        .iter()
        .map(|b| integer(b, "netMinutes"))
        .collect::<Result<Vec<_>, _>>()?
        .iter()
        .sum::<i64>();
    let allowance = if let Some(allowance) = allowances.first() {
        let rate = integer(allowance, "amountCents")?;
        if allowance["amountKind"] == "FIXED_HOURLY" {
            round(rate * work_minutes, 60)?
        } else {
            round(
                rate * if allowance["prorateByPartTime"] == true {
                    weekly
                } else {
                    ctx.full_time
                },
                ctx.full_time,
            )?
        }
    } else {
        0
    };
    let fixed = if family == Family::VkaE
        && selected["sector"] == "BT_K"
        && !matches!(
            selected["payGroup"].as_str(),
            Some("E1" | "E2" | "E3" | "E4")
        ) {
        if selected["tariffRegion"] == "KAV_BW" {
            3500
        } else {
            2500
        }
    } else {
        0
    };
    let fixed = round(fixed * weekly, ctx.full_time)?;
    let mut result = empty_month(month, family, true)?;
    result["fullTimeTableAmount"] = euros(ctx.monthly);
    result["personalBaseAmount"] = euros(base);
    result["timePremiumAmount"] = euros(premiums);
    result["overtimeAmount"] = euros(overtime);
    result["allowanceAmount"] = euros(allowance);
    result["tvoedAllowanceAmount"] = euros(fixed);
    result["shiftBreakdowns"] = Value::Array(breakdowns);
    result["estimatedGrossAmount"] = euros(base + premiums + overtime + allowance + fixed);
    result["assessment"] = assessment.clone();
    result["confirmedAllowance"] = confirmed.cloned().unwrap_or(Value::Null);
    Ok(result)
}

pub fn duty_hourly(
    family: Family,
    date: &str,
    work_profile: &Value,
    resolver: &RuleResolver,
) -> Result<Value, FamilyError> {
    Ok(context(family, date, work_profile, resolver)?
        .map(|ctx| round(ctx.monthly * 60000, ctx.full_time * 4348))
        .transpose()?
        .map(|value| json!(value))
        .unwrap_or(Value::Null))
}
pub fn duty_overtime_rates(
    family: Family,
    date: &str,
    work_profile: &Value,
    resolver: &RuleResolver,
) -> Result<Value, FamilyError> {
    let Some(ctx) = context(family, date, work_profile, resolver)? else {
        return Ok(Value::Null);
    };
    let (base, premium, bps) = if family == Family::VkaE {
        (
            hourly_cents(&ctx, ctx.overtime_monthly)?,
            hourly_cents(&ctx, ctx.premium_monthly)?,
            ctx.overtime_bps,
        )
    } else {
        let rules: Vec<_> = rows(&ctx.pkg.rules()["premiumRules"])?
            .iter()
            .filter(|r| r["premiumType"] == "OVERTIME")
            .collect();
        if rules.len() != 1 {
            return Ok(Value::Null);
        }
        let hourly = round(ctx.monthly * 60000, ctx.full_time * 4348)?;
        (hourly, hourly, integer(rules[0], "percentageBasisPoints")?)
    };
    Ok(json!({"baseHourlyCents":base,"premiumHourlyCents":premium,"premiumBasisPoints":bps}))
}
