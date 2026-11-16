use super::ValidationIssue;
use jiff::{ToSpan, civil::Date};
use serde_json::Value;
use std::collections::HashSet;
pub(super) fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}
pub(super) fn n(v: &Value, key: &str) -> f64 {
    v[key].as_f64().unwrap_or(0.0)
}
pub(super) fn a(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or(&[])
}
pub(super) fn issue(
    issues: &mut Vec<ValidationIssue>,
    code: &str,
    path: impl Into<String>,
    message: impl Into<String>,
) {
    issues.push(ValidationIssue {
        code: code.to_owned(),
        path: path.into(),
        message: message.into(),
    });
}
pub(super) fn real_date(value: &str) -> bool {
    value.len() == 10
        && value.as_bytes().iter().enumerate().all(|(i, b)| {
            if i == 4 || i == 7 {
                *b == b'-'
            } else {
                b.is_ascii_digit()
            }
        })
        && value.parse::<Date>().is_ok_and(|d| d.to_string() == value)
}
pub(super) fn real_utc(value: &str) -> bool {
    value.get(..10).is_some_and(real_date) && value.parse::<jiff::Timestamp>().is_ok()
}
pub(super) fn next_date(value: &str) -> Option<String> {
    value
        .parse::<Date>()
        .ok()?
        .checked_add(1.days())
        .ok()
        .map(|d| d.to_string().chars().take(10).collect())
}
pub(super) fn date(value: &str, path: &str, issues: &mut Vec<ValidationIssue>) {
    if !real_date(value) {
        issue(
            issues,
            "INVALID_DATE",
            path,
            format!("Invalid calendar date: {value}."),
        );
    }
}
pub(super) fn range(from: &str, until: &Value, path: &str, issues: &mut Vec<ValidationIssue>) {
    date(from, &format!("{path}/validFrom"), issues);
    if let Some(until) = until.as_str() {
        date(until, &format!("{path}/validTo"), issues);
        if real_date(from) && real_date(until) && from > until {
            issue(
                issues,
                "INVALID_DATE_RANGE",
                path,
                "validFrom must not be later than validTo.",
            );
        }
    }
}
pub(super) fn duplicates<'a>(
    values: impl IntoIterator<Item = &'a str>,
    path: &str,
    label: &str,
    issues: &mut Vec<ValidationIssue>,
) {
    let mut seen = HashSet::new();
    let mut repeated = HashSet::new();
    for value in values {
        if !seen.insert(value) && repeated.insert(value) {
            issue(
                issues,
                "DUPLICATE_ID",
                path,
                format!("Duplicate {label}: {value}."),
            );
        }
    }
}
pub(super) fn references(
    values: &Value,
    known: &HashSet<&str>,
    path: &str,
    issues: &mut Vec<ValidationIssue>,
) {
    for id in a(values).iter().filter_map(Value::as_str) {
        if !known.contains(id) {
            issue(
                issues,
                "UNKNOWN_SOURCE_ID",
                path,
                format!("Unknown source reference: {id}."),
            );
        }
    }
}
pub(super) fn package_common(package: &Value) -> Vec<ValidationIssue> {
    let mut issues = vec![];
    range(
        s(package, "validFrom"),
        &package["validTo"],
        "",
        &mut issues,
    );
    if package["status"] != package["review"]["status"] {
        issue(
            &mut issues,
            "REVIEW_STATUS_MISMATCH",
            "/review/status",
            "Package status and review status must match.",
        );
    }
    if let Some(timestamp) = package["review"]["reviewedAt"].as_str()
        && !real_utc(timestamp)
    {
        issue(
            &mut issues,
            "INVALID_TIMESTAMP",
            "/review/reviewedAt",
            "Invalid UTC review timestamp.",
        );
    }
    duplicates(
        a(&package["sources"]).iter().map(|v| s(v, "id")),
        "/sources",
        "source id",
        &mut issues,
    );
    for (i, source) in a(&package["sources"]).iter().enumerate() {
        date(
            s(source, "documentDate"),
            &format!("/sources/{i}/documentDate"),
            &mut issues,
        );
        if !url::Url::parse(s(source, "url")).is_ok_and(|url| url.scheme() == "https") {
            issue(
                &mut issues,
                "INVALID_SOURCE_URL",
                format!("/sources/{i}/url"),
                "Source URL must be valid HTTPS.",
            );
        }
    }
    issues
}
