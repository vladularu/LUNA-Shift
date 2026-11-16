//! Original UTF-8 artifact bytes, not reserialized JSON, bind package bodies to
//! manifest descriptors. Ed25519 trust/channel policy stays in the platform
//! acquisition adapter; this module never claims signature authentication.
use crate::{contract, rules::validation};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

pub const MAX_ARTIFACT_BYTES: usize = 524_288;
pub const MAX_ARTIFACT_CHUNK_BYTES: usize = 65_536;
const MAX_CHUNKS: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArtifactError {
    InvalidChunks,
    TooLarge,
    TooManyDecodedNodes,
    InvalidJson,
    InvalidManifest,
    PackageCount,
    PackageIdentity,
    PackageSize,
    PackageHash,
    PackageKind,
}

/// Only native parsing/hashing can construct this value. It is not a wire DTO.
#[derive(Debug)]
pub struct RuleArtifact {
    value: Value,
    sha256: String,
    byte_length: usize,
}
impl RuleArtifact {
    pub fn from_chunks(chunks: &Value) -> Result<Self, ArtifactError> {
        let mut remaining_nodes = contract::MAX_JSON_NODES;
        Self::from_chunks_in_catalog(chunks, &mut remaining_nodes)
    }
    /// All original artifacts and the manifest consume one catalog allowance.
    /// Parsing fails before materializing nodes beyond the remaining budget.
    pub(crate) fn from_chunks_in_catalog(
        chunks: &Value,
        remaining_nodes: &mut u32,
    ) -> Result<Self, ArtifactError> {
        let chunks = chunks.as_array().ok_or(ArtifactError::InvalidChunks)?;
        if chunks.is_empty() || chunks.len() > MAX_CHUNKS {
            return Err(ArtifactError::InvalidChunks);
        }
        let mut size = 0usize;
        for chunk in chunks {
            let chunk = chunk.as_str().ok_or(ArtifactError::InvalidChunks)?;
            if chunk.len() > MAX_ARTIFACT_CHUNK_BYTES {
                return Err(ArtifactError::InvalidChunks);
            }
            size = size
                .checked_add(chunk.len())
                .ok_or(ArtifactError::TooLarge)?;
            if size > MAX_ARTIFACT_BYTES {
                return Err(ArtifactError::TooLarge);
            }
        }
        let mut bytes = Vec::with_capacity(size);
        for chunk in chunks {
            bytes.extend_from_slice(chunk.as_str().unwrap().as_bytes());
        }
        let (value, used_nodes) = contract::bounded_json_with_node_budget(&bytes, *remaining_nodes)
            .map_err(|error| match error {
                contract::ContractError::TooManyJsonNodes => ArtifactError::TooManyDecodedNodes,
                _ => ArtifactError::InvalidJson,
            })?;
        *remaining_nodes -= used_nodes;
        Ok(Self {
            value,
            sha256: format!("{:x}", Sha256::digest(&bytes)),
            byte_length: bytes.len(),
        })
    }
    pub fn value(&self) -> &Value {
        &self.value
    }
    pub fn sha256(&self) -> &str {
        &self.sha256
    }
    pub fn byte_length(&self) -> usize {
        self.byte_length
    }
}

/// All descriptors, identities, kinds, original byte lengths and SHA-256s are
/// checked before consuming the parsed bodies. Semantic checks follow in the
/// native RuntimeCatalog constructor. No supplied success flag is accepted.
pub fn verified_package_values(
    manifest: &Value,
    artifacts: Vec<(crate::rules::RuleKind, RuleArtifact)>,
) -> Result<Vec<Value>, ArtifactError> {
    if !validation::validate_manifest(manifest)
        .map_err(|_| ArtifactError::InvalidManifest)?
        .is_empty()
    {
        return Err(ArtifactError::InvalidManifest);
    }
    let descriptors = manifest["packages"]
        .as_array()
        .ok_or(ArtifactError::InvalidManifest)?;
    if artifacts.len() != descriptors.len() {
        return Err(ArtifactError::PackageCount);
    }
    let mut seen = BTreeSet::new();
    let mut packages = Vec::with_capacity(artifacts.len());
    for (expected_kind, artifact) in artifacts {
        let package_id = artifact.value["packageId"]
            .as_str()
            .ok_or(ArtifactError::PackageIdentity)?;
        let version_id = artifact.value["versionId"]
            .as_str()
            .ok_or(ArtifactError::PackageIdentity)?;
        if !seen.insert((package_id.to_owned(), version_id.to_owned())) {
            return Err(ArtifactError::PackageIdentity);
        }
        let descriptor = descriptors
            .iter()
            .find(|d| d["packageId"] == package_id && d["versionId"] == version_id)
            .ok_or(ArtifactError::PackageIdentity)?;
        let kind = serde_json::to_value(expected_kind).map_err(|_| ArtifactError::PackageKind)?;
        if artifact.value["kind"] != kind || descriptor["kind"] != kind {
            return Err(ArtifactError::PackageKind);
        }
        if descriptor["sizeBytes"].as_f64() != Some(artifact.byte_length as f64) {
            return Err(ArtifactError::PackageSize);
        }
        if descriptor["sha256"].as_str() != Some(artifact.sha256.as_str()) {
            return Err(ArtifactError::PackageHash);
        }
        packages.push(artifact.value);
    }
    Ok(packages)
}

#[cfg(test)]
mod decoded_budget_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn manifest_and_packages_share_exact_node_allowance_with_original_byte_identity() {
        let mut remaining = 5;
        let package =
            RuleArtifact::from_chunks_in_catalog(&json!([" [0,null] "]), &mut remaining).unwrap();
        assert_eq!(remaining, 2); // Array root plus both values.
        assert_eq!(package.byte_length(), 10);
        assert_eq!(
            package.sha256(),
            format!("{:x}", Sha256::digest(b" [0,null] "))
        );
        let manifest =
            RuleArtifact::from_chunks_in_catalog(&json!(["{\"x\":0}"]), &mut remaining).unwrap();
        assert_eq!(manifest.value(), &json!({"x":0}));
        assert_eq!(remaining, 0); // Object root plus its value; keys aren't nodes.
        assert_eq!(
            RuleArtifact::from_chunks_in_catalog(&json!(["null"]), &mut remaining).unwrap_err(),
            ArtifactError::TooManyDecodedNodes
        );
    }

    #[test]
    fn malformed_shapes_remain_strict_and_never_gain_a_fresh_independent_budget() {
        let mut remaining = 1;
        assert_eq!(
            RuleArtifact::from_chunks_in_catalog(&json!(["[0]"]), &mut remaining).unwrap_err(),
            ArtifactError::TooManyDecodedNodes
        );
        assert_eq!(remaining, 1);
        assert_eq!(
            RuleArtifact::from_chunks_in_catalog(&json!(["{\"x\":0,\"x\":1}"]), &mut 100)
                .unwrap_err(),
            ArtifactError::InvalidJson
        );
        assert_eq!(
            RuleArtifact::from_chunks_in_catalog(&json!(["1 trailing"]), &mut 100).unwrap_err(),
            ArtifactError::InvalidJson
        );
    }
}
