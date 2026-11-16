use super::{Family, FamilyError, common::*, profile};
use crate::{
    pay::pattern::{Assignment, WorkPatternSettings, WorkplaceCoverage},
    rules::RuleResolver,
};
use serde_json::{Value, json};

fn allowance_rates(date: &str) -> Value {
    if date < "2026-10-01" {
        json!({"alternatingMonthlyCents":10500,"alternatingHourlyCents":63,"shiftMonthlyCents":4000,"shiftHourlyCents":24})
    } else {
        json!({"alternatingMonthlyCents":20000,"alternatingHourlyCents":119,"shiftMonthlyCents":10000,"shiftHourlyCents":60})
    }
}
pub(crate) fn context(
    date: &str,
    selection: &Value,
    weekly: i64,
    resolver: &RuleResolver,
) -> Result<Option<RateContext>, FamilyError> {
    let Some(selected) = profile::require_tvh_kr_tariff(selection)? else {
        return Ok(None);
    };
    let Some(table) = raw_table(Family::Tvh, date, resolver)? else {
        return Ok(None);
    };
    let full_time = integer(&selected, "fullTimeWeeklyMinutes")?;
    if weekly <= 0 || weekly > full_time {
        return Ok(None);
    }
    let group = string(&selected, "payGroup")?;
    let levels = profile::tvh_kr_levels_for_group(group);
    let row = rows(&table["monthlyCents"][group])?;
    let amount = |level: &Value| -> Result<i64, FamilyError> {
        let index = levels
            .iter()
            .position(|v| v == level)
            .ok_or(FamilyError::Message("Invalid TV-H level"))?;
        row.get(index)
            .and_then(Value::as_i64)
            .ok_or(FamilyError::Message("Invalid TV-H table amount"))
    };
    let monthly = amount(&selected["payLevel"])?;
    let premium = amount(&json!(3))?;
    let overtime_level = selected["payLevel"]
        .as_i64()
        .map(|n| json!(n.min(4)))
        .unwrap_or_else(|| selected["payLevel"].clone());
    let overtime = amount(&overtime_level)?;
    let divisor = round(full_time * 4348, 600)?;
    let group_number = group[2..]
        .parse::<i64>()
        .map_err(|_| FamilyError::Message("Invalid TV-H group"))?;
    Ok(Some(RateContext {
        pkg: None,
        full_time,
        monthly,
        premium_hourly: round(premium * 100, divisor)?,
        overtime_hourly: round(overtime * 100, divisor)?,
        overtime_bps: if group_number <= 8 { 3000 } else { 1500 },
        care_monthly: if group_number > 12 {
            0
        } else if date < "2026-07-01" {
            13804
        } else if date < "2027-10-01" {
            14222
        } else {
            14620
        },
        allowance_rates: allowance_rates(date),
        policy: json!({"nightWindow":{"startMinute":1260,"endMinute":360},"nightBasisPoints":2000,"sundayBasisPoints":2500,"holidayWithTimeOffBasisPoints":3500,"holidayWithoutTimeOffBasisPoints":13500,"preHolidayMonthDays":["12-24","12-31"],"preHolidayWindow":{"startMinute":360,"endMinute":1440},"preHolidayBasisPoints":3500,"saturdayWindow":{"startMinute":780,"endMinute":1260},"saturdayBasisPoints":2000}),
    }))
}

pub fn calculate_shift(
    shift: &Value,
    work_profile: &Value,
    saturday_shift_work: bool,
    allowance_status: &str,
    resolver: &RuleResolver,
    capture_trace: bool,
) -> Result<Value, FamilyError> {
    if work(shift)
        && ![
            "NONE",
            "SHIFT_MONTHLY",
            "SHIFT_HOURLY",
            "ALTERNATING_MONTHLY",
            "ALTERNATING_HOURLY",
        ]
        .contains(&allowance_status)
    {
        return Err(FamilyError::Message("Der Schichtarbeitsbezug fehlt."));
    }
    policy_shift(
        Family::Tvh,
        shift,
        work_profile,
        PolicyShiftOptions {
            saturday_shift_work,
            allowance_status,
        },
        resolver,
        capture_trace,
        |date| {
            context(
                date,
                &work_profile["tvhKrTariff"],
                integer(work_profile, "weeklyMinutes")?,
                resolver,
            )
        },
    )
}

