//! Native-only locale preflight. Intake is original raw JSON; outputs are
//! comparison strings, never profile/calculation readiness supplied by a host.
use super::*;
use crate::{
    input::calendar_rows::PreparedCalendarRows,
    runtime::catalog_source::{PreparedCatalogParts, prepare_catalog_set},
};
use std::collections::BTreeSet;
struct Prepared {
    calendar: PreparedCalendarRows,
    calendar_names: BTreeSet<String>,
    catalog: PreparedCatalogParts,
    catalog_names: BTreeSet<String>,
}
pub struct NativeDayDetailsAssembly {
    owner: UtilityOwnerMarker,
    stamp: WriteContextStamp,
    source: SnapshotAssembly,
    epoch: i64,
    prepared: Option<Prepared>,
    requested_date: String,
}
impl NativeDayDetailsAssembly {
    pub fn new(
        owner: UtilityOwnerMarker,
        stamp: WriteContextStamp,
        source: SnapshotAssembly,
        epoch: i64,
        requested_date: &str,
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
        crate::calendar::parse_date(requested_date)
            .map_err(|_| DayDetailsSourceError::InvalidResult)?;
        Ok(Self {
            owner,
            stamp,
            source,
            epoch,
            prepared: None,
            requested_date: requested_date.into(),
        })
    }
    pub fn prepare(&mut self) -> Result<(), DayDetailsSourceError> {
        check(&self.owner)?;
        if self.prepared.is_some() {
            return Ok(());
        }
        super::super::sources::ready_state(
            self.source.source_state(SourceKind::CalendarEntries),
            super::super::sources::RequiredCoverage::AllHistory,
        )
        .and_then(|ready| ready.value())
        .map_err(|error| {
            DayDetailsSourceError::Facts(FactError::Source {
                kind: SourceKind::CalendarEntries,
                error,
            })
        })?;
        let raw = self
            .source
            .calendar_source()
            .and_then(Value::as_object)
            .ok_or(DayDetailsSourceError::InvalidResult)?;
        if !(raw.len() == 3 || (raw.len() == 4 && raw.contains_key("templateRows")))
            || !raw
                .get("platformCollationRanks")
                .and_then(Value::as_object)
                .is_some_and(|value| value.is_empty())
        {
            return Err(DayDetailsSourceError::InvalidResult);
        }
        let shifts = raw
            .get("shiftRows")
            .and_then(Value::as_array)
            .ok_or(DayDetailsSourceError::InvalidResult)?;
        let appointments = raw
            .get("appointmentRows")
            .and_then(Value::as_array)
            .ok_or(DayDetailsSourceError::InvalidResult)?;
        let templates = raw
            .get("templateRows")
            .map(|value| {
                value
                    .as_array()
                    .map(Vec::as_slice)
                    .ok_or(DayDetailsSourceError::InvalidResult)
            })
            .transpose()?;
        let calendar = match templates {
            Some(templates) => PreparedCalendarRows::from_rows_with_templates(
                Arc::new(shifts.clone()),
                Arc::new(appointments.clone()),
                templates,
            ),
            None => PreparedCalendarRows::from_rows(
                Arc::new(shifts.clone()),
                Arc::new(appointments.clone()),
            ),
        }
        .map_err(|error| DayDetailsSourceError::Facts(FactError::Calendar(error)))?;
        let mut calendar_names = calendar.collation_candidates().clone();
        // A recurring appointment can project to a date absent from stored
        // rows. This is raw route intent, ranked by the real platform worker.
        calendar_names.insert(self.requested_date.clone());
        for entry in calendar
            .normalized_entries()
            .iter()
            .filter(|entry| entry["kind"] == "SHIFT")
        {
            if entry.get("specialDuty").is_some_and(|duty| !duty.is_null()) {
                for projected in crate::credit::duty::project_duty_work(entry).map_err(|error| {
                    DayDetailsSourceError::Metrics(MetricsError::Calculation(error))
                })? {
                    calendar_names.insert(
                        projected["id"]
                            .as_str()
                            .ok_or(DayDetailsSourceError::InvalidResult)?
                            .into(),
                    );
                }
            }
        }
        if calendar_names.len() > crate::contract::MAX_SOURCE_ITEMS as usize {
            return Err(DayDetailsSourceError::InvalidResult);
        }
        let catalog = prepare_catalog_set(self.source.current_catalog(), 0)
            .map_err(DayDetailsSourceError::Catalog)?;
        let catalog_names = catalog
            .candidates()
            .map_err(DayDetailsSourceError::Catalog)?
            .clone();
        self.prepared = Some(Prepared {
            calendar,
            calendar_names,
            catalog,
            catalog_names,
        });
        check(&self.owner)
    }
    pub fn calendar_candidates(&self) -> Result<&BTreeSet<String>, DayDetailsSourceError> {
        check(&self.owner)?;
        Ok(&self
            .prepared
            .as_ref()
            .ok_or(DayDetailsSourceError::InvalidResult)?
            .calendar_names)
    }
    pub fn catalog_candidates(&self) -> Result<&BTreeSet<String>, DayDetailsSourceError> {
        check(&self.owner)?;
        Ok(&self
            .prepared
            .as_ref()
            .ok_or(DayDetailsSourceError::InvalidResult)?
            .catalog_names)
    }
    pub fn finish(
        mut self,
        calendar_ranks: &[u8],
        catalog_ranks: &[u8],
    ) -> Result<NativeDayDetailsSource, DayDetailsSourceError> {
        check(&self.owner)?;
        if calendar_ranks
            .len()
            .checked_add(catalog_ranks.len())
            .is_none_or(|bytes| bytes > crate::contract::MAX_INPUT_BYTES as usize)
        {
            return Err(DayDetailsSourceError::Contract(
                ContractError::InputTooLarge,
            ));
        }
        let prepared = self
            .prepared
            .take()
            .ok_or(DayDetailsSourceError::InvalidResult)?;
        self.source
            .bind_calendar_ranks(calendar_ranks)
            .map_err(DayDetailsSourceError::Contract)?;
        let ranks: crate::calendar::recurrence::CollationRanks =
            serde_json::from_slice(calendar_ranks)
                .map_err(|_| DayDetailsSourceError::InvalidResult)?;
        for name in &prepared.calendar_names {
            ranks
                .rank(name)
                .map_err(|_| DayDetailsSourceError::InvalidResult)?;
        }
        let ids = prepared.catalog.default_package_ids();
        let bound = self
            .source
            .bind_catalog_metadata(
                [&ids.tariff, &ids.legal, &ids.holiday],
                catalog_ranks,
                &prepared.catalog_names,
                prepared.catalog.requires_ranks(),
            )
            .map_err(DayDetailsSourceError::Contract)?;
        let catalog = prepared
            .catalog
            .finish(bound)
            .map_err(DayDetailsSourceError::Catalog)?;
        let calendar = prepared
            .calendar
            .into_ranked_owned(ranks)
            .map_err(|error| DayDetailsSourceError::Facts(FactError::Calendar(error)))?;
        check(&self.owner)?;
        NativeDayDetailsSource::prepare_inner(
            self.owner,
            self.stamp,
            self.source,
            self.epoch,
            Some(NativeParts {
                calendar: Arc::new(calendar),
                catalog,
            }),
        )
    }
}
