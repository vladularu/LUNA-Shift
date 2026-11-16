//! A pinned submission owns its original save completion. UI edits do not
//! replace that submission and ACK does not rebase the immutable editor source.
use super::*;
use crate::{
    input::entry_editor_save::EntrySaveFailure,
    runtime::write_resource::{
        NativeWriteContext, NativeWritePermit, TakenNativeWrite, WriteContextStamp,
        WriteResourceError,
    },
};
struct Io {
    context: NativeWriteContext,
    permit: NativeWritePermit,
}
enum Submission {
    Save(RawSavePreparation),
    Delete(RawDeletePreparation),
}
impl Submission {
    fn begin(&self) -> Value {
        match self {
            Self::Save(prepared) => prepared.begin().expect("captured native save"),
            Self::Delete(prepared) => prepared.begin(),
        }
    }
    fn intent(&self) -> (&str, &Value) {
        match self {
            Self::Save(prepared) => {
                let intent = prepared.write_intent().expect("captured native save");
                (
                    intent["kind"].as_str().expect("native entry kind"),
                    &intent["payload"],
                )
            }
            Self::Delete(prepared) => (
                "DELETE",
                prepared.write_intent().expect("captured native delete"),
            ),
        }
    }
    fn deleted(&self) -> bool {
        matches!(self, Self::Delete(_))
    }
    fn finish(self, failure: Option<&EntrySaveFailure>) -> Value {
        match self {
            Self::Save(prepared) => prepared.finish(failure),
            Self::Delete(prepared) => prepared.finish(failure),
        }
    }
}
pub(super) struct Write {
    id: u64,
    prepared: Submission,
    io: Option<Io>,
    review: Option<crate::runtime::day_editor_review::NativeDayReviewCapture>,
    bulk: Option<Value>,
}
impl Write {
    fn intent(&self) -> (&str, &Value) {
        self.bulk
            .as_ref()
            .map(|payload| ("BULK_SHIFT", payload))
            .unwrap_or_else(|| self.prepared.intent())
    }
}
fn next(value: u64) -> Result<u64, FormResourceError> {
    value
        .checked_add(1)
        .filter(|v| *v <= crate::money::MAX_SAFE_INTEGER as u64)
        .ok_or(FormResourceError::Capacity)
}
impl DayState {
    pub(super) fn capture(
        &mut self,
        close_after: bool,
        require_review: bool,
    ) -> Result<Option<Value>, FormResourceError> {
        let prepared = self
            .controller
            .prepare_save(self.write.is_some() || self.terminal, close_after)
            .map_err(|_| FormResourceError::InvalidSource)?;
        if prepared.write_intent().is_none() {
            return Ok(Some(prepared.finish(None)));
        }
        if require_review
            && prepared.requires_review()
            && !matches!(self.review, Some(super::review::ReviewSlot::Ready(_)))
        {
            return Ok(Some(json!({"state":"REVIEW_REQUIRED","stored":false})));
        }
        let transfers = match self.billing_inputs() {
            Ok(inputs) => inputs,
            Err(error) => {
                return Ok(Some(
                    prepared.finish(Some(&EntrySaveFailure::from_input_error(&error))),
                ));
            }
        };
        let bulk = if transfers.is_empty() {
            None
        } else {
            let mut inputs = Vec::with_capacity(transfers.len() + 1);
            inputs.push(prepared.write_intent().expect("captured save")["payload"].clone());
            inputs.extend(transfers);
            Some(Value::Array(inputs))
        };
        let id = next(self.next_write)?;
        self.next_write = id;
        self.feedback = None;
        self.review_notice = None;
        let review = match self.review.take() {
            Some(super::review::ReviewSlot::Ready(source)) => Some(
                (*source)
                    .capture()
                    .map_err(|_| FormResourceError::StaleResource)?,
            ),
            other => {
                self.review = other;
                None
            }
        };
        self.write = Some(Write {
            id,
            prepared: Submission::Save(prepared),
            io: None,
            review,
            bulk,
        });
        Ok(None)
    }
    pub(super) fn capture_delete(&mut self) -> Result<(), FormResourceError> {
        let prepared = RawDeletePreparation::prepare(
            self.controller.source().initial(),
            self.write.is_some() || self.terminal,
        );
        if prepared.write_intent().is_none() {
            return Ok(());
        }
        let id = next(self.next_write)?;
        let mut feedback = prepared.begin();
        // The actual write argument remains private. UI only receives the
        // original onDeletionChange event, never a host-ready write input.
        feedback
            .as_object_mut()
            .expect("native begin frame")
            .remove("writes");
        self.feedback = Some(feedback);
        self.next_write = id;
        self.write = Some(Write {
            id,
            prepared: Submission::Delete(prepared),
            io: None,
            review: None,
            bulk: None,
        });
        Ok(())
    }
    pub(super) fn write_frame(&self, frame: &mut Value) {
        if let Some(feedback) = &self.feedback {
            frame["feedback"] = feedback.clone();
        }
        if let Some(receipt) = &self.receipt {
            frame["receipt"] = receipt.clone();
        }
        if self.terminal {
            frame["terminal"] = json!(true);
        }
        if let Some(write) = &self.write {
            if self.feedback.is_none() {
                frame["feedback"] = write.prepared.begin();
            }
            frame["state"] = json!(if write.io.is_some() {
                "WRITE_PERMIT_READY"
            } else {
                "WRITE_CONTEXT_REQUIRED"
            });
            frame["writeId"] = json!(write.id);
            let (operation, payload) = write.intent();
            let kind = if operation == "DELETE" {
                payload["kind"].as_str().expect("native existing kind")
            } else {
                operation
            };
            let id = payload.get("id").and_then(Value::as_str);
            let shifts = if operation == "BULK_SHIFT" {
                payload
                    .as_array()
                    .expect("native bulk")
                    .iter()
                    .filter_map(|input| input["id"].as_str())
                    .collect::<Vec<_>>()
            } else if kind == "SHIFT" {
                id.into_iter().collect()
            } else {
                Vec::new()
            };
            frame["selection"] = json!({"shiftIds":shifts,"appointmentIds":if kind=="APPOINTMENT"{id.into_iter().collect::<Vec<_>>()}else{Vec::new()}});
        }
    }
    fn checked_write(&self, id: u64) -> Result<&Write, FormResourceError> {
        self.write
            .as_ref()
            .filter(|w| w.id == id)
            .ok_or(FormResourceError::StaleResource)
    }
    pub fn prepare_write(
        &mut self,
        id: u64,
        context: NativeWriteContext,
        epoch: i64,
        allocated_id: &str,
    ) -> Result<(), FormResourceError> {
        let revision = next(self.revision)?;
        if context.stamp() != &self.stamp || self.checked_write(id)?.io.is_some() {
            return Err(FormResourceError::StaleResource);
        }
        let (operation, payload) = self.checked_write(id)?.intent();
        // Creating a record requires an actual raw ID allocated by the IO
        // adapter. Absence must never silently become an empty primary key.
        if operation != "BULK_SHIFT" && payload.get("id").is_none() && allocated_id.is_empty() {
            return Err(FormResourceError::InvalidHeader);
        }
        match context.prepare_day(operation, payload, epoch as f64, allocated_id) {
            Ok(permit) => {
                self.write.as_mut().expect("checked write").io = Some(Io { context, permit })
            }
            Err(error) => {
                let failure = match error {
                    WriteResourceError::Input(error) => EntrySaveFailure::from_input_error(&error),
                    _ => EntrySaveFailure::Internal,
                };
                let write = self.write.take().expect("checked write");
                self.feedback = Some(write.prepared.finish(Some(&failure)));
            }
        }
        self.revision = revision;
        Ok(())
    }
    pub fn take(&self, id: u64) -> Result<TakenNativeWrite, FormResourceError> {
        let io = self
            .checked_write(id)?
            .io
            .as_ref()
            .ok_or(FormResourceError::StaleResource)?;
        io.context
            .take(&io.permit)
            .map_err(|_| FormResourceError::StaleResource)
    }
    pub fn ack(
        &mut self,
        id: u64,
        stamp: WriteContextStamp,
        epoch: i64,
    ) -> Result<&'static str, FormResourceError> {
        let revision = next(self.revision)?;
        let io = self
            .checked_write(id)?
            .io
            .as_ref()
            .ok_or(FormResourceError::StaleResource)?;
        let committed = io
            .context
            .acknowledge(&io.permit, stamp.clone())
            .map_err(|_| FormResourceError::StaleResource)?;
        let review = self.write.as_mut().expect("checked write").review.take();
        let io = self.checked_write(id)?.io.as_ref().expect("checked IO");
        let (receipt, notice) = if let Some(review) = review {
            let complete = review
                .complete(&io.context, committed, epoch)
                .map_err(|_| FormResourceError::StaleResource)?;
            let (receipt, notice) = complete.into_parts();
            (receipt, Some(notice))
        } else {
            (
                io.context
                    .committed_day(committed)
                    .map_err(|_| FormResourceError::StaleResource)?,
                None,
            )
        };
        let write = self.write.take().expect("checked write");
        let receipt = if write.bulk.is_some() {
            receipt
                .as_array()
                .and_then(|rows| rows.first())
                .cloned()
                .ok_or(FormResourceError::InvalidSource)?
        } else {
            receipt
        };
        let effect = if write.prepared.deleted() {
            "DELETED"
        } else {
            "SAVED"
        };
        let failure = match notice {
            Some(Ok(critical)) => {
                self.review_notice = Some(json!({"state":"READY","critical":critical}));
                None
            }
            Some(Err(error)) => {
                self.review_notice = Some(json!({"state":"FAILED"}));
                Some(match error {
                    crate::runtime::day_editor_review::DayReviewError::Input(error) => {
                        EntrySaveFailure::from_input_error(&error)
                    }
                    _ => EntrySaveFailure::Internal,
                })
            }
            None => None,
        };
        self.feedback = Some(write.prepared.finish(failure.as_ref()));
        self.receipt = Some(receipt);
        self.stamp = stamp;
        self.terminal = true;
        self.revision = revision;
        Ok(effect)
    }
    pub fn abort(
        &mut self,
        id: u64,
        failure: &crate::runtime::form_resource::profile::IoFailure,
    ) -> Result<(), FormResourceError> {
        let revision = next(self.revision)?;
        let write = self.checked_write(id)?;
        if let Some(io) = &write.io {
            io.context
                .abort(&io.permit)
                .map_err(|_| FormResourceError::StaleResource)?;
        }
        let failure = match failure {
            crate::runtime::form_resource::profile::IoFailure::SourceChanged => {
                EntrySaveFailure::UserFacing(
                    "Der Eintrag wurde zwischenzeitlich geändert. Bitte neu laden.".into(),
                )
            }
            crate::runtime::form_resource::profile::IoFailure::IoFailed => {
                EntrySaveFailure::Internal
            }
        };
        let write = self.write.take().expect("checked write");
        self.feedback = Some(write.prepared.finish(Some(&failure)));
        self.revision = revision;
        Ok(())
    }
}