pub fn calculate_assessment(
    month: &str,
    shifts: &[Value],
    settings: &WorkPatternSettings,
    time_zone: &str,
) -> Result<Value, FamilyError> {
    let date = month_first(month)?;
    if !data()?.tvh_tables.iter().any(|t| active(&date, t)) {
        return Ok(json!({"available":false,"assessment":null,"tariffLabel":Family::Tvh.label()}));
    }
    let mut relevant: Vec<_> = shifts
        .iter()
        .filter(|s| {
            work(s)
                && s["date"]
                    .as_str()
                    .is_some_and(|date| date.starts_with(&format!("{month}-")))
        })
        .collect();
    relevant.sort_by(|a, b| {
        a["date"]
            .as_str()
            .cmp(&b["date"].as_str())
            .then_with(|| a["startTime"].as_str().cmp(&b["startTime"].as_str()))
    });
    let mut times = vec![];
    for shift in &relevant {
        let from = crate::time::clock(string(shift, "startTime")?)?;
        let end = crate::time::clock(string(shift, "endTime")?)?;
        let start = i64::from(from.hour()) * 60 + i64::from(from.minute());
        let end = i64::from(end.hour()) * 60 + i64::from(end.minute());
        times.push((start, if end <= start { end + 1440 } else { end }));
    }
    let changes = times
        .windows(2)
        .filter(|p| (p[1].0 - p[0].0).abs() >= 120)
        .count();
    let span = times
        .iter()
        .map(|t| t.1)
        .max()
        .zip(times.iter().map(|t| t.0).min())
        .map(|(end, start)| end - start)
        .unwrap_or(0);
    let regular = changes >= 2 && span >= 780;
    let profile = json!({"timeZone":time_zone});
    let mut night_count = 0;
    for shift in &relevant {
        let Some(bounds) = bounds(shift, &profile)? else {
            continue;
        };
        let start = start(&bounds, &profile)?;
        let pause = integer(shift, "breakMinutes")?.min(bounds.gross_minutes);
        let pause_from = (bounds.gross_minutes - pause).div_euclid(2);
        let mut count = 0;
        for section in sections(&start, bounds.gross_minutes)? {
            for offset in section.from..section.until {
                if offset >= pause_from && offset < pause_from + pause {
                    continue;
                }
                let minute = minute(&start, &section, offset)?;
                if !(360..1260).contains(&minute) {
                    count += 1
                }
            }
        }
        if count >= 120 {
            night_count += 1
        }
    }
    let has_nights = night_count >= 1;
    let around = settings.workplace_coverage == WorkplaceCoverage::AroundTheClock;
    let not_around = settings.workplace_coverage == WorkplaceCoverage::NotAroundTheClock;
    let alternating = regular && has_nights && around;
    let pattern = if alternating {
        Some("ALTERNATING")
    } else if regular && (!has_nights || not_around) {
        Some("SHIFT")
    } else {
        None
    };
    let suggested = match (pattern, settings.assignment) {
        (Some("ALTERNATING"), Assignment::Permanent) => "ALTERNATING_MONTHLY",
        (Some("ALTERNATING"), Assignment::Temporary) => "ALTERNATING_HOURLY",
        (Some(_), Assignment::Permanent) => "SHIFT_MONTHLY",
        (Some(_), Assignment::Temporary) => "SHIFT_HOURLY",
        (None, _) | (_, Assignment::Unknown) => "NONE",
    };
    let shift_state = if regular {
        "DETECTED"
    } else if times.is_empty() {
        "NOT_DETECTED"
    } else {
        "REVIEW"
    };
    Ok(
        json!({"available":true,"tariffLabel":Family::Tvh.label(),"assessment":{"shiftWork":shift_state,"alternatingShiftWork":if alternating{"DETECTED"}else if has_nights&&regular&&!not_around{"REVIEW"}else{"NOT_DETECTED"},"suggestedAllowance":suggested,"requiresConfirmation":regular&&(settings.assignment==Assignment::Unknown||has_nights&&settings.workplace_coverage==WorkplaceCoverage::Unknown),"evidence":[format!("{} Arbeitsdienste",relevant.len()),format!("{changes} Wechsel um mindestens zwei Stunden"),format!("{night_count} Nachtschichten mit mindestens zwei Stunden Nachtarbeit")],"criteria":[{"key":"SHIFT_CHANGES","label":"Regelmäßiger Wechsel","detail":"TV-H: wechselnde Dienstbeginne um mindestens zwei Stunden und eine Dienstspanne von mindestens 13 Stunden innerhalb eines Monats.","state":if regular{"MET"}else if times.is_empty(){"NOT_MET"}else{"OPEN"}},{"key":"NIGHT_SHIFTS","label":"Wiederkehrende Nachtschichten","detail":"TV-H: Nachtschicht mit mindestens zwei Stunden Nachtarbeit und erneute Nachtschicht spätestens nach einem Monat.","state":if has_nights{"MET"}else{"NOT_MET"}},{"key":"AROUND_THE_CLOCK","label":"Arbeitsbereich rund um die Uhr","detail":"Diese Angabe beschreibt den Betrieb; sie wird nicht aus deinem Kalender abgeleitet.","state":if around{"MET"}else if not_around{"NOT_MET"}else{"OPEN"}},{"key":"ASSIGNMENT","label":"Dauerhafte Zuordnung","detail":"Die bestehende Angabe zur dauerhaften oder gelegentlichen Schichtarbeit bestimmt die Zulagenart.","state":if settings.assignment==Assignment::Unknown{"OPEN"}else{"MET"}}],"estimateNote":"Schichtmuster aus den erfassten Diensten geschätzt; keine Arbeitgeberentscheidung."}}),
    )
}

