//! TVöD VKA § 21 and protocol declarations. Monetary calculations use integer cents.
use super::payment_schedule::add_salary_payment_months;
use jiff::civil::Date;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

pub(crate) fn absence(v: &Value) -> bool {
    matches!(v["type"].as_str(), Some("VACATION" | "SICK")) && v["deletedAt"].is_null()
}
pub(crate) fn eligible(profile: &Value) -> bool {
    (!profile["tariff"].is_null() || !profile["vkaETariff"].is_null())
        && profile["salaryBasisConflict"] != true
        && profile["manualMonthlyGrossCents"].is_null()
        && ![
            "nursingTrainingTariff",
            "tvlKrTariff",
            "tvUkNursingTariff",
            "tvhKrTariff",
            "tvalPflegeTariff",
        ]
        .iter()
        .any(|key| !profile[key].is_null())
}
pub(crate) fn validate(facts: &Value, shift: &Value) -> Result<(), ()> {
    let keys = [
        "day",
        "dailyRateCents",
        "workdaysPerWeek",
        "historyComplete",
        "eventStart",
    ];
    if !absence(shift)
        || !facts.as_object().is_some_and(|obj| {
            obj.keys().all(|k| {
                keys.contains(&k.as_str())
                    || ["referenceCents", "referenceDays", "plannedShift"].contains(&k.as_str())
            }) && keys.iter().all(|k| obj.contains_key(*k))
        })
        || !matches!(
            facts["day"].as_str(),
            Some("AUTO" | "FREE" | "PAID" | "UNPAID" | "EXCUSED_UNPAID")
        )
        || !facts["historyComplete"].is_boolean()
        || !(facts["referenceCents"].is_null()
            || facts["referenceCents"]
                .as_f64()
                .is_some_and(|n| n.fract() == 0.0 && (0.0..=100000000.0).contains(&n)))
        || !(facts["referenceDays"].is_null()
            || facts["referenceDays"]
                .as_f64()
                .is_some_and(|n| (1.0..=93.0).contains(&n)))
        || !(facts["plannedShift"].is_null() || valid_plan(&facts["plannedShift"]))
        || !(facts["dailyRateCents"].is_null()
            || facts["dailyRateCents"]
                .as_f64()
                .is_some_and(|x| x.fract() == 0.0 && (0.0..=1000000.0).contains(&x)))
        || !(facts["workdaysPerWeek"].is_null()
            || facts["workdaysPerWeek"]
                .as_f64()
                .is_some_and(|x| (0.1..=7.0).contains(&x)))
        || !(facts["eventStart"].is_null()
            || facts["eventStart"].as_str().is_some_and(|s| {
                s.len() == 10 && s.parse::<Date>().is_ok() && Some(s) <= shift["date"].as_str()
            }))
    {
        return Err(());
    }
    Ok(())
}
fn valid_plan(v: &Value) -> bool {
    let time = |k: &str| {
        v[k].as_str()
            .is_some_and(|s| s.len() == 5 && s.parse::<jiff::civil::Time>().is_ok())
    };
    v.as_object().is_some_and(|p| p.len() == 4)
        && matches!(
            v["type"].as_str(),
            Some("EARLY" | "LATE" | "NIGHT" | "DAY" | "CUSTOM")
        )
        && time("startTime")
        && time("endTime")
        && v["startTime"] != v["endTime"]
        && v["breakMinutes"]
            .as_i64()
            .is_some_and(|n| (0..=1440).contains(&n))
}
pub(super) fn planned_assessment(shift: &Value) -> Option<Value> {
    let plan = &shift["absencePay"]["plannedShift"];
    if !absence(shift) || shift["absencePay"]["day"] != "PAID" || !valid_plan(plan) {
        return None;
    }
    let mut planned = shift.clone();
    for field in ["type", "startTime", "endTime", "breakMinutes"] {
        planned[field] = plan[field].clone();
    }
    planned["allDay"] = json!(false);
    Some(planned)
}
fn period<'a>(context: &'a Value, date: &str) -> Option<&'a Value> {
    context["periods"].as_array()?.iter().find(|p| {
        p["validFrom"].as_str().is_some_and(|s| s <= date)
            && p["validTo"].as_str().is_none_or(|s| s >= date)
    })
}
fn scheduled(context: &Value, date: &str, holiday: Option<bool>) -> Option<bool> {
    let day = context["days"].as_array().and_then(|v| {
        v.iter()
            .find(|d| d["date"] == date && d["rosterStatus"] == "FINAL")
    });
    if let Some(day) = day {
        match day["disposition"].as_str() {
            Some("WORK_REQUIRED") => return Some(true),
            Some("ROSTER_FREE") => return Some(false),
            Some("RELEASED") => return day["lostMinutes"].as_i64().map(|minutes| minutes > 0),
            _ => {}
        }
    }
    let model = &period(context, date)?["model"];
    if model["kind"] != "FIXED_WEEK" {
        return None;
    }
    let index = date.parse::<Date>().ok()?.weekday().to_monday_zero_offset() as usize;
    let minutes = model["weekdayMinutes"][index].as_i64()?;
    if minutes == 0 {
        Some(false)
    } else {
        holiday.map(|h| !h)
    }
}
fn workdays(context: &Value, date: &str) -> Option<f64> {
    let model = &period(context, date)?["model"];
    match model["kind"].as_str()? {
        "FIXED_WEEK" => Some(
            model["weekdayMinutes"]
                .as_array()?
                .iter()
                .filter(|v| v.as_i64().is_some_and(|m| m > 0))
                .count() as f64,
        ),
        "ROTATING_FIVE_IN_SEVEN" if model["sevenDayShiftPlanConfirmed"] == true => Some(5.0),
        _ => None,
    }
}
fn prior_cents(pay: &Value) -> Option<i64> {
    if pay["available"] != true
        || pay["absencePayNotes"]
            .as_array()
            .is_some_and(|n| !n.is_empty())
    {
        return None;
    }
    let cents = |key: &str| {
        pay[key]
            .as_f64()
            .map(|v| (100.0 * v).round() as i64)
            .unwrap_or(0)
    };
    // LUNA currently records tariff confirmation but no evidence of scheduled overtime.
    if cents("overtimeAmount") != 0
        || pay["specialDutyBreakdowns"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|line| {
                let callout = &line["calloutPay"];
                ["baseAmountCents", "overtimePremiumCents"]
                    .iter()
                    .any(|key| callout[key].as_i64().unwrap_or(0) != 0)
            })
        || pay["shiftBreakdowns"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|b| b["overtimePremiumAmount"].as_f64().unwrap_or(0.0) != 0.0)
    {
        return None;
    }
    let allowance = cents("allowanceAmount");
    let hourly = match pay["confirmedAllowance"]
        .as_str()
        .or_else(|| pay["assessment"]["suggestedAllowance"].as_str())
    {
        Some(label) if label.ends_with("_MONTHLY") => 0,
        _ if allowance == 0 || !pay["confirmedAllowance"].is_null() => allowance,
        _ => return None,
    };
    Some(
        cents("timePremiumAmount")
            + hourly
            + cents("specialDutyAmount")
            + cents("absencePayAmount"),
    )
}
fn automatic_rate(
    start: &str,
    date: &str,
    context: &Value,
    facts: &Value,
    shifts: &[Value],
    mut prior: impl FnMut(&str) -> Option<Value>,
) -> Result<i64, String> {
    let mon = &start[..7];
    let mut months = Vec::new();
    let mut bound = context["employment"]["from"].as_str().unwrap_or("");
    let mut periods: Vec<_> = context["periods"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|p| p["validFrom"].as_str().is_some_and(|s| s <= start))
        .collect();
    periods.sort_by_key(|p| p["validFrom"].as_str());
    for pair in periods.windows(2) {
        if pair[0]["weeklyMinutes"] != pair[1]["weeklyMinutes"] {
            bound = bound.max(pair[1]["validFrom"].as_str().unwrap_or(""));
        }
    }
    for delta in -3..0 {
        let m = add_salary_payment_months(mon, delta).map_err(|e| e.to_string())?;
        if format!("{m}-01").as_str() >= bound {
            months.push(m);
        }
    }
    let confirmed_sum = facts["referenceCents"].as_f64();
    let confirmed_days = facts["referenceDays"].as_f64();
    if let (Some(sum), Some(divisor)) = (confirmed_sum, confirmed_days) {
        return Ok((sum / divisor).round() as i64);
    }
    if months.is_empty() {
        let actual_days: BTreeSet<_> = shifts
            .iter()
            .filter(|s| {
                s["deletedAt"].is_null()
                    && s["allDay"] == false
                    && matches!(
                        s["type"].as_str(),
                        Some("EARLY" | "LATE" | "NIGHT" | "DAY" | "CUSTOM")
                    )
            })
            .filter_map(|s| s["date"].as_str())
            .filter(|d| *d >= bound && *d < start)
            .collect();
        let divisor = confirmed_days.or_else(|| {
            (facts["historyComplete"] == true && !actual_days.is_empty())
                .then_some(actual_days.len() as f64)
        });
        let sum=confirmed_sum.ok_or("Seit Eintritt oder Arbeitszeitwechsel liegt kein voller Monat vor. Individuelle anrechenbare Summe oder Tagessatz eintragen.")?;
        return divisor
            .map(|days| (sum / days).round() as i64)
            .ok_or_else(|| {
                "Tatsächlich gearbeitete Tage im individuellen Vergleichszeitraum fehlen.".into()
            });
    }
    let first = &months[0];
    if confirmed_sum.is_none() && facts["historyComplete"] != true {
        return Err(format!(
            "Referenzmonate ab {first} auf Vollständigkeit prüfen."
        ));
    }
    // Repricing depends on the nature of each component. A flat increase would incorrectly index fixed euro premiums.
    if confirmed_sum.is_none()
        && ["2025-04-01", "2026-05-01"]
            .iter()
            .any(|change| format!("{first}-01").as_str() < *change && *change <= date)
    {
        return Err("Tarifanpassung im Vergleichszeitraum. Angepassten Tagessatz laut Abrechnung eintragen.".into());
    }
    let days = confirmed_days
        .or_else(|| facts["workdaysPerWeek"].as_f64())
        .or_else(|| workdays(context, &format!("{first}-01")))
        .filter(|d| *d > 0.0)
        .ok_or("Regelmäßige Arbeitstage pro Woche fehlen.")?;
    let excused: BTreeSet<_> = shifts
        .iter()
        .filter(|s| absence(s) && s["absencePay"]["day"] == "EXCUSED_UNPAID")
        .filter_map(|s| s["date"].as_str())
        .filter(|d| months.iter().any(|m| d.starts_with(m)))
        .collect();
    let divisor = confirmed_days.unwrap_or_else(|| {
        (if months.len() == 3 {
            13.0 * days
        } else {
            (13.0 * days * months.len() as f64 / 3.0).round()
        }) - excused.len() as f64
    });
    if divisor <= 0.0 {
        return Err("Maßgebliche Arbeitstage im Vergleichszeitraum fehlen.".into());
    }
    if let Some(sum) = confirmed_sum {
        return Ok((sum / divisor).round() as i64);
    }
    let mut cents = 0;
    for month in &months {
        cents += prior(month)
            .and_then(|pay| prior_cents(&pay))
            .ok_or_else(|| {
                format!(
                    "Anrechenbare Entgeltbestandteile für {month} klären oder Tagessatz eintragen."
                )
            })?;
    }
    Ok((cents as f64 / divisor).round() as i64)
}

