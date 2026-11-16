//! Retained-string Temporal Instant validation. Gregorian 400-year cycles let
//! the pinned parser validate far-year syntax without narrowing Temporal's
//! ±100-million-day range to Jiff's civil-year representation.
use std::borrow::Cow;
const SECOND: i128 = 1_000_000_000;
const MAX: i128 = 8_640_000_000_000_000_000_000;

pub(super) fn nanoseconds(raw: &str) -> Option<i128> {
    if raw.contains('−') || raw.starts_with("-000000") {
        return None;
    }
    let signed = matches!(raw.as_bytes().first(), Some(b'+' | b'-'));
    let width = if signed { 7 } else { 4 };
    let year = raw.get(..width)?.parse::<i32>().ok()?;
    let (parsed, cycles) = if !(-9999..=9999).contains(&year) {
        let surrogate = 2000 + year.rem_euclid(400);
        (
            Cow::Owned(format!("{surrogate:04}{}", raw.get(width..)?)),
            i128::from((year - surrogate) / 400),
        )
    } else {
        (Cow::Borrowed(raw), 0)
    };
    let split = parsed.find(['T', 't', ' '])?;
    let annotation = parsed.find('[').unwrap_or(parsed.len());
    let time = parsed.get(split + 1..annotation)?;
    let offset_at = time.rfind(['+', '-']).map(|at| split + 1 + at);
    let mut adjustment = 0;
    let mut whole = parsed.clone();
    if let Some(at) = offset_at {
        let offset = parsed.get(at + 1..annotation)?;
        let (integral, fraction) = offset
            .split_once(['.', ','])
            .map_or((offset, None), |(integral, fraction)| {
                (integral, Some(fraction))
            });
        let digits: String = integral.chars().filter(|c| *c != ':').collect();
        if ![2, 4, 6].contains(&digits.len()) || !digits.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        if digits.get(..2)?.parse::<u32>().ok()? > 23
            || digits
                .get(2..4)
                .is_some_and(|value| value.parse::<u32>().map_or(true, |value| value > 59))
            || digits
                .get(4..6)
                .is_some_and(|value| value.parse::<u32>().map_or(true, |value| value > 59))
        {
            return None;
        }
        if let Some(fraction) = fraction {
            if digits.len() != 6
                || fraction.is_empty()
                || fraction.len() > 9
                || !fraction.bytes().all(|b| b.is_ascii_digit())
            {
                return None;
            }
            let fraction =
                i128::from(fraction.parse::<u32>().ok()?) * 10_i128.pow(9 - fraction.len() as u32);
            adjustment = if parsed.as_bytes()[at] == b'+' {
                -fraction
            } else {
                fraction
            };
            whole = Cow::Owned(format!(
                "{}{}",
                parsed.get(..at + 1 + integral.len())?,
                parsed.get(annotation..)?
            ));
        }
    }
    let timestamp: jiff::Timestamp = whole.parse().ok()?;
    let result = timestamp.as_nanosecond() + adjustment + cycles * 146097 * 86400 * SECOND;
    (-MAX..=MAX).contains(&result).then_some(result)
}

pub(super) fn javascript_milliseconds(raw: &str) -> Option<i128> {
    if raw.contains('[') {
        return None;
    }
    let (date, time) = raw.split_once(['T', 't', ' '])?;
    let year = if matches!(date.as_bytes().first(), Some(b'+' | b'-')) {
        7
    } else {
        4
    };
    let rest = date.as_bytes().get(year..)?;
    if rest.len() != 6
        || rest[0] != b'-'
        || rest[3] != b'-'
        || !rest[1..3].iter().chain(&rest[4..]).all(u8::is_ascii_digit)
    {
        return None;
    }
    let body = if time.ends_with(['Z', 'z']) {
        time.get(..time.len() - 1)?
    } else {
        let at = time.rfind(['+', '-'])?;
        let offset = time.get(at + 1..)?;
        if !(offset.len() == 4 && offset.bytes().all(|b| b.is_ascii_digit())
            || offset.len() == 5
                && offset.as_bytes()[2] == b':'
                && offset.as_bytes()[..2]
                    .iter()
                    .chain(&offset.as_bytes()[3..])
                    .all(u8::is_ascii_digit))
        {
            return None;
        }
        time.get(..at)?
    };
    let (clock, fraction) = body
        .split_once('.')
        .map_or((body, None), |(clock, fraction)| (clock, Some(fraction)));
    let bytes = clock.as_bytes();
    if ![5, 8].contains(&bytes.len())
        || bytes[2] != b':'
        || bytes.len() == 8 && (bytes[5] != b':' || &bytes[6..] == b"60")
        || !bytes.iter().enumerate().all(|(at, byte)| {
            if [2, 5].contains(&at) {
                *byte == b':'
            } else {
                byte.is_ascii_digit()
            }
        })
    {
        return None;
    }
    if fraction.is_some_and(|fraction| {
        bytes.len() != 8
            || fraction.is_empty()
            || !fraction.bytes().all(|byte| byte.is_ascii_digit())
    }) {
        return None;
    }
    nanoseconds(raw).map(|nanoseconds| nanoseconds.div_euclid(1_000_000))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    #[test]
    fn epoch_nanoseconds_match_original_temporal_at_offset_and_full_range_edges() {
        let data: Value = serde_json::from_str(include_str!(
            "../../../reference/input-employment-golden.json"
        ))
        .unwrap();
        let cases: Vec<_> = data["cases"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|case| case["operation"] == "preciseInstantNanoseconds")
            .collect();
        assert_eq!(cases.len(), 26);
        for case in cases {
            let actual = match nanoseconds(case["input"].as_str().unwrap()) {
                Some(value) => json!({"value":value.to_string()}),
                None => {
                    json!({"$error":"Zeitstempel enthält keinen gültigen Zeitstempel.","name":"ValidationError"})
                }
            };
            assert_eq!(actual, case["expected"], "{}", case["id"]);
        }
    }
}