pub fn calculate_month(
    month: &str,
    shifts: &[Value],
    work_profile: &Value,
    decision: Option<&Value>,
    assessment_shifts: &[Value],
    settings: &WorkPatternSettings,
    resolver: &RuleResolver,
) -> Result<Value, FamilyError> {
    calculate_month_with_capture(
        &super::FamilyMonthInput {
            month,
            shifts,
            profile: work_profile,
            decision,
            assessment_shifts,
            settings,
        },
        resolver,
        false,
    )
}
pub(super) fn calculate_month_with_capture(
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
    let selected = selection(Family::Tvh, work_profile)?
        .ok_or(FamilyError::Message("TV-H-Pflegegruppe fehlt."))?;
    let assessment = calculate_assessment(
        month,
        assessment_shifts,
        settings,
        string(work_profile, "timeZone")?,
    )?;
    let assessed = &assessment["assessment"];
    let confirmed = decision
        .and_then(|d| d.get("allowanceStatus"))
        .filter(|v| !v.is_null());
    let status = confirmed
        .and_then(Value::as_str)
        .or_else(|| assessed["suggestedAllowance"].as_str())
        .unwrap_or("NONE");
    if ![
        "NONE",
        "SHIFT_MONTHLY",
        "SHIFT_HOURLY",
        "ALTERNATING_MONTHLY",
        "ALTERNATING_HOURLY",
    ]
    .contains(&status)
    {
        return Err(FamilyError::Message("Ungültige TV-H-Monatsangaben."));
    }
    let saturday = assessed["shiftWork"] == "DETECTED"
        || assessed["alternatingShiftWork"] == "DETECTED"
        || status != "NONE";
    let date = month_first(month)?;
    let weekly = integer(work_profile, "weeklyMinutes")?;
    let Some(ctx) = context(&date, &selected, weekly, resolver)? else {
        return empty_month(month, Family::Tvh, false);
    };
    let mut breakdowns = vec![];
    for shift in shifts.iter().filter(|s| {
        work(s)
            && s["date"]
                .as_str()
                .is_some_and(|date| date.starts_with(&format!("{month}-")))
    }) {
        breakdowns.push(calculate_shift(
            shift,
            work_profile,
            saturday,
            status,
            resolver,
            capture,
        )?);
    }
    let base = round(ctx.monthly * weekly, ctx.full_time)?;
    let care = round(ctx.care_monthly * weekly, ctx.full_time)?;
    let monthly = status.ends_with("_MONTHLY");
    let allowance = if monthly {
        let key = if status.starts_with("ALTERNATING") {
            "alternatingMonthlyCents"
        } else {
            "shiftMonthlyCents"
        };
        round(integer(&ctx.allowance_rates, key)? * weekly, ctx.full_time)?
    } else {
        breakdowns
            .iter()
            .map(|b| cents(&b["hourlyAllowanceAmount"]))
            .collect::<Result<Vec<_>, _>>()?
            .iter()
            .sum()
    };
    let (premiums, overtime) = sum_breakdowns(&breakdowns)?;
    let mut result = empty_month(month, Family::Tvh, true)?;
    result["fullTimeTableAmount"] = euros(ctx.monthly);
    result["personalBaseAmount"] = euros(base);
    result["careAllowanceAmount"] = euros(care);
    result["allowanceAmount"] = euros(allowance);
    result["timePremiumAmount"] = euros(premiums);
    result["overtimeAmount"] = euros(overtime);
    result["shiftBreakdowns"] = Value::Array(breakdowns);
    result["estimatedGrossAmount"] = euros(base + care + allowance + premiums + overtime);
    if !assessed.is_null() {
        result["assessment"] = assessed.clone();
    }
    result["confirmedAllowance"] = confirmed.cloned().unwrap_or(Value::Null);
    Ok(result)
}

pub fn duty_hourly(
    date: &str,
    work_profile: &Value,
    resolver: &RuleResolver,
) -> Result<Value, FamilyError> {
    let selection = &work_profile["tvhKrTariff"];
    if selection.is_null() {
        return Ok(Value::Null);
    }
    Ok(context(
        date,
        selection,
        integer(work_profile, "weeklyMinutes")?,
        resolver,
    )?
    .map(|ctx| round(ctx.monthly * 100, round(ctx.full_time * 4348, 600)?))
    .transpose()?
    .map(|c| json!(c))
    .unwrap_or(Value::Null))
}
pub fn duty_overtime_rates(
    date: &str,
    work_profile: &Value,
    resolver: &RuleResolver,
) -> Result<Value, FamilyError> {
    let selection = &work_profile["tvhKrTariff"];
    if selection.is_null() {
        return Ok(Value::Null);
    }
    Ok(context(date,selection,integer(work_profile,"weeklyMinutes")?,resolver)?.map(|ctx|json!({"baseHourlyCents":ctx.overtime_hourly,"premiumHourlyCents":ctx.premium_hourly,"premiumBasisPoints":ctx.overtime_bps})).unwrap_or(Value::Null))
}
