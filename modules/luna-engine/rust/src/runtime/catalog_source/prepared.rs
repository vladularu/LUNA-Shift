//! Native-only admission state between original artifact intake and locale
//! collation. Raw package values are input-only until finish validates them.
use super::*;
use crate::contract::CatalogSet;
use std::sync::OnceLock;

enum PreparedKind {
    Compiled(RuntimeCatalog),
    External {
        manifest: RuleArtifact,
        packages: Vec<Value>,
        ids: crate::rules::PackageIds,
        historical: HistoricalPolicy,
    },
}
pub struct PreparedCatalogParts {
    kind: PreparedKind,
    candidates: OnceLock<Result<BTreeSet<String>, CatalogSourceError>>,
}
impl PreparedCatalogParts {
    pub fn default_package_ids(&self) -> &crate::rules::PackageIds {
        match &self.kind {
            PreparedKind::Compiled(catalog) => catalog.resolver().default_package_ids(),
            PreparedKind::External { ids, .. } => ids,
        }
    }
    pub fn requires_ranks(&self) -> bool {
        matches!(self.kind, PreparedKind::External { .. })
    }
    pub fn candidates(&self) -> Result<&BTreeSet<String>, CatalogSourceError> {
        self.candidates
            .get_or_init(|| match &self.kind {
                PreparedKind::Compiled(_) => Ok(BTreeSet::new()),
                PreparedKind::External {
                    packages,
                    historical,
                    ..
                } => required_collation_candidates(packages, *historical),
            })
            .as_ref()
            .map_err(Clone::clone)
    }
    pub(super) fn supplied_ranks(
        &self,
        current: &CatalogSet,
    ) -> Result<BTreeMap<String, u32>, CatalogSourceError> {
        if !self.requires_ranks() {
            return Ok(BTreeMap::new());
        }
        let part = object(raw(current.tariff(), RuleKind::Tariff)?, RuleKind::Tariff)?;
        collation(&part["collationRanks"], self.candidates()?)
    }
    /// Consumes native parsed inputs; no JavaScript results or caller-provided
    /// validation flags can construct a RuntimeCatalog through this boundary.
    pub fn finish(
        self,
        ranks: BTreeMap<String, u32>,
    ) -> Result<RuntimeCatalog, CatalogSourceError> {
        if self
            .candidates()?
            .iter()
            .any(|name| !ranks.contains_key(name))
        {
            return Err(CatalogSourceError::MissingCollation);
        }
        match self.kind {
            PreparedKind::Compiled(catalog) => {
                if !ranks.is_empty() {
                    return Err(CatalogSourceError::MalformedPart(RuleKind::Tariff));
                }
                Ok(catalog)
            }
            PreparedKind::External {
                manifest,
                packages,
                historical,
                ..
            } => Ok(catalog::external_owned(
                manifest.value(),
                packages,
                historical,
                ranks,
            )?),
        }
    }
}

/// Checks actual read states, modes, original manifest and artifact byte hashes
/// once. This deliberately does not depend on selected IDs already being set:
/// the native builder derives them from these exact sources before seal.
pub fn prepare_catalog_set(
    current: &CatalogSet,
    historical_count: usize,
) -> Result<PreparedCatalogParts, CatalogSourceError> {
    if historical_count != 0 {
        return Err(CatalogSourceError::UnsupportedHistory);
    }
    let parts = [
        (
            RuleKind::Tariff,
            object(raw(current.tariff(), RuleKind::Tariff)?, RuleKind::Tariff)?,
        ),
        (
            RuleKind::Legal,
            object(raw(current.legal(), RuleKind::Legal)?, RuleKind::Legal)?,
        ),
        (
            RuleKind::Holiday,
            object(
                raw(current.holiday(), RuleKind::Holiday)?,
                RuleKind::Holiday,
            )?,
        ),
    ];
    let mode = parts[0]
        .1
        .get("mode")
        .and_then(Value::as_str)
        .ok_or(CatalogSourceError::MalformedPart(RuleKind::Tariff))?;
    if parts
        .iter()
        .any(|(_, part)| part.get("mode").and_then(Value::as_str) != Some(mode))
    {
        return Err(CatalogSourceError::MixedModes);
    }
    if matches!(mode, "COMPILED_PREVIEW" | "COMPILED_LEGACY") {
        for (kind, part) in &parts {
            keys(part, &["mode"], *kind)?;
        }
        let runtime = if mode == "COMPILED_PREVIEW" {
            catalog::compiled_preview()?
        } else {
            catalog::compiled_legacy()?
        };
        return Ok(PreparedCatalogParts {
            kind: PreparedKind::Compiled(runtime),
            candidates: OnceLock::new(),
        });
    }
    if mode != "EXTERNAL" {
        return Err(CatalogSourceError::MalformedPart(RuleKind::Tariff));
    }
    let mut artifacts = Vec::new();
    let mut remaining_nodes = crate::contract::MAX_JSON_NODES;
    for (kind, part) in &parts {
        let fields: &[&str] = if *kind == RuleKind::Tariff {
            &[
                "mode",
                "packageJsonChunks",
                "manifestJsonChunks",
                "historicalPolicy",
                "collationRanks",
            ]
        } else {
            &["mode", "packageJsonChunks"]
        };
        keys(part, fields, *kind)?;
        let packages = part["packageJsonChunks"]
            .as_array()
            .filter(|p| p.len() <= 256)
            .ok_or(CatalogSourceError::MalformedPart(*kind))?;
        for chunks in packages {
            artifacts.push((
                *kind,
                RuleArtifact::from_chunks_in_catalog(chunks, &mut remaining_nodes)?,
            ));
        }
    }
    let tariff = parts[0].1;
    let manifest =
        RuleArtifact::from_chunks_in_catalog(&tariff["manifestJsonChunks"], &mut remaining_nodes)?;
    let historical = match tariff["historicalPolicy"].as_str() {
        Some("NONE") => HistoricalPolicy::None,
        Some("APP_COMPATIBILITY") => HistoricalPolicy::AppCompatibility,
        _ => return Err(CatalogSourceError::MalformedPart(RuleKind::Tariff)),
    };
    let packages = verified_package_values(manifest.value(), artifacts)?;
    let ids = RuleResolver::package_ids_from_manifest(manifest.value())
        .map_err(|_| CatalogSourceError::Catalog(CatalogLoadError::Incompatible))?;
    Ok(PreparedCatalogParts {
        kind: PreparedKind::External {
            manifest,
            packages,
            ids,
            historical,
        },
        candidates: OnceLock::new(),
    })
}
