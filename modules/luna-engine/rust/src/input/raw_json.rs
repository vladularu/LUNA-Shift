//! Native stored-JSON decoding. Chunks preserve original text at the I/O
//! boundary without forcing the UI to parse or validate calculation settings.
use crate::contract::{self, ContractError};
use serde_json::Value;
const CHUNK_BYTES: usize = 65_536;
pub(crate) fn exact_sql_columns(value: &Value, columns: &[&str], json_columns: &[&str]) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.len() == columns.len()
        && columns.iter().all(|column| {
            let chunked =
                json_columns.contains(column) && object.contains_key(&format!("{column}_chunks"));
            if chunked {
                !object.contains_key(*column)
            } else {
                object.contains_key(*column)
            }
        })
}
pub(crate) fn sql_json_is_text(row: &Value, column: &str) -> bool {
    row.get(column).is_some_and(Value::is_string)
        || row
            .get(format!("{column}_chunks"))
            .is_some_and(Value::is_array)
}
/// Alternate representation of the same original SQL text, never host-parsed
/// settings. Both representations together are ambiguous and rejected.
pub(crate) fn parse_sql_json(row: &Value, column: &str) -> Result<Value, ContractError> {
    if let Some(chunks) = row.get(format!("{column}_chunks")) {
        if row.get(column).is_some() {
            return Err(ContractError::MalformedEnvelope);
        }
        parse_chunks(chunks)
    } else {
        parse(
            row.get(column)
                .and_then(Value::as_str)
                .ok_or(ContractError::MalformedEnvelope)?,
        )
    }
}
pub(crate) fn normalize_integral_numbers(value: &mut Value) {
    match value {
        Value::Number(number) if number.is_f64() => {
            if let Some(n) = number.as_f64().filter(|n| {
                n.is_finite()
                    && n.fract() == 0.0
                    && n.abs() <= crate::money::MAX_SAFE_INTEGER as f64
            }) {
                *value = Value::from(n as i64);
            }
        }
        Value::Array(values) => {
            for value in values {
                normalize_integral_numbers(value);
            }
        }
        Value::Object(map) => {
            for value in map.values_mut() {
                normalize_integral_numbers(value);
            }
        }
        _ => {}
    }
}
pub(crate) fn parse(text: &str) -> Result<Value, ContractError> {
    let mut value = contract::bounded_json(text.as_bytes())?;
    normalize_integral_numbers(&mut value);
    Ok(value)
}
pub(crate) fn parse_chunks(value: &Value) -> Result<Value, ContractError> {
    let chunks = value
        .as_array()
        .filter(|v| !v.is_empty() && v.len() <= 512)
        .ok_or(ContractError::MalformedEnvelope)?;
    let mut size = 0usize;
    for chunk in chunks {
        let chunk = chunk
            .as_str()
            .filter(|s| s.len() <= CHUNK_BYTES)
            .ok_or(ContractError::StringTooLarge)?;
        size = size
            .checked_add(chunk.len())
            .ok_or(ContractError::InputTooLarge)?;
        if size > contract::MAX_INPUT_BYTES as usize {
            return Err(ContractError::InputTooLarge);
        }
    }
    let mut text = String::with_capacity(size);
    for chunk in chunks {
        text.push_str(chunk.as_str().unwrap());
    }
    parse(&text)
}

/// Classify a rejected stored JSON number without admitting a non-finite
/// value. Substitution is used only to prove syntax; no substituted tree is
/// returned to a producer. Quoted text is copied byte-for-byte.
pub(crate) fn sql_json_number_overflow(row: &Value, column: &str) -> bool {
    let text = if let Some(text) = row.get(column).and_then(Value::as_str) {
        std::borrow::Cow::Borrowed(text)
    } else if let Some(parts) = row
        .get(format!("{column}_chunks"))
        .and_then(Value::as_array)
    {
        let mut text = String::new();
        for part in parts {
            let Some(part) = part.as_str() else {
                return false;
            };
            if text.len().saturating_add(part.len()) > contract::MAX_INPUT_BYTES as usize {
                return false;
            }
            text.push_str(part);
        }
        std::borrow::Cow::Owned(text)
    } else {
        return false;
    };
    if text.len() > contract::MAX_INPUT_BYTES as usize {
        return false;
    }
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let (mut at, mut found) = (0, false);
    while at < bytes.len() {
        if bytes[at] == b'"' {
            let start = at;
            at += 1;
            while at < bytes.len() {
                let c = bytes[at];
                at += 1;
                if c == b'\\' {
                    if at < bytes.len() {
                        at += 1
                    }
                } else if c == b'"' {
                    break;
                }
            }
            out.extend_from_slice(&bytes[start..at]);
            continue;
        }
        if bytes[at] == b'-' || bytes[at].is_ascii_digit() {
            let start = at;
            let mut end = at;
            if bytes[end] == b'-' {
                end += 1;
            }
            let integer_start = end;
            if end < bytes.len() && bytes[end] == b'0' {
                end += 1;
            } else {
                while end < bytes.len() && bytes[end].is_ascii_digit() {
                    end += 1;
                }
            }
            let mut valid = end > integer_start;
            if end < bytes.len() && bytes[end] == b'.' {
                end += 1;
                let fraction_start = end;
                while end < bytes.len() && bytes[end].is_ascii_digit() {
                    end += 1;
                }
                valid &= end > fraction_start;
            }
            if end < bytes.len() && matches!(bytes[end], b'e' | b'E') {
                end += 1;
                if end < bytes.len() && matches!(bytes[end], b'+' | b'-') {
                    end += 1;
                }
                let exponent_start = end;
                while end < bytes.len() && bytes[end].is_ascii_digit() {
                    end += 1;
                }
                valid &= end > exponent_start;
            }
            if valid
                && end > start
                && text[start..end]
                    .parse::<f64>()
                    .is_ok_and(|n| !n.is_finite())
            {
                out.extend_from_slice(b"null");
                found = true;
            } else {
                out.extend_from_slice(&bytes[start..end]);
            }
            at = end.max(start + 1);
            continue;
        }
        out.push(bytes[at]);
        at += 1;
    }
    found && contract::bounded_json(&out).is_ok()
}
#[cfg(test)]
mod overflow_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn overflow_is_a_validation_failure_only_for_complete_json_number_tokens() {
        for text in [r#"{"version":1e999}"#, r#"[-1e999,0]"#] {
            assert!(sql_json_number_overflow(&json!({"v":text}), "v"));
            assert!(sql_json_number_overflow(
                &json!({"v_chunks":[&text[..5],&text[5..]]}),
                "v"
            ));
        }
        for text in [
            r#"{"text":"1e999"}"#,
            r#"{"v":1e999x}"#,
            r#"{"v":01e999}"#,
            r#"{"v":--1e999}"#,
            r#"{"v":-.1e999}"#,
            r#"{"v":1.e999}"#,
            r#"{"v":1e999,"#,
            r#"{"v":"\\\"1e999"}"#,
        ] {
            assert!(!sql_json_number_overflow(&json!({"v":text}), "v"), "{text}");
        }
    }
}
