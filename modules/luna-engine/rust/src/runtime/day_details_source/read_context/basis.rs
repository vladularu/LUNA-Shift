//! Immutable checked inputs for clock role reprojection, not a Provider-ready
//! or FullLoad admission proof. No fresh DB/source rows are read on rebase.
use super::*;
use crate::input::{
    employment::RawEmploymentHistory, profile_clock::prepare_profile_clock,
    stored_profile::OpaqueStoredWorkProfile,
};
pub(super) struct ReadBasis {
    pub owner: UtilityOwnerMarker,
    pub stamp: WriteContextStamp,
    pub profile: Option<Arc<OpaqueStoredWorkProfile>>,
    pub history: Option<Arc<RawEmploymentHistory>>,
    pub pattern: Arc<SourceState>,
    pub target_status: InputStatus,
    pub target: Option<Value>,
    pub youth_status: InputStatus,
    pub youth: Option<bool>,
    pub resolver: Arc<RuleResolver>,
}
impl ReadBasis {
    pub(super) fn project(
        self: &Arc<Self>,
        epoch: i64,
    ) -> Result<NativeDayDetailsReadContext, DayDetailsSourceError> {
        check(&self.owner)?;
        crate::contract::RawClockContext::from_epoch_milliseconds(epoch)
            .map_err(DayDetailsSourceError::Contract)?;
        let clock = prepare_profile_clock(self.profile.as_deref(), self.history.as_deref(), epoch)
            .map_err(|e| DayDetailsSourceError::Facts(FactError::Profile(e)))?;
        self.project_prepared(epoch, &clock)
    }
    pub(super) fn project_prepared(
        self: &Arc<Self>,
        epoch: i64,
        clock: &crate::input::profile_clock::PreparedProfileClock,
    ) -> Result<NativeDayDetailsReadContext, DayDetailsSourceError> {
        check(&self.owner)?;
        crate::contract::RawClockContext::from_epoch_milliseconds(epoch)
            .map_err(DayDetailsSourceError::Contract)?;
        let pattern = ProfileClockEnvironment::checked_pattern_for(clock, &self.pattern)
            .map_err(DayDetailsSourceError::Facts)?;
        let base = clock
            .calculation_profile_base(pattern.as_ref(), self.history.as_deref())
            .map_err(|e| DayDetailsSourceError::Facts(FactError::Profile(e)))?;
        let until = clock.clock_metadata()["validUntilEpochMilliseconds"].as_i64();
        let parts = match base {
            None => None,
            Some(base) => {
                let history = self
                    .history
                    .as_ref()
                    .ok_or(DayDetailsSourceError::InvalidResult)?;
                let profile = Arc::new(
                    crate::target::profile::create_working_time_calculation_profile(
                        &base,
                        self.target.as_ref(),
                        history.profiles(),
                        self.target_status,
                        self.youth,
                        self.youth_status,
                    )
                    .map_err(|e| DayDetailsSourceError::Facts(FactError::Target(e)))?,
                );
                let targets = PreparedTargetSource::new(Arc::clone(&profile));
                Some(Arc::new(ReadParts {
                    profile,
                    targets,
                    resolver: Arc::clone(&self.resolver),
                }))
            }
        };
        check(&self.owner)?;
        Ok(NativeDayDetailsReadContext {
            owner: self.owner.clone(),
            stamp: self.stamp.clone(),
            basis: Arc::clone(self),
            parts,
            observed_epoch_milliseconds: epoch,
            valid_until_epoch_milliseconds: until,
        })
    }
}
