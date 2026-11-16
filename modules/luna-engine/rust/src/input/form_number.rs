//! Original ECMAScript text-to-number policy used by raw editor fields.
use super::InputError;
use num_bigint::BigUint;
use num_traits::ToPrimitive;
pub fn trim(value: &str) -> &str {
    value.trim_matches(|ch:char|matches!(ch,'\u{0009}'..='\u{000d}'|'\u{0020}'|'\u{00a0}'|'\u{1680}'|'\u{2000}'..='\u{200a}'|'\u{2028}'|'\u{2029}'|'\u{202f}'|'\u{205f}'|'\u{3000}'|'\u{feff}'))
}
pub fn number(value: &str) -> f64 {
    let value = trim(value);
    if value.is_empty() {
        return 0.0;
    }
    for (prefix, radix) in [
        ("0x", 16),
        ("0X", 16),
        ("0b", 2),
        ("0B", 2),
        ("0o", 8),
        ("0O", 8),
    ] {
        if let Some(digits) = value.strip_prefix(prefix) {
            if digits.is_empty()
                || !digits
                    .bytes()
                    .all(|digit| (digit as char).is_digit(radix) && digit.is_ascii())
            {
                return f64::NAN;
            }
            return BigUint::parse_bytes(digits.as_bytes(), radix)
                .map_or(f64::NAN, |v| v.to_f64().unwrap_or(f64::INFINITY));
        }
    }
    match value {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    if value
        .bytes()
        .any(|byte| byte.is_ascii_alphabetic() && !matches!(byte, b'e' | b'E'))
    {
        return f64::NAN;
    }
    value.parse::<f64>().unwrap_or(f64::NAN)
}
pub fn round(value: f64) -> f64 {
    if value.fract() == -0.5 {
        value.ceil()
    } else {
        value.round()
    }
}
pub fn parse_weekly_hours(value: &str) -> Result<f64, InputError> {
    let value = number(&trim(value).replacen(',', ".", 1));
    if !value.is_finite() {
        return Err(InputError::source(
            "Bitte gültige Wochenstunden angeben.",
            "Error",
        ));
    }
    Ok(round(value * 60.0))
}
pub fn weekly_hours_error(value: &str) -> Option<&'static str> {
    let value = number(&value.replacen(',', ".", 1));
    if !value.is_finite() {
        return Some("Bitte gültige Wochenstunden angeben.");
    }
    let minutes = round(value * 60.0);
    if !(60.0..=4800.0).contains(&minutes) {
        Some("Die Wochenarbeitszeit muss zwischen 1 und 80 Stunden liegen.")
    } else {
        None
    }
}
