//! Native validation of immutable catalog contracts. Platform signature checks
//! precede this boundary; neither a digest nor a JavaScript flag grants validity.
mod common;
mod holiday;
mod legal;
mod manifest;
mod simple_table;
mod tariff;
pub use manifest::{validate_manifest, validate_publication, validate_rule_catalog};
pub mod schema;
mod youth;

/// Full schema and semantic pipeline in the original source order. Incomplete
/// family validators propagate an error and can never grant package validity.
pub fn validate_rule_package(
    value: &serde_json::Value,
) -> Result<Vec<ValidationIssue>, ValidationError> {
    let schema_issues = schema::validate_schema(schema::SchemaKind::Package, value)?;
    if !schema_issues.is_empty() {
        return Ok(schema_issues);
    }
    let mut issues = common::package_common(value);
    match common::s(value, "kind") {
        "TARIFF" => {
            issues.extend(super::validation_tariff::family_tariff_issues(value)?);
            issues.extend(tariff::issues(value));
            issues.extend(simple_table::issues(value)?);
        }
        "LEGAL" => issues.extend(legal::issues(value)),
        "HOLIDAY" => issues.extend(holiday::issues(value)),
        _ => return Err(ValidationError::SemanticValidationUnavailable),
    }
    Ok(issues)
}

/// Cached only on this package's immutable body/metadata, with a guard over all
/// publicly mutable header fields. A cloned/modified header cannot reuse trust.
#[derive(Debug, Clone)]
pub(crate) struct CachedPackageValidation {
    kind: super::RuleKind,
    package_id: String,
    version_id: String,
    valid_from: String,
    valid_to: Option<String>,
    engine_contract_version: u32,
    result: Result<std::sync::Arc<Vec<ValidationIssue>>, ValidationError>,
}
impl CachedPackageValidation {
    fn new(
        package: &super::RulePackage,
        result: Result<std::sync::Arc<Vec<ValidationIssue>>, ValidationError>,
    ) -> Self {
        Self {
            kind: package.kind,
            package_id: package.package_id.clone(),
            version_id: package.version_id.clone(),
            valid_from: package.valid_from.clone(),
            valid_to: package.valid_to.clone(),
            engine_contract_version: package.engine_contract_version,
            result,
        }
    }
    fn matches(&self, p: &super::RulePackage) -> bool {
        self.kind == p.kind
            && self.package_id == p.package_id
            && self.version_id == p.version_id
            && self.valid_from == p.valid_from
            && self.valid_to == p.valid_to
            && self.engine_contract_version == p.engine_contract_version
    }
}
fn uncached_package(
    package: &super::RulePackage,
) -> Result<std::sync::Arc<Vec<ValidationIssue>>, ValidationError> {
    let value = serde_json::to_value(package).map_err(|_| ValidationError::InvalidSchema)?;
    validate_rule_package(&value).map(std::sync::Arc::new)
}
pub fn package_validation_issues(
    package: &super::RulePackage,
) -> Result<std::sync::Arc<Vec<ValidationIssue>>, ValidationError> {
    let cached = package
        .validation
        .get_or_init(|| CachedPackageValidation::new(package, uncached_package(package)));
    if cached.matches(package) {
        cached.result.clone()
    } else {
        uncached_package(package)
    }
}
pub fn validate_tariff_package(package: &super::RulePackage) -> Result<bool, ValidationError> {
    if package.kind != super::RuleKind::Tariff {
        return Ok(false);
    }
    package_validation_issues(package).map(|issues| issues.is_empty())
}
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValidationIssue {
    pub code: String,
    pub path: String,
    pub message: String,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValidationError {
    InvalidSchema,
    DiagnosticMismatch,
    SemanticValidationUnavailable,
}
impl std::fmt::Display for ValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::InvalidSchema => "Native rule schema is invalid",
            Self::DiagnosticMismatch => "Native rule validation diagnostics are incomplete",
            Self::SemanticValidationUnavailable => "Native semantic rule validation is not ready",
        })
    }
}
impl std::error::Error for ValidationError {}
