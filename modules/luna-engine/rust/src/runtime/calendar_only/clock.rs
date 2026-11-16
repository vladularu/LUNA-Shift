use super::super::{
    profile_clock::ProfileClockEnvironment,
    report::ReportIssue,
    sources::{RequiredCoverage, ready_state},
};
use crate::contract::{CanonicalHashWriter, CanonicalValueRef, OwnerIdentity, SourceState};
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CalendarClockOrigin {
    AnalysisProfile,
    DegradedSavedZone,
    DegradedBerlin,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarClockMetadata {
    pub origin: CalendarClockOrigin,
    pub observed_epoch_milliseconds: i64,
    pub valid_until_epoch_milliseconds: Option<i64>,
    pub time_zone: String,
    pub reference_date: String,
    pub month: String,
    pub cacheable: bool,
    pub issue: Option<ReportIssue>,
}
pub struct CalendarClock {
    metadata: CalendarClockMetadata,
    key: String,
    provider_time_zone: Option<String>,
}
impl CalendarClock {
    pub fn prepare(
        owner_scope: &str,
        profile: &SourceState,
        history: &SourceState,
        epoch: i64,
    ) -> Result<Self, ReportIssue> {
        let invalid = || ReportIssue::new("CALENDAR_CLOCK_INVALID");
        OwnerIdentity::new(owner_scope, 1).map_err(|_| invalid())?;
        if epoch.unsigned_abs() > crate::money::MAX_SAFE_INTEGER as u64 {
            return Err(invalid());
        }
        let stamp = jiff::Timestamp::from_millisecond(epoch).map_err(|_| invalid())?;
        let mut hash = Sha256::new();
        hash.update(b"luna-calendar-only-clock-v2\0");
        let mut provider_time_zone = None;
        let metadata =
            match ProfileClockEnvironment::from_states(owner_scope, profile, history, epoch) {
                Ok(env) => {
                    super::location::update(&mut hash, &env)?;
                    let raw = env.prepared.clock_metadata();
                    provider_time_zone = Some(
                        raw["providerTimeZone"]
                            .as_str()
                            .ok_or_else(invalid)?
                            .to_owned(),
                    );
                    CalendarClockMetadata {
                        origin: CalendarClockOrigin::AnalysisProfile,
                        observed_epoch_milliseconds: epoch,
                        valid_until_epoch_milliseconds: Some(
                            raw["validUntilEpochMilliseconds"]
                                .as_i64()
                                .ok_or_else(invalid)?,
                        ),
                        time_zone: raw["analysisTimeZone"]
                            .as_str()
                            .ok_or_else(invalid)?
                            .to_owned(),
                        reference_date: raw["referenceDate"]
                            .as_str()
                            .ok_or_else(invalid)?
                            .to_owned(),
                        month: raw["month"].as_str().ok_or_else(invalid)?.to_owned(),
                        cacheable: true,
                        issue: None,
                    }
                }
                Err(error) => {
                    // Availability policy: completed source loads use the original analysis
                    // clock. Incomplete/invalid profile IO never becomes a ready profile.
                    // A checked saved zone keeps calendar days usable, but is not cache-fresh.
                    let saved = ready_state(profile, RequiredCoverage::AllHistory)
                        .ok()
                        .and_then(|v| v.value().ok())
                        .and_then(|v| v.get("profileRow"))
                        .and_then(|v| crate::input::stored_profile::map_profile_row(v).ok())
                        .and_then(|v| v["timeZone"].as_str().map(str::to_owned));
                    let saved = saved.filter(|z| crate::time_zone::zone(z).is_ok());
                    let origin = if saved.is_some() {
                        CalendarClockOrigin::DegradedSavedZone
                    } else {
                        CalendarClockOrigin::DegradedBerlin
                    };
                    let time_zone = saved.unwrap_or_else(|| "Europe/Berlin".into());
                    let reference_date = stamp
                        .to_zoned(crate::time_zone::zone(&time_zone).map_err(|_| invalid())?)
                        .date()
                        .to_string();
                    CalendarClockMetadata {
                        origin,
                        observed_epoch_milliseconds: epoch,
                        valid_until_epoch_milliseconds: None,
                        time_zone,
                        month: reference_date.get(..7).ok_or_else(invalid)?.into(),
                        reference_date,
                        cacheable: false,
                        issue: Some(error.into()),
                    }
                }
            };
        // Semantic identity includes actual native clock roles and dated location,
        // while money/read revisions remain outside. Admission still fences all IO.
        let basis = json!({"ownerScope":owner_scope,"engineVersion":crate::ENGINE_VERSION,"contract":crate::contract::CONTRACT_VERSION,"origin":metadata.origin,"timeZone":metadata.time_zone,"referenceDate":metadata.reference_date,"cacheable":metadata.cacheable,"issue":metadata.issue});
        serde_json::to_writer(CanonicalHashWriter(&mut hash), &CanonicalValueRef(&basis))
            .map_err(|_| invalid())?;
        Ok(Self {
            metadata,
            key: format!("{:x}", hash.finalize()),
            provider_time_zone,
        })
    }
    pub(in crate::runtime) fn provider_time_zone(&self) -> Option<&str> {
        self.provider_time_zone.as_deref()
    }
    pub fn metadata(&self) -> &CalendarClockMetadata {
        &self.metadata
    }
    pub fn key(&self) -> &str {
        &self.key
    }
    pub fn is_valid_at(&self, epoch: i64) -> bool {
        self.metadata.cacheable
            && epoch >= self.metadata.observed_epoch_milliseconds
            && self
                .metadata
                .valid_until_epoch_milliseconds
                .is_some_and(|until| epoch < until)
    }
}
