//! Checked pre-seal clock sources and small persistent metadata. Clock outputs
//! are never deserializable salary/target facts or reusable admission proofs.
use super::{
    RegistryError,
    facts::FactError,
    report::{ReportIssue, SectionOutput},
    sources::{RequiredCoverage, ready_state},
};
use crate::{
    contract::{
        CanonicalHashWriter, CanonicalValueRef, DataPresence, ImmutableSnapshot, SnapshotIdentity,
        SourceKind, SourceState,
    },
    input::{
        self,
        employment::RawEmploymentHistory,
        personal_context::CheckedWorkPatternSettings,
        profile_clock::{PreparedProfileClock, prepare_profile_clock},
        stored_profile::{OpaqueStoredWorkProfile, checked_stored_work_profile},
    },
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::sync::Arc;
pub(crate) struct ProfileClockEnvironment {
    pub(crate) prepared: PreparedProfileClock,
    pub(crate) profile: Option<Arc<OpaqueStoredWorkProfile>>,
    pub(crate) history: Option<Arc<RawEmploymentHistory>>,
    scope: String,
    key: String,
}
fn source_error(kind: SourceKind, error: super::sources::SourceReadError) -> FactError {
    FactError::Source { kind, error }
}
fn nullable(state: &SourceState, kind: SourceKind) -> Result<Option<&Value>, FactError> {
    ready_state(state, RequiredCoverage::AllHistory)
        .and_then(|r| r.nullable())
        .map_err(|e| source_error(kind, e))
}
fn value(state: &SourceState, kind: SourceKind) -> Result<&Value, FactError> {
    ready_state(state, RequiredCoverage::AllHistory)
        .and_then(|r| r.value())
        .map_err(|e| source_error(kind, e))
}
fn hash_source(hash: &mut Sha256, state: &SourceState) -> Result<(), FactError> {
    let source = ready_state(state, RequiredCoverage::AllHistory)
        .map_err(|e| source_error(SourceKind::WorkProfile, e))?;
    serde_json::to_writer(CanonicalHashWriter(&mut *hash), source.coverage)
        .map_err(|_| FactError::Clock("CLOCK_KEY_FAILED"))?;
    match source.data {
        DataPresence::Null => hash.update(b"NULL\0"),
        DataPresence::Value { value } => {
            hash.update(b"VALUE\0");
            serde_json::to_writer(CanonicalHashWriter(&mut *hash), &CanonicalValueRef(value))
                .map_err(|_| FactError::Clock("CLOCK_KEY_FAILED"))?;
        }
        DataPresence::Missing => return Err(FactError::Clock("CLOCK_KEY_FAILED")),
    };
    Ok(())
}
impl ProfileClockEnvironment {
    pub(crate) fn from_states(
        scope: &str,
        profile_state: &SourceState,
        history_state: &SourceState,
        epoch: i64,
    ) -> Result<Arc<Self>, FactError> {
        let profile = nullable(profile_state, SourceKind::WorkProfile)?
            .map(|v| {
                let object = v
                    .as_object()
                    .filter(|o| {
                        o.len() == 2 && o.contains_key("profileRow") && o.contains_key("salaryRows")
                    })
                    .ok_or(FactError::InvalidShape(SourceKind::WorkProfile))?;
                let salary = object["salaryRows"]
                    .as_array()
                    .ok_or(FactError::InvalidShape(SourceKind::WorkProfile))?;
                checked_stored_work_profile(
                    Arc::new(object["profileRow"].clone()),
                    Arc::new(salary.clone()),
                )
                .map(Arc::new)
                .map_err(FactError::Profile)
            })
            .transpose()?;
        // Preserve original loadProfile error precedence before accessing history.
        if let Some(profile) = &profile {
            let mapped = input::stored_profile::map_profile_row(profile.raw_profile())
                .map_err(FactError::Profile)?;
            input::stored_profile::load_simple_salary_for_profile(
                &mapped,
                profile.raw_salary_rows(),
            )
            .map_err(|e| {
                FactError::Profile(input::InputError::source(e.to_string(), "DataLoadFailure"))
            })?;
        }
        let history = if profile.is_some() {
            let rows = value(history_state, SourceKind::RemunerationProfiles)?
                .as_array()
                .ok_or(FactError::InvalidShape(SourceKind::RemunerationProfiles))?;
            Some(Arc::new(
                RawEmploymentHistory::try_from_rows(Arc::new(rows.clone()))
                    .map_err(FactError::Remuneration)?,
            ))
        } else {
            None
        };
        let prepared = prepare_profile_clock(profile.as_deref(), history.as_deref(), epoch)
            .map_err(FactError::Profile)?;
        let mut basis = prepared.clock_metadata().clone();
        let record = basis
            .as_object_mut()
            .ok_or(FactError::Clock("CLOCK_KEY_FAILED"))?;
        record.remove("observedEpochMilliseconds");
        record.remove("validUntilEpochMilliseconds");
        let context = json!({"schemaVersion":1,"ownerScope":scope,"engineVersion":crate::ENGINE_VERSION,"calculationContractVersion":crate::contract::CONTRACT_VERSION,"basis":basis});
        let mut hash = Sha256::new();
        hash.update(b"luna-source-profile-clock-v1\0");
        serde_json::to_writer(CanonicalHashWriter(&mut hash), &CanonicalValueRef(&context))
            .map_err(|_| FactError::Clock("CLOCK_KEY_FAILED"))?;
        hash.update(b"profile-source\0");
        hash_source(&mut hash, profile_state)?;
        if profile.is_some() {
            hash.update(b"history-source\0");
            hash_source(&mut hash, history_state)?;
        }
        let key = format!("{:x}", hash.finalize());
        Ok(Arc::new(Self {
            prepared,
            profile,
            history,
            scope: scope.into(),
            key,
        }))
    }
    pub(crate) fn source_clock_key(&self) -> &str {
        &self.key
    }
    pub(crate) fn reference_date(&self) -> &str {
        self.prepared.clock_metadata()["referenceDate"]
            .as_str()
            .expect("native clock date")
    }
    pub(crate) fn projection_date(&self) -> Option<&str> {
        self.prepared.clock_metadata()["savedDate"].as_str()
    }
    fn pattern(
        &self,
        state: &SourceState,
    ) -> Result<Option<CheckedWorkPatternSettings>, FactError> {
        Self::checked_pattern_for(&self.prepared, state)
    }
    pub(crate) fn checked_pattern_for(
        prepared: &PreparedProfileClock,
        state: &SourceState,
    ) -> Result<Option<CheckedWorkPatternSettings>, FactError> {
        if prepared.requires_work_pattern() {
            Ok(Some(
                CheckedWorkPatternSettings::try_from_raw_rows(value(
                    state,
                    SourceKind::WorkPatternSettings,
                )?)
                .map_err(FactError::Personal)?,
            ))
        } else {
            Ok(None)
        }
    }
    pub(crate) fn calculation_profile_base(
        &self,
        state: &SourceState,
    ) -> Result<Option<Arc<Value>>, FactError> {
        self.prepared
            .calculation_profile_base(self.pattern(state)?.as_ref(), self.history.as_deref())
            .map_err(FactError::Profile)
    }
    pub(crate) fn editor_profile(
        &self,
        state: &SourceState,
    ) -> Result<Option<Arc<Value>>, FactError> {
        self.prepared
            .editor_profile(self.pattern(state)?.as_ref(), self.history.as_deref())
            .map_err(FactError::Profile)
    }
    pub(crate) fn projected_receipt_profile(&self) -> Result<Option<Arc<Value>>, FactError> {
        self.prepared
            .projected_receipt_profile(self.history.as_deref())
            .map_err(FactError::Profile)
    }
    pub(crate) fn profiles(&self, state: &SourceState) -> Result<Value, FactError> {
        let pattern = self.pattern(state)?;
        self.prepared
            .profile_metadata(pattern.as_ref())
            .map_err(FactError::Profile)
    }
    pub(crate) fn frame(&self, pattern: &SourceState) -> Value {
        let profiles = self.profiles(pattern).map_err(ReportIssue::from);
        let summary = match &profiles {
            Ok(profiles) => profiles
                .get("providerProfile")
                .ok_or_else(|| ReportIssue::new("PROFILE_SUMMARY_INVALID"))
                .and_then(|provider| {
                    if provider.is_null() {
                        return Ok(Value::Null);
                    }
                    crate::input::profile_editor::work_salary_summary(provider)
                        .map(|text| json!({"workAndSalary":text}))
                        .map_err(|_| ReportIssue::new("PROFILE_SUMMARY_INVALID"))
                }),
            Err(issue) => Err(issue.clone()),
        };
        json!({"ok":true,"state":"PROFILE_CLOCK_READY","schemaVersion":1,"engineVersion":crate::ENGINE_VERSION,"calculationContractVersion":crate::contract::CONTRACT_VERSION,"ownerScope":self.scope,"sourceClockKey":self.source_clock_key(),"clock":self.prepared.clock_metadata(),"profiles":SectionOutput::from_result(profiles),"settingsSummary":SectionOutput::from_result(summary)})
    }
}
fn source(snapshot: &ImmutableSnapshot, kind: SourceKind) -> &SourceState {
    snapshot
        .sources()
        .iter()
        .find(|s| s.kind() == kind)
        .expect("checked source group")
        .state()
}
pub(crate) fn from_snapshot(
    snapshot: &ImmutableSnapshot,
) -> Result<Option<Arc<ProfileClockEnvironment>>, FactError> {
    let Some(clock) = snapshot.clock_context() else {
        return Ok(None);
    };
    let env = ProfileClockEnvironment::from_states(
        snapshot.identity().owner_scope(),
        source(snapshot, SourceKind::WorkProfile),
        source(snapshot, SourceKind::RemunerationProfiles),
        clock.observed_epoch_milliseconds(),
    )?;
    if env.reference_date() != snapshot.reference_date() {
        return Err(FactError::Clock("CLOCK_REFERENCE_MISMATCH"));
    }
    Ok(Some(env))
}
/// Never Deserialize or public construction. Builder/registration binds this
/// to the final complete identity, after native source and reference checking.
pub(crate) struct ProfileClockAdmission {
    identity: SnapshotIdentity,
    environment: Result<Option<Arc<ProfileClockEnvironment>>, FactError>,
}
impl ProfileClockAdmission {
    pub(crate) fn from_environment(
        snapshot: &ImmutableSnapshot,
        env: Arc<ProfileClockEnvironment>,
    ) -> Result<Self, RegistryError> {
        if env.reference_date() != snapshot.reference_date()
            || snapshot.clock_context().is_none_or(|c| {
                c.observed_epoch_milliseconds()
                    != env.prepared.clock_metadata()["observedEpochMilliseconds"]
                        .as_i64()
                        .expect("native raw instant")
            })
        {
            return Err(RegistryError::IdentityConflict);
        }
        Ok(Self {
            identity: snapshot.identity().clone(),
            environment: Ok(Some(env)),
        })
    }
    pub(crate) fn registration(
        snapshot: &ImmutableSnapshot,
    ) -> Result<Option<Self>, RegistryError> {
        if snapshot.clock_context().is_none() {
            return Ok(None);
        }
        let env = from_snapshot(snapshot);
        if matches!(env, Err(FactError::Clock("CLOCK_REFERENCE_MISMATCH"))) {
            return Err(RegistryError::IdentityConflict);
        }
        Ok(Some(Self {
            identity: snapshot.identity().clone(),
            environment: env,
        }))
    }
    pub(crate) fn checked_for(
        &self,
        snapshot: &ImmutableSnapshot,
    ) -> Result<Result<Option<Arc<ProfileClockEnvironment>>, FactError>, RegistryError> {
        if self.identity != *snapshot.identity() {
            return Err(RegistryError::IdentityConflict);
        }
        Ok(self.environment.clone())
    }
}
