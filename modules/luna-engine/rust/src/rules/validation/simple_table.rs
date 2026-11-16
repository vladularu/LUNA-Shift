use super::{ValidationError, ValidationIssue, common::*};
use jiff::ToSpan;
use serde_json::Value;
use std::{collections::HashSet, sync::OnceLock};
static LAYOUT: OnceLock<Result<Value, ValidationError>> = OnceLock::new();
pub(super) fn issues(package: &Value) -> Result<Vec<ValidationIssue>, ValidationError> {
    let mut issues = vec![];
    let version = n(package, "engineContractVersion");
    let Some(data) = package["rules"]
        .get("simpleTariffTables")
        .filter(|v| !v.is_null() && v != &&Value::Bool(false))
    else {
        if version == 19.0 {
            issue(
                &mut issues,
                "SIMPLE_TABLE_DATA_REQUIRED",
                "/rules/simpleTariffTables",
                "Contract 19 requires tariff tables.",
            );
        }
        return Ok(issues);
    };
    if version != 19.0 {
        issue(
            &mut issues,
            "SIMPLE_TABLE_CONTRACT_MISMATCH",
            "/engineContractVersion",
            "Tariff tables require contract 19.",
        );
        return Ok(issues);
    }
    let layout = LAYOUT
        .get_or_init(|| {
            serde_json::from_str(include_str!(
                "../../../../../../src/rules/simple-tariff-table-layout.json"
            ))
            .map_err(|_| ValidationError::InvalidSchema)
        })
        .as_ref()
        .map_err(|e| *e)?
        .as_object()
        .ok_or(ValidationError::InvalidSchema)?;
    let sources: HashSet<_> = a(&package["sources"]).iter().map(|v| s(v, "id")).collect();
    let mut fail = |code: &str, path: String| {
        issue(
            &mut issues,
            code,
            path,
            "Invalid simple tariff table dataset.",
        )
    };
    for (family, required) in layout {
        let mut tables: Vec<_> = a(&data["tables"])
            .iter()
            .enumerate()
            .filter(|(_, table)| table["tariffId"] == *family)
            .collect();
        tables.sort_by(|(_, a), (_, b)| s(a, "validFrom").cmp(s(b, "validFrom")));
        if tables.is_empty() {
            fail(
                "SIMPLE_TABLE_FAMILY_MISSING",
                "/rules/simpleTariffTables/tables".to_owned(),
            );
        }
        let mut previous: Option<&Value> = None;
        for (i, table) in tables {
            let path = format!("/rules/simpleTariffTables/tables/{i}");
            if s(table, "validFrom").parse::<jiff::civil::Date>().is_err()
                || table["validTo"]
                    .as_str()
                    .is_some_and(|v| v.parse::<jiff::civil::Date>().is_err())
            {
                fail("SIMPLE_TABLE_INVALID_DATE", path.clone());
            }
            if !table["validTo"].is_null() && s(table, "validFrom") > s(table, "validTo") {
                fail("SIMPLE_TABLE_INVALID_RANGE", path.clone());
            }
            if previous.is_some_and(|end| {
                end.is_null() || s(table, "validFrom") <= end.as_str().unwrap_or("")
            }) {
                fail("SIMPLE_TABLE_OVERLAP", path.clone());
            }
            if let Some(end) = previous.and_then(Value::as_str)
                && let Ok(date) = end.parse::<jiff::civil::Date>()
                && let Ok(next) = date.checked_add(1.days())
                && next.to_string() != s(table, "validFrom")
            {
                fail("SIMPLE_TABLE_GAP", path.clone());
            }
            previous = Some(&table["validTo"]);
            let mut keys: Vec<_> = a(&table["entries"])
                .iter()
                .map(|entry| format!("{}:{}", s(entry, "groupId"), s(entry, "stepId")))
                .collect();
            keys.sort();
            let mut required: Vec<_> = a(required).iter().filter_map(Value::as_str).collect();
            required.sort();
            if keys.iter().map(String::as_str).ne(required) {
                fail("SIMPLE_TABLE_LAYOUT_MISMATCH", format!("{path}/entries"));
            }
            if a(&table["sourceIds"]).is_empty()
                || a(&table["sourceIds"])
                    .iter()
                    .filter_map(Value::as_str)
                    .any(|id| !sources.contains(id))
            {
                fail("SIMPLE_TABLE_SOURCE_MISSING", format!("{path}/sourceIds"));
            }
        }
    }
    Ok(issues)
}
