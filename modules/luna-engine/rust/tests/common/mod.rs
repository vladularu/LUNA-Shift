use bigdecimal::BigDecimal;
use serde_json::Value;
use std::str::FromStr;

/// JSON has one number type. Ignore only its integer/decimal spelling (3 vs 3.0),
/// never a differing numeric value, missing field, array position or status.
pub fn assert_json_eq(actual: &Value, expected: &Value, path: &str) {
    match (actual, expected) {
        (Value::Number(a), Value::Number(b)) => assert_eq!(
            BigDecimal::from_str(&a.to_string()).unwrap(),
            BigDecimal::from_str(&b.to_string()).unwrap(),
            "{path}"
        ),
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{path}.length");
            for (index, (a, b)) in a.iter().zip(b).enumerate() {
                assert_json_eq(a, b, &format!("{path}[{index}]"));
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.len(), b.len(), "{path}.keys");
            for (key, a) in a {
                let path = format!("{path}.{key}");
                let b = b.get(key).unwrap_or_else(|| panic!("Missing {path}"));
                assert_json_eq(a, b, &path);
            }
        }
        _ => assert_eq!(actual, expected, "{path}"),
    }
}
