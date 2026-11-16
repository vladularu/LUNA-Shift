use super::{IncomingPoolError, IncomingSourceConsumption, IncomingSourceLease};
use crate::{
    calendar::incoming::{SharedCalendarDays, SharedDayWindow},
    runtime::{RegistryError, calendar_only::CalendarClockLease},
};
use std::sync::Arc;
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IncomingViewerRole {
    Analysis,
    Provider,
}
#[derive(Debug)]
pub enum IncomingClockError {
    ScopeMismatch,
    Stale,
    RoleUnavailable,
    Registry(RegistryError),
    Source(IncomingPoolError),
}
struct View {
    days: SharedCalendarDays,
    observed: i64,
    source_until: Option<i64>,
}
pub struct IncomingProjection {
    view: IncomingSourceConsumption<View>,
    clock: Arc<CalendarClockLease>,
    time_zone: String,
    role: IncomingViewerRole,
}
fn clock_fresh(clock: &CalendarClockLease, epoch: i64) -> Result<bool, IncomingClockError> {
    let metadata = clock.clock().metadata();
    if metadata.cacheable {
        clock
            .is_fresh_at(epoch)
            .map_err(IncomingClockError::Registry)
    } else {
        Ok(clock.is_current().map_err(IncomingClockError::Registry)?
            && epoch == metadata.observed_epoch_milliseconds)
    }
}
impl IncomingProjection {
    pub fn is_current_at(&self, epoch: i64) -> Result<bool, IncomingClockError> {
        if !self.view.is_current().map_err(IncomingClockError::Source)?
            || !clock_fresh(&self.clock, epoch)?
        {
            return Ok(false);
        }
        let view = self.view.value().map_err(IncomingClockError::Source)?;
        Ok(epoch >= view.observed && view.source_until.is_none_or(|until| epoch < until))
    }
    fn check(&self, epoch: i64) -> Result<(), IncomingClockError> {
        if self.is_current_at(epoch)? {
            Ok(())
        } else {
            Err(IncomingClockError::Stale)
        }
    }
    pub fn viewer_time_zone_at(&self, epoch: i64) -> Result<&str, IncomingClockError> {
        self.check(epoch)?;
        Ok(&self.time_zone)
    }
    pub fn days_at(&self, epoch: i64) -> Result<&SharedCalendarDays, IncomingClockError> {
        self.check(epoch)?;
        Ok(&self.view.value().map_err(IncomingClockError::Source)?.days)
    }
    pub fn role(&self) -> IncomingViewerRole {
        self.role
    }
    pub fn cacheable_at(&self, epoch: i64) -> Result<bool, IncomingClockError> {
        self.check(epoch)?;
        Ok(self.clock.clock().metadata().cacheable)
    }
    pub fn valid_until_epoch_milliseconds_at(
        &self,
        epoch: i64,
    ) -> Result<Option<i64>, IncomingClockError> {
        self.check(epoch)?;
        let clock = self.clock.clock().metadata();
        if !clock.cacheable {
            return Ok(None);
        }
        let source = self
            .view
            .value()
            .map_err(IncomingClockError::Source)?
            .source_until;
        Ok(match (clock.valid_until_epoch_milliseconds, source) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        })
    }
}
impl IncomingSourceLease {
    pub fn bind_clock(
        &self,
        clock: Arc<CalendarClockLease>,
        role: IncomingViewerRole,
        epoch: i64,
        window: Option<&SharedDayWindow<'_>>,
    ) -> Result<IncomingProjection, IncomingClockError> {
        if !clock.shares_owner(&self.0.owner) {
            return Err(IncomingClockError::ScopeMismatch);
        }
        if !self.is_current().map_err(IncomingClockError::Source)? || !clock_fresh(&clock, epoch)? {
            return Err(IncomingClockError::Stale);
        }
        // This provider zone is a private M1 result, never a host-selected ready
        // profile or the similarly named analysis/public clock timezone.
        let zone = match role {
            IncomingViewerRole::Analysis => clock.clock().metadata().time_zone.as_str(),
            IncomingViewerRole::Provider => clock
                .clock()
                .provider_time_zone()
                .ok_or(IncomingClockError::RoleUnavailable)?,
        };
        let view = self
            .with_observation(|observation| {
                Ok(View {
                    days: observation.project(zone, epoch, window)?,
                    observed: epoch,
                    source_until: observation.valid_until_epoch_milliseconds(),
                })
            })
            .map_err(IncomingClockError::Source)?;
        let projection = IncomingProjection {
            view,
            time_zone: zone.into(),
            clock,
            role,
        };
        projection.check(epoch)?;
        Ok(projection)
    }
}
