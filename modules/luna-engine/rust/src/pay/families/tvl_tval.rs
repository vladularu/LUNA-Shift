use super::{Family, FamilyError, common::*, profile};
use crate::{
    pay::pattern::{WorkPatternSettings, assess_tvoed_pattern_refs},
    rules::RuleResolver,
};
use serde_json::{Value, json};

pub fn full_time_minutes(
    family: Family,
    date: &str,
    region: &str,
    resolver: &RuleResolver,
) -> Result<Option<i64>, FamilyError> {
    if !matches!(region, "WEST" | "EAST") {
        return Ok(None);
    }
    let Some(pkg) = package(family, date, resolver)? else {
        return Ok(None);
    };
    let region = if region == "WEST" {
        "WEST_38_5"
    } else {
        "EAST_UNIVERSITY_HOSPITAL"
    };
    let variant = if family == Family::Tvl {
        "SECTION_43"
    } else {
        "CARE"
    };
    let Some(rules) = pkg
        .rules()
        .get("employmentWorkingTimeRules")
        .and_then(Value::as_array)
    else {
        return Ok(None);
    };
    let matching: Vec<_> = rules
        .iter()
        .filter(|r| r["variantId"] == variant && r["regionId"] == region && active(date, r))
        .collect();
    Ok(if matching.len() == 1 {
        Some(integer(matching[0], "fullTimeWeeklyMinutes")?)
    } else {
        None
    })
}

pub(crate) fn context(
    family: Family,
    date: &str,
    selection: &Value,
    weekly: i64,
    resolver: &RuleResolver,
) -> Result<Option<RateContext>, FamilyError> {
    let selected = match family {
        Family::Tvl => profile::require_tvl_kr_salary_tariff(selection)?,
        Family::Tval => profile::require_tval_pflege_tariff(selection)?,
        _ => return Err(FamilyError::Message("Invalid TV-L family")),
    };
    let Some(selected) = selected else {
        return Ok(None);
    };
    let Some(pkg) = package(family, date, resolver)? else {
        return Ok(None);
    };
    let Some(full_time) = full_time_minutes(
        family,
        date,
        string(&selected, "universityRegion")?,
        resolver,
    )?
    else {
        return Ok(None);
    };
    if weekly <= 0 || weekly > full_time {
        return Ok(None);
    }
    let body = pkg.rules();
    let mut entries = vec![];
    let selected_id = &body["selector"]["payTableId"];
    for table in rows(&body["payTables"])? {
        if family == Family::Tval || &table["id"] == selected_id {
            entries.extend(rows(&table["entries"])?);
        }
    }
    if family == Family::Tvl {
        let group = string(&selected, "payGroup")?.to_lowercase();
        let level = integer(&selected, "payLevel")?;
        let amount = |level: i64| -> Result<Option<i64>, FamilyError> {
            let step = level.to_string();
            let matching: Vec<_> = entries
                .iter()
                .filter(|e| e["groupId"] == group && e["stepId"].as_str() == Some(step.as_str()))
                .collect();
            Ok(if matching.len() == 1 {
                Some(integer(matching[0], "monthlyCents")?)
            } else {
                None
            })
        };
        let (Some(monthly), Some(premium), Some(overtime)) =
            (amount(level)?, amount(3)?, amount(level.min(4))?)
        else {
            return Ok(None);
        };
        let policy = &body["tvlTimePremiumPolicy"];
        let overtime_policy = &body["tvlOvertimePolicy"];
        if policy.is_null() || overtime_policy.is_null() {
            return Ok(None);
        }
        let matching: Vec<_> = rows(&overtime_policy["groupRates"])?
            .iter()
            .filter(|r| r["groupId"] == group)
            .collect();
        if matching.len() != 1 {
            return Ok(None);
        }
        let ctx = RateContext {
            full_time,
            monthly,
            premium_hourly: round(
                premium * 60000,
                full_time * integer(policy, "monthlyFactorThousandths")?,
            )?,
            overtime_hourly: round(
                overtime * 60000,
                full_time * integer(overtime_policy, "monthlyFactorThousandths")?,
            )?,
            overtime_bps: integer(matching[0], "percentageBasisPoints")?,
            policy: policy.clone(),
            care_monthly: body["tvlCareAllowancePolicy"]["nursingMonthlyCents"]
                .as_i64()
                .unwrap_or(0),
            allowance_rates: Value::Null,
            pkg: Some(pkg),
        };
        Ok(Some(ctx))
    } else {
        let training_year = integer(&selected, "trainingYear")?.to_string();
        let matching: Vec<_> = entries
            .iter()
            .filter(|e| e["groupId"] == "regular" && e["stepId"] == training_year)
            .collect();
        let policy = &body["tvalTimePremiumPolicy"];
        let overtime = &body["tvalOvertimePolicy"];
        if matching.len() != 1 || policy.is_null() || overtime.is_null() {
            return Ok(None);
        }
        let monthly = integer(matching[0], "monthlyCents")?;
        let mut mapped_policy = policy.clone();
        mapped_policy["saturdaySalariedShiftHourlyCents"] =
            if selected["employerScope"] == "GENERAL" {
                json!(0)
            } else {
                policy["hospitalSalariedShiftHourlyCents"].clone()
            };
        Ok(Some(RateContext {
            full_time,
            monthly,
            premium_hourly: round(
                monthly * 60000,
                full_time * integer(policy, "monthlyFactorThousandths")?,
            )?,
            overtime_hourly: round(
                monthly * 60000,
                full_time * integer(overtime, "monthlyFactorThousandths")?,
            )?,
            overtime_bps: integer(overtime, "percentageBasisPoints")?,
            policy: mapped_policy,
            care_monthly: 0,
            allowance_rates: Value::Null,
            pkg: Some(pkg),
        }))
    }
}

