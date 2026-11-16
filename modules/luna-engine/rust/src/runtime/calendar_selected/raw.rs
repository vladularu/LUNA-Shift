use super::*;
use crate::{
    contract::{
        ALL_SOURCE_KINDS, ContractError, SourceKind, SourceState, assembly::SnapshotAssembly,
    },
    input::{InputError, employment::RawEmploymentHistory},
    runtime::{
        facts::FactError,
        profile_clock::ProfileClockEnvironment,
        profile_inputs,
        write_resource::{WriteContextStamp, WriteResourceError},
    },
    target::InputStatus,
};
use serde_json::Value;

#[derive(Debug)]
pub enum SelectedSourceError {
    Control(SelectedControlError),
    Contract(ContractError),
    Write(WriteResourceError),
    Facts(FactError),
    Input(InputError),
    Target(crate::target::TargetError),
    ForeignSource,
    InvalidScope,
    Unavailable,
    Stale,
}
impl From<SelectedControlError> for SelectedSourceError {
    fn from(value: SelectedControlError) -> Self {
        Self::Control(value)
    }
}
/// Raw-input projection at one full-load epoch. No SelectedFullLoad admission.
pub struct NativeSelectedBase {
    pub(super) owner: UtilityOwnerMarker,
    stamp: WriteContextStamp,
    pub(super) profile: Option<Arc<Value>>,
}
pub struct NativeSelectedHistory {
    pub(super) owner: UtilityOwnerMarker,
    stamp: WriteContextStamp,
    pub(super) history: RawEmploymentHistory,
}
pub struct NativeSelectedTarget {
    pub(super) owner: UtilityOwnerMarker,
    stamp: WriteContextStamp,
    pub(super) snapshot: Option<Value>,
}
pub struct NativeSelectedYouth {
    pub(super) owner: UtilityOwnerMarker,
    pub(super) status: InputStatus,
    pub(super) value: Option<bool>,
}
fn begin(owner: &UtilityOwnerMarker, stamp: &WriteContextStamp) -> Result<(), SelectedSourceError> {
    check_owner(owner)?;
    stamp.validate().map_err(SelectedSourceError::Write)
}
impl NativeSelectedBase {
    pub fn prepare(
        owner: UtilityOwnerMarker,
        stamp: WriteContextStamp,
        mut source: SnapshotAssembly,
        epoch: i64,
    ) -> Result<Self, SelectedSourceError> {
        begin(&owner, &stamp)?;
        if !owner
            .matches_owner(source.fence().owner())
            .map_err(|_| SelectedSourceError::Control(SelectedControlError::OwnerChanged))?
        {
            return Err(SelectedSourceError::ForeignSource);
        }
        for kind in ALL_SOURCE_KINDS {
            if !matches!(
                kind,
                SourceKind::WorkProfile
                    | SourceKind::RemunerationProfiles
                    | SourceKind::WorkPatternSettings
            ) && !matches!(source.source_state(*kind), SourceState::NotRequested)
            {
                return Err(SelectedSourceError::InvalidScope);
            }
        }
        let env = ProfileClockEnvironment::from_states(
            source.owner_scope(),
            source.source_state(SourceKind::WorkProfile),
            source.source_state(SourceKind::RemunerationProfiles),
            epoch,
        )
        .map_err(SelectedSourceError::Facts)?;
        let pattern = ProfileClockEnvironment::checked_pattern_for(
            &env.prepared,
            source.source_state(SourceKind::WorkPatternSettings),
        )
        .map_err(SelectedSourceError::Facts)?;
        let profile = env
            .prepared
            .calculation_profile_base(pattern.as_ref(), env.history.as_deref())
            .map_err(SelectedSourceError::Input)?;
        source
            .bind_profile_clock(epoch, env.reference_date())
            .map_err(SelectedSourceError::Contract)?;
        let _sealed = source.seal().map_err(SelectedSourceError::Contract)?;
        check_owner(&owner)?;
        Ok(Self {
            owner,
            stamp,
            profile,
        })
    }
    pub fn stamp(&self) -> Result<&WriteContextStamp, SelectedSourceError> {
        check_owner(&self.owner)?;
        Ok(&self.stamp)
    }
}
impl NativeSelectedHistory {
    /// Actual raw SQL rows, never a mapped employment/profile array.
    pub fn prepare(
        owner: UtilityOwnerMarker,
        stamp: WriteContextStamp,
        rows: Arc<Vec<Value>>,
    ) -> Result<Self, SelectedSourceError> {
        begin(&owner, &stamp)?;
        let history =
            RawEmploymentHistory::try_from_rows(rows).map_err(SelectedSourceError::Input)?;
        check_owner(&owner)?;
        Ok(Self {
            owner,
            stamp,
            history,
        })
    }
    pub fn stamp(&self) -> Result<&WriteContextStamp, SelectedSourceError> {
        check_owner(&self.owner)?;
        Ok(&self.stamp)
    }
}
impl NativeSelectedTarget {
    pub fn prepare(
        owner: UtilityOwnerMarker,
        stamp: WriteContextStamp,
        source: &SourceState,
    ) -> Result<Self, SelectedSourceError> {
        begin(&owner, &stamp)?;
        let (status, snapshot) = profile_inputs::target_snapshot(source);
        if status != InputStatus::Ready {
            return Err(SelectedSourceError::Unavailable);
        }
        check_owner(&owner)?;
        Ok(Self {
            owner,
            stamp,
            snapshot,
        })
    }
    pub fn stamp(&self) -> Result<&WriteContextStamp, SelectedSourceError> {
        check_owner(&self.owner)?;
        Ok(&self.stamp)
    }
}
impl NativeSelectedYouth {
    pub fn prepare(
        owner: UtilityOwnerMarker,
        source: &SourceState,
    ) -> Result<Self, SelectedSourceError> {
        check_owner(&owner)?;
        let (status, value) = profile_inputs::youth_snapshot(source);
        check_owner(&owner)?;
        Ok(Self {
            owner,
            status,
            value,
        })
    }
}
