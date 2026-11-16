//! Concrete raw catalog payloads inside the R0 transport buckets. Only this
//! native boundary selects presets or parses external original artifacts.
mod prepared;
use super::{
    catalog::{self, CatalogLoadError, HistoricalPolicy, RuntimeCatalog},
    catalog_artifact::{ArtifactError, RuleArtifact, verified_package_values},
    sources::SourceReadError,
};
use crate::{
    contract::{Coverage, DataPresence, ImmutableSnapshot, SourceState},
    rules::{RuleKind, RuleResolver},
};
pub use prepared::{PreparedCatalogParts, prepare_catalog_set};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CatalogSourceError {
    Source {
        kind: RuleKind,
        error: SourceReadError,
    },
    MalformedPart(RuleKind),
    MixedModes,
    UnsupportedHistory,
    SelectionMismatch,
    MissingCollation,
    Artifact(ArtifactError),
    Catalog(CatalogLoadError),
}
impl From<ArtifactError> for CatalogSourceError {
    fn from(value: ArtifactError) -> Self {
        Self::Artifact(value)
    }
}
impl From<CatalogLoadError> for CatalogSourceError {
    fn from(value: CatalogLoadError) -> Self {
        Self::Catalog(value)
    }
}
fn raw(state: &SourceState, kind: RuleKind) -> Result<&Value, CatalogSourceError> {
    let error = |error| CatalogSourceError::Source { kind, error };
    match state {
        SourceState::NotRequested => Err(error(SourceReadError::NotRequested)),
        SourceState::Loading => Err(error(SourceReadError::Loading)),
        SourceState::Failed { code } => Err(error(SourceReadError::Failed(*code))),
        SourceState::Ready {
            coverage, payload, ..
        } => {
            if !matches!(coverage, Coverage::AllHistory) {
                return Err(error(SourceReadError::InsufficientCoverage));
            }
            match payload.data() {
                DataPresence::Missing => Err(error(SourceReadError::MissingRecord)),
                DataPresence::Null => Err(error(SourceReadError::NullRecord)),
                DataPresence::Value { value } => Ok(value),
            }
        }
    }
}
fn object(value: &Value, kind: RuleKind) -> Result<&Map<String, Value>, CatalogSourceError> {
    value
        .as_object()
        .ok_or(CatalogSourceError::MalformedPart(kind))
}
fn keys(
    value: &Map<String, Value>,
    required: &[&str],
    kind: RuleKind,
) -> Result<(), CatalogSourceError> {
    if value.len() != required.len() || required.iter().any(|key| !value.contains_key(*key)) {
        return Err(CatalogSourceError::MalformedPart(kind));
    }
    Ok(())
}
fn one_selected(actual: &[String], expected: &str) -> bool {
    actual.len() == 1 && actual[0] == expected
}
fn selections(
    snapshot: &ImmutableSnapshot,
    ids: &crate::rules::PackageIds,
) -> Result<(), CatalogSourceError> {
    let selected = snapshot.current_catalog().selected_package_ids();
    if !one_selected(selected.tariff(), &ids.tariff)
        || !one_selected(selected.legal(), &ids.legal)
        || !one_selected(selected.holiday(), &ids.holiday)
    {
        return Err(CatalogSourceError::SelectionMismatch);
    }
    Ok(())
}
fn collation(
    value: &Value,
    names: &BTreeSet<String>,
) -> Result<BTreeMap<String, u32>, CatalogSourceError> {
    let ranks: BTreeMap<String, u32> = serde_json::from_value(value.clone())
        .map_err(|_| CatalogSourceError::MalformedPart(RuleKind::Tariff))?;
    if names.iter().any(|name| !ranks.contains_key(name)) {
        return Err(CatalogSourceError::MissingCollation);
    }
    Ok(ranks)
}

/// Platform-only locale equivalence data, requested after native artifact
/// decoding. Annual source selection compares version IDs only at equal
/// validity starts; unrelated versions do not create new source dependencies.
pub fn required_collation_candidates(
    packages: &[Value],
    historical: HistoricalPolicy,
) -> Result<BTreeSet<String>, CatalogSourceError> {
    let mut names: BTreeSet<String> = ["NATIONWIDE", "STATEWIDE", "REGIONAL"]
        .into_iter()
        .map(str::to_owned)
        .collect();
    let mut versions: BTreeMap<(&str, &str), BTreeSet<&str>> = BTreeMap::new();
    for package in packages.iter().filter(|v| v["kind"] == "TARIFF") {
        if let (Some(id), Some(start), Some(version)) = (
            package["packageId"].as_str(),
            package["validFrom"].as_str(),
            package["versionId"].as_str(),
        ) {
            versions.entry((id, start)).or_default().insert(version);
        }
    }
    for package in packages.iter().filter(|v| v["kind"] == "HOLIDAY") {
        if let Some(holidays) = package["rules"]["holidays"].as_array() {
            for holiday in holidays {
                if let Some(name) = holiday["name"].as_str() {
                    names.insert(name.to_owned());
                }
            }
        }
    }
    let legacy: Value;
    if matches!(historical, HistoricalPolicy::AppCompatibility) {
        legacy = serde_json::from_str(include_str!("../rules/bundled.json"))
            .map_err(|_| CatalogSourceError::Catalog(CatalogLoadError::Malformed))?;
        for package in legacy["catalog"]["tariff"].as_array().into_iter().flatten() {
            if let (Some(id), Some(start), Some(version)) = (
                package["packageId"].as_str(),
                package["validFrom"].as_str(),
                package["versionId"].as_str(),
            ) {
                versions.entry((id, start)).or_default().insert(version);
            }
        }
        for package in legacy["catalog"]["holiday"]
            .as_array()
            .into_iter()
            .flatten()
        {
            for holiday in package["rules"]["holidays"]
                .as_array()
                .into_iter()
                .flatten()
            {
                if let Some(name) = holiday["name"].as_str() {
                    names.insert(name.to_owned());
                }
            }
        }
    }
    for tied in versions.values().filter(|versions| versions.len() > 1) {
        names.extend(tied.iter().map(|v| (*v).to_owned()));
    }
    Ok(names)
}

/// Real app catalogs are atomic (manifest plus all described package kinds).
/// Call only for sections that need that resolver: unrelated calendar/time
/// work must not acquire a new dependency on a legal/compliance I/O state.
///
/// Presets bind the actual embedded current+historical bytes through the build
/// identity. EXTERNAL tariff parts carry the original manifest, named native
/// history policy and platform collation; legal/holiday parts carry only their
/// original package artifacts. Arbitrary additional history is rejected rather
/// than silently dropped. Platform Ed25519 authentication must precede delivery.
pub fn from_snapshot(snapshot: &ImmutableSnapshot) -> Result<RuntimeCatalog, CatalogSourceError> {
    let prepared = prepare_catalog_set(
        snapshot.current_catalog(),
        snapshot.historical_catalog_count(),
    )?;
    selections(snapshot, prepared.default_package_ids())?;
    let ranks = prepared.supplied_ranks(snapshot.current_catalog())?;
    prepared.finish(ranks)
}