pub fn calculate_assessment(
    family: Family,
    month: &str,
    shifts: &[Value],
    settings: &WorkPatternSettings,
    resolver: &RuleResolver,
) -> Result<Value, FamilyError> {
    let date = month_first(month)?;
    if family == Family::Tval && package(Family::Tval, &date, bundled_resolver()?)?.is_none() {
        return Ok(json!({"available":false,"assessment":null,"tariffLabel":family.label()}));
    }
    let Some(pkg) = package(Family::Tvl, &date, bundled_resolver()?)? else {
        return Ok(json!({"available":false,"assessment":null,"tariffLabel":family.label()}));
    };
    let relevant: Vec<_> = shifts
        .iter()
        .filter(|s| {
            work(s)
                && s["date"]
                    .as_str()
                    .is_some_and(|date| date.starts_with(&format!("{month}-")))
        })
        .collect();
    let mut assessment =
        assess_tvoed_pattern_refs(&relevant, settings, resolver, Some(&date), None, Some(&pkg))?;
    let mut starts = vec![];
    let mut ends = vec![];
    for shift in &relevant {
        let start = crate::time::clock(string(shift, "startTime")?)?;
        let end = crate::time::clock(string(shift, "endTime")?)?;
        let start = i64::from(start.hour()) * 60 + i64::from(start.minute());
        let end = i64::from(end.hour()) * 60 + i64::from(end.minute());
        starts.push(start);
        ends.push(if end <= start { end + 1440 } else { end });
    }
    let starts_change = starts.len() > 1
        && starts
            .iter()
            .max()
            .zip(starts.iter().min())
            .is_some_and(|(max, min)| max - min >= 120);
    let span = ends
        .iter()
        .max()
        .zip(starts.iter().min())
        .map(|(max, min)| max - min)
        .unwrap_or(0);
    if !(starts_change && span >= 780) {
        let empty = relevant.is_empty();
        assessment["shiftWork"] = json!(if empty { "NOT_DETECTED" } else { "REVIEW" });
        assessment["alternatingShiftWork"] = json!(if empty { "NOT_DETECTED" } else { "REVIEW" });
        assessment["suggestedAllowance"] = json!("NONE");
        for criterion in assessment["criteria"]
            .as_array_mut()
            .ok_or(FamilyError::Message("Invalid assessment criteria"))?
        {
            if criterion["key"] == "SHIFT_CHANGES" {
                criterion["state"] = json!(if empty { "NOT_MET" } else { "OPEN" });
                criterion["detail"] = json!(
                    "Für TV-L müssen die Dienstbeginne um mindestens zwei Stunden wechseln und die Dienste eine Spanne von mindestens 13 Stunden abdecken."
                );
            }
        }
    }
    Ok(json!({"available":true,"assessment":assessment,"tariffLabel":family.label()}))
}

