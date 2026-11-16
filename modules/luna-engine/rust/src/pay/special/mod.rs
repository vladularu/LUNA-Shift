//! Special-duty remuneration from canonical entries and raw employment profiles.
pub mod callout;
pub mod rates;
pub mod standby;
pub mod time_account;
pub mod trace;
mod types;
use crate::pay::duty_policy::{self, DutyTariffFamily as F};
use crate::rules::RuleResolver;
use serde_json::Value;
use serde_json::json;
use std::collections::BTreeSet;
pub use types::{DutyOvertimeRates, SpecialDutyError, SpecialDutyTimeAccount, StandbyHourlyRate};
use types::{duty, integer, round_integer, text, truthy, zoned};

fn calculate_duty_base(
    shift: &Value,
    profile: &Value,
    resolver: &RuleResolver,
) -> Result<Value, SpecialDutyError> {
    let duty = duty(shift)?;
    let mut notes: Vec<String> = Vec::new();
    let mut paid_hours: Option<f64> = None;
    let mut hourly: Option<i64> = None;
    let mut base: Option<i64> = None;
    let mut duration = 0.0;
    let mut source: Option<&str> = None;
    let mut callout: Option<Value> = None;
    let mut standby: Option<Value> = None;
    let calculated = (|| -> Result<(), SpecialDutyError> {
        let work = crate::employment::employment_profile_at(profile, text(shift, "date")?)?;
        let family = duty_policy::duty_tariff_family(&work);
        let (start, end) = types::bounds(shift)?;
        duration = (end - start) as f64 / 60000.0;
        let zone = text(duty, "timeZone")?;
        let last_date = zoned(end - 1, zone)?.date().to_string();
        let Some(family) = family else {
            notes.push(
                "Der Arbeitgeberbereich ist für diese Abrechnung noch nicht zugeordnet.".into(),
            );
            return Ok(());
        };
        if text(shift, "date")? < duty_policy::rule_source(family).version
            || last_date.as_str() > "2026-12-31"
        {
            notes.push("Für diesen Zeitraum fehlen geprüfte Bereitschaftsregeln.".into());
        } else if duty["kind"] == "STANDBY" {
            source = Some(duty_policy::rule_source(family).standby);
            let value = standby::calculate_standby_pay(shift, profile, resolver)?;
            base = value["cashAmountCents"].as_i64();
            hourly = value["hourlyCents"].as_i64();
            paid_hours = value["weightedMinutes"]
                .as_f64()
                .map(|minutes| minutes / 60.0);
            for note in value["notes"]
                .as_array()
                .ok_or(SpecialDutyError::InvalidInput)?
            {
                notes.push(note.as_str().ok_or(SpecialDutyError::InvalidInput)?.into());
            }
            standby = Some(value);
        } else if duration > 1440.0 || integer(duty, "endDay")? > 1 {
            notes.push(
                "Mehrtägige Rufbereitschaft: die Aufteilung der Pauschalen ist noch offen.".into(),
            );
        } else if last_date.get(..7) != text(shift, "date")?.get(..7) {
            notes.push(
                "Rufbereitschaft über eine Monatsgrenze: die Abrechnungszuordnung ist noch offen."
                    .into(),
            );
        } else {
            source = Some(duty_policy::rule_source(family).on_call);
            let day = crate::calendar::parse_date(text(shift, "date")?)?;
            let last_work = crate::employment::employment_profile_at(profile, &last_date)?;
            hourly = rates::hourly_cents(text(shift, "date")?, &work, resolver)?;
            let last_rate = rates::hourly_cents(&last_date, &last_work, resolver)?;
            if hourly.is_none() || last_rate.is_none() {
                notes.push("Das tarifliche Stundenentgelt fehlt.".into());
            } else if hourly != last_rate
                || duty_policy::duty_tariff_family(&last_work) != Some(family)
            {
                notes.push("Die Berechnungsgrundlage wechselt während der Rufbereitschaft.".into());
            } else {
                let weekend_or_holiday = day.weekday().to_monday_one_offset() >= 6
                    || if family != F::Tvuk && duration >= 720.0 {
                        crate::rules::holidays::holiday_calendar(
                            i32::from(day.year()),
                            text(&work, "federalState")?,
                            work["holidayRegion"].as_str().unwrap_or("NONE"),
                            resolver,
                        )?
                        .contains(text(shift, "date")?)
                    } else {
                        false
                    };
                paid_hours = duty_policy::on_call_base_hours(family, duration, weekend_or_holiday);
                if let Some(hours) = paid_hours {
                    base = Some(round_integer(
                        hours
                            * hourly.ok_or(SpecialDutyError::InvalidInput)? as f64
                            * if family == F::Tvuk { 1.25 } else { 1.0 },
                    )?);
                    if !duty["callouts"]
                        .as_array()
                        .ok_or(SpecialDutyError::InvalidInput)?
                        .is_empty()
                    {
                        let value =
                            callout::calculate_duty_callout_pay(shift, profile, family, resolver)?;
                        for note in value["notes"]
                            .as_array()
                            .ok_or(SpecialDutyError::InvalidInput)?
                        {
                            notes.push(note.as_str().ok_or(SpecialDutyError::InvalidInput)?.into());
                        }
                        callout = Some(value);
                    }
                }
            }
        }
        Ok(())
    })();
    if calculated.is_err() {
        notes.push(
            "Tarif-, Zeit- oder Feiertagsdaten konnten nicht vollständig zugeordnet werden.".into(),
        );
    }
    if duty["kind"] == "ON_CALL" {
        if !truthy(duty.get("calloutsComplete")) {
            notes.push("Bestätige noch, ob alle Einsätze erfasst sind oder kein Einsatz stattgefunden hat.".into());
        }
        let has_calls = !duty["callouts"]
            .as_array()
            .ok_or(SpecialDutyError::InvalidInput)?
            .is_empty();
        if has_calls && callout.is_none() {
            notes.push(
                "Einsatzvergütung und Zuschläge sind zusätzlich zur Pauschale noch offen.".into(),
            );
        }
        if has_calls && duty["settlement"] == "UNKNOWN" {
            notes.push(
                "Wähle für deine Einsätze Auszahlung oder den vereinbarten Freizeitausgleich."
                    .into(),
            );
        }
    }
    let mut value = json!({"shiftId":text(shift,"id")?,"date":text(shift,"date")?,"title":types::label(text(duty,"kind")?)?,"source":source,"durationMinutes":duration,"paidHours":paid_hours,"hourlyCents":hourly,"baseAmountCents":base,"complete":notes.is_empty()&&base.is_some(),"notes":notes});
    let map = value
        .as_object_mut()
        .ok_or(SpecialDutyError::InvalidInput)?;
    if let Some(value) = callout {
        map.insert("calloutPay".into(), value);
    }
    if let Some(value) = standby {
        map.insert("standbyPay".into(), value);
    }
    Ok(value)
}

pub fn calculate_special_duty_pay(
    month: &str,
    entries: &[Value],
    profile: &Value,
    resolver: &RuleResolver,
) -> Result<Vec<Value>, SpecialDutyError> {
    calculate_special_duty_pay_refs(
        month,
        &entries.iter().collect::<Vec<_>>(),
        profile,
        resolver,
    )
}
pub fn calculate_special_duty_pay_refs(
    month: &str,
    entries: &[&Value],
    profile: &Value,
    resolver: &RuleResolver,
) -> Result<Vec<Value>, SpecialDutyError> {
    let mut ids = BTreeSet::new();
    let mut result = Vec::new();
    for shift in entries {
        if shift.get("deletedAt") != Some(&Value::Null)
            || !truthy(shift.get("specialDuty"))
            || shift["specialDuty"]["kind"] == "SPLIT"
        {
            continue;
        }
        let id = text(shift, "id")?;
        if ids.contains(id) {
            continue;
        }
        if !crate::credit::duty::duty_calendar_dates(shift)?
            .iter()
            .any(|date| date.starts_with(month))
        {
            continue;
        }
        ids.insert(id.to_owned());
        result.push(calculate_duty_base(shift, profile, resolver)?);
    }
    Ok(result)
}
