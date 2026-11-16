//! Automatic native profile clock over one immutable raw builder.
use super::*;
use crate::{
    contract::{ContractError, RawClockContext, SourceKind},
    runtime::{profile_clock::ProfileClockEnvironment, report::ReportIssue},
};
use serde_json::{Value, json};
impl SnapshotAssemblyPool {
    pub fn profile_clock(
        &self,
        id: BuilderId,
        observed_epoch_milliseconds: i64,
    ) -> Result<Value, AssemblyError> {
        let mut operation = RawOperation::new(self, id)?;
        RawClockContext::from_epoch_milliseconds(observed_epoch_milliseconds)?;
        let environment = if let Some(environment) = operation.builder.profile_clock.get() {
            if environment.prepared.clock_metadata()["observedEpochMilliseconds"]
                != observed_epoch_milliseconds
            {
                return Err(ContractError::IdentityMismatch.into());
            }
            Ok(Arc::clone(environment))
        } else {
            let assembly = operation
                .body
                .as_ref()
                .ok_or(AssemblyError::UnknownBuilder)?;
            ProfileClockEnvironment::from_states(
                assembly.owner_scope(),
                assembly.source_state(SourceKind::WorkProfile),
                assembly.source_state(SourceKind::RemunerationProfiles),
                observed_epoch_milliseconds,
            )
        };
        let value = match environment {
            Err(error) => {
                json!({"ok":true,"state":"PROFILE_CLOCK_UNAVAILABLE","reason":ReportIssue::from(error)})
            }
            Ok(environment) => {
                let body = operation
                    .body
                    .as_mut()
                    .ok_or(AssemblyError::UnknownBuilder)?;
                body.bind_profile_clock(observed_epoch_milliseconds, environment.reference_date())?;
                let value = environment.frame(body.source_state(SourceKind::WorkPatternSettings));
                let _ = operation.builder.profile_clock.set(environment);
                value
            }
        };
        operation.restore()?;
        Ok(value)
    }
}
