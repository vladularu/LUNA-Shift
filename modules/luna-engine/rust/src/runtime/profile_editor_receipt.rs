//! Checked save-return role, never reconstructed from a thin UI/cache profile.
use super::facts::{FactError, SnapshotFacts};
use crate::contract::SnapshotIdentity;
use serde_json::Value;
use std::sync::Arc;
pub struct ProfileEditorReceipt {
    identity: SnapshotIdentity,
    profile: Arc<Value>,
}
impl ProfileEditorReceipt {
    pub fn from_committed_native(
        origin: &SnapshotIdentity,
        context: &super::write_resource::NativeWriteContext,
        committed: super::write_resource::CommittedNativeWrite,
    ) -> Result<Arc<Self>, super::write_resource::WriteResourceError> {
        let profile = context.committed_profile(origin, committed)?;
        Ok(Arc::new(Self {
            identity: origin.clone(),
            profile,
        }))
    }
    pub fn from_facts(facts: Arc<SnapshotFacts>) -> Result<Option<Arc<Self>>, FactError> {
        let environment = facts
            .profile_clock_environment()?
            .ok_or(FactError::Clock("PROFILE_CLOCK_REQUIRED"))?;
        let Some(profile) = environment.projected_receipt_profile()? else {
            return Ok(None);
        };
        Ok(Some(Arc::new(Self {
            identity: facts.snapshot().identity().clone(),
            profile,
        })))
    }
    pub fn identity(&self) -> &SnapshotIdentity {
        &self.identity
    }
    pub fn profile(&self) -> &Arc<Value> {
        &self.profile
    }
}
