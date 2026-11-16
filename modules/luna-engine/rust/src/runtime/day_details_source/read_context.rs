//! Read-only calculation-preferred context for the SAME Calendar-core window.
//! It admits five raw IO groups and catalogs, never CalendarEntries or READY math.
mod basis;
use super::*;
#[cfg(test)]
use crate::runtime::profile_inputs::retain_target_context;
use crate::{
    calendar::{
        recurrence::CollationRanks,
        window::{CalendarEntrySource, SortedCalendarWindow},
    },
    runtime::{
        catalog_source::{PreparedCatalogParts, prepare_catalog_set},
        profile_inputs::{target_snapshot, youth_snapshot as youth},
    },
};
use basis::ReadBasis;
use std::collections::BTreeSet;
struct ReadParts {
    profile: Arc<Value>,
    targets: PreparedTargetSource,
    resolver: Arc<RuleResolver>,
}
#[derive(Clone)]
pub struct NativeDayDetailsReadContext {
    owner: UtilityOwnerMarker,
    stamp: WriteContextStamp,
    basis: Arc<ReadBasis>,
    parts: Option<Arc<ReadParts>>,
    observed_epoch_milliseconds: i64,
    valid_until_epoch_milliseconds: Option<i64>,
}
pub struct NativeDayDetailsReadAssembly {
    owner: UtilityOwnerMarker,
    stamp: WriteContextStamp,
    source: SnapshotAssembly,
    epoch: i64,
    catalog: Option<PreparedCatalogParts>,
}
pub struct NativeDayDetailsReadView<S = Arc<Vec<Value>>> {
    owner: UtilityOwnerMarker,
    view: Arc<DayDetailsProjection<S>>,
    observed_epoch_milliseconds: i64,
    valid_until_epoch_milliseconds: Option<i64>,
}
fn fresh(
    owner: &UtilityOwnerMarker,
    observed: i64,
    until: Option<i64>,
    epoch: i64,
) -> Result<bool, DayDetailsSourceError> {
    crate::contract::RawClockContext::from_epoch_milliseconds(epoch)
        .map_err(DayDetailsSourceError::Contract)?;
    Ok(owner
        .is_current()
        .map_err(|_| DayDetailsSourceError::OwnerChanged)?
        && epoch >= observed
        && until.is_none_or(|until| epoch < until))
}
impl NativeDayDetailsReadAssembly {
    pub fn new(
        owner: UtilityOwnerMarker,
        stamp: WriteContextStamp,
        source: SnapshotAssembly,
        epoch: i64,
    ) -> Result<Self, DayDetailsSourceError> {
        check(&owner)?;
        stamp.validate().map_err(DayDetailsSourceError::Write)?;
        if !owner
            .matches_owner(source.fence().owner())
            .map_err(|_| DayDetailsSourceError::OwnerChanged)?
        {
            return Err(DayDetailsSourceError::OwnerChanged);
        }
        crate::contract::RawClockContext::from_epoch_milliseconds(epoch)
            .map_err(DayDetailsSourceError::Contract)?;
        for kind in ALL_SOURCE_KINDS {
            if !matches!(
                kind,
                SourceKind::WorkProfile
                    | SourceKind::RemunerationProfiles
                    | SourceKind::WorkPatternSettings
                    | SourceKind::WorkingTimeTarget
                    | SourceKind::YouthPreference
            ) && !matches!(source.source_state(*kind), SourceState::NotRequested)
            {
                return Err(DayDetailsSourceError::InvalidSourceScope);
            }
        }
        Ok(Self {
            owner,
            stamp,
            source,
            epoch,
            catalog: None,
        })
    }
    pub fn prepare(&mut self) -> Result<(), DayDetailsSourceError> {
        check(&self.owner)?;
        if self.catalog.is_none() {
            self.catalog = Some(
                prepare_catalog_set(self.source.current_catalog(), 0)
                    .map_err(DayDetailsSourceError::Catalog)?,
            );
        }
        check(&self.owner)
    }
    pub fn catalog_candidates(&self) -> Result<&BTreeSet<String>, DayDetailsSourceError> {
        check(&self.owner)?;
        self.catalog
            .as_ref()
            .ok_or(DayDetailsSourceError::InvalidResult)?
            .candidates()
            .map_err(DayDetailsSourceError::Catalog)
    }
    pub fn finish(
        mut self,
        catalog_ranks: &[u8],
    ) -> Result<NativeDayDetailsReadContext, DayDetailsSourceError> {
        check(&self.owner)?;
        let catalog = self
            .catalog
            .take()
            .ok_or(DayDetailsSourceError::InvalidResult)?;
        let names = catalog
            .candidates()
            .map_err(DayDetailsSourceError::Catalog)?;
        let ids = catalog.default_package_ids();
        let bound = self
            .source
            .bind_catalog_metadata(
                [&ids.tariff, &ids.legal, &ids.holiday],
                catalog_ranks,
                names,
                catalog.requires_ranks(),
            )
            .map_err(DayDetailsSourceError::Contract)?;
        let catalog = catalog
            .finish(bound)
            .map_err(DayDetailsSourceError::Catalog)?;
        let env = ProfileClockEnvironment::from_states(
            self.source.owner_scope(),
            self.source.source_state(SourceKind::WorkProfile),
            self.source.source_state(SourceKind::RemunerationProfiles),
            self.epoch,
        )
        .map_err(DayDetailsSourceError::Facts)?;
        let (target_status, target) =
            target_snapshot(self.source.source_state(SourceKind::WorkingTimeTarget));
        let (youth_status, youth) = youth(self.source.source_state(SourceKind::YouthPreference));
        let basis = Arc::new(ReadBasis {
            owner: self.owner.clone(),
            stamp: self.stamp.clone(),
            profile: env.profile.clone(),
            history: env.history.clone(),
            pattern: Arc::new(
                self.source
                    .source_state(SourceKind::WorkPatternSettings)
                    .clone(),
            ),
            target_status,
            target,
            youth_status,
            youth,
            resolver: Arc::clone(catalog.resolver()),
        });
        let context = basis.project_prepared(self.epoch, &env.prepared)?;
        self.source
            .bind_profile_clock(self.epoch, env.reference_date())
            .map_err(DayDetailsSourceError::Contract)?;
        // Seal transport evidence, but deliberately do not register an R0/Finance snapshot.
        let _snapshot = self
            .source
            .seal()
            .map_err(DayDetailsSourceError::Contract)?;
        check(&self.owner)?;
        Ok(context)
    }
}
impl NativeDayDetailsReadContext {
    /// Direct presentation from the same checked raw5 target/profile context.
    /// This creates no selected source, registry slot, or report calculation.
    pub(crate) fn calendar_highlights(
        &self,
        start: &str,
        end: &str,
        epoch: i64,
    ) -> Result<Value, DayDetailsSourceError> {
        if !self.is_current_at(epoch)? {
            return Err(DayDetailsSourceError::OwnerChanged);
        }
        let Some(parts) = &self.parts else {
            return Ok(
                serde_json::json!({"labels":[],"months":[],"observedEpochMilliseconds":epoch,"validUntilEpochMilliseconds":self.valid_until_epoch_milliseconds}),
            );
        };
        let mut credits = DailyCreditContextCache::with_source(&parts.targets, &parts.resolver);
        let labels = crate::calendar::widget::widget_calendar_highlights(start, end, &mut credits)
            .map_err(DayDetailsSourceError::Metrics)?;
        let mut date = crate::calendar::parse_date(start)
            .map_err(|_| DayDetailsSourceError::InvalidResult)?
            .first_of_month();
        let end =
            crate::calendar::parse_date(end).map_err(|_| DayDetailsSourceError::InvalidResult)?;
        let mut months = Vec::new();
        use jiff::ToSpan;
        while date <= end {
            if months.len() >= 120 {
                return Err(DayDetailsSourceError::InvalidResult);
            }
            let month = format!("{:04}-{:02}", date.year(), date.month());
            let holidays = crate::rules::profile_holidays::resolve_profile_holiday_map_for_month(
                &month,
                &parts.profile,
                &parts.resolver,
            )
            .map_err(|_| DayDetailsSourceError::InvalidResult)?;
            let mut special = Vec::new();
            let status = match parts.profile.get("workingTimeTarget") {
                None => "AVAILABLE",
                Some(value) if value["status"] == "loading" => "LOADING",
                Some(value) if value["status"] != "ready" => "UNAVAILABLE",
                Some(_) => match credits.base_monthly_target(&month, None) {
                    Ok(target) => {
                        for adjustment in &target.adjustments {
                            if adjustment.kind == crate::target::AdjustmentKind::TariffSpecialDay {
                                special.push((adjustment.date.clone(), adjustment.clone()));
                            }
                        }
                        if target.status == crate::target::TargetStatus::Unavailable {
                            "UNAVAILABLE"
                        } else {
                            "AVAILABLE"
                        }
                    }
                    Err(_) => "UNAVAILABLE",
                },
            };
            months.push(serde_json::json!({"month":month,"status":holidays.status,"holidays":holidays.holidays.into_iter().collect::<Vec<_>>(),"failure":holidays.failure,"specialDays":special,"specialStatus":status}));
            date = date
                .checked_add(1.months())
                .map_err(|_| DayDetailsSourceError::InvalidResult)?;
        }
        if !self.is_current_at(epoch)? {
            return Err(DayDetailsSourceError::OwnerChanged);
        }
        Ok(
            serde_json::json!({"labels":labels,"months":months,"observedEpochMilliseconds":epoch,"validUntilEpochMilliseconds":self.valid_until_epoch_milliseconds}),
        )
    }
    pub fn rebase_at(&self, epoch: i64) -> Result<Self, DayDetailsSourceError> {
        check(&self.owner)?;
        if self.is_current_at(epoch)? {
            return Ok(self.clone());
        }
        self.basis.project(epoch)
    }
    pub fn profile(&self) -> Result<Option<&Arc<Value>>, DayDetailsSourceError> {
        check(&self.owner)?;
        Ok(self.parts.as_ref().map(|p| &p.profile))
    }
    pub fn stamp(&self) -> Result<&WriteContextStamp, DayDetailsSourceError> {
        check(&self.owner)?;
        Ok(&self.stamp)
    }
    pub fn shares_owner(&self, owner: &UtilityOwnerMarker) -> bool {
        self.owner.shares_owner(owner)
    }
    pub fn is_current_at(&self, epoch: i64) -> Result<bool, DayDetailsSourceError> {
        fresh(
            &self.owner,
            self.observed_epoch_milliseconds,
            self.valid_until_epoch_milliseconds,
            epoch,
        )
    }
    pub fn valid_until_epoch_milliseconds(&self) -> Result<Option<i64>, DayDetailsSourceError> {
        check(&self.owner)?;
        Ok(self.valid_until_epoch_milliseconds)
    }
    pub fn time_zone(&self) -> Result<Option<&str>, DayDetailsSourceError> {
        check(&self.owner)?;
        Ok(self
            .parts
            .as_ref()
            .and_then(|p| p.profile["timeZone"].as_str()))
    }
    /// Additional strings for the real platform collation step. Only native
    /// source records and the raw requested date enter this structural query.
    pub fn additional_calendar_candidates<S: crate::calendar::window::CalendarRecordSource>(
        &self,
        source: &S,
        date: &str,
        epoch: i64,
    ) -> Result<BTreeSet<String>, DayDetailsSourceError> {
        if !self.is_current_at(epoch)? {
            return Err(DayDetailsSourceError::OwnerChanged);
        }
        crate::calendar::parse_date(date).map_err(|_| DayDetailsSourceError::InvalidResult)?;
        if source.entries_len() > crate::contract::MAX_SOURCE_ITEMS as usize {
            return Err(DayDetailsSourceError::InvalidResult);
        }
        let mut names = BTreeSet::from([date.to_owned()]);
        let mut bytes = date.len();
        for record in source.records() {
            let row = record.base_value();
            if row["kind"] != "SHIFT" || row.get("specialDuty").is_none_or(Value::is_null) {
                continue;
            }
            for part in crate::credit::duty::project_duty_work(row)
                .map_err(|e| DayDetailsSourceError::Metrics(MetricsError::Calculation(e)))?
            {
                let id = part["id"]
                    .as_str()
                    .ok_or(DayDetailsSourceError::InvalidResult)?;
                if names.insert(id.to_owned()) {
                    bytes = bytes
                        .checked_add(id.len())
                        .ok_or(DayDetailsSourceError::InvalidResult)?;
                }
                if names.len() > crate::contract::MAX_SOURCE_ITEMS as usize
                    || bytes > crate::contract::MAX_INPUT_BYTES as usize
                {
                    return Err(DayDetailsSourceError::InvalidResult);
                }
            }
        }
        if !self.is_current_at(epoch)? {
            return Err(DayDetailsSourceError::OwnerChanged);
        }
        Ok(names)
    }
    pub fn prepare_window<S: CalendarEntrySource>(
        &self,
        date: &str,
        window: Arc<SortedCalendarWindow<S>>,
        ranks: &CollationRanks,
        epoch: i64,
    ) -> Result<Option<NativeDayDetailsReadView<S>>, DayDetailsSourceError> {
        if !self.is_current_at(epoch)? {
            return Err(DayDetailsSourceError::OwnerChanged);
        }
        let Some(parts) = &self.parts else {
            return Ok(None);
        };
        let mut credits = DailyCreditContextCache::with_source(&parts.targets, &parts.resolver);
        let view = Arc::new(
            day_details::prepare(date, window, &mut credits, ranks)
                .map_err(DayDetailsSourceError::Metrics)?,
        );
        if !self.is_current_at(epoch)? {
            return Err(DayDetailsSourceError::OwnerChanged);
        }
        Ok(Some(NativeDayDetailsReadView {
            owner: self.owner.clone(),
            view,
            observed_epoch_milliseconds: self.observed_epoch_milliseconds,
            valid_until_epoch_milliseconds: self.valid_until_epoch_milliseconds,
        }))
    }
}
impl<S: CalendarEntrySource> NativeDayDetailsReadView<S> {
    fn check_at(&self, epoch: i64) -> Result<(), DayDetailsSourceError> {
        if fresh(
            &self.owner,
            self.observed_epoch_milliseconds,
            self.valid_until_epoch_milliseconds,
            epoch,
        )? {
            Ok(())
        } else {
            Err(DayDetailsSourceError::OwnerChanged)
        }
    }
    pub fn metadata_at(&self, epoch: i64) -> Result<Value, DayDetailsSourceError> {
        self.check_at(epoch)?;
        let value = serde_json::to_value(self.view.as_ref())
            .map_err(|_| DayDetailsSourceError::InvalidResult)?;
        self.check_at(epoch)?;
        Ok(value)
    }
    pub fn rows_at(
        &self,
        offset: u32,
        limit: u32,
        epoch: i64,
    ) -> Result<Vec<Value>, DayDetailsSourceError> {
        self.check_at(epoch)?;
        let rows = self
            .view
            .rows(offset, limit)
            .map_err(DayDetailsSourceError::Metrics)?;
        self.check_at(epoch)?;
        Ok(rows)
    }
    pub fn entry_count_at(&self, epoch: i64) -> Result<u32, DayDetailsSourceError> {
        self.check_at(epoch)?;
        Ok(self.view.entry_count())
    }
}

#[cfg(test)]
mod target_retention_tests {
    use super::*;
    #[test]
    fn clock_basis_moves_only_the_required_target_context_without_copying_large_data() {
        let context = Value::String("context".repeat(100000));
        let pointer = context.as_str().unwrap().as_ptr();
        let mut raw = serde_json::Map::new();
        raw.insert("context".into(), context);
        raw.insert(
            "planRevision".into(),
            Value::String("unused full plan".repeat(100000)),
        );
        raw.insert(
            "saved".into(),
            serde_json::json!({"unused":"saved settings"}),
        );
        let kept = retain_target_context(Value::Object(raw)).unwrap();
        assert_eq!(kept.as_object().unwrap().len(), 1);
        assert_eq!(
            kept["context"].as_str().unwrap().as_ptr(),
            pointer,
            "context moved without cloning"
        );
        assert!(
            retain_target_context(
                serde_json::json!({"saved":null,"staleDates":[],"planRevision":"unused"})
            )
            .is_none()
        );
    }
}
