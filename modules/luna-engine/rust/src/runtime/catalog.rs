//! Native catalog construction. Builtin modes select actual compiled bytes;
//! external input cannot confer builtin identity by claiming a success flag.
use crate::rules::{
    self, HistoricalCatalog, PackageIds, RuleResolver, RuleResolverCatalog, validation,
};
use serde::Deserialize;
use serde_json::Value;
use std::{
    collections::BTreeMap,
    sync::{Arc, OnceLock},
};
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CatalogLoadError {
    Malformed,
    InvalidRules,
    InvalidCatalog,
    Incompatible,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CatalogOrigin {
    CompiledLegacy,
    CompiledPreview,
    External,
}
#[derive(Debug, Clone, Copy)]
pub enum HistoricalPolicy {
    None,
    AppCompatibility,
}
#[derive(Debug, Clone)]
pub struct RuntimeCatalog {
    resolver: Arc<RuleResolver>,
    origin: CatalogOrigin,
    generation: Option<u64>,
}
impl RuntimeCatalog {
    pub fn resolver(&self) -> &Arc<RuleResolver> {
        &self.resolver
    }
    pub fn origin(&self) -> CatalogOrigin {
        self.origin
    }
    pub fn generation(&self) -> Option<u64> {
        self.generation
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviewData {
    generation: u64,
    catalog: RuleResolverCatalog,
    package_ids: PackageIds,
    historical: HistoryData,
    collation_ranks: BTreeMap<String, u32>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryData {
    package_ids: PackageIds,
    compatible_package_ids: PackageIds,
    valid_before: PackageIds,
}
#[derive(Deserialize)]
struct LegacyData {
    catalog: RuleResolverCatalog,
}
static PREVIEW: OnceLock<Result<RuntimeCatalog, CatalogLoadError>> = OnceLock::new();
static LEGACY: OnceLock<Result<RuntimeCatalog, CatalogLoadError>> = OnceLock::new();
fn preview_data() -> Result<PreviewData, CatalogLoadError> {
    serde_json::from_str(include_str!("../rules/embedded-preview.json"))
        .map_err(|_| CatalogLoadError::Malformed)
}
fn history(data: HistoryData) -> Result<HistoricalCatalog, CatalogLoadError> {
    let legacy: LegacyData = serde_json::from_str(include_str!("../rules/bundled.json"))
        .map_err(|_| CatalogLoadError::Malformed)?;
    Ok(HistoricalCatalog {
        catalog: legacy.catalog,
        package_ids: data.package_ids,
        compatible_package_ids: data.compatible_package_ids,
        valid_before: data.valid_before,
    })
}
fn checked(resolver: RuleResolver) -> Result<Arc<RuleResolver>, CatalogLoadError> {
    if !resolver
        .validate_all_package_semantics()
        .map_err(|_| CatalogLoadError::InvalidRules)?
    {
        return Err(CatalogLoadError::InvalidRules);
    }
    Ok(Arc::new(resolver))
}
pub fn compiled_legacy() -> Result<RuntimeCatalog, CatalogLoadError> {
    LEGACY
        .get_or_init(|| {
            Ok(RuntimeCatalog {
                resolver: checked(
                    RuleResolver::bundled().map_err(|_| CatalogLoadError::Malformed)?,
                )?,
                origin: CatalogOrigin::CompiledLegacy,
                generation: None,
            })
        })
        .clone()
}
pub fn compiled_preview() -> Result<RuntimeCatalog, CatalogLoadError> {
    PREVIEW
        .get_or_init(|| {
            let data = preview_data()?;
            let resolver = RuleResolver::new(
                data.catalog,
                data.package_ids,
                Some(history(data.historical)?),
            )
            .map_err(|_| CatalogLoadError::Incompatible)?
            .with_collation_ranks(data.collation_ranks);
            Ok(RuntimeCatalog {
                resolver: checked(resolver)?,
                origin: CatalogOrigin::CompiledPreview,
                generation: Some(data.generation),
            })
        })
        .clone()
}
/// Signature authentication is the platform adapter's separate responsibility.
/// This constructor performs the complete native catalog/selection checks. It
/// preserves external origin even for a structurally identical builtin catalog.
pub fn external(
    manifest: &Value,
    packages: &[Value],
    historical: HistoricalPolicy,
    collation: BTreeMap<String, u32>,
) -> Result<RuntimeCatalog, CatalogLoadError> {
    let package_ids = external_package_ids(manifest, packages)?;
    let catalog = parsed_catalog(packages.iter().cloned())?;
    finish_external(manifest, catalog, package_ids, historical, collation)
}
/// Native original-artifact admission can consume its temporary parsed values
/// rather than deep-cloning every package again. Policy is shared with external.
pub fn external_owned(
    manifest: &Value,
    packages: Vec<Value>,
    historical: HistoricalPolicy,
    collation: BTreeMap<String, u32>,
) -> Result<RuntimeCatalog, CatalogLoadError> {
    let package_ids = external_package_ids(manifest, &packages)?;
    let catalog = parsed_catalog(packages)?;
    finish_external(manifest, catalog, package_ids, historical, collation)
}
fn external_package_ids(
    manifest: &Value,
    packages: &[Value],
) -> Result<PackageIds, CatalogLoadError> {
    if !validation::validate_rule_catalog(manifest, packages)
        .map_err(|_| CatalogLoadError::InvalidRules)?
        .is_empty()
    {
        return Err(CatalogLoadError::InvalidCatalog);
    }
    RuleResolver::package_ids_from_manifest(manifest).map_err(|_| CatalogLoadError::Incompatible)
}
fn parsed_catalog(
    packages: impl IntoIterator<Item = Value>,
) -> Result<RuleResolverCatalog, CatalogLoadError> {
    let mut catalog = RuleResolverCatalog {
        tariff: vec![],
        legal: vec![],
        holiday: vec![],
    };
    for package in packages {
        let parsed: rules::RulePackage =
            serde_json::from_value(package).map_err(|_| CatalogLoadError::Malformed)?;
        match parsed.kind {
            rules::RuleKind::Tariff => catalog.tariff.push(parsed),
            rules::RuleKind::Legal => catalog.legal.push(parsed),
            rules::RuleKind::Holiday => catalog.holiday.push(parsed),
        }
    }
    Ok(catalog)
}
fn finish_external(
    manifest: &Value,
    catalog: RuleResolverCatalog,
    package_ids: PackageIds,
    historical: HistoricalPolicy,
    collation: BTreeMap<String, u32>,
) -> Result<RuntimeCatalog, CatalogLoadError> {
    let historical = match historical {
        HistoricalPolicy::None => None,
        HistoricalPolicy::AppCompatibility => Some(history(preview_data()?.historical)?),
    };
    let resolver = RuleResolver::new(catalog, package_ids, historical)
        .map_err(|_| CatalogLoadError::Incompatible)?
        .with_collation_ranks(collation);
    let generation = manifest["generation"]
        .as_f64()
        .filter(|n| {
            n.is_finite()
                && n.fract() == 0.0
                && *n >= 1.0
                && *n <= crate::money::MAX_SAFE_INTEGER as f64
        })
        .ok_or(CatalogLoadError::Incompatible)? as u64;
    Ok(RuntimeCatalog {
        resolver: checked(resolver)?,
        origin: CatalogOrigin::External,
        generation: Some(generation),
    })
}
