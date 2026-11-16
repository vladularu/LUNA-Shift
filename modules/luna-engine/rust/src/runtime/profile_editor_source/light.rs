//! A local raw source owner. This intentionally never enters the report pool,
//! starts global preparation or registers/replaces a calculation snapshot.
use super::ProfileEditorContext;
use crate::{
    contract::{
        ALL_SOURCE_KINDS, ContractError, SourceKind, SourceState, assembly::SnapshotAssembly,
    },
    runtime::{
        RegistryError,
        facts::{FactError, SnapshotFacts},
        profile_clock::{ProfileClockAdmission, ProfileClockEnvironment},
        utility_lease::UtilityOwnerMarker,
        write_resource::{WriteContextStamp, WriteResourceError},
    },
};
use std::sync::Arc;
#[derive(Debug)]
pub enum LightProfileError {
    OwnerChanged,
    InvalidSourceScope,
    Contract(ContractError),
    Facts(FactError),
    Registry(RegistryError),
    Write(WriteResourceError),
}
pub struct LightProfileContext {
    owner: UtilityOwnerMarker,
    stamp: WriteContextStamp,
    context: Option<Arc<ProfileEditorContext>>,
    observed_epoch_milliseconds: i64,
}
impl LightProfileContext {
    /// `source` is an independent contract assembly containing actual raw profile,
    /// remuneration and work-pattern reads. Missing/failed reads remain distinct.
    /// The stamp is the coherent private IO capture, never a UI profile revision.
    pub fn prepare(
        owner: UtilityOwnerMarker,
        stamp: WriteContextStamp,
        mut source: SnapshotAssembly,
        epoch: i64,
    ) -> Result<Self, LightProfileError> {
        stamp.validate().map_err(LightProfileError::Write)?;
        if !owner
            .matches_owner(source.fence().owner())
            .map_err(|_| LightProfileError::OwnerChanged)?
        {
            return Err(LightProfileError::OwnerChanged);
        }
        for kind in ALL_SOURCE_KINDS {
            if !matches!(
                kind,
                SourceKind::WorkProfile
                    | SourceKind::RemunerationProfiles
                    | SourceKind::WorkPatternSettings
            ) && !matches!(source.source_state(*kind), SourceState::NotRequested)
            {
                return Err(LightProfileError::InvalidSourceScope);
            }
        }
        let env = ProfileClockEnvironment::from_states(
            source.owner_scope(),
            source.source_state(SourceKind::WorkProfile),
            source.source_state(SourceKind::RemunerationProfiles),
            epoch,
        )
        .map_err(LightProfileError::Facts)?;
        source
            .bind_profile_clock(epoch, env.reference_date())
            .map_err(LightProfileError::Contract)?;
        let snapshot = source.seal().map_err(LightProfileError::Contract)?;
        let proof = ProfileClockAdmission::from_environment(&snapshot, env)
            .map_err(LightProfileError::Registry)?;
        let facts = Arc::new(SnapshotFacts::new(snapshot));
        facts
            .seed_profile_clock(&proof)
            .map_err(LightProfileError::Registry)?;
        let context = ProfileEditorContext::from_facts(facts).map_err(LightProfileError::Facts)?;
        if !owner
            .is_current()
            .map_err(|_| LightProfileError::OwnerChanged)?
        {
            return Err(LightProfileError::OwnerChanged);
        }
        Ok(Self {
            owner,
            stamp,
            context,
            observed_epoch_milliseconds: epoch,
        })
    }
    pub fn context(&self) -> Option<&Arc<ProfileEditorContext>> {
        self.context.as_ref()
    }
    pub fn stamp(&self) -> &WriteContextStamp {
        &self.stamp
    }
    pub fn observed_epoch_milliseconds(&self) -> i64 {
        self.observed_epoch_milliseconds
    }
    /// Core/owner identity only. This does not prove a selected profile/full-load link.
    pub fn shares_loaded_source(
        &self,
        source: &super::super::calendar_loaded::LoadedReadSource,
    ) -> bool {
        source.shares_owner(&self.owner)
    }
    pub(crate) fn shares_lease(&self, lease: &super::super::utility_lease::UtilityLease) -> bool {
        self.owner.shares_lease(lease)
    }
    pub(crate) fn shares_write_context(
        &self,
        context: &super::super::write_resource::NativeWriteContext,
    ) -> bool {
        context.shares_owner(&self.owner)
    }
    pub fn is_current(&self) -> Result<bool, LightProfileError> {
        self.owner
            .is_current()
            .map_err(|_| LightProfileError::OwnerChanged)
    }
}
