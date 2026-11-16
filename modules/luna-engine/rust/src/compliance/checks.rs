//! Native check taxonomy and lossless report display projection. No host wire operation
//! accepts completed reports; these helpers consume results already produced in Rust.
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckCounts {
    pub critical_count: u64,
    pub warning_count: u64,
    pub info_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prerequisite_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tariff_prerequisite_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope_count: Option<u64>,
}
#[derive(Debug, Clone, Default, Serialize)]
pub struct ClassifiedCheckCounts {
    pub legal: CheckCounts,
    pub planning: CheckCounts,
}
#[derive(Debug)]
pub enum CheckDisplayError {
    InvalidReport,
    Overflow,
}
impl std::fmt::Display for CheckDisplayError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::InvalidReport => "Die nativen Prüfergebnisse sind unvollständig.",
            Self::Overflow => "Die Anzahl der Prüfhinweise ist zu groß.",
        })
    }
}
impl std::error::Error for CheckDisplayError {}
pub fn is_check_scope_notice(issue: &Value) -> bool {
    issue["rule"] == "SPECIAL_DUTY_REVIEW" && issue["severity"] != "critical"
}
pub fn is_check_prerequisite(issue: &Value) -> bool {
    issue["severity"] != "critical"
        && matches!(
            issue["rule"].as_str(),
            Some(
                "ARBZG_DATA_ALL_EMPLOYMENT"
                    | "ARBZG_6_NIGHT_STATUS_UNKNOWN"
                    | "HOLIDAY_REGION_UNKNOWN"
                    | "ARBZG_10_ELIGIBILITY"
                    | "TARIFF_SCOPE"
            )
        )
}
fn retired(issue: &Value) -> bool {
    issue["kind"] == "PLANNING" && issue["rule"] == "PLANNING_WEEKENDS"
}
fn count_iter<'a>(issues: impl Iterator<Item = &'a Value>) -> CheckCounts {
    let mut result = CheckCounts::default();
    let (mut prerequisites, mut tariff, mut scope) = (0, 0, false);
    for issue in issues {
        let prerequisite = is_check_prerequisite(issue);
        let notice = is_check_scope_notice(issue);
        if prerequisite {
            prerequisites += 1;
            if issue["rule"] == "TARIFF_SCOPE" {
                tariff += 1;
            }
        }
        scope |= notice;
        if retired(issue) || prerequisite || notice {
            continue;
        }
        match issue["severity"].as_str() {
            Some("critical") => result.critical_count += 1,
            Some("warning") => result.warning_count += 1,
            Some("info") => result.info_count += 1,
            _ => {}
        }
    }
    result.prerequisite_count = (prerequisites > 0).then_some(prerequisites);
    result.tariff_prerequisite_count = (tariff > 0).then_some(tariff);
    result.scope_count = scope.then_some(1);
    result
}
pub fn count_checks(issues: &[Value]) -> CheckCounts {
    count_iter(issues.iter())
}
pub fn classify_checks(issues: &[Value]) -> ClassifiedCheckCounts {
    ClassifiedCheckCounts {
        legal: count_iter(issues.iter().filter(|i| i["kind"] != "PLANNING")),
        planning: count_iter(issues.iter().filter(|i| i["kind"] == "PLANNING")),
    }
}
pub fn is_check_limited(counts: &CheckCounts) -> bool {
    counts.prerequisite_count.unwrap_or(0) > 0 || counts.scope_count.unwrap_or(0) > 0
}
pub fn add_check_counts(
    a: &CheckCounts,
    b: &CheckCounts,
) -> Result<CheckCounts, CheckDisplayError> {
    let sum = |a: u64, b: u64| a.checked_add(b).ok_or(CheckDisplayError::Overflow);
    let optional = |a: Option<u64>, b: Option<u64>| -> Result<Option<u64>, CheckDisplayError> {
        let value = sum(a.unwrap_or(0), b.unwrap_or(0))?;
        Ok((value != 0).then_some(value))
    };
    Ok(CheckCounts {
        critical_count: sum(a.critical_count, b.critical_count)?,
        warning_count: sum(a.warning_count, b.warning_count)?,
        info_count: sum(a.info_count, b.info_count)?,
        prerequisite_count: optional(a.prerequisite_count, b.prerequisite_count)?,
        tariff_prerequisite_count: optional(
            a.tariff_prerequisite_count,
            b.tariff_prerequisite_count,
        )?,
        scope_count: optional(a.scope_count, b.scope_count)?,
    })
}
pub fn select_visible_compliance(
    report: &Value,
    show_planning: bool,
) -> Result<Value, CheckDisplayError> {
    let original = unique_by_id(
        optional_array(report, "scopeNotes")?
            .iter()
            .chain(required_array(report, "issues")?),
    )?
    .into_iter()
    .filter(|i| !retired(i))
    .collect::<Vec<_>>();
    let scope = unique_by_id(
        original
            .iter()
            .copied()
            .filter(|i| is_check_scope_notice(i)),
    )?;
    let prerequisites = unique_by_id(
        optional_array(report, "prerequisites")?
            .iter()
            .chain(
                original
                    .iter()
                    .copied()
                    .filter(|i| is_check_prerequisite(i)),
            )
            .filter(|i| !retired(i)),
    )?;
    let issues = original
        .into_iter()
        .filter(|i| {
            !is_check_prerequisite(i)
                && !is_check_scope_notice(i)
                && (show_planning || i["kind"] != "PLANNING")
        })
        .cloned()
        .collect::<Vec<_>>();
    let mut output = report
        .as_object()
        .ok_or(CheckDisplayError::InvalidReport)?
        .clone();
    for key in [
        "scopeNotes",
        "scopeCount",
        "prerequisites",
        "prerequisiteCount",
        "tariffPrerequisiteCount",
    ] {
        output.remove(key);
    }
    merge_counts(&mut output, &count_checks(&issues))?;
    if !prerequisites.is_empty() {
        output.insert("prerequisiteCount".into(), json!(prerequisites.len()));
        output.insert("prerequisites".into(), json!(prerequisites));
    }
    let tariff = prerequisites
        .iter()
        .filter(|i| i["rule"] == "TARIFF_SCOPE" && is_check_prerequisite(i))
        .count();
    if tariff > 0 {
        output.insert("tariffPrerequisiteCount".into(), json!(tariff));
    }
    if !scope.is_empty() {
        output.insert("scopeNotes".into(), json!(scope));
        output.insert("scopeCount".into(), json!(1));
    }
    let mut dates = issues
        .iter()
        .map(|i| i["date"].as_str().ok_or(CheckDisplayError::InvalidReport))
        .collect::<Result<BTreeSet<_>, _>>()?
        .into_iter()
        .collect::<Vec<_>>();
    dates.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    output.insert("affectedDates".into(), json!(dates));
    output.insert("issues".into(), Value::Array(issues));
    Ok(Value::Object(output))
}
pub fn select_annual_check_display(
    report: &Value,
    show_planning: bool,
) -> Result<Value, CheckDisplayError> {
    let mut months = Vec::new();
    let mut totals = CheckCounts::default();
    for month in required_array(report, "months")? {
        let counts = if let Some(classified) = month
            .get("checkCounts")
            .filter(|v| crate::credit::summary::truthy(Some(v)))
        {
            let legal = read_counts(&classified["legal"])?;
            if show_planning {
                add_check_counts(&legal, &read_counts(&classified["planning"])?)?
            } else {
                legal
            }
        } else {
            CheckCounts {
                critical_count: required_count(month, "criticalCount")?,
                warning_count: required_count(month, "warningCount")?,
                info_count: match month.get("infoCount") {
                    None | Some(Value::Null) => 0,
                    Some(v) => v.as_u64().ok_or(CheckDisplayError::InvalidReport)?,
                },
                ..CheckCounts::default()
            }
        };
        let mut month = month
            .as_object()
            .ok_or(CheckDisplayError::InvalidReport)?
            .clone();
        // Source spreading deliberately retains unspecified legacy metadata.
        merge_counts(&mut month, &counts)?;
        let month = Value::Object(month);
        totals = add_check_counts(&totals, &read_counts(&month)?)?;
        months.push(month);
    }
    let mut output = report
        .as_object()
        .ok_or(CheckDisplayError::InvalidReport)?
        .clone();
    output.insert("months".into(), Value::Array(months));
    merge_counts(&mut output, &totals)?;
    Ok(Value::Object(output))
}
fn required_array<'a>(value: &'a Value, key: &str) -> Result<&'a [Value], CheckDisplayError> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .ok_or(CheckDisplayError::InvalidReport)
}
fn optional_array<'a>(value: &'a Value, key: &str) -> Result<&'a [Value], CheckDisplayError> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(&[]),
        Some(v) => v
            .as_array()
            .map(Vec::as_slice)
            .ok_or(CheckDisplayError::InvalidReport),
    }
}
fn unique_by_id<'a>(
    rows: impl Iterator<Item = &'a Value>,
) -> Result<Vec<&'a Value>, CheckDisplayError> {
    let mut values = Vec::new();
    let mut indices = BTreeMap::new();
    for row in rows {
        let id = row["id"].as_str().ok_or(CheckDisplayError::InvalidReport)?;
        if let Some(index) = indices.get(id).copied() {
            values[index] = row;
        } else {
            indices.insert(id, values.len());
            values.push(row);
        }
    }
    Ok(values)
}
fn required_count(value: &Value, key: &str) -> Result<u64, CheckDisplayError> {
    value[key].as_u64().ok_or(CheckDisplayError::InvalidReport)
}
fn read_counts(value: &Value) -> Result<CheckCounts, CheckDisplayError> {
    let optional = |key| match value.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_u64()
            .map(Some)
            .ok_or(CheckDisplayError::InvalidReport),
    };
    Ok(CheckCounts {
        critical_count: required_count(value, "criticalCount")?,
        warning_count: required_count(value, "warningCount")?,
        info_count: required_count(value, "infoCount")?,
        prerequisite_count: optional("prerequisiteCount")?,
        tariff_prerequisite_count: optional("tariffPrerequisiteCount")?,
        scope_count: optional("scopeCount")?,
    })
}
fn merge_counts(
    object: &mut serde_json::Map<String, Value>,
    counts: &CheckCounts,
) -> Result<(), CheckDisplayError> {
    let counts = serde_json::to_value(counts).map_err(|_| CheckDisplayError::InvalidReport)?;
    object.extend(
        counts
            .as_object()
            .ok_or(CheckDisplayError::InvalidReport)?
            .iter()
            .map(|(k, v)| (k.clone(), v.clone())),
    );
    Ok(())
}
