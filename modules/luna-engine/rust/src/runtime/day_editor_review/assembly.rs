//! Local raw calendar/catalog intake. No global report snapshot or finance preparation.
use super::*;
use crate::{
    contract::{
        ContractError, SourceKind,
        assembly::{CatalogKind, SnapshotAssembly},
    },
    input::calendar_rows::PreparedCalendarRows,
    runtime::catalog_source::{PreparedCatalogParts, prepare_catalog_set},
};
use serde_json::json;
use std::collections::BTreeSet;
const MAX_BYTES: usize = 16_777_216 - 262_144;
#[derive(Debug)]
pub enum DayReviewAssemblyError {
    OwnerChanged,
    InvalidState,
    Unavailable,
    TooLarge,
    Contract(ContractError),
    Input(InputError),
    Catalog(super::super::catalog_source::CatalogSourceError),
    Review(DayReviewError),
}
struct Prepared {
    calendar: PreparedCalendarRows,
    catalog: PreparedCatalogParts,
    calendar_names: BTreeSet<String>,
    catalog_names: BTreeSet<String>,
}
pub struct NativeDayReviewAssembly {
    editor: Arc<NativeDayEditorSource>,
    stamp: WriteContextStamp,
    epoch: i64,
    source: SnapshotAssembly,
    bytes: usize,
    seen: [bool; 4],
    prepared: Option<Prepared>,
}
impl NativeDayReviewAssembly {
    /// The form pool separately binds this builder to its still-active target resource.
    pub fn new(
        editor: Arc<NativeDayEditorSource>,
        stamp: WriteContextStamp,
        epoch: i64,
    ) -> Result<Self, DayReviewAssemblyError> {
        if editor.stamp() != &stamp
            || !editor
                .is_current()
                .map_err(|_| DayReviewAssemblyError::OwnerChanged)?
        {
            return Err(DayReviewAssemblyError::OwnerChanged);
        }
        let context = editor
            .provider_context()
            .ok_or(DayReviewAssemblyError::Unavailable)?;
        crate::contract::RawClockContext::from_epoch_milliseconds(epoch)
            .map_err(DayReviewAssemblyError::Contract)?;
        let identity = context.identity();
        let header = json!({"ownerScope":identity.owner_scope(),"ownerEpoch":identity.owner_epoch(),"snapshotId":"private-day-review","snapshotRevision":1,"referenceDate":editor.request().date,"selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}});
        let source = SnapshotAssembly::begin(
            &serde_json::to_vec(&header).map_err(|_| DayReviewAssemblyError::InvalidState)?,
        )
        .map_err(DayReviewAssemblyError::Contract)?;
        Ok(Self {
            editor,
            stamp,
            epoch,
            source,
            bytes: 0,
            seen: [false; 4],
            prepared: None,
        })
    }
    fn check(&self) -> Result<(), DayReviewAssemblyError> {
        if self.editor.stamp() == &self.stamp
            && self
                .editor
                .is_current()
                .map_err(|_| DayReviewAssemblyError::OwnerChanged)?
        {
            Ok(())
        } else {
            Err(DayReviewAssemblyError::OwnerChanged)
        }
    }
    fn intake(
        &self,
        slot: usize,
        header: &[u8],
        body: &[u8],
    ) -> Result<usize, DayReviewAssemblyError> {
        self.check()?;
        if self.prepared.is_some() || self.seen[slot] {
            return Err(DayReviewAssemblyError::InvalidState);
        }
        self.bytes
            .checked_add(header.len())
            .and_then(|n| n.checked_add(body.len()))
            .filter(|n| *n <= MAX_BYTES)
            .ok_or(DayReviewAssemblyError::TooLarge)
    }
    pub fn calendar(&mut self, state: &Value, body: &[u8]) -> Result<(), DayReviewAssemblyError> {
        let header =
            serde_json::to_vec(&json!({"kind":SourceKind::CalendarEntries,"source":state}))
                .map_err(|_| DayReviewAssemblyError::InvalidState)?;
        let bytes = self.intake(0, &header, body)?;
        self.source
            .source(&header, body)
            .map_err(DayReviewAssemblyError::Contract)?;
        self.seen[0] = true;
        self.bytes = bytes;
        Ok(())
    }
    pub fn catalog(
        &mut self,
        kind: CatalogKind,
        state: &Value,
        body: &[u8],
    ) -> Result<(), DayReviewAssemblyError> {
        let (slot, tag) = match kind {
            CatalogKind::Tariff => (1, "TARIFF"),
            CatalogKind::Legal => (2, "LEGAL"),
            CatalogKind::Holiday => (3, "HOLIDAY"),
        };
        let header = serde_json::to_vec(&json!({"kind":tag,"source":state}))
            .map_err(|_| DayReviewAssemblyError::InvalidState)?;
        let bytes = self.intake(slot, &header, body)?;
        self.source
            .catalog(&header, body)
            .map_err(DayReviewAssemblyError::Contract)?;
        self.seen[slot] = true;
        self.bytes = bytes;
        Ok(())
    }
    pub fn prepare(&mut self) -> Result<(), DayReviewAssemblyError> {
        self.check()?;
        if self.prepared.is_some() {
            return Ok(());
        }
        let raw = self
            .source
            .calendar_source()
            .and_then(Value::as_object)
            .ok_or(DayReviewAssemblyError::Unavailable)?;
        if raw.len() != 3 && !(raw.len() == 4 && raw.contains_key("templateRows")) {
            return Err(DayReviewAssemblyError::InvalidState);
        }
        if !raw
            .get("platformCollationRanks")
            .and_then(Value::as_object)
            .is_some_and(|ranks| ranks.is_empty())
        {
            return Err(DayReviewAssemblyError::InvalidState);
        }
        let shifts = raw
            .get("shiftRows")
            .and_then(Value::as_array)
            .ok_or(DayReviewAssemblyError::InvalidState)?;
        let appointments = raw
            .get("appointmentRows")
            .and_then(Value::as_array)
            .ok_or(DayReviewAssemblyError::InvalidState)?;
        let templates = raw
            .get("templateRows")
            .map(|rows| {
                rows.as_array()
                    .map(Vec::as_slice)
                    .ok_or(DayReviewAssemblyError::InvalidState)
            })
            .transpose()?;
        let shifts = Arc::new(shifts.clone());
        let appointments = Arc::new(appointments.clone());
        let calendar = match templates {
            Some(templates) => {
                PreparedCalendarRows::from_rows_with_templates(shifts, appointments, templates)
            }
            None => PreparedCalendarRows::from_rows(shifts, appointments),
        }
        .map_err(DayReviewAssemblyError::Input)?;
        let mut calendar_names = calendar.collation_candidates().clone();
        calendar_names.extend(
            crate::compliance::preparation::check_collation_candidates(
                calendar.normalized_entries(),
            )
            .map_err(|_| DayReviewAssemblyError::InvalidState)?,
        );
        if calendar_names.len() > crate::contract::MAX_SOURCE_ITEMS as usize {
            return Err(DayReviewAssemblyError::TooLarge);
        }
        let catalog = prepare_catalog_set(self.source.current_catalog(), 0)
            .map_err(DayReviewAssemblyError::Catalog)?;
        let catalog_names = catalog
            .candidates()
            .map_err(DayReviewAssemblyError::Catalog)?
            .clone();
        self.prepared = Some(Prepared {
            calendar,
            catalog,
            calendar_names,
            catalog_names,
        });
        self.check()
    }
    pub fn calendar_candidates(&self) -> Result<&BTreeSet<String>, DayReviewAssemblyError> {
        self.check()?;
        self.prepared
            .as_ref()
            .map(|p| &p.calendar_names)
            .ok_or(DayReviewAssemblyError::InvalidState)
    }
    pub fn catalog_candidates(&self) -> Result<&BTreeSet<String>, DayReviewAssemblyError> {
        self.check()?;
        self.prepared
            .as_ref()
            .map(|p| &p.catalog_names)
            .ok_or(DayReviewAssemblyError::InvalidState)
    }
    pub fn finish(
        mut self,
        calendar_ranks: &[u8],
        catalog_ranks: &[u8],
    ) -> Result<Option<NativeDayReviewSource>, DayReviewAssemblyError> {
        self.check()?;
        let prepared = self
            .prepared
            .take()
            .ok_or(DayReviewAssemblyError::InvalidState)?;
        let total = self
            .bytes
            .checked_add(calendar_ranks.len())
            .and_then(|n| n.checked_add(catalog_ranks.len()))
            .filter(|n| *n <= MAX_BYTES)
            .ok_or(DayReviewAssemblyError::TooLarge)?;
        self.bytes = total;
        self.source
            .bind_calendar_ranks(calendar_ranks)
            .map_err(DayReviewAssemblyError::Contract)?;
        let ranks: crate::calendar::recurrence::CollationRanks =
            serde_json::from_slice(calendar_ranks)
                .map_err(|_| DayReviewAssemblyError::InvalidState)?;
        if prepared
            .calendar_names
            .iter()
            .any(|name| ranks.rank(name).is_err())
        {
            return Err(DayReviewAssemblyError::InvalidState);
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
            .map_err(DayReviewAssemblyError::Contract)?;
        let catalog = prepared
            .catalog
            .finish(bound)
            .map_err(DayReviewAssemblyError::Catalog)?;
        let rows = prepared
            .calendar
            .into_ranked_owned(ranks)
            .map_err(DayReviewAssemblyError::Input)?;
        self.check()?;
        self.source
            .seal()
            .map_err(DayReviewAssemblyError::Contract)?;
        NativeDayReviewSource::from_native_parts(
            self.editor,
            &self.stamp,
            rows,
            Arc::clone(catalog.resolver()),
            self.epoch,
        )
        .map_err(DayReviewAssemblyError::Review)
    }
}
