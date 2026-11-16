//! Native dated selection helpers. These inspect rule policy rather than accepting precomputed flags.
pub mod annual;
pub mod model;
pub mod periods;
pub mod resolve;
pub mod selection;
pub mod training;
use crate::rules::RulePackage;
pub use crate::rules::validation::ValidationIssue;
use serde_json::Value;
/// Read-only package view shared by calculation contexts and full raw catalog validation.
/// It grants no validation status and never copies the rule body or embedded tables.
pub trait TariffValidationPackage {
    fn package_id(&self) -> &str;
    fn engine_contract_version(&self) -> u32;
    fn valid_from(&self) -> &str;
    fn valid_to(&self) -> Option<&str>;
    fn rules(&self) -> &Value;
    fn sources(&self) -> Option<&Value>;
}
impl TariffValidationPackage for RulePackage {
    fn package_id(&self) -> &str {
        &self.package_id
    }
    fn engine_contract_version(&self) -> u32 {
        self.engine_contract_version
    }
    fn valid_from(&self) -> &str {
        &self.valid_from
    }
    fn valid_to(&self) -> Option<&str> {
        self.valid_to.as_deref()
    }
    fn rules(&self) -> &Value {
        RulePackage::rules(self)
    }
    fn sources(&self) -> Option<&Value> {
        RulePackage::sources(self)
    }
}
pub struct RawTariffValidationPackage<'a> {
    value: &'a Value,
    version: u32,
}
impl<'a> RawTariffValidationPackage<'a> {
    pub fn new(value: &'a Value) -> Result<Self, crate::rules::validation::ValidationError> {
        let version = value["engineContractVersion"]
            .as_f64()
            .filter(|n| n.is_finite() && n.fract() == 0.0 && *n >= 0.0 && *n <= f64::from(u32::MAX))
            .map(|n| n as u32);
        let complete = value["kind"] == "TARIFF"
            && ["packageId", "validFrom"]
                .iter()
                .all(|key| value.get(*key).is_some_and(Value::is_string))
            && value
                .get("validTo")
                .is_some_and(|v| v.is_null() || v.is_string())
            && version.is_some()
            && value["rules"].is_object()
            && value["sources"].is_array();
        if !complete {
            return Err(crate::rules::validation::ValidationError::SemanticValidationUnavailable);
        }
        Ok(Self {
            value,
            version: version.expect("version checked above"),
        })
    }
}
impl TariffValidationPackage for RawTariffValidationPackage<'_> {
    fn package_id(&self) -> &str {
        self.value["packageId"].as_str().unwrap_or("")
    }
    fn engine_contract_version(&self) -> u32 {
        self.version
    }
    fn valid_from(&self) -> &str {
        self.value["validFrom"].as_str().unwrap_or("")
    }
    fn valid_to(&self) -> Option<&str> {
        self.value["validTo"].as_str()
    }
    fn rules(&self) -> &Value {
        &self.value["rules"]
    }
    fn sources(&self) -> Option<&Value> {
        Some(&self.value["sources"])
    }
}
pub(super) fn issue(
    issues: &mut Vec<ValidationIssue>,
    code: &str,
    path: &str,
    message: impl Into<String>,
) {
    issues.push(ValidationIssue {
        code: code.into(),
        path: path.into(),
        message: message.into(),
    });
}
pub(super) fn rows<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v.get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}
pub(super) fn text<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str)
}
pub(super) fn number(v: &Value, key: &str) -> i64 {
    v.get(key).and_then(integer_value).unwrap_or(i64::MIN)
}
/// Integer-valued JSON decimal lexemes have the same JS Number meaning as the
/// corresponding integer token. No fractional value or tolerance is admitted.
pub(super) fn integer_value(value: &Value) -> Option<i64> {
    value.as_i64().or_else(|| {
        value
            .as_f64()
            .filter(|n| {
                n.is_finite()
                    && n.fract() == 0.0
                    && n.abs() <= crate::money::MAX_SAFE_INTEGER as f64
            })
            .map(|n| n as i64)
    })
}
pub(super) fn null(v: &Value, key: &str) -> bool {
    v.get(key).is_some_and(Value::is_null)
}
pub(super) fn nullish(v: &Value, key: &str) -> bool {
    v.get(key).is_none_or(Value::is_null)
}
pub(super) fn has(values: &[Value], text: &str) -> bool {
    values.iter().any(|v| v == text)
}
pub(super) fn sources(pkg: &impl TariffValidationPackage) -> std::collections::BTreeSet<&str> {
    pkg.sources()
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|s| text(s, "id"))
        .collect()
}
pub(super) fn source_issues(
    issues: &mut Vec<ValidationIssue>,
    ids: &[Value],
    known: &std::collections::BTreeSet<&str>,
    path: &str,
) {
    for id in ids {
        if let Some(id) = id.as_str().filter(|id| !known.contains(*id)) {
            issue(
                issues,
                "UNKNOWN_SOURCE_ID",
                path,
                format!("Unknown source reference: {id}."),
            );
        }
    }
}
