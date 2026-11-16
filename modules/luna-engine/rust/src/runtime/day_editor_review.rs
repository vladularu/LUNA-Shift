//! Borrow genuine admitted rows/catalog and the editor's Provider source; never UI profiles.
//! The shared form pool owns this source. It introduces no registry or public Ready input.
use super::{
    day_editor_source::NativeDayEditorSource, utility_lease::UtilityLease,
    write_resource::WriteContextStamp,
};
use crate::{
    input::{InputError, calendar_rows::RawCalendarEntries, saved_critical, standby_transfer},
    rules::RuleResolver,
};
use serde_json::Value;
use std::sync::Arc;
mod assembly;
pub use assembly::{DayReviewAssemblyError, NativeDayReviewAssembly};
#[derive(Debug)]
pub enum DayReviewError {
    SourceChanged,
    SourceMissing,
    InvalidClock,
    Profile(super::facts::FactError),
    Catalog(super::catalog_source::CatalogSourceError),
    Input(InputError),
    Compliance(crate::compliance::model::ComplianceError),
}
pub struct NativeDayReviewSource {
    lease: Option<UtilityLease>,
    editor: Arc<NativeDayEditorSource>,
    rows: Arc<RawCalendarEntries>,
    resolver: Arc<RuleResolver>,
    profile: Arc<Value>,
}
/// Original pre-write closure, retained independently of a report-generation lease.
/// Only an actual matching native commit can turn it into a completed review.
pub struct NativeDayReviewCapture {
    editor: Arc<NativeDayEditorSource>,
    rows: Arc<RawCalendarEntries>,
    resolver: Arc<RuleResolver>,
}
pub struct NativeCommittedDayReview {
    receipt: Value,
    notice: Result<Value, DayReviewError>,
}
impl NativeCommittedDayReview {
    pub fn into_parts(self) -> (Value, Result<Value, DayReviewError>) {
        (self.receipt, self.notice)
    }
}
impl NativeDayReviewCapture {
    /// Owner lifetime only. This is not a current DB/source or successful-write flag.
    pub fn is_current(&self) -> bool {
        self.editor.is_current().unwrap_or(false)
    }
    pub fn complete(
        self,
        context: &super::write_resource::NativeWriteContext,
        committed: super::write_resource::CommittedNativeWrite,
        epoch: i64,
    ) -> Result<NativeCommittedDayReview, super::write_resource::WriteResourceError> {
        use super::write_resource::WriteResourceError;
        if !self.is_current() || !self.editor.shares_write_context(context) {
            return Err(WriteResourceError::OwnerChanged);
        }
        if self.editor.stamp() != context.stamp() {
            return Err(WriteResourceError::InvalidStamp);
        }
        let receipt = context.committed_day(committed)?;
        let saved = receipt
            .as_array()
            .and_then(|rows| rows.first())
            .unwrap_or(&receipt);
        let notice = if saved["kind"] == "SHIFT" && saved["allDay"] == false {
            critical_for(&self.editor, &self.rows, &self.resolver, saved, epoch)
        } else {
            Ok(Value::Null)
        };
        if !self.is_current() {
            return Err(WriteResourceError::OwnerChanged);
        }
        Ok(NativeCommittedDayReview { receipt, notice })
    }
}
impl NativeDayReviewSource {
    pub(crate) fn from_native_parts(
        editor: Arc<NativeDayEditorSource>,
        stamp: &WriteContextStamp,
        rows: RawCalendarEntries,
        resolver: Arc<RuleResolver>,
        epoch: i64,
    ) -> Result<Option<Self>, DayReviewError> {
        if editor.stamp() != stamp
            || !editor
                .is_current()
                .map_err(|_| DayReviewError::SourceChanged)?
        {
            return Err(DayReviewError::SourceChanged);
        }
        let Some(context) = editor.provider_context() else {
            return Ok(None);
        };
        let Some(profile) = context
            .provider_profile_at(epoch)
            .map_err(DayReviewError::Profile)?
        else {
            return Ok(None);
        };
        let source = Self {
            lease: None,
            editor,
            rows: Arc::new(rows),
            resolver,
            profile,
        };
        source.check()?;
        Ok(Some(source))
    }
    pub fn capture(self) -> Result<NativeDayReviewCapture, DayReviewError> {
        self.check()?;
        Ok(NativeDayReviewCapture {
            editor: self.editor,
            rows: self.rows,
            resolver: self.resolver,
        })
    }
    /// `stamp` belongs to the private host source capsule, checked around real IO and
    /// bound to the same editor. A registry lease alone cannot prove DB freshness.
    pub fn from_lease(
        mut lease: UtilityLease,
        editor: Arc<NativeDayEditorSource>,
        stamp: &WriteContextStamp,
        epoch: i64,
    ) -> Result<Option<Self>, DayReviewError> {
        if editor.stamp() != stamp
            || !editor.shares_lease(&lease)
            || !editor
                .is_current()
                .map_err(|_| DayReviewError::SourceChanged)?
            || !lease
                .is_current()
                .map_err(|_| DayReviewError::SourceChanged)?
        {
            return Err(DayReviewError::SourceChanged);
        }
        let Some(context) = editor.provider_context() else {
            return Ok(None);
        };
        let facts = lease.facts().ok_or(DayReviewError::SourceMissing)?;
        let identity = facts.snapshot().identity();
        if context.identity().owner_scope() != identity.owner_scope()
            || context.identity().owner_epoch() != identity.owner_epoch()
        {
            return Err(DayReviewError::SourceChanged);
        }
        let Some(profile) = context
            .provider_profile_at(epoch)
            .map_err(DayReviewError::Profile)?
        else {
            return Ok(None);
        };
        let rows = Arc::clone(facts.calendar().map_err(DayReviewError::Profile)?);
        let resolver = Arc::clone(facts.catalog().map_err(DayReviewError::Catalog)?.resolver());
        // Retain only the admitted rows/catalog. Unrelated targets, net settings and
        // finance caches must not stay alive through this read-review resource.
        lease.release_source_owner();
        let result = Self {
            lease: Some(lease),
            editor,
            rows,
            resolver,
            profile,
        };
        result.check()?;
        Ok(Some(result))
    }
    fn check(&self) -> Result<(), DayReviewError> {
        let current = match &self.lease {
            Some(lease) => lease
                .is_current()
                .map_err(|_| DayReviewError::SourceChanged)?,
            None => true,
        };
        if current
            && self
                .editor
                .is_current()
                .map_err(|_| DayReviewError::SourceChanged)?
        {
            Ok(())
        } else {
            Err(DayReviewError::SourceChanged)
        }
    }
    pub fn candidates<'a>(&'a self, next: &Value) -> Result<Vec<&'a Value>, DayReviewError> {
        self.check()?;
        let empty = Value::Null;
        let result = standby_transfer::candidates(
            self.editor.initial().unwrap_or(&empty),
            next,
            self.rows.entries(),
            &self.profile,
            &self.resolver,
        )
        .map_err(DayReviewError::Input)?;
        self.check()?;
        Ok(result)
    }
    /// Selected rows are looked up in the admitted native source by raw UI IDs;
    /// callers cannot supply calculated entries as a selection proof.
    pub fn transfer_inputs(
        &self,
        next: &Value,
        selected_ids: &[String],
    ) -> Result<Vec<Value>, DayReviewError> {
        self.check()?;
        if selected_ids.len() > 50_000 {
            return Err(DayReviewError::SourceMissing);
        }
        let candidates = self.candidates(next)?;
        let mut selected = Vec::with_capacity(selected_ids.len());
        for id in selected_ids {
            let entry = self
                .rows
                .entries()
                .iter()
                .find(|entry| entry["id"].as_str() == Some(id.as_str()))
                .ok_or(DayReviewError::SourceChanged)?;
            selected.push(entry);
        }
        let empty = Value::Null;
        let result = standby_transfer::transfer_inputs_borrowed(
            self.editor.initial().unwrap_or(&empty),
            next,
            &selected,
            &candidates,
        )
        .map_err(DayReviewError::Input)?;
        self.check()?;
        Ok(result)
    }
    pub fn billing_message(&self, next: &Value) -> Result<Value, DayReviewError> {
        self.check()?;
        let empty = Value::Null;
        let result = standby_transfer::billing_message(
            self.editor.initial().unwrap_or(&empty),
            next,
            &self.profile,
            &self.resolver,
        )
        .map_err(DayReviewError::Input)?;
        self.check()?;
        Ok(result)
    }
    pub fn critical_issue(&self, saved: &Value, epoch: i64) -> Result<Value, DayReviewError> {
        self.check()?;
        let result = critical_for(&self.editor, &self.rows, &self.resolver, saved, epoch)?;
        self.check()?;
        Ok(result)
    }
}
fn critical_for(
    editor: &NativeDayEditorSource,
    rows: &RawCalendarEntries,
    resolver: &RuleResolver,
    saved: &Value,
    epoch: i64,
) -> Result<Value, DayReviewError> {
    let context = editor
        .provider_context()
        .ok_or(DayReviewError::SourceMissing)?;
    let Some(profile) = context
        .provider_profile_at(epoch)
        .map_err(DayReviewError::Profile)?
    else {
        return Ok(Value::Null);
    };
    let zone = crate::time_zone::zone(
        profile["timeZone"]
            .as_str()
            .ok_or(DayReviewError::InvalidClock)?,
    )
    .map_err(|_| DayReviewError::InvalidClock)?;
    let date = jiff::Timestamp::from_millisecond(epoch)
        .map_err(|_| DayReviewError::InvalidClock)?
        .to_zoned(zone)
        .date()
        .to_string();
    let result = saved_critical::critical_issue(
        saved,
        rows.entries(),
        &profile,
        &date,
        rows.collation().as_ref().clone(),
        resolver,
    )
    .map_err(DayReviewError::Compliance)?;
    Ok(result)
}
