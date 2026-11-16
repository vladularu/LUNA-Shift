use super::PdfError;
use crate::{
    calendar::sharing::{utf16_len, utf16_prefix},
    input::{form_number::round, javascript_json::number_text},
    report::time_display::format::precise,
};
use serde_json::{Value, json};

pub(super) fn text(raw: &str) -> Value {
    json!(raw.encode_utf16().collect::<Vec<_>>())
}
pub(super) fn short(raw: &str, max: usize) -> Value {
    let mut units = utf16_prefix(raw, max);
    if utf16_len(raw) > max {
        units.truncate(max - 1);
        units.push(0x2026);
    }
    json!(units)
}
pub(super) fn string<'a>(facts: &'a Value, key: &str) -> &'a str {
    facts[key].as_str().unwrap_or("")
}
pub(super) fn number(facts: &Value, key: &str) -> Option<f64> {
    facts[key].as_f64()
}
pub(super) fn boolean(facts: &Value, key: &str) -> bool {
    facts[key].as_bool() == Some(true)
}
pub(super) fn optional_text(raw: &str) -> Value {
    if raw.is_empty() {
        Value::Null
    } else {
        text(raw)
    }
}
pub(super) fn finite(value: f64) -> Result<f64, PdfError> {
    value.is_finite().then_some(value).ok_or(PdfError)
}
pub(super) fn minutes(value: Option<f64>, signed: bool) -> Result<String, PdfError> {
    let Some(value) = value else {
        return Ok("Nicht verfügbar".into());
    };
    finite(value)?;
    let absolute = value.abs();
    let remainder = number_text(round(absolute) % 60.0);
    Ok(format!(
        "{}{}:{}{} h",
        if value < 0.0 {
            "-"
        } else if signed && value > 0.0 {
            "+"
        } else {
            ""
        },
        number_text((absolute / 60.0).floor()),
        if remainder.len() < 2 { "0" } else { "" },
        remainder
    ))
}
pub(super) fn account(value: Option<f64>, signed: bool) -> Result<String, PdfError> {
    let Some(value) = value else {
        return Ok("Noch offen".into());
    };
    Ok(format!(
        "{}{} h",
        if signed && value >= 0.0 { "+" } else { "" },
        precise(value).map_err(|_| PdfError)?
    ))
}
pub(super) fn money(value: Option<f64>) -> Result<Value, PdfError> {
    match value {
        None => Ok(display_text("Nicht verfügbar")),
        Some(value) => {
            finite(value)?;
            Ok(
                json!({"kind":"MONEY","amount":{"euros":value,"fractionDigits":2,"negativeZero":value==0.0&&value.is_sign_negative()}}),
            )
        }
    }
}
pub(super) fn prepared_money(value: &Value) -> Value {
    if value.is_object() {
        json!({"kind":"MONEY","amount":value})
    } else {
        display_text(value.as_str().unwrap_or("Nicht verfügbar"))
    }
}
pub(super) fn display_text(raw: &str) -> Value {
    json!({"kind":"TEXT","text":text(raw)})
}
pub(super) fn date(raw: &str) -> Vec<u16> {
    let units = raw.encode_utf16().collect::<Vec<_>>();
    let mut result = units.iter().skip(8).take(2).copied().collect::<Vec<_>>();
    result.push(u16::from(b'.'));
    result.extend(units.iter().skip(5).take(2).copied());
    result.push(u16::from(b'.'));
    result.extend(units.iter().take(4).copied());
    result
}
pub(super) fn day(raw: &str) -> Value {
    json!(date(raw).into_iter().take(5).collect::<Vec<_>>())
}
