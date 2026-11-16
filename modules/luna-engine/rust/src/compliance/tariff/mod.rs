//! Native tariff week/fortnight observation; personal applicability remains explicit.
pub mod context;
pub(crate) mod policy;
pub mod work_dates;
use self::context::{TariffTimeContext, tariff_context_for_basis};
use super::{
    average::{add_days, add_months},
    model::{ComplianceError, number, text},
    profile::ComplianceProfile,
};
use crate::calendar::parse_date;
use jiff::civil::Date;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
type Context = Option<Arc<TariffTimeContext>>;
fn at(
    profile: ComplianceProfile<'_>,
    date: &str,
    cache: &mut BTreeMap<String, Context>,
) -> Result<Context, ComplianceError> {
    if let Some(c) = cache.get(date) {
        return Ok(c.clone());
    }
    let c = tariff_context_for_basis(profile, date)?.map(Arc::new);
    cache.insert(date.into(), c.clone());
    Ok(c)
}
fn monday(date: Date) -> Result<Date, ComplianceError> {
    add_days(date, -i64::from(date.weekday().to_monday_zero_offset()))
}
fn days(from: Date, count: i64) -> Result<Vec<String>, ComplianceError> {
    (0..count)
        .map(|i| add_days(from, i).map(|d| d.to_string()))
        .collect()
}
fn evidence(c: &TariffTimeContext, from: &str, until: &str, reference: &str, free: bool) -> Value {
    let source = c
        .policy
        .and_then(|p| p.get(if free { "freeSource" } else { "source" }))
        .filter(|v| !v.is_null())
        .unwrap_or(policy::scope_source());
    let rule_text = c
        .policy
        .and_then(|p| p.get(if free { "freeRuleText" } else { "ruleText" }))
        .filter(|v| !v.is_null())
        .cloned()
        .unwrap_or(json!(
            "Die anwendbare Tarifgrundlage ist noch zu bestimmen."
        ));
    json!({"tariffLabel":c.label,"ruleId":if free{"TARIFF_FREE_DAYS"}else{"TARIFF_WEEK_DAYS"},"status":if c.unavailable{"UNAVAILABLE"}else if until>=reference{"PENDING"}else{"REVIEW"},"period":{"from":from,"until":until},"source":source,"ruleText":rule_text,"requirements":c.requirements})
}
fn free_requirements(c: &TariffTimeContext, contexts: &[Context]) -> Vec<String> {
    let mut out = c.requirements.clone();
    out.push("Die Zuordnung des tariflichen Zweiwochen-Bezugszeitraums ist zu bestätigen; dieses Fenster ist ein Beobachtungszeitraum.".into());
    if !contexts
        .iter()
        .all(|c| c.as_ref().is_some_and(|c| c.sunday_model_known))
    {
        out.push("Prüfe, ob regelmäßig Sonn- und Feiertagsarbeit im Sinne der Tarifregel geleistet wird. Die Zulässigkeit von Sonntagsarbeit allein bestätigt diese Regelmäßigkeit nicht.".into());
    }
    out.push("Leere Kalendertage sind kein Nachweis tatsächlich arbeitsfreier Tage.".into());
    if contexts
        .iter()
        .any(|c| c.as_ref().is_some_and(|c| !c.scope_confirmed))
    {
        out.push("Der persönliche Geltungsbereich dieser Tarifregel ist zu bestätigen.".into());
    }
    if mixed(contexts) {
        out.push(
            "Ein Tarifwechsel innerhalb des Beobachtungszeitraums muss gesondert geprüft werden."
                .into(),
        );
    }
    out
}
fn mixed(contexts: &[Context]) -> bool {
    contexts
        .iter()
        .map(|c| c.as_ref().map(|c| c.key.as_str()).unwrap_or("NONE"))
        .collect::<BTreeSet<_>>()
        .len()
        > 1
}
fn finding(
    rule: &str,
    date: &str,
    title: &str,
    description: &str,
    tariff: Value,
    ids: Vec<String>,
) -> Result<Value, ComplianceError> {
    let from = text(&tariff["period"], "from")?;
    let until = text(&tariff["period"], "until")?;
    let mut ids = ids;
    ids.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    ids.dedup();
    Ok(
        json!({"id":format!("{rule}:{}:{from}:{until}",text(&tariff,"tariffLabel")?),"kind":"LEGAL","severity":"info","rule":rule,"title":title,"description":description,"date":date,"tariff":tariff,"relatedShiftIds":ids,"assessmentRanges":[{"from":from,"through":add_days(parse_date(until)?,1)?.to_string()}]}),
    )
}
fn related(dates: &[String], work: &BTreeMap<String, BTreeSet<String>>) -> Vec<String> {
    dates
        .iter()
        .flat_map(|d| work.get(d).into_iter().flat_map(|v| v.iter().cloned()))
        .collect()
}
pub fn check_tariff_working_time(
    month: &str,
    shifts: &[Value],
    time_zone: &str,
    options: &Value,
    clock_date: &str,
) -> Result<Vec<Value>, ComplianceError> {
    check_tariff_working_time_with_profile(
        month,
        shifts,
        time_zone,
        options,
        clock_date,
        options
            .get("employmentProfile")
            .map(ComplianceProfile::from_raw),
    )
}
pub(crate) fn check_tariff_working_time_with_profile(
    month: &str,
    shifts: &[Value],
    time_zone: &str,
    options: &Value,
    clock_date: &str,
    employment_profile: Option<ComplianceProfile<'_>>,
) -> Result<Vec<Value>, ComplianceError> {
    let Some(profile) = employment_profile.filter(|v| !v.is_null()) else {
        return Ok(vec![]);
    };
    if options.get("youthProtection") == Some(&Value::Bool(true)) {
        return Ok(vec![]);
    }
    let first = parse_date(&format!("{month}-01"))?;
    let last = add_days(add_months(first, 1)?, -1)?;
    let scan_start = add_days(monday(first)?, -7)?;
    let scan_end = add_days(monday(last)?, 13)?;
    let reference = options
        .get("referenceDate")
        .and_then(Value::as_str)
        .unwrap_or(clock_date);
    let earliest = add_days(scan_start, -15)?.to_string();
    let latest = scan_end.to_string();
    let mut unique = BTreeMap::<&str, &Value>::new();
    for shift in shifts {
        let id = text(shift, "id")?;
        let replace = if let Some(old) = unique.get(id) {
            number(shift, "revision")? > number(old, "revision")?
                || (number(shift, "revision")? == number(old, "revision")?
                    && text(shift, "updatedAt")? > text(old, "updatedAt")?)
        } else {
            true
        };
        if replace {
            unique.insert(id, shift);
        }
    }
    let mut work = BTreeMap::<String, BTreeSet<String>>::new();
    let mut starts = BTreeMap::<String, BTreeSet<String>>::new();
    let start_value = scan_start.to_string();
    for shift in unique.values() {
        let date = text(shift, "date")?;
        if date < earliest.as_str() || date > latest.as_str() {
            continue;
        }
        let worked = work_dates::recorded_work_dates(shift, time_zone);
        let id = text(shift, "id")?;
        if !worked.is_empty() && date >= start_value.as_str() {
            starts.entry(date.into()).or_default().insert(id.into());
        }
        for date in worked {
            if date >= start_value && date <= latest {
                work.entry(date).or_default().insert(id.into());
            }
        }
    }
    if work.is_empty() {
        return Ok(vec![]);
    }
    let mut cache = BTreeMap::new();
    let in_display = |date: &str| {
        date.starts_with(&format!("{month}-"))
            && options
                .get("employmentAssessmentPeriod")
                .filter(|v| !v.is_null())
                .is_none_or(|p| {
                    p.get("from")
                        .and_then(Value::as_str)
                        .is_some_and(|v| date >= v)
                        && p.get("until")
                            .and_then(Value::as_str)
                            .is_none_or(|v| v.is_empty() || date < v)
                })
    };
    let mut missing = Vec::<(Arc<TariffTimeContext>, Vec<String>)>::new();
    let mut missing_indexes = BTreeMap::new();
    for date in work.keys() {
        if !date.starts_with(&format!("{month}-")) {
            continue;
        }
        if let Some(c) = at(profile, date, &mut cache)?.filter(|c| c.unavailable) {
            if let Some(index) = missing_indexes.get(&c.key) {
                let index: usize = *index;
                missing[index].1.push(date.clone());
            } else {
                missing_indexes.insert(c.key.clone(), missing.len());
                missing.push((c, vec![date.clone()]));
            }
        }
    }
    let mut out = vec![];
    for (context, dates) in missing {
        if !in_display(&dates[0]) {
            continue;
        }
        let mut tariff = evidence(
            &context,
            &dates[0],
            dates.last().ok_or(ComplianceError::InvalidInput)?,
            reference,
            false,
        );
        tariff["ruleId"] = json!("TARIFF_SCOPE");
        tariff["status"] = json!("UNAVAILABLE");
        tariff["recordedDates"] = json!(dates);
        out.push(finding("TARIFF_SCOPE",&dates[0],"Tarifgrundlage prüfen","Für die erfassten Dienste ist die tarifliche Prüfgrundlage nicht hinreichend bestimmt.",tariff,related(&dates,&work))?);
    }
    let mut week = scan_start;
    let final_week = monday(last)?;
    while week <= final_week {
        let dates = days(week, 14)?;
        let sundays = vec![dates[6].clone(), dates[13].clone()];
        let until = &sundays[1];
        if in_display(until) && sundays.iter().all(|d| work.contains_key(d)) {
            let contexts = dates
                .iter()
                .map(|d| at(profile, d, &mut cache))
                .collect::<Result<Vec<_>, _>>()?;
            if let Some(c) = contexts[13]
                .as_ref()
                .or_else(|| contexts.iter().flatten().next())
                .filter(|c| {
                    c.policy
                        .is_some_and(|p| p.get("freeSource").is_some_and(|v| !v.is_null()))
                        && !c.unavailable
                })
            {
                let mut forbidden = false;
                for date in &sundays {
                    if at(profile, date, &mut cache)?
                        .is_some_and(|c| c.sunday_eligible == Some(Value::Bool(false)))
                    {
                        forbidden = true;
                        break;
                    }
                }
                if !forbidden {
                    let mut tariff = evidence(c, &dates[0], until, reference, true);
                    tariff["ruleId"] = json!("TARIFF_FREE_SUNDAY");
                    tariff["ruleText"] = json!(
                        "Von den zwei arbeitsfreien Tagen innerhalb von zwei Wochen soll ein Tag auf einen Sonntag fallen."
                    );
                    tariff["count"] = json!(2);
                    tariff["recordedDates"] = json!(sundays);
                    tariff["requirements"] = json!(free_requirements(c, &contexts));
                    out.push(finding("TARIFF_FREE_SUNDAY",until,"Beide Sonntage mit Diensten","An beiden Sonntagen des Beobachtungszeitraums sind Tätigkeiten erfasst. Prüfe die tarifliche Sollvorgabe zur Lage eines freien Tages am Sonntag.",tariff,related(&sundays,&work))?);
                }
            }
        }
        week = add_days(week, 7)?;
    }
    if work.len() <= 6 && starts.len() <= 6 {
        return Ok(out);
    }
    let mut week = scan_start;
    while week <= final_week {
        let dates = days(week, 7)?;
        let worked = dates
            .iter()
            .filter(|d| starts.contains_key(*d))
            .cloned()
            .collect::<Vec<_>>();
        if worked.len() > 6 && in_display(&worked[6]) {
            let contexts = dates
                .iter()
                .map(|d| at(profile, d, &mut cache))
                .collect::<Result<Vec<_>, _>>()?;
            if let Some(c) = at(profile, &worked[6], &mut cache)?
                .or_else(|| contexts.iter().flatten().next().cloned())
                .filter(|c| !c.unavailable)
            {
                let mut tariff = evidence(&c, &dates[0], &dates[6], reference, false);
                tariff["count"] = json!(worked.len());
                tariff["limit"] = json!(6);
                tariff["recordedDates"] = json!(worked);
                let mut requirements = c.requirements.clone();
                requirements.push("Prüfe, welche erfassten Tätigkeiten regelmäßige Arbeitszeit und welche zusätzliche Arbeit sind.".into());
                requirements.push(policy::weekly_assumption().into());
                if contexts.iter().flatten().any(|c| !c.scope_confirmed) {
                    requirements.push("Der persönliche Geltungsbereich der gewählten Tarifregel ist zu bestätigen.".into());
                }
                if mixed(&contexts) {
                    requirements.push("Innerhalb dieser Woche ändert sich die Tarifzuordnung oder eine Prüfgrundlage. Die Teilzeiträume sind getrennt zu beurteilen.".into());
                }
                tariff["requirements"] = json!(requirements);
                out.push(finding(
                    "TARIFF_WEEK_DAYS",
                    &worked[6],
                    &format!("Arbeit an allen {} Tagen der Kalenderwoche", worked.len()),
                    &format!(
                        "{} Tage mit Dienstbeginn in einer Kalenderwoche. {}",
                        worked.len(),
                        policy::weekly_assumption()
                    ),
                    tariff,
                    related(&worked, &starts),
                )?);
            }
        }
        week = add_days(week, 7)?;
    }
    let mut week = scan_start;
    while week <= final_week {
        let dates = days(week, 14)?;
        let until = &dates[13];
        if !in_display(until) {
            week = add_days(week, 7)?;
            continue;
        }
        let worked = dates
            .iter()
            .filter(|d| work.contains_key(*d))
            .cloned()
            .collect::<Vec<_>>();
        let possible_free = 14 - worked.len();
        let block_possible = dates
            .windows(2)
            .any(|pair| !work.contains_key(&pair[0]) && !work.contains_key(&pair[1]));
        if (possible_free >= 2 && block_possible)
            || !worked
                .iter()
                .any(|d| parse_date(d).is_ok_and(|d| d.weekday().to_monday_one_offset() == 7))
        {
            week = add_days(week, 7)?;
            continue;
        }
        let contexts = dates
            .iter()
            .map(|d| at(profile, d, &mut cache))
            .collect::<Result<Vec<_>, _>>()?;
        if let Some(c) = contexts[13]
            .as_ref()
            .or_else(|| contexts.iter().flatten().next())
            .filter(|c| {
                c.policy
                    .is_some_and(|p| p.get("freeSource").is_some_and(|v| !v.is_null()))
                    && !c.unavailable
                    && c.sunday_eligible != Some(Value::Bool(false))
            })
        {
            let consecutive = c
                .policy
                .is_some_and(|p| p.get("consecutiveFreeDays") == Some(&Value::Bool(true)));
            if !(possible_free >= 2 && (!consecutive || block_possible)) {
                let mut tariff = evidence(c, &dates[0], until, reference, true);
                tariff["count"] = json!(worked.len());
                tariff["recordedDates"] = json!(worked);
                tariff["requirements"] = json!(free_requirements(c, &contexts));
                let rule_text = text(&tariff, "ruleText")?;
                let description = if consecutive {
                    format!(
                        "Im Beobachtungszeitraum lassen die erfassten Tätigkeiten keinen möglichen zusammenhängenden Zweitageblock übrig. {rule_text}"
                    )
                } else {
                    format!(
                        "Im Beobachtungszeitraum liegen Tätigkeiten an {} von 14 Kalendertagen. {rule_text}",
                        worked.len()
                    )
                };
                out.push(finding(
                    "TARIFF_FREE_DAYS",
                    until,
                    "Tarifliches Frei prüfen",
                    &description,
                    tariff,
                    related(&worked, &work),
                )?);
            }
        }
        week = add_days(week, 7)?;
    }
    Ok(out)
}
