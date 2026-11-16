//! Source-equivalent pure calendar input normalization; no persistence or clocks.
use super::{InputError, local_date, require_instant, special_duty, trim_javascript};
use crate::net::js_truthy;
use serde_json::{Value, json};
fn invalid(message: &str) -> InputError {
    InputError::validation(message)
}
pub fn require_local_date(value: &Value) -> Result<String, InputError> {
    value
        .as_str()
        .and_then(local_date::normalize)
        .ok_or_else(|| invalid("Bitte ein gültiges Datum angeben."))
}
pub fn require_local_month(value: &Value) -> Result<String, InputError> {
    let text = value.as_str().filter(|text| {
        text.len() == 7
            && text.as_bytes()[4] == b'-'
            && text
                .bytes()
                .enumerate()
                .all(|(i, b)| i == 4 || b.is_ascii_digit())
    });
    text.filter(|text| crate::calendar::parse_date(&format!("{text}-01")).is_ok())
        .map(str::to_owned)
        .ok_or_else(|| invalid("Bitte einen gültigen Auswertungsmonat angeben."))
}
pub fn require_local_time(value: &Value) -> Result<String, InputError> {
    let text = value.as_str().map(trim_javascript).filter(|text| {
        text.len() == 5
            && text.as_bytes()[2] == b':'
            && text
                .bytes()
                .enumerate()
                .all(|(i, b)| i == 2 || b.is_ascii_digit())
    });
    text.filter(|text| {
        text[..2].parse::<u8>().is_ok_and(|h| h < 24)
            && text[3..].parse::<u8>().is_ok_and(|m| m < 60)
    })
    .map(str::to_owned)
    .ok_or_else(|| invalid("Uhrzeiten müssen im Format HH:MM angegeben werden."))
}
pub fn require_non_empty(value: &Value, field: &str) -> Result<String, InputError> {
    value
        .as_str()
        .map(trim_javascript)
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| InputError::validation(format!("{field} darf nicht leer sein.")))
}
pub fn require_color(value: &Value) -> Result<String, InputError> {
    value
        .as_str()
        .filter(|text| {
            text.len() == 7
                && text.starts_with('#')
                && text.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
        })
        .map(str::to_ascii_uppercase)
        .ok_or_else(|| invalid("Bitte eine gültige Farbe wählen."))
}
pub fn require_allowance_status(value: &Value) -> Result<String, InputError> {
    value
        .as_str()
        .filter(|s| {
            [
                "NONE",
                "SHIFT_MONTHLY",
                "SHIFT_HOURLY",
                "ALTERNATING_MONTHLY",
                "ALTERNATING_HOURLY",
            ]
            .contains(s)
        })
        .map(str::to_owned)
        .ok_or_else(|| invalid("Unbekannter Zulagenstatus."))
}
pub fn require_positive_revision(value: &Value) -> Result<Value, InputError> {
    if value.as_f64().is_some_and(|n| n.fract() == 0.0 && n >= 1.0) {
        Ok(value.clone())
    } else {
        Err(invalid("Ungültige Datensatzrevision."))
    }
}
/// Save intent has no stored revision/timestamps; those remain SQL metadata.
pub fn normalize_tariff_decision_input(input: &Value) -> Result<Value, InputError> {
    Ok(
        json!({"month":require_local_month(&input["month"])?,"allowanceStatus":require_allowance_status(&input["allowanceStatus"])?}),
    )
}
pub fn validate_monthly_tariff_decision(input: &Value) -> Result<Value, InputError> {
    let month = require_local_month(&input["month"])?;
    let status = require_allowance_status(&input["allowanceStatus"])?;
    let revision = require_positive_revision(&input["revision"])?;
    let confirmed = require_instant(&input["confirmedAt"], "Bestätigung")?;
    let updated = require_instant(&input["updatedAt"], "Aktualisierung")?;
    Ok(
        json!({"month":month,"allowanceStatus":status,"revision":revision,"confirmedAt":confirmed,"updatedAt":updated}),
    )
}
fn range(value: &Value, max: f64, message: &str) -> Result<(), InputError> {
    if value
        .as_f64()
        .is_some_and(|n| n.fract() == 0.0 && n >= 0.0 && n <= max)
    {
        Ok(())
    } else {
        Err(invalid(message))
    }
}
fn location(value: &Value) -> Result<Value, InputError> {
    if value.is_null() {
        return Ok(Value::Null);
    }
    let name = require_non_empty(&value["name"], "Ort")?;
    let address = match value.get("address").filter(|v| !v.is_null()) {
        Some(v) => {
            Some(trim_javascript(v.as_str().ok_or_else(|| {
                invalid("Der ausgewählte Ort ist ungültig.")
            })?))
            .filter(|v| !v.is_empty())
        }
        None => None,
    };
    let (lat, lon) = (&value["latitude"], &value["longitude"]);
    if lat.is_null() != lon.is_null() {
        return Err(invalid(
            "Der ausgewählte Ort enthält unvollständige Koordinaten.",
        ));
    }
    let mut result = json!({"name":name});
    if let Some(address) = address {
        result["address"] = json!(address);
    }
    if !lat.is_null() {
        if !lat.as_f64().is_some_and(|n| (-90.0..=90.0).contains(&n))
            || !lon.as_f64().is_some_and(|n| (-180.0..=180.0).contains(&n))
        {
            return Err(invalid(
                "Der ausgewählte Ort enthält ungültige Koordinaten.",
            ));
        }
        result["latitude"] = lat.clone();
        result["longitude"] = lon.clone();
    }
    Ok(result)
}
fn notification(value: &Value) -> Result<Value, InputError> {
    if value.is_null() {
        return Ok(Value::Null);
    }
    range(
        &value["amount"],
        365.0,
        "Der Benachrichtigungsabstand ist ungültig.",
    )?;
    if !value["unit"]
        .as_str()
        .is_some_and(|v| ["MINUTE", "HOUR", "DAY", "WEEK"].contains(&v))
    {
        return Err(invalid("Die Benachrichtigungseinheit ist ungültig."));
    }
    if !value["direction"]
        .as_str()
        .is_some_and(|v| ["BEFORE", "AFTER"].contains(&v))
    {
        return Err(invalid("Die Benachrichtigungsrichtung ist ungültig."));
    }
    if !value["reference"]
        .as_str()
        .is_some_and(|v| ["START", "END"].contains(&v))
    {
        return Err(invalid("Der Benachrichtigungszeitpunkt ist ungültig."));
    }
    Ok(value.clone())
}
fn recurrence(value: &Value) -> Result<Value, InputError> {
    if value.is_null() {
        return Ok(Value::Null);
    }
    if !value["interval"]
        .as_f64()
        .is_some_and(|n| n.fract() == 0.0 && (1.0..=99.0).contains(&n))
    {
        return Err(invalid(
            "Das Wiederholungsintervall muss zwischen 1 und 99 liegen.",
        ));
    }
    if !value["frequency"]
        .as_str()
        .is_some_and(|v| ["DAY", "WEEK", "MONTH", "YEAR"].contains(&v))
    {
        return Err(invalid("Die Wiederholung ist ungültig."));
    }
    Ok(value.clone())
}
fn record(value: &Value) -> Result<Value, InputError> {
    if value.is_object() {
        Ok(value.clone())
    } else {
        Err(invalid("Die Kalenderangaben sind ungültig."))
    }
}
fn default(value: &Value, fallback: Value) -> Value {
    if value.is_null() {
        fallback
    } else {
        value.clone()
    }
}
fn note(value: &Value) -> Result<Value, InputError> {
    if value.is_null() {
        Ok(Value::Null)
    } else {
        value
            .as_str()
            .map(trim_javascript)
            .map(|text| {
                if text.is_empty() {
                    Value::Null
                } else {
                    json!(text)
                }
            })
            .ok_or_else(|| invalid("Die Notiz ist ungültig."))
    }
}
fn symbol(value: &Value) -> Result<String, InputError> {
    let value = require_non_empty(value, "Symbol")?;
    // Do not replace a source UTF-16 slice that cuts an isolated surrogate.
    String::from_utf16(&value.encode_utf16().take(4).collect::<Vec<_>>())
        .map_err(|_| invalid("Das Symbol enthält ein unvollständiges Zeichen."))
}
fn shift_type(value: &Value) -> Result<(), InputError> {
    if value.as_str().is_some_and(|v| {
        [
            "EARLY", "LATE", "NIGHT", "DAY", "TRAINING", "VACATION", "SICK", "FREE", "CUSTOM",
        ]
        .contains(&v)
    }) {
        Ok(())
    } else {
        Err(invalid("Unbekannte Dienstart."))
    }
}
const DUTY_PARENT: &str = "Bitte prüfe die Zeiten des Sonderdienstes. Teile dürfen sich nicht überlappen; Einsätze müssen innerhalb der Rufbereitschaft liegen. Nicht eindeutige Uhrzeiten bei der Zeitumstellung bitte korrigieren.";
fn duty(input: &Value) -> Result<Option<Value>, InputError> {
    let duty = special_duty::validate_special_duty(input.get("specialDuty"))?;
    special_duty::validate_duty_parent(duty.as_ref(), input).map_err(|_| invalid(DUTY_PARENT))?;
    Ok(duty)
}
fn times(
    input: &Value,
    base: &mut Value,
    has_duty: bool,
    default_break: bool,
) -> Result<(), InputError> {
    let start = require_local_time(&default(&input["startTime"], json!("")))?;
    let end = require_local_time(&default(&input["endTime"], json!("")))?;
    if !has_duty && start == end {
        return Err(invalid("Beginn und Ende dürfen nicht identisch sein."));
    }
    let pause = if js_truthy(&base["allDay"]) {
        json!(0)
    } else {
        let value = if default_break {
            default(&input["breakMinutes"], json!(0))
        } else {
            input["breakMinutes"].clone()
        };
        range(
            &value,
            1440.0,
            "Die Pause muss zwischen 0 und 1.440 Minuten liegen.",
        )?;
        value
    };
    base["startTime"] = json!(start);
    base["endTime"] = json!(end);
    base["breakMinutes"] = pause;
    Ok(())
}
pub fn validate_shift(input: &Value) -> Result<Value, InputError> {
    if js_truthy(&input["specialDuty"])
        && input["specialDuty"]["kind"] != "SPLIT"
        && input["overtimeMinutes"].as_f64().is_some_and(|n| n > 0.0)
    {
        return Err(invalid(
            "Überstunden bei Sonderdiensten sind noch nicht zugeordnet. Erfasse hier nur die tatsächlichen Zeiten.",
        ));
    }
    let special = duty(input)?;
    shift_type(&input["type"])?;
    let mut base = record(input)?;
    if input.get("specialDuty").is_some() {
        base["specialDuty"] = special.clone().unwrap_or(Value::Null);
    }
    base["allDay"] = default(&input["allDay"], json!(false));
    base["date"] = json!(require_local_date(&input["date"])?);
    base["title"] = json!(require_non_empty(&input["title"], "Bezeichnung")?);
    base["color"] = json!(require_color(&input["color"])?);
    base["symbol"] = json!(symbol(&input["symbol"])?);
    base["note"] = note(&input["note"])?;
    base["notification"] = notification(&input["notification"])?;
    base["alarmEnabled"] = default(&input["alarmEnabled"], json!(false));
    base["location"] = location(&input["location"])?;
    base["overtimeMinutes"] = default(&input["overtimeMinutes"], json!(0));
    base["tariffOvertimeConfirmed"] = default(&input["tariffOvertimeConfirmed"], json!(false));
    base["holidayPremiumMode"] = default(&input["holidayPremiumMode"], json!("WITH_TIME_OFF"));
    range(
        &base["overtimeMinutes"],
        1440.0,
        "Überstunden müssen zwischen 0 und 1.440 Minuten liegen.",
    )?;
    if !base["alarmEnabled"].is_boolean() {
        return Err(invalid("Die Weckereinstellung ist ungültig."));
    }
    if !base["tariffOvertimeConfirmed"].is_boolean() {
        return Err(invalid(
            "Die Bestätigung der Tarifüberstunden ist ungültig.",
        ));
    }
    if !base["holidayPremiumMode"]
        .as_str()
        .is_some_and(|v| ["WITH_TIME_OFF", "WITHOUT_TIME_OFF"].contains(&v))
    {
        return Err(invalid("Ungültige Feiertagsoption."));
    }
    if ["VACATION", "SICK", "FREE"]
        .iter()
        .any(|kind| input["type"] == *kind)
    {
        base["allDay"] = json!(true);
        base["startTime"] = Value::Null;
        base["endTime"] = Value::Null;
        base["breakMinutes"] = json!(0);
        base["overtimeMinutes"] = json!(0);
        base["tariffOvertimeConfirmed"] = json!(false);
    } else {
        times(input, &mut base, special.is_some(), true)?;
    }
    Ok(base)
}
pub fn validate_template(input: &Value) -> Result<Value, InputError> {
    if !input["specialDuty"]["standbyAgreement"]["sequence"].is_null() {
        return Err(invalid(
            "Die Monatsnummer gehört in den Kalendereintrag, nicht in die Vorlage.",
        ));
    }
    if input["specialDuty"]["callouts"]
        .as_array()
        .is_some_and(|v| !v.is_empty())
        || js_truthy(&input["specialDuty"]["calloutsComplete"])
    {
        return Err(invalid(
            "Tatsächliche Einsätze gehören nicht in eine Dienstvorlage.",
        ));
    }
    let special = duty(input)?;
    shift_type(&input["type"])?;
    let mut base = record(input)?;
    if input.get("specialDuty").is_some() {
        base["specialDuty"] = special.clone().unwrap_or(Value::Null);
    }
    base["allDay"] = default(&input["allDay"], json!(false));
    base["name"] = json!(require_non_empty(&input["name"], "Name")?);
    base["color"] = json!(require_color(&input["color"])?);
    base["symbol"] = json!(symbol(&input["symbol"])?);
    base["notification"] = notification(&input["notification"])?;
    base["location"] = location(&input["location"])?;
    if ["VACATION", "SICK", "FREE"]
        .iter()
        .any(|kind| input["type"] == *kind)
    {
        base["allDay"] = json!(true);
        base["startTime"] = Value::Null;
        base["endTime"] = Value::Null;
        base["breakMinutes"] = json!(0);
    } else {
        times(input, &mut base, special.is_some(), false)?;
    }
    Ok(base)
}
pub fn validate_appointment(input: &Value) -> Result<Value, InputError> {
    let mut base = record(input)?;
    base["date"] = json!(require_local_date(&input["date"])?);
    base["title"] = json!(require_non_empty(&input["title"], "Titel")?);
    base["color"] = json!(require_color(&input["color"])?);
    base["note"] = note(&input["note"])?;
    base["recurrence"] = recurrence(&input["recurrence"])?;
    base["notification"] = notification(&input["notification"])?;
    base["location"] = location(&input["location"])?;
    if js_truthy(&input["allDay"]) {
        base["startTime"] = Value::Null;
        base["endTime"] = Value::Null;
    } else {
        let start = require_local_time(&default(&input["startTime"], json!("")))?;
        let end = require_local_time(&default(&input["endTime"], json!("")))?;
        if end <= start {
            return Err(invalid(
                "Ein Termin muss am selben Tag nach seinem Beginn enden.",
            ));
        }
        base["startTime"] = json!(start);
        base["endTime"] = json!(end);
    }
    Ok(base)
}