pub(crate) fn apply(
    month: &str,
    pay: &mut Value,
    shifts: &[Value],
    context: &Value,
    mut in_tariff: impl FnMut(&str) -> bool,
    mut holiday: impl FnMut(&str) -> Option<bool>,
    mut prior: impl FnMut(&str) -> Option<Value>,
) {
    if !shifts
        .iter()
        .any(|s| absence(s) && s["date"].as_str().is_some_and(|d| d.starts_with(month)))
    {
        return;
    }
    let mut dates: BTreeMap<&str, Vec<&Value>> = BTreeMap::new();
    for s in shifts.iter().filter(|s| absence(s)) {
        if let Some(date) = s["date"].as_str() {
            dates.entry(date).or_default().push(s);
        }
    }
    let mut total = 0_i64;
    let mut notes = BTreeSet::new();
    let mut lines = Vec::new();
    let mut previous: Option<(Date, &str, String)> = None;
    let mut rates: BTreeMap<(String, String, String), i64> = BTreeMap::new();
    let mut confirmations: BTreeMap<(String, String, String), Value> = BTreeMap::new();
    for (&date, group) in &dates {
        let Ok(civil) = date.parse::<Date>() else {
            continue;
        };
        let active: Vec<_> = group
            .iter()
            .filter(|s| {
                !matches!(
                    s["absencePay"]["day"].as_str(),
                    Some("FREE" | "UNPAID" | "EXCUSED_UNPAID")
                )
            })
            .collect();
        let s = *active.first().copied().unwrap_or(&group[0]);
        let kind = s["type"].as_str().unwrap_or("");
        let facts = &s["absencePay"];
        let start = facts["eventStart"]
            .as_str()
            .map(str::to_owned)
            .or_else(|| {
                previous
                    .as_ref()
                    .filter(|(p, k, _)| p.tomorrow().ok() == Some(civil) && *k == kind)
                    .map(|(_, _, s)| s.clone())
            })
            .unwrap_or_else(|| date.to_owned());
        previous = Some((civil, kind, start.clone()));
        let tariff_date = ["2025-04-01", "2026-05-01"]
            .into_iter()
            .filter(|change| *change <= date)
            .next_back()
            .unwrap_or("");
        let event = (start.clone(), kind.to_owned(), tariff_date.to_owned());
        if !facts.is_null()
            && (facts["historyComplete"] == true
                || !facts["workdaysPerWeek"].is_null()
                || !facts["referenceCents"].is_null()
                || !facts["referenceDays"].is_null())
        {
            confirmations.insert(event.clone(), facts.clone());
        }
        if let Some(rate) = facts["dailyRateCents"].as_f64() {
            rates.insert(event.clone(), rate as i64);
        }
        if !date.starts_with(month) || !in_tariff(date) || active.is_empty() {
            continue;
        }
        if context["employment"]["from"]
            .as_str()
            .is_some_and(|bound| date < bound)
            || context["employment"]["to"]
                .as_str()
                .is_some_and(|bound| date > bound)
        {
            continue;
        }
        if active.len() > 1 {
            notes.insert(format!(
                "{date} · Mehrere Abwesenheiten. Bezahlten Ausfall eindeutig zuordnen."
            ));
            continue;
        }
        let day = match facts["day"].as_str() {
            Some("PAID") => Some(true),
            _ => scheduled(context, date, holiday(date)).or_else(|| {
                context["confirmedPaidDates"]
                    .as_array()
                    .and_then(|dates| dates.iter().any(|d| d == date).then_some(true))
            }),
        };
        if day == Some(false) {
            continue;
        }
        if day.is_none() {
            notes.insert(format!("{date} · Bezahlten Ausfalltag bestätigen."));
            continue;
        }
        if kind == "SICK"
            && facts["day"] != "PAID"
            && start
                .parse::<Date>()
                .is_ok_and(|first| civil.since(first).is_ok_and(|span| span.get_days() >= 42))
        {
            notes.insert(format!(
                "{date} · Entgeltfortzahlung nach sechs Wochen klären."
            ));
            continue;
        }
        let rate = rates.get(&event).copied().map(Ok).unwrap_or_else(|| {
            automatic_rate(
                &start,
                date,
                context,
                confirmations.get(&event).unwrap_or(facts),
                shifts,
                &mut prior,
            )
        });
        match rate {
            Ok(cents) => {
                total += cents;
                lines.push(json!({"date":date,"eventStart":start,"type":kind,"dailyRateCents":cents,"manual":rates.contains_key(&event)}));
            }
            Err(reason) => {
                notes.insert(format!("{date} · {reason}"));
            }
        }
    }
    if lines.is_empty() && notes.is_empty() {
        return;
    }
    let amount = total as f64 / 100.0;
    pay["absencePayAmount"] = json!(amount);
    pay["absencePayDays"] = json!(lines);
    pay["absencePayNotes"] = json!(notes);
    for key in ["estimatedGrossAmount", "knownGrossAmount"] {
        if let Some(gross) = pay[key].as_f64() {
            pay[key] = json!(crate::pay::legacy::round_money(gross + amount));
        }
    }
    if !notes.is_empty() {
        if let Some(gross) = pay["estimatedGrossAmount"].as_f64() {
            pay["knownGrossAmount"] = json!(gross);
        }
        pay["estimatedGrossAmount"] = Value::Null;
        pay["available"] = json!(false);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn payroll() -> Value {
        json!({"available":true,"estimatedGrossAmount":3000,"timePremiumAmount":325.0,"allowanceAmount":300.0,"confirmedAllowance":"SHIFT_MONTHLY"})
    }
    fn shift(d: &str, k: &str, facts: Value) -> Value {
        json!({"date":d,"type":k,"absencePay":facts})
    }
    fn facts() -> Value {
        json!({"day":"AUTO","workdaysPerWeek":5,"historyComplete":true,"dailyRateCents":null,"eventStart":null})
    }
    #[test]
    fn paid_absence_three_days_from_three_complete_reference_months() {
        let context = json!({"periods":[{"validFrom":"2022-01-01","model":{"kind":"FIXED_WEEK","weekdayMinutes":[480,480,480,480,480,0,0]}}],"days":[]});
        for kind in ["SICK", "VACATION"] {
            for tariff in [
                json!({"tariff":{"payGroup":"P8"}}),
                json!({"vkaETariff":{"payGroup":"E8"}}),
            ] {
                let entries = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-06"]
                    .map(|d| shift(d, kind, facts()));
                let mut pay = payroll();
                apply(
                    "2026-09",
                    &mut pay,
                    &entries,
                    &context,
                    |_| eligible(&tariff),
                    |_| Some(false),
                    |m| {
                        assert!(["2026-06", "2026-07", "2026-08"].contains(&m));
                        Some(payroll())
                    },
                );
                assert_eq!(pay["absencePayAmount"], 45.0);
                assert_eq!(pay["estimatedGrossAmount"], 3045.0);
                assert_eq!(pay["absencePayDays"].as_array().unwrap().len(), 3);
                assert_eq!(add_salary_payment_months("2026-09", 2).unwrap(), "2026-11");
            }
        }
    }
    #[test]
    fn continuing_event_carries_manual_zero_and_uses_its_original_reference_months() {
        let mut first = facts();
        first["day"] = json!("PAID");
        first["workdaysPerWeek"] = json!(3);
        let mut second = first.clone();
        second["workdaysPerWeek"] = Value::Null;
        second["historyComplete"] = json!(false);
        let mut third = second.clone();
        third["dailyRateCents"] = json!(0);
        let entries = [
            shift("2026-09-30", "SICK", first),
            shift("2026-10-01", "SICK", second),
            shift("2026-10-02", "SICK", third),
        ];
        let mut pay = payroll();
        apply(
            "2026-10",
            &mut pay,
            &entries,
            &Value::Null,
            |_| true,
            |_| None,
            |m| {
                assert!(["2026-06", "2026-07", "2026-08"].contains(&m));
                Some(payroll())
            },
        );
        assert_eq!(pay["absencePayAmount"], 25.0);
        assert_eq!(pay["absencePayDays"][1]["dailyRateCents"], 0);
    }
    #[test]
    fn unknown_roster_or_conflicting_absences_leave_the_amount_open() {
        let mut pay = payroll();
        let entries = [
            shift("2026-09-01", "SICK", facts()),
            shift("2026-09-02", "VACATION", facts()),
            shift("2026-09-02", "SICK", facts()),
        ];
        apply(
            "2026-09",
            &mut pay,
            &entries,
            &Value::Null,
            |_| true,
            |_| None,
            |_| panic!(),
        );
        assert_eq!(pay["available"], false);
        assert_eq!(pay["knownGrossAmount"], 3000.0);
        assert_eq!(pay["absencePayNotes"].as_array().unwrap().len(), 2);
    }
    #[test]
    fn actual_workdays_and_corrected_reference_values_from_payroll() {
        let mut f = facts();
        f["referenceCents"] = json!(9750);
        f["referenceDays"] = json!(5);
        assert_eq!(
            automatic_rate(
                "2026-05-04",
                "2026-05-04",
                &Value::Null,
                &f,
                &[],
                |_| panic!()
            ),
            Ok(1950)
        );
        assert!(!eligible(&json!({"tvlKrTariff":{}})));
    }
}
