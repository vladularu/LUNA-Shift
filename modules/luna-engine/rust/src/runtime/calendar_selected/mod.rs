//! Original provider child lifetimes. This control leaf grants no report/source admission.
//! Generic values are retained native sources, never deserialized ready-profile inputs.

mod profiles;
mod raw;
mod state;
pub use profiles::{NativeSelectedProfileCache, NativeSelectedProfileView};
pub use raw::{
    NativeSelectedBase, NativeSelectedHistory, NativeSelectedTarget, NativeSelectedYouth,
    SelectedSourceError,
};
pub use state::{NativeSelectedLifecycle, SelectedControlSnapshot, SelectedReads};

use super::utility_lease::UtilityOwnerMarker;
use std::sync::{Arc, Weak, atomic::AtomicU64};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SelectedStatus {
    Loading,
    Ready,
    Error,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SelectedControlError {
    OwnerChanged,
    Closed,
    ForeignTicket,
    Replay,
    Capacity,
    SequenceExhausted,
    Poisoned,
}
/// Native IO identity. Numeric revisions alone never establish a matching child.
pub struct SelectedTargetRead {
    core: Weak<()>,
    owner: UtilityOwnerMarker,
    activation: u64,
    revision: u64,
}
pub struct SelectedHistoryRead {
    core: Weak<()>,
    owner: UtilityOwnerMarker,
    sequence: u64,
    load_revision: u64,
}
pub struct SelectedHistoryWrite {
    core: Weak<()>,
    owner: UtilityOwnerMarker,
    id: u64,
}
#[derive(Clone)]
struct Current {
    core: Weak<()>,
    owner: UtilityOwnerMarker,
    revision: Weak<AtomicU64>,
    expected_revision: u64,
}
fn check_owner(owner: &UtilityOwnerMarker) -> Result<(), SelectedControlError> {
    if owner
        .is_current()
        .map_err(|_| SelectedControlError::Poisoned)?
    {
        Ok(())
    } else {
        Err(SelectedControlError::OwnerChanged)
    }
}
impl Current {
    fn is_current(&self) -> Result<bool, SelectedControlError> {
        check_owner(&self.owner)?;
        Ok(self.core.upgrade().is_some()
            && self.revision.upgrade().is_some_and(|v| {
                v.load(std::sync::atomic::Ordering::Acquire) == self.expected_revision
            }))
    }
}
