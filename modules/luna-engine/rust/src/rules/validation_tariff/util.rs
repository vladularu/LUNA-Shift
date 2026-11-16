use crate::rules::validation::ValidationIssue;
use serde_json::Value;
use std::collections::BTreeSet;
pub(super) fn a(value: &Value) -> &[Value] {
    value.as_array().map(Vec::as_slice).unwrap_or(&[])
}
pub(super) fn rows<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v.get(key).map(a).unwrap_or(&[])
}
pub(super) fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}
pub(super) fn n(v: &Value, key: &str) -> f64 {
    v.get(key).and_then(Value::as_f64).unwrap_or(f64::NAN)
}
pub(super) fn truth(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(v)) => *v,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|n| n != 0.0),
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(_) | Value::Object(_)) => true,
    }
}
pub(super) fn issue(
    issues: &mut Vec<ValidationIssue>,
    code: &str,
    path: impl Into<String>,
    message: impl Into<String>,
) {
    issues.push(ValidationIssue {
        code: code.into(),
        path: path.into(),
        message: message.into(),
    });
}
pub(super) fn sources(pkg: &Value) -> BTreeSet<&str> {
    a(&pkg["sources"])
        .iter()
        .map(|source| s(source, "id"))
        .collect()
}
pub(super) fn valid_date(value: &str) -> bool {
    value
        .parse::<jiff::civil::Date>()
        .is_ok_and(|date| date.to_string() == value)
}
pub(super) fn next_date(value: &str) -> Option<String> {
    let date = value.parse::<jiff::civil::Date>().ok()?;
    if date.to_string() != value {
        return None;
    }
    let (mut year, mut month, mut day) = (i32::from(date.year()), date.month(), date.day());
    if day < date.days_in_month() {
        day += 1;
    } else {
        day = 1;
        if month < 12 {
            month += 1;
        } else {
            month = 1;
            year += 1;
        }
    }
    let year = if (0..=9999).contains(&year) {
        format!("{year:04}")
    } else if year < 0 {
        format!("-{:06}", -year)
    } else {
        format!("+{year:06}")
    };
    Some(format!("{year}-{month:02}-{day:02}"))
}
pub(super) fn after(value: &Value) -> Option<String> {
    value.as_str().and_then(next_date)
}
pub(super) fn unique_strings(values: impl Iterator<Item = String>) -> Vec<String> {
    let mut result = vec![];
    for value in values {
        if !result.contains(&value) {
            result.push(value)
        }
    }
    result
}
