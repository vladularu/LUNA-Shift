//! Source-only editor context. Thin UI/cache profiles are never constructors.
mod light;
use super::facts::{FactError, SnapshotFacts};
use crate::{
    contract::{SnapshotIdentity, SourceKind},
    input::{
        profile_editor::{EditorSection, ProfileEditorSource},
        profile_form::{FormClock, ProfileFormError},
    },
    rules::RuleResolver,
};
pub use light::{LightProfileContext, LightProfileError};
use serde_json::Value;
use std::sync::Arc;
pub struct ProfileEditorContext {
    facts: Arc<SnapshotFacts>,
    profile: Arc<Value>,
    reference_date: String,
    clock: FormClock,
}
impl ProfileEditorContext {
    /// Re-evaluate the Provider role at a raw observed instant from the retained original
    /// three source groups. This does not change the editor's pinned form clock or receipt.
    pub(crate) fn provider_profile_at(&self, epoch: i64) -> Result<Option<Arc<Value>>, FactError> {
        let snapshot = self.facts.snapshot();
        let state = |kind| {
            snapshot
                .sources()
                .iter()
                .find(|group| group.kind() == kind)
                .map(|group| group.state())
                .ok_or(FactError::InvalidShape(kind))
        };
        let environment = super::profile_clock::ProfileClockEnvironment::from_states(
            snapshot.identity().owner_scope(),
            state(SourceKind::WorkProfile)?,
            state(SourceKind::RemunerationProfiles)?,
            epoch,
        )?;
        environment.editor_profile(state(SourceKind::WorkPatternSettings)?)
    }
    pub fn from_facts(facts: Arc<SnapshotFacts>) -> Result<Option<Arc<Self>>, FactError> {
        let environment = facts
            .profile_clock_environment()?
            .ok_or(FactError::Clock("PROFILE_CLOCK_REQUIRED"))?;
        let pattern = facts
            .snapshot()
            .sources()
            .iter()
            .find(|s| s.kind() == SourceKind::WorkPatternSettings)
            .expect("checked source set")
            .state();
        let Some(profile) = environment.editor_profile(pattern)? else {
            return Ok(None);
        };
        let metadata = environment.prepared.clock_metadata();
        let reference_date = metadata["providerDate"]
            .as_str()
            .expect("native provider date")
            .to_owned();
        let stamp = jiff::Timestamp::from_millisecond(
            metadata["observedEpochMilliseconds"]
                .as_i64()
                .expect("checked raw instant"),
        )
        .map_err(|_| FactError::Clock("INVALID_PROFILE_CLOCK"))?;
        let clock = FormClock::from_instant(&stamp.to_string()).map_err(FactError::Profile)?;
        Ok(Some(Arc::new(Self {
            facts,
            profile,
            reference_date,
            clock,
        })))
    }
    pub fn profile(&self) -> &Arc<Value> {
        &self.profile
    }
    pub(crate) fn form_clock(&self) -> &FormClock {
        &self.clock
    }
    pub fn reference_date(&self) -> &str {
        &self.reference_date
    }
    pub fn identity(&self) -> &SnapshotIdentity {
        self.facts.snapshot().identity()
    }
    pub fn bootstrap(
        &self,
        section: EditorSection,
        from_more: bool,
        resolver: &RuleResolver,
    ) -> Result<Value, ProfileFormError> {
        ProfileEditorSource::new(
            &self.profile,
            section,
            from_more,
            &self.reference_date,
            &self.clock,
            resolver,
        )?
        .bootstrap(resolver)
    }
}
