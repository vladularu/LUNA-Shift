//! Source-faithful incomplete monthly Caritas compositions.
mod base;
mod composition;
mod lines;
use super::{
    lookup::{rows, unavailable},
    overtime::source_ids,
    personal_allowances, personal_base, personal_cash,
};
use crate::{
    money::MAX_SAFE_INTEGER,
    remuneration::{base::BaseError, context::model::NativePackageValidator},
    rules::RulePackage,
};
pub use base::components;
pub use composition::composition;
use serde_json::{Value, json};
pub fn with_shift(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    let base = components(pkg, input, validator)?;
    if bad(&base) {
        Ok(base)
    } else {
        base::shift(pkg, input, &base, validator)
    }
}
pub fn with_hourly(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    let base = components(pkg, input, validator)?;
    if bad(&base) {
        Ok(base)
    } else {
        lines::hourly(pkg, input, &base, validator)
    }
}
pub fn with_time(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    let base = components(pkg, input, validator)?;
    if bad(&base) {
        Ok(base)
    } else {
        lines::time(pkg, input, &base, validator)
    }
}
pub fn with_overtime(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    let base = components(pkg, input, validator)?;
    if bad(&base) {
        Ok(base)
    } else {
        lines::overtime(pkg, input, &base, validator)
    }
}
fn bad(value: &Value) -> bool {
    value["kind"] == "unavailable"
}
fn component(mut value: Value, name: &str, line_id: Option<&str>) -> Value {
    value["component"] = json!(name);
    if let Some(id) = line_id {
        value["lineId"] = json!(id);
    }
    value
}
fn failure(reason: &str, name: &str, id: Option<&str>) -> Value {
    component(unavailable(reason), name, id)
}
fn safe(value: f64) -> Option<i64> {
    (value.is_finite() && value.fract() == 0.0 && value.abs() <= MAX_SAFE_INTEGER as f64)
        .then_some(value as i64)
}
fn position_sum(positions: &[Value]) -> Option<i64> {
    safe(positions.iter().fold(0.0, |sum, p| {
        sum + p["amountCents"].as_f64().unwrap_or(f64::NAN)
    }))
}
fn result(
    base: &Value,
    kind: &str,
    subtotal: i64,
    positions: Vec<Value>,
    excluded: [&str; 3],
) -> Value {
    json!({"kind":kind,"completeGross":false,"knownSubtotalCents":subtotal,"packageId":base["packageId"],"versionId":base["versionId"],"month":base["month"],"excludedComponents":[excluded[0],excluded[1],excluded[2],"ANNUAL_PAYMENT","OTHER_LOCAL_TERMS"],"positions":positions})
}
/// Small money-only arguments. Raw line arrays and rule packages are never copied into each component.
fn arguments(input: &Value, line: Option<&Value>) -> Value {
    let mut out = serde_json::Map::new();
    for k in [
        "variantId",
        "regionId",
        "groupId",
        "stepId",
        "weeklyMinutes",
        "month",
        "fullMonthEmploymentConfirmed",
        "fullMonthWeeklyTimeConfirmed",
    ] {
        if let Some(value) = input.get(k) {
            out.insert(k.to_owned(), value.clone());
        }
    }
    if let Some(line) = line {
        for k in [
            "serviceDate",
            "allowanceType",
            "entitlement",
            "payableWholeHours",
            "hoursConfirmed",
            "categoryAndOverlapConfirmed",
            "premiumType",
            "overtimeConfirmed",
            "baseEntitlement",
            "premiumEntitlement",
        ] {
            if let Some(value) = line.get(k) {
                out.insert(k.to_owned(), value.clone());
            }
        }
    }
    Value::Object(out)
}