pub fn calculate_shift(
    family: Family,
    shift: &Value,
    work_profile: &Value,
    saturday_shift_work: bool,
    resolver: &RuleResolver,
    capture_trace: bool,
) -> Result<Value, FamilyError> {
    let selection =
        selection(family, work_profile)?.ok_or(FamilyError::Message(if family == Family::Tvl {
            "TV-L-Pflegegruppe fehlt."
        } else {
            "TVA-L-Ausbildungsjahr fehlt."
        }))?;
    policy_shift(
        family,
        shift,
        work_profile,
        PolicyShiftOptions {
            saturday_shift_work,
            allowance_status: "NONE",
        },
        resolver,
        capture_trace,
        |date| {
            context(
                family,
                date,
                &selection,
                integer(work_profile, "weeklyMinutes")?,
                resolver,
            )
        },
    )
}
fn allowance_rate(status: &str, policy: &Value) -> Result<i64, FamilyError> {
    if status == "NONE" {
        return Ok(0);
    }
    integer(
        policy,
        match (
            status.starts_with("ALTERNATING"),
            status.ends_with("_MONTHLY"),
        ) {
            (true, true) => "alternatingMonthlyCents",
            (true, false) => "alternatingHourlyCents",
            (false, true) => "shiftMonthlyCents",
            (false, false) => "shiftHourlyCents",
        },
    )
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
    let selection =
        selection(family, work_profile)?.ok_or(FamilyError::Message(if family == Family::Tvl {
            "TV-L-Pflegegruppe fehlt."
        } else {
            "TVA-L-Ausbildungsjahr fehlt."
        }))?;
    let assessed = calculate_assessment(family, month, assessment_shifts, settings, resolver)?;
    let assessment = &assessed["assessment"];
    let confirmed = decision
        .and_then(|d| d.get("allowanceStatus"))
        .filter(|v| !v.is_null());
    let status = confirmed
        .and_then(Value::as_str)
        .or_else(|| assessment["suggestedAllowance"].as_str())
        .unwrap_or("NONE");
    if ![
        "NONE",
        "SHIFT_MONTHLY",
        "ALTERNATING_MONTHLY",
        "SHIFT_HOURLY",
        "ALTERNATING_HOURLY",
    ]
    .contains(&status)
    {
        return Err(FamilyError::Message(if family == Family::Tvl {
            "Ungültige TV-L-Monatsangaben."
        } else {
            "Ungültige TVA-L-Monatsangaben."
        }));
    }
    let saturday = assessment["shiftWork"] == "DETECTED"
        || assessment["alternatingShiftWork"] == "DETECTED"
        || status != "NONE";
    let date = month_first(month)?;
    let weekly = integer(work_profile, "weeklyMinutes")?;
    let Some(ctx) = context(family, &date, &selection, weekly, resolver)? else {
        return empty_month(month, family, false);
    };
    let pkg = ctx
        .pkg
        .as_ref()
        .ok_or(FamilyError::Message("Missing family context package"))?;
    let body = pkg.rules();
    let policy = if family == Family::Tvl {
        let Some(policy) = body["tvlShiftAllowancePolicy"]["periods"]
            .as_array()
            .and_then(|p| p.iter().find(|p| active(&date, p)))
        else {
            return empty_month(month, family, false);
        };
        if body["tvlCareAllowancePolicy"].is_null() {
            return empty_month(month, family, false);
        }
        policy
    } else {
        let scope = selection["employerScope"].as_str().unwrap_or("SECTION_43");
        let allowance = &body["tvalShiftAllowancePolicy"];
        let Some(periods) = allowance["scopes"]
            .as_array()
            .and_then(|s| s.iter().find(|s| s["id"] == scope))
            .and_then(|s| s["rates"]["periods"].as_array())
        else {
            return empty_month(month, family, false);
        };
        let matching: Vec<_> = periods.iter().filter(|p| active(&date, p)).collect();
        if matching.len() != 1 {
            return empty_month(month, family, false);
        }
        matching[0]
    };
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
            saturday,
            resolver,
            capture,
        )?);
    }
    let base = round(ctx.monthly * weekly, ctx.full_time)?;
    let care = round(ctx.care_monthly * weekly, ctx.full_time)?;
    let (mut rate, monthly) = (
        allowance_rate(status, policy)?,
        status.ends_with("_MONTHLY"),
    );
    if family == Family::Tval {
        rate = round(
            rate * integer(&body["tvalShiftAllowancePolicy"], "shareBasisPoints")?,
            10000,
        )?;
    }
    let work_minutes = breakdowns
        .iter()
        .map(|b| integer(b, "netMinutes"))
        .collect::<Result<Vec<_>, _>>()?
        .iter()
        .sum::<i64>();
    let allowance = round(
        rate * if monthly { weekly } else { work_minutes },
        if monthly { ctx.full_time } else { 60 },
    )?;
    let (premiums, overtime) = sum_breakdowns(&breakdowns)?;
    let mut result = empty_month(month, family, true)?;
    result["fullTimeTableAmount"] = euros(ctx.monthly);
    result["personalBaseAmount"] = euros(base);
    result["careAllowanceAmount"] = euros(care);
    result["allowanceAmount"] = euros(allowance);
    result["timePremiumAmount"] = euros(premiums);
    result["overtimeAmount"] = euros(overtime);
    result["shiftBreakdowns"] = Value::Array(breakdowns);
    result["estimatedGrossAmount"] = euros(base + care + allowance + premiums + overtime);
    if !assessment.is_null() {
        result["assessment"] = assessment.clone();
    }
    result["confirmedAllowance"] = confirmed.cloned().unwrap_or(Value::Null);
    Ok(result)
}

pub fn duty_hourly(
    family: Family,
    date: &str,
    work_profile: &Value,
    resolver: &RuleResolver,
) -> Result<Value, FamilyError> {
    let selected = &work_profile[family.field()];
    if selected.is_null() {
        return Ok(Value::Null);
    }
    let Some(ctx) = context(
        family,
        date,
        selected,
        integer(work_profile, "weeklyMinutes")?,
        resolver,
    )?
    else {
        return Ok(Value::Null);
    };
    Ok(json!(round(
        ctx.monthly * 60000,
        ctx.full_time * integer(&ctx.policy, "monthlyFactorThousandths")?
    )?))
}
pub fn duty_overtime_rates(
    family: Family,
    date: &str,
    work_profile: &Value,
    resolver: &RuleResolver,
) -> Result<Value, FamilyError> {
    let selected = &work_profile[family.field()];
    if selected.is_null() {
        return Ok(Value::Null);
    }
    Ok(context(family,date,selected,integer(work_profile,"weeklyMinutes")?,resolver)?.map(|ctx|json!({"baseHourlyCents":ctx.overtime_hourly,"premiumHourlyCents":ctx.premium_hourly,"premiumBasisPoints":ctx.overtime_bps})).unwrap_or(Value::Null))
}
