//! Retained raw-six source leaf. No registry registration, transport or utility arm.
use super::{
    ExportTimeError, NativeTimeExportSource,
    collation::{ExportCollationDraft, ExportCollationError, VerifiedExportCollation},
    structure::ExportStructureIndex,
};
use crate::{
    contract::{self, SourceKind, SourceState, assembly::SnapshotAssembly},
    runtime::{
        RegistryError,
        catalog_source::CatalogSourceError,
        facts::{FactError, SnapshotFacts},
        profile_clock::{ProfileClockAdmission, ProfileClockEnvironment},
        utility_lease::UtilityOwnerMarker,
        write_resource::{WriteContextStamp, WriteResourceError},
    },
};
use std::sync::{
    Arc, OnceLock,
    atomic::{AtomicUsize, Ordering},
};
/// Artifact-only ceiling; no partial CSV is returned.
pub const MAX_CSV_BYTES: usize = 16 * 1024 * 1024;
#[derive(Debug)]
pub enum ExportResourceError {
    OwnerChanged,
    ForeignBinding,
    MissingProfile,
    Expired,
    TooLarge,
    InvalidSourceScope,
    Facts(FactError),
    Contract(contract::ContractError),
    Registry(RegistryError),
    Stamp(WriteResourceError),
    Catalog(CatalogSourceError),
    Collation(ExportCollationError),
    Time(Arc<ExportTimeError>),
}
impl std::fmt::Display for ExportResourceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Die Exportquellen sind nicht verf\u{00fc}gbar.")
    }
}
impl std::error::Error for ExportResourceError {}
fn check_owner(owner: &UtilityOwnerMarker) -> Result<(), ExportResourceError> {
    if owner
        .is_current()
        .map_err(|_| ExportResourceError::OwnerChanged)?
    {
        Ok(())
    } else {
        Err(ExportResourceError::OwnerChanged)
    }
}
struct Source {
    owner: UtilityOwnerMarker,
    stamp: WriteContextStamp,
    facts: Arc<SnapshotFacts>,
    index: Arc<ExportStructureIndex>,
    observed_epoch: i64,
    valid_until: Option<i64>,
    time: OnceLock<Result<NativeTimeExportSource, Arc<ExportTimeError>>>,
    initializations: AtomicUsize,
}
/// Only genuine native source assembly can construct this immutable capability.
#[derive(Clone)]
pub struct ExportSourceResource {
    inner: Arc<Source>,
}
impl ExportSourceResource {
    pub fn prepare(
        owner: UtilityOwnerMarker,
        stamp: WriteContextStamp,
        mut assembly: SnapshotAssembly,
        epoch: i64,
    ) -> Result<Self, ExportResourceError> {
        check_owner(&owner)?;
        stamp.validate().map_err(ExportResourceError::Stamp)?;
        contract::RawClockContext::from_epoch_milliseconds(epoch)
            .map_err(ExportResourceError::Contract)?;
        if !owner
            .matches_owner(assembly.fence().owner())
            .map_err(|_| ExportResourceError::OwnerChanged)?
        {
            return Err(ExportResourceError::ForeignBinding);
        }
        for kind in contract::ALL_SOURCE_KINDS {
            if !matches!(
                kind,
                SourceKind::WorkProfile
                    | SourceKind::RemunerationProfiles
                    | SourceKind::WorkPatternSettings
                    | SourceKind::WorkingTimeTarget
                    | SourceKind::CalendarEntries
                    | SourceKind::YouthPreference
            ) && !matches!(assembly.source_state(*kind), SourceState::NotRequested)
            {
                return Err(ExportResourceError::InvalidSourceScope);
            }
        }
        let env = ProfileClockEnvironment::from_states(
            assembly.owner_scope(),
            assembly.source_state(SourceKind::WorkProfile),
            assembly.source_state(SourceKind::RemunerationProfiles),
            epoch,
        )
        .map_err(ExportResourceError::Facts)?;
        if env.profile.is_none() {
            return Err(ExportResourceError::MissingProfile);
        }
        let valid_until = env.prepared.clock_metadata()["validUntilEpochMilliseconds"].as_i64();
        assembly
            .bind_profile_clock(epoch, env.reference_date())
            .map_err(ExportResourceError::Contract)?;
        let snapshot = assembly.seal().map_err(ExportResourceError::Contract)?;
        let clock = ProfileClockAdmission::from_environment(&snapshot, env)
            .map_err(ExportResourceError::Registry)?;
        let facts = Arc::new(SnapshotFacts::new(snapshot));
        facts
            .seed_profile_clock(&clock)
            .map_err(ExportResourceError::Registry)?;
        let index = Arc::new(
            ExportStructureIndex::from_facts(&facts)
                .map_err(|e| ExportResourceError::Time(Arc::new(e)))?,
        );
        facts.catalog().map_err(ExportResourceError::Catalog)?;
        check_owner(&owner)?;
        Ok(Self {
            inner: Arc::new(Source {
                owner,
                stamp,
                facts,
                index,
                observed_epoch: epoch,
                valid_until,
                time: OnceLock::new(),
                initializations: AtomicUsize::new(0),
            }),
        })
    }
    fn check(
        &self,
        owner: &UtilityOwnerMarker,
        stamp: &WriteContextStamp,
        epoch: i64,
    ) -> Result<(), ExportResourceError> {
        check_owner(&self.inner.owner)?;
        check_owner(owner)?;
        if !self.inner.owner.shares_owner(owner) || &self.inner.stamp != stamp {
            return Err(ExportResourceError::ForeignBinding);
        }
        contract::RawClockContext::from_epoch_milliseconds(epoch)
            .map_err(ExportResourceError::Contract)?;
        if epoch < self.inner.observed_epoch
            || self.inner.valid_until.is_some_and(|until| epoch >= until)
        {
            return Err(ExportResourceError::Expired);
        }
        Ok(())
    }
    pub fn structure(&self) -> &Arc<ExportStructureIndex> {
        &self.inner.index
    }
    pub fn initialization_count(&self) -> usize {
        self.inner.initializations.load(Ordering::Relaxed)
    }
    pub fn valid_until_epoch_milliseconds(&self) -> Option<i64> {
        self.inner.valid_until
    }
    pub fn target_preparation_stats(&self) -> Option<crate::target::TargetPreparationStats> {
        self.inner
            .time
            .get()
            .and_then(|v| v.as_ref().ok())
            .map(NativeTimeExportSource::target_preparation_stats)
    }
    pub fn collation_draft(
        &self,
        owner: &UtilityOwnerMarker,
        stamp: &WriteContextStamp,
        period: &str,
        epoch: i64,
    ) -> Result<ExportCollationDraft, ExportResourceError> {
        self.check(owner, stamp, epoch)?;
        let draft = ExportCollationDraft::prepare(
            self.inner.owner.clone(),
            self.inner.stamp.clone(),
            Arc::clone(&self.inner.index),
            period,
        )
        .map_err(ExportResourceError::Collation)?;
        self.check(owner, stamp, epoch)?;
        Ok(draft)
    }
    /// Worker-side producer only. No transport/utility route exposes this leaf.
    /// The following job package must keep its completion through final publish.
    pub fn produce_csv(
        &self,
        owner: &UtilityOwnerMarker,
        stamp: &WriteContextStamp,
        period: &str,
        proof: Arc<VerifiedExportCollation>,
        epoch: i64,
        max_bytes: usize,
    ) -> Result<ExportCsvArtifact, ExportResourceError> {
        self.check(owner, stamp, epoch)?;
        if max_bytes > MAX_CSV_BYTES {
            return Err(ExportResourceError::TooLarge);
        }
        let ranks = proof
            .ranks_for(owner, stamp, &self.inner.index, period)
            .map_err(ExportResourceError::Collation)?;
        // OnceLock computation is outside every resource/registry/queue mutex.
        let source = self
            .inner
            .time
            .get_or_init(|| {
                self.inner.initializations.fetch_add(1, Ordering::Relaxed);
                NativeTimeExportSource::with_structure(
                    &self.inner.facts,
                    Arc::clone(&self.inner.index),
                )
                .map_err(Arc::new)
            })
            .as_ref()
            .map_err(|e| ExportResourceError::Time(Arc::clone(e)))?;
        let document = source
            .document(period, ranks)
            .map_err(|e| ExportResourceError::Time(Arc::new(e)))?;
        let csv = document
            .to_csv(max_bytes)
            .map_err(|e| ExportResourceError::Time(Arc::new(e)))?;
        self.check(owner, stamp, epoch)?;
        proof
            .ranks_for(owner, stamp, &self.inner.index, period)
            .map_err(ExportResourceError::Collation)?;
        Ok(ExportCsvArtifact {
            source: self.clone(),
            proof,
            period: period.to_owned(),
            epoch,
            csv,
        })
    }
}
/// Not Serialize/Deserialize: no raw source, proof map or Ready JSON is echoed.
/// A publication writer must recheck with its latest raw stamp/clock after Serde
/// and buffer allocation. The immutable artifact pins all native witnesses.
pub struct ExportCsvArtifact {
    source: ExportSourceResource,
    proof: Arc<VerifiedExportCollation>,
    period: String,
    epoch: i64,
    csv: String,
}
impl ExportCsvArtifact {
    pub fn csv(&self) -> Result<&str, ExportResourceError> {
        self.source.check(
            &self.source.inner.owner,
            &self.source.inner.stamp,
            self.epoch,
        )?;
        self.proof
            .ranks_for(
                &self.source.inner.owner,
                &self.source.inner.stamp,
                &self.source.inner.index,
                &self.period,
            )
            .map_err(ExportResourceError::Collation)?;
        Ok(&self.csv)
    }
    pub fn is_current_at(
        &self,
        owner: &UtilityOwnerMarker,
        stamp: &WriteContextStamp,
        epoch: i64,
    ) -> Result<bool, ExportResourceError> {
        match self.source.check(owner, stamp, epoch) {
            Ok(()) => {}
            Err(
                ExportResourceError::OwnerChanged
                | ExportResourceError::ForeignBinding
                | ExportResourceError::Expired,
            ) => return Ok(false),
            Err(e) => return Err(e),
        }
        Ok(self
            .proof
            .ranks_for(owner, stamp, &self.source.inner.index, &self.period)
            .is_ok())
    }
}
