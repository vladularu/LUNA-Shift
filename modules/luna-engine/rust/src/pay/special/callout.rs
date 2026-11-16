use super::SpecialDutyError;
use super::{
    DutyOvertimeRates, rates,
    types::{self, actual_minutes, duty, half_up, instant, integer, text, truthy, zoned},
};
use crate::pay::{
    duty_policy,
    trace::{TariffPayrollOptions, tariff_payroll_trace},
};
use crate::{pay::duty_policy::DutyTariffFamily, rules::RuleResolver};
use serde_json::{Value, json};

pub fn calculate_duty_callout_pay(
    shift: &Value,
    profile: &Value,
    family: DutyTariffFamily,
    resolver: &RuleResolver,
) -> Result<Value, SpecialDutyError> {
    let duty = duty(shift)?;
    let zone = text(duty, "timeZone")?;
    let actual = actual_minutes(shift)?;
    let mut rates: Option<DutyOvertimeRates> = None;
    let mut onsite = Vec::new();
    let mut remote = Vec::new();
    let mut traces = Vec::new();
    let mut time_premium = 0_i64;
    let mut rest = 0.0;
    let mut notes = Vec::new();
    for (index, call) in duty["callouts"]
        .as_array()
        .ok_or(SpecialDutyError::InvalidInput)?
        .iter()
        .enumerate()
    {
        let start = instant(shift, integer(call, "departure")?)?;
        let end = instant(shift, integer(call, "returned")?)?;
        let start_local = zoned(start, zone)?;
        let end_local = zoned(end, zone)?;
        let date = start_local.date().to_string();
        let last_date = zoned(end - 1, zone)?.date().to_string();
        let work = crate::employment::employment_profile_at(profile, &date)?;
        let last_work = crate::employment::employment_profile_at(profile, &last_date)?;
        let rate = rates::overtime_rates(&date, &work, shift, resolver)?;
        let last_rate = rates::overtime_rates(&last_date, &last_work, shift, resolver)?;
        if rate.is_none()
            || last_rate.is_none()
            || duty_policy::duty_tariff_family(&work) != Some(family)
            || duty_policy::duty_tariff_family(&last_work) != Some(family)
            || rate != last_rate
            || rates
                .as_ref()
                .is_some_and(|previous| Some(previous) != rate.as_ref())
        {
            return Ok(
                json!({"actualMinutes":actual,"paidMinutes":null,"baseAmountCents":null,"overtimePremiumCents":null,"rates":null,"notes":["Die Entgeltgrundlage der Einsätze fehlt oder wechselt während der Rufbereitschaft."]}),
            );
        }
        rates = rate;
        if truthy(call.get("breakMinutes")) {
            return Ok(
                json!({"actualMinutes":actual,"paidMinutes":null,"baseAmountCents":null,"overtimePremiumCents":null,"rates":rates,"notes":["Für Einsätze mit Pausen muss die Abrechnung noch geprüft werden."]}),
            );
        }
        let elapsed = (end - start) as f64 / 60000.0;
        if call["kind"] == "ON_SITE" {
            onsite.push(elapsed);
        } else {
            remote.push(elapsed);
        }
        let mut projected = shift.clone();
        let map = projected
            .as_object_mut()
            .ok_or(SpecialDutyError::InvalidInput)?;
        for (key, value) in [
            (
                "id",
                json!(format!("duty-callout:{}:{index}", text(shift, "id")?)),
            ),
            ("date", json!(date)),
            ("type", json!("CUSTOM")),
            (
                "startTime",
                json!(format!(
                    "{:02}:{:02}",
                    start_local.hour(),
                    start_local.minute()
                )),
            ),
            (
                "endTime",
                json!(format!("{:02}:{:02}", end_local.hour(), end_local.minute())),
            ),
            ("breakMinutes", json!(0)),
            ("specialDuty", Value::Null),
            ("overtimeMinutes", json!(0)),
            ("tariffOvertimeConfirmed", json!(false)),
        ] {
            map.insert(key.into(), value);
        }
        match tariff_payroll_trace(
            &projected,
            &work,
            &TariffPayrollOptions::default(),
            resolver,
        ) {
            Ok(traced) => {
                let payments = traced.trace["payments"]
                    .as_array()
                    .ok_or(SpecialDutyError::InvalidInput)?;
                let mut cents = 0_i64;
                for payment in payments {
                    let value = payment["amountCents"]
                        .as_f64()
                        .filter(|number| {
                            number.is_finite()
                                && number.fract() == 0.0
                                && number.abs() <= crate::money::MAX_SAFE_INTEGER as f64
                        })
                        .ok_or(SpecialDutyError::InvalidInput)?
                        as i64;
                    cents = cents
                        .checked_add(value)
                        .ok_or(SpecialDutyError::InvalidInput)?;
                }
                if !payments.is_empty() {
                    let mut trace = traced.trace;
                    trace
                        .as_object_mut()
                        .ok_or(SpecialDutyError::InvalidInput)?
                        .insert("sourceShiftId".into(), json!(text(shift, "id")?));
                    traces.push(trace);
                }
                time_premium = time_premium
                    .checked_add(cents)
                    .ok_or(SpecialDutyError::InvalidInput)?;
                rest += traced.night_compensatory_minutes;
            }
            Err(_) => notes.push(
                "Die Zeitzuschläge dieses Einsatzes konnten nicht vollständig zugeordnet werden."
                    .to_owned(),
            ),
        }
    }
    let paid = duty_policy::on_call_paid_minutes(family, &onsite, &remote)?;
    let paid_integer = if paid.fract() == 0.0 && paid >= 0.0 {
        paid as i128
    } else {
        return Err(SpecialDutyError::InvalidInput);
    };
    let cash = rates.is_some() && duty["settlement"] != "TIME_OFF";
    let base = if cash {
        half_up(
            i128::from(
                rates
                    .as_ref()
                    .ok_or(SpecialDutyError::InvalidInput)?
                    .base_hourly_cents,
            ) * paid_integer,
            60,
        )?
    } else {
        0
    };
    let overtime = if cash {
        let rates = rates.as_ref().ok_or(SpecialDutyError::InvalidInput)?;
        half_up(
            i128::from(rates.premium_hourly_cents)
                * paid_integer
                * i128::from(rates.premium_basis_points),
            600000,
        )?
    } else {
        0
    };
    let credit = if duty["settlement"] == "TIME_OFF" {
        rates.as_ref().map_or(0.0, |rates| {
            paid * (1.0 + rates.premium_basis_points as f64 / 10000.0)
        })
    } else {
        0.0
    } + rest;
    Ok(
        json!({"actualMinutes":actual,"paidMinutes":paid,"rates":rates,"baseAmountCents":base,"overtimePremiumCents":overtime,"timePremiumCents":if notes.is_empty(){Some(time_premium)}else{None},"timeCreditMinutes":if notes.is_empty(){Some(credit)}else{None},"mandatoryRestMinutes":rest,"payrollTraces":traces,"notes":types::unique(notes)}),
    )
}
