//! Native catalog preparation, selection and locale facts belong to one
//! immutable builder. Only the private admission proof can seed snapshot facts.
use super::*;
use crate::runtime::catalog::RuntimeCatalog;
use crate::{
    contract::{ContractError, SnapshotIdentity},
    runtime::catalog_source::{CatalogSourceError, PreparedCatalogParts, prepare_catalog_set},
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

pub(super) struct CatalogPreflight {
    ids: crate::rules::PackageIds,
    candidate_digest: String,
    candidate_count: u32,
    pending: Mutex<Option<PreparedCatalogParts>>,
    completed: OnceLock<Result<RuntimeCatalog, CatalogSourceError>>,
}
/// No Deserialize or public constructor. The catalog module only makes this
/// after native artifact/selection/rank validation and full admission, and the
/// assembly parent binds it to the exact sealed snapshot before registration.
pub(crate) struct CatalogAdmission {
    identity: SnapshotIdentity,
    catalog: Result<RuntimeCatalog, CatalogSourceError>,
}
impl CatalogAdmission {
    pub(crate) fn checked_for(
        &self,
        identity: &SnapshotIdentity,
    ) -> Result<Result<RuntimeCatalog, CatalogSourceError>, RegistryError> {
        if self.identity != *identity {
            return Err(RegistryError::IdentityConflict);
        }
        Ok(self.catalog.clone())
    }
}
impl CatalogPreflight {
    pub(super) fn finalized(&self) -> bool {
        self.completed.get().is_some()
    }
    pub(super) fn admission(&self, identity: &SnapshotIdentity) -> Option<CatalogAdmission> {
        self.completed.get().map(|catalog| CatalogAdmission {
            identity: identity.clone(),
            catalog: catalog.clone(),
        })
    }
}
enum Preparation<'a> {
    Available(&'a CatalogPreflight),
    Unavailable(Value),
}
fn unavailable(error: &CatalogSourceError) -> Value {
    let code = match error {
        CatalogSourceError::Source { .. } => "CATALOG_SOURCE_UNAVAILABLE",
        CatalogSourceError::MalformedPart(_) => "MALFORMED_CATALOG_PART",
        CatalogSourceError::MixedModes => "MIXED_CATALOG_MODES",
        CatalogSourceError::UnsupportedHistory => "UNSUPPORTED_CATALOG_HISTORY",
        CatalogSourceError::SelectionMismatch => "CATALOG_SELECTION_MISMATCH",
        CatalogSourceError::MissingCollation => "CATALOG_COLLATION_MISSING",
        CatalogSourceError::Artifact(_) => "INVALID_CATALOG_ARTIFACT",
        CatalogSourceError::Catalog(_) => "CATALOG_VALIDATION_FAILED",
    };
    json!({"ok":true,"state":"CATALOG_UNAVAILABLE","code":code})
}
fn candidate_digest(names: &BTreeSet<String>) -> Result<String, AssemblyError> {
    let mut hash = Sha256::new();
    hash.update(b"luna-engine-catalog-candidates-v1\0");
    hash.update(
        u32::try_from(names.len())
            .map_err(|_| ContractError::CollectionTooLarge)?
            .to_be_bytes(),
    );
    for name in names {
        hash.update(
            u32::try_from(name.len())
                .map_err(|_| ContractError::StringTooLarge)?
                .to_be_bytes(),
        );
        hash.update(name.as_bytes());
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn prepared<'a>(
    builder: &'a Builder,
    body: &SnapshotAssembly,
) -> Result<Preparation<'a>, AssemblyError> {
    if let Some(value) = builder.catalog.get() {
        return Ok(Preparation::Available(value));
    }
    // Begin accepts only the current atomic catalog; historicalPolicy is an
    // explicit native enum inside that catalog, never an ignored extra bucket.
    let parts = match prepare_catalog_set(body.current_catalog(), 0) {
        Ok(parts) => parts,
        Err(error) => return Ok(Preparation::Unavailable(unavailable(&error))),
    };
    let names = match parts.candidates() {
        Ok(names) => names,
        Err(error) => return Ok(Preparation::Unavailable(unavailable(&error))),
    };
    if names.len() > crate::contract::MAX_SOURCE_ITEMS as usize {
        return Ok(Preparation::Unavailable(
            json!({"ok":true,"state":"CATALOG_UNAVAILABLE","code":"CATALOG_CANDIDATE_LIMIT"}),
        ));
    }
    let digest = candidate_digest(names)?;
    let count = u32::try_from(names.len()).map_err(|_| ContractError::CollectionTooLarge)?;
    let value = CatalogPreflight {
        ids: parts.default_package_ids().clone(),
        candidate_digest: digest,
        candidate_count: count,
        pending: Mutex::new(Some(parts)),
        completed: OnceLock::new(),
    };
    builder
        .catalog
        .set(value)
        .map_err(|_| AssemblyError::Capacity)?;
    Ok(Preparation::Available(
        builder.catalog.get().ok_or(AssemblyError::Capacity)?,
    ))
}
fn wire_ids(ids: &crate::rules::PackageIds) -> Value {
    json!({"tariff":[ids.tariff],"legal":[ids.legal],"holiday":[ids.holiday]})
}
impl SnapshotAssemblyPool {
    pub fn catalog_candidates(
        &self,
        id: BuilderId,
        after: Option<u32>,
        limit: u16,
    ) -> Result<Value, AssemblyError> {
        let mut operation = RawOperation::new(self, id)?;
        if !(1..=1024).contains(&limit) {
            return Err(ContractError::InvalidRequest.into());
        }
        let builder = Arc::clone(&operation.builder);
        let preflight = match prepared(
            &builder,
            operation
                .body
                .as_ref()
                .ok_or(AssemblyError::UnknownBuilder)?,
        )? {
            Preparation::Available(value) => value,
            Preparation::Unavailable(reply) => {
                operation.restore()?;
                return Ok(reply);
            }
        };
        let holder = preflight
            .pending
            .lock()
            .map_err(|_| AssemblyError::Poisoned)?;
        let parts = holder.as_ref().ok_or(ContractError::InvalidRequest)?;
        let names = parts
            .candidates()
            .map_err(|_| ContractError::InvalidPresence)?;
        let start = after.unwrap_or(0) as usize;
        if start > names.len() {
            return Err(ContractError::InvalidRequest.into());
        }
        let mut page = Vec::new();
        let mut bytes = 0usize;
        for name in names.iter().skip(start).take(limit as usize) {
            let next = name
                .len()
                .checked_mul(6)
                .and_then(|n| n.checked_add(4))
                .ok_or(ContractError::InputTooLarge)?;
            if !page.is_empty() && bytes.saturating_add(next) > 2 * 1024 * 1024 {
                break;
            }
            bytes = bytes.saturating_add(next);
            page.push(name);
        }
        let end = start + page.len();
        let reply = json!({"ok":true,"state":"CATALOG_CANDIDATES","defaultPackageIds":wire_ids(&preflight.ids),"page":{"candidates":page,"nextAfter":(end<names.len()).then_some(end as u32),"total":preflight.candidate_count,"candidateDigest":preflight.candidate_digest}});
        drop(holder);
        operation.restore()?;
        Ok(reply)
    }
    pub fn catalog_finalize(&self, id: BuilderId, ranks: &[u8]) -> Result<Value, AssemblyError> {
        self.catalog_finalize_frame(id, ranks, 0)
    }
    pub(crate) fn catalog_finalize_frame(
        &self,
        id: BuilderId,
        ranks: &[u8],
        header_bytes: usize,
    ) -> Result<Value, AssemblyError> {
        let mut operation = RawOperation::new(self, id)?;
        let builder = Arc::clone(&operation.builder);
        let preflight = match prepared(
            &builder,
            operation
                .body
                .as_ref()
                .ok_or(AssemblyError::UnknownBuilder)?,
        )? {
            Preparation::Available(value) => value,
            Preparation::Unavailable(reply) => {
                operation.restore()?;
                return Ok(reply);
            }
        };
        if preflight.finalized() {
            return Err(ContractError::InvalidRequest.into());
        }
        let addition = ranks
            .len()
            .checked_add(header_bytes)
            .and_then(|n| u32::try_from(n).ok())
            .ok_or(ContractError::InputTooLarge)?;
        let next = builder
            .wire_bytes
            .load(Ordering::Relaxed)
            .checked_add(addition)
            .filter(|n| *n <= crate::contract::MAX_INPUT_BYTES)
            .ok_or(ContractError::InputTooLarge)?;
        let parts = {
            preflight
                .pending
                .lock()
                .map_err(|_| AssemblyError::Poisoned)?
                .take()
                .ok_or(ContractError::InvalidRequest)?
        };
        let ids = &preflight.ids;
        let checked = operation
            .body
            .as_mut()
            .ok_or(AssemblyError::UnknownBuilder)?
            .bind_catalog_metadata(
                [&ids.tariff, &ids.legal, &ids.holiday],
                ranks,
                parts
                    .candidates()
                    .map_err(|_| ContractError::InvalidPresence)?,
                parts.requires_ranks(),
            )?;
        let result = parts.finish(checked);
        let reply = match &result {
            Ok(_) => {
                json!({"ok":true,"state":"CATALOG_FINALIZED","selectedPackageIds":wire_ids(ids)})
            }
            Err(error) => unavailable(error),
        };
        preflight
            .completed
            .set(result)
            .map_err(|_| AssemblyError::Capacity)?;
        builder.wire_bytes.store(next, Ordering::Relaxed);
        operation.restore()?;
        Ok(reply)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::{
        self,
        utility::{UtilityKind, parse_utility_request},
    };
    #[test]
    fn registered_facts_are_already_seeded_share_native_resolver_and_check_the_entire_identity() {
        let registry = SnapshotRegistry::default();
        registry
            .reset_for_owner(&contract::OwnerIdentity::new("proof-owner", 1).unwrap())
            .unwrap();
        let pool = SnapshotAssemblyPool::new(registry.clone());
        let id=pool.begin(br#"{"ownerScope":"proof-owner","ownerEpoch":1,"snapshotId":"proof","snapshotRevision":1,"referenceDate":"2026-11-13","selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}}"#).unwrap();
        for kind in ["TARIFF", "LEGAL", "HOLIDAY"] {
            let header = json!({"kind":kind,"source":{"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE"}}}});
            pool.source(
                id,
                SourceTarget::Catalog,
                &serde_json::to_vec(&header).unwrap(),
                br#"{"mode":"COMPILED_PREVIEW"}"#,
            )
            .unwrap();
        }
        pool.catalog_finalize(id, b"{}").unwrap();
        let builder = pool.current(id).unwrap();
        let native = builder
            .catalog
            .get()
            .unwrap()
            .completed
            .get()
            .unwrap()
            .as_ref()
            .unwrap()
            .resolver()
            .clone();
        let snapshot = pool.seal(id).unwrap();
        let proof = builder
            .catalog
            .get()
            .unwrap()
            .admission(snapshot.identity())
            .unwrap();
        for (field, value) in [
            ("ownerScope", json!("other-owner")),
            ("ownerEpoch", json!(2)),
            ("snapshotId", json!("other")),
            ("snapshotRevision", json!(2)),
            ("inputDigest", json!("f".repeat(64))),
            ("catalogDigest", json!("f".repeat(64))),
        ] {
            let mut altered = serde_json::to_value(snapshot.identity()).unwrap();
            altered[field] = value;
            let identity: SnapshotIdentity = serde_json::from_value(altered).unwrap();
            assert!(matches!(
                proof.checked_for(&identity),
                Err(RegistryError::IdentityConflict)
            ));
        }
        let request=parse_utility_request(&serde_json::to_vec(&json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":crate::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"proof-owner","ownerEpoch":1,"requestId":"sharing","draftRevision":0,"snapshot":snapshot.identity()},"operation":{"kind":"MONTH_RANGE","month":"2026-11"}})).unwrap()).unwrap();
        let lease = registry
            .lease_utility(
                &registry.utility_owner_marker().unwrap(),
                request.guard(),
                UtilityKind::MonthRange,
            )
            .unwrap();
        let facts = lease.facts().unwrap();
        assert!(
            facts.catalog_initialized(),
            "native preparation must seed the cell before the first catalog getter"
        );
        assert!(Arc::ptr_eq(facts.catalog().unwrap().resolver(), &native));
    }
}
