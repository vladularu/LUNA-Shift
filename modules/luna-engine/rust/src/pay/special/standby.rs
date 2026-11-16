use super::SpecialDutyError;
use super::{
    rates, trace,
    types::{
        self, actual_minutes, amount_cents, instant, integer, numeric, round_integer, text, truthy,
        zoned,
    },
};
use crate::pay::duty_policy::{self, DutyTariffFamily as F};
use crate::rules::RuleResolver;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

fn unknown(actual: f64, note: &str) -> Value {
    json!({"actualMinutes":actual,"weightedMinutes":null,"factorBasisPoints":null,"hourlyCents":null,"payGroup":null,"baseAmountCents":null,"overtimePremiumCents":null,"nightPremiumCents":null,"holidayPremiumCents":null,"sundayPremiumCents":null,"cashAmountCents":null,"timeCreditMinutes":null,"mandatoryRestMinutes":null,"notes":[note]})
}

pub fn calculate_standby_pay(
    shift: &Value,
    profile: &Value,
    resolver: &RuleResolver,
) -> Result<Value, SpecialDutyError> {
    let actual = actual_minutes(shift)?;
    let Some(duty) = shift.get("specialDuty").filter(|value| value.is_object()) else {
        return Ok(unknown(
            actual,
            "Ergänze die Abrechnungsgrundlage für deinen Bereitschaftsdienst.",
        ));
    };
    let Some(agreement) = duty
        .get("standbyAgreement")
        .filter(|value| value.is_object())
    else {
        return Ok(unknown(
            actual,
            "Ergänze die Abrechnungsgrundlage für deinen Bereitschaftsdienst.",
        ));
    };
    if duty["kind"] != "STANDBY" || agreement["rule"] == "UNKNOWN" {
        return Ok(unknown(
            actual,
            "Ergänze die Abrechnungsgrundlage für deinen Bereitschaftsdienst.",
        ));
    }
    let work = crate::employment::employment_profile_at(profile, text(shift, "date")?)?;
    let family = duty_policy::duty_tariff_family(&work);
    if family.is_none()
        || serde_json::to_value(family).map_err(|_| SpecialDutyError::InvalidInput)?
            != agreement["tariff"]
    {
        return Ok(unknown(
            actual,
            "Die gespeicherte Bereitschaftsregelung passt nicht zum Tarif an diesem Tag.",
        ));
    }
    let family = family.ok_or(SpecialDutyError::InvalidInput)?;
    let care = agreement["rule"] == "CARE";
    if care && !matches!(family, F::TvoedK | F::TvoedB) {
        return Ok(unknown(
            actual,
            "Diese Sonderbewertung gehört nicht zum gewählten Tarif.",
        ));
    }
    let (start, end) = types::bounds(shift)?;
    let zone = text(duty, "timeZone")?;
    let last = zoned(end - 1, zone)?.date().to_string();
    let elapsed = (end - start) as f64 / 60000.0;
    if elapsed <= 0.0 || elapsed > 1440.0 || text(shift, "date")?.get(..7) != last.get(..7) {
        return Ok(unknown(
            actual,
            "Bereitschaft über 24 Stunden oder eine Monatsgrenze: die Aufteilung ist noch offen.",
        ));
    }
    let pause = numeric(shift, "breakMinutes")?;
    if pause.fract() != 0.0
        || !(0.0..=crate::money::MAX_SAFE_INTEGER as f64).contains(&pause)
        || !actual.is_finite()
        || actual <= 0.0
        || actual > elapsed
    {
        return Ok(unknown(
            actual,
            "Prüfe die Dauer und Pausenangabe deines Bereitschaftsdienstes.",
        ));
    }
    if text(shift, "date")? < duty_policy::rule_source(family).version
        || last.as_str() > "2026-12-31"
    {
        return Ok(unknown(
            actual,
            "Für diesen Zeitraum fehlen geprüfte Bereitschaftsregeln.",
        ));
    }
    let level = text(duty, "standbyLevel")?;
    let ordinal = agreement["sequence"].as_f64();
    let factor = if care {
        if family == F::TvoedK {
            (level == "I").then_some(0.285)
        } else if ["A", "B"].contains(&level) {
            ordinal.map(|ordinal| if ordinal <= 8.0 { 0.25 } else { 0.4 })
        } else {
            None
        }
    } else {
        duty_policy::standby_normal_factor(family, level, ordinal, true, text(shift, "date")?)
    };
    let Some(factor) = factor else {
        return Ok(unknown(
            actual,
            "Prüfe die Bereitschaftsstufe und gegebenenfalls die Nummer des Dienstes im Monat.",
        ));
    };
    let rate = rates::standby_hourly_rate(text(shift, "date")?, &work, agreement, resolver)?;
    let last_work = crate::employment::employment_profile_at(profile, &last)?;
    let last_rate = rates::standby_hourly_rate(&last, &last_work, agreement, resolver)?;
    let (Some(rate), Some(last_rate)) = (rate, last_rate) else {
        return Ok(unknown(
            actual,
            if truthy(work.get("nursingTrainingTariff")) || truthy(work.get("tvalPflegeTariff")) {
                "Für deine Ausbildung: Öffne Abrechnung, tippe auf Stundenentgelt und trage den bestätigten Grundstundensatz deines Arbeitgebers ohne Zuschläge ein."
            } else {
                "Die Bereitschaftsgruppe oder das vereinbarte Stundenentgelt fehlt."
            },
        ));
    };
    if rate != last_rate
        || work.get("federalState") != last_work.get("federalState")
        || work.get("holidayRegion") != last_work.get("holidayRegion")
    {
        return Ok(unknown(
            actual,
            "Die Berechnungsgrundlage wechselt während des Bereitschaftsdienstes.",
        ));
    }
    let settlement = text(duty, "settlement")?;
    if settlement == "UNKNOWN" {
        return Ok(unknown(
            actual,
            "Wähle noch, ob dein Bereitschaftsdienst ausgezahlt oder in Freizeit ausgeglichen wird.",
        ));
    }
    let time_off = text(agreement, "timeOffMode")?;
    if settlement == "TIME_OFF"
        && (time_off == "UNKNOWN" || (time_off == "FACTORIZED" && family != F::TvoedK))
    {
        return Ok(unknown(
            actual,
            "Ergänze das vereinbarte Verfahren für den Freizeitausgleich.",
        ));
    }
    let pause_start = if pause > 0.0 {
        duty.get("breakStart")
            .filter(|value| !value.is_null())
            .map(|value| {
                value
                    .as_i64()
                    .ok_or(SpecialDutyError::InvalidInput)
                    .and_then(|minute| instant(shift, minute))
            })
            .transpose()?
    } else {
        None
    };
    let pause_ms = integer(shift, "breakMinutes")?
        .checked_mul(60000)
        .ok_or(SpecialDutyError::InvalidInput)?;
    let pause_end = pause_start
        .map(|value| {
            value
                .checked_add(pause_ms)
                .ok_or(SpecialDutyError::InvalidInput)
        })
        .transpose()?;
    if pause_start.is_some_and(|value| value < start) || pause_end.is_some_and(|value| value > end)
    {
        return Ok(unknown(
            actual,
            "Prüfe den Beginn und die Dauer deiner Bereitschaftspause.",
        ));
    }
    let mut boundaries = BTreeSet::from([start, end]);
    if let Some(value) = pause_start {
        boundaries.insert(value);
    }
    if let Some(value) = pause_end {
        boundaries.insert(value);
    }
    for day in 0..=integer(duty, "endDay")? {
        for hour in [0, 4, 6, 20, 21, 24] {
            let at = instant(shift, day * 1440 + hour * 60)?;
            if at > start && at < end {
                boundaries.insert(at);
            }
        }
    }
    let first = zoned(start, zone)?;
    let holidays = crate::rules::holidays::holiday_calendar(
        i32::from(first.year()),
        text(&work, "federalState")?,
        work["holidayRegion"].as_str().unwrap_or("NONE"),
        resolver,
    )?;
    let points: Vec<_> = boundaries.into_iter().collect();
    let (mut night, mut deep, mut holiday, mut sunday) = (0.0, 0.0, 0.0, 0.0);
    let mut kinds = BTreeSet::new();
    let mut periods: BTreeMap<&str, Vec<Value>> = BTreeMap::from([
        ("night", Vec::new()),
        ("deepNight", Vec::new()),
        ("holiday", Vec::new()),
        ("sunday", Vec::new()),
    ]);
    for pair in points.windows(2) {
        let from = pair[0];
        let until = pair[1];
        if pause_start.is_some_and(|value| from >= value)
            && pause_end.is_some_and(|value| until <= value)
        {
            continue;
        }
        let local = zoned(from, zone)?;
        let minutes = (until - from) as f64 / 60000.0;
        let in_night = matches!(family, F::Tvuk | F::TvoedK | F::TvoedB)
            && (local.hour() < 6 || local.hour() >= if family == F::Tvuk { 20 } else { 21 });
        let in_deep = family == F::Tvuk && local.hour() < 4;
        let on_holiday = matches!(family, F::TvoedK | F::Tvl43 | F::Tvh43)
            && holidays.contains(&local.date().to_string());
        let on_sunday = family == F::Tvuk && local.date().weekday().to_monday_one_offset() == 7;
        kinds.insert((in_night, in_deep, on_holiday, on_sunday));
        if in_night {
            night += minutes;
        }
        if in_deep {
            deep += minutes;
        }
        if on_holiday {
            holiday += minutes;
        }
        if on_sunday {
            sunday += minutes;
        }
        let period =
            json!({"start":trace::timestamp(from,zone)?,"end":trace::timestamp(until,zone)?});
        for (key, include) in [
            ("night", in_night),
            ("deepNight", in_deep),
            ("holiday", on_holiday),
            ("sunday", on_sunday),
        ] {
            if include {
                periods
                    .get_mut(key)
                    .ok_or(SpecialDutyError::InvalidInput)?
                    .push(period.clone());
            }
        }
    }
    if pause != 0.0 && pause_start.is_none() {
        if kinds.len() != 1 {
            return Ok(unknown(
                actual,
                "Für die Zuordnung zu Nacht-, Sonn- oder Feiertagszeiten fehlt die genaue Lage der Pause. Die Abrechnung bleibt noch offen.",
            ));
        }
        if night != 0.0 {
            night -= pause;
        }
        if deep != 0.0 {
            deep -= pause;
        }
        if holiday != 0.0 {
            holiday -= pause;
        }
        if sunday != 0.0 {
            sunday -= pause;
        }
    }
    // Preserve the source IEEE order for displayed credits; cash quantization is integer HALF_UP.
    let weighted = actual * factor
        + if matches!(family, F::Tvl43 | F::Tvh43) {
            holiday * 0.25
        } else {
            0.0
        };
    let amount = |minutes, multiplier| amount_cents(rate.cents, minutes, multiplier);
    let base = amount(weighted, 1.0)?;
    let overtime = if family == F::Tvuk {
        amount(weighted, 0.25)?
    } else {
        0
    };
    let night_cash = if family == F::Tvuk {
        amount(night * factor, 0.2)? + amount(deep * factor, 0.15)?
    } else if matches!(family, F::TvoedK | F::TvoedB) {
        amount(night, 0.15)?
    } else {
        0
    };
    let holiday_cash = if family == F::TvoedK {
        amount(holiday * factor, 0.25)?
    } else {
        0
    };
    let sunday_cash = if family == F::Tvuk {
        amount(sunday * factor, 0.4)?
    } else {
        0
    };
    let rest = if family == F::Tvuk {
        night * factor * 0.05
    } else {
        0.0
    };
    let mut credit = rest;
    let mut cash = base + overtime + night_cash + holiday_cash + sunday_cash;
    if settlement == "TIME_OFF" {
        credit = if family == F::TvoedK && time_off == "FACTORIZED" {
            let per_hour = if care {
                17.5
            } else {
                match level {
                    "I" => 37.0,
                    "II" => 46.0,
                    "III" => 55.0,
                    _ => return Err(SpecialDutyError::InvalidInput),
                }
            };
            actual * per_hour / 60.0 + holiday * 0.25 + night * 0.15
        } else if family == F::Tvuk {
            weighted * 1.25 + night * factor * 0.25 + sunday * factor * 0.4
        } else {
            weighted
                + if family == F::TvoedK {
                    holiday * factor * 0.25
                } else {
                    0.0
                }
                + if matches!(family, F::TvoedK | F::TvoedB) {
                    night * 0.15
                } else {
                    0.0
                }
        };
        cash = if family == F::Tvuk {
            amount(deep * factor, 0.15)?
        } else {
            0
        };
    }
    let deep_cash = if family == F::Tvuk {
        amount(deep * factor, 0.15)?
    } else {
        0
    };
    let mut payments = Vec::new();
    for (key, cents, kind, category) in [
        (
            "night",
            if settlement == "PAY" {
                night_cash - deep_cash
            } else {
                0
            },
            "NIGHT",
            "NIGHT",
        ),
        (
            "holiday",
            if settlement == "PAY" { holiday_cash } else { 0 },
            "DAY",
            "HOLIDAY",
        ),
        (
            "sunday",
            if settlement == "PAY" { sunday_cash } else { 0 },
            "DAY",
            "SUNDAY",
        ),
        ("deepNight", deep_cash, "NIGHT", "NIGHT"),
    ] {
        if cents > 0 {
            payments.push(json!({"id":format!("{}:standby:{key}",text(shift,"id")?),"kind":kind,"category":category,"amountCents":cents,"additionalToBasicPay":true,"periods":periods.get(key).ok_or(SpecialDutyError::InvalidInput)?}));
        }
    }
    let mut notes = Vec::new();
    let payroll = if payments.is_empty() {
        None
    } else {
        match trace::standby_payroll_trace(shift, &payments, &work, resolver) {
            Ok(value) => Some(value),
            Err(_) => {
                notes.push("Für die steuerliche Zuschlagszuordnung fehlt die genaue Lage der Bereitschaftspause.");
                None
            }
        }
    };
    let mut result = json!({"actualMinutes":actual,"weightedMinutes":weighted,"factorBasisPoints":round_integer(factor*10000.0)?,"hourlyCents":rate.cents,"payGroup":rate.group,"baseAmountCents":base,"overtimePremiumCents":overtime,"nightPremiumCents":night_cash,"holidayPremiumCents":holiday_cash,"sundayPremiumCents":sunday_cash,"cashAmountCents":cash,"timeCreditMinutes":credit,"mandatoryRestMinutes":rest,"notes":notes});
    if let Some(value) = payroll {
        result
            .as_object_mut()
            .ok_or(SpecialDutyError::InvalidInput)?
            .insert("payrollTrace".into(), value);
    }
    Ok(result)
}
