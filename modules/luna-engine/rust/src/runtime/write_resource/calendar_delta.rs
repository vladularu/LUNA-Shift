//! Only a completed private permit creates this move-only publication proof.
//! It is distinct from raw Source rows and never crosses the host as Ready data.
use super::{WriteContextStamp, WriteResourceError, source::Binding};
use crate::runtime::utility_lease::UtilityOwnerMarker;
use serde_json::Value;
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommittedEntryKind {
    Shift,
    Appointment,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommittedTemplateAction {
    Save,
    Delete,
    Restore,
    Order,
}

/// Native physical postimages, not deserializable claims about a SQL commit.
pub enum CommittedCalendarChange {
    UpsertShift(Arc<Value>),
    UpsertAppointment(Arc<Value>),
    DeleteEntry {
        kind: CommittedEntryKind,
        id: String,
    },
    Template {
        action: CommittedTemplateAction,
        row: Arc<Value>,
    },
}
/// No Clone/Deserialize: the controller extracts it once, and A1 consumes it
/// after matching real Core/owner plus a genuine postcommit control-row read.
pub struct CommittedCalendarDelta {
    binding: Arc<Binding>,
    stamp: WriteContextStamp,
    changes: Vec<CommittedCalendarChange>,
}
impl CommittedCalendarDelta {
    pub(super) fn from_native_body(
        binding: Arc<Binding>,
        stamp: WriteContextStamp,
        mut body: Value,
        publish: bool,
    ) -> Result<Self, WriteResourceError> {
        // Original template save can commit and then fail while decoding its
        // returned row. Provider never publishes that failed repository result.
        let changes = if publish {
            let mutations = body
                .as_object_mut()
                .and_then(|body| body.remove("mutations"))
                .and_then(|value| {
                    if let Value::Array(rows) = value {
                        Some(rows)
                    } else {
                        None
                    }
                })
                .ok_or(WriteResourceError::InvalidContext)?;
            mutations
                .into_iter()
                .map(change)
                .collect::<Result<Vec<_>, _>>()?
        } else {
            Vec::new()
        };
        Ok(Self {
            binding,
            stamp,
            changes,
        })
    }
    pub fn stamp(&self) -> &WriteContextStamp {
        &self.stamp
    }
    pub fn consume_for_owner(
        self,
        owner: &UtilityOwnerMarker,
    ) -> Result<Vec<CommittedCalendarChange>, WriteResourceError> {
        self.binding.current()?;
        if !self.binding.shares_owner(owner) {
            return Err(WriteResourceError::ForeignPermit);
        }
        Ok(self.changes)
    }
}
fn change(value: Value) -> Result<CommittedCalendarChange, WriteResourceError> {
    use CommittedCalendarChange as C;
    use CommittedTemplateAction as T;
    let Value::Object(mut value) = value else {
        return Err(WriteResourceError::InvalidContext);
    };
    let kind = value
        .remove("kind")
        .ok_or(WriteResourceError::InvalidContext)?;
    let row = value
        .remove("row")
        .ok_or(WriteResourceError::InvalidContext)?;
    Ok(match kind.as_str() {
        Some("UPSERT_SHIFT_ENTRY") => C::UpsertShift(Arc::new(row)),
        Some("UPSERT_APPOINTMENT") => C::UpsertAppointment(Arc::new(row)),
        Some("TOMBSTONE_CALENDAR_ENTRY") => C::DeleteEntry {
            kind: match value.get("entryKind").and_then(Value::as_str) {
                Some("SHIFT") => CommittedEntryKind::Shift,
                Some("APPOINTMENT") => CommittedEntryKind::Appointment,
                _ => return Err(WriteResourceError::InvalidContext),
            },
            id: row["id"]
                .as_str()
                .ok_or(WriteResourceError::InvalidContext)?
                .to_owned(),
        },
        Some("UPSERT_SHIFT_TEMPLATE") => C::Template {
            action: T::Save,
            row: Arc::new(row),
        },
        Some("TOMBSTONE_SHIFT_TEMPLATE") => C::Template {
            action: T::Delete,
            row: Arc::new(row),
        },
        Some("RESTORE_SHIFT_TEMPLATE") => C::Template {
            action: T::Restore,
            row: Arc::new(row),
        },
        Some("UPDATE_SHIFT_TEMPLATE_ORDER") => C::Template {
            action: T::Order,
            row: Arc::new(row),
        },
        _ => return Err(WriteResourceError::InvalidContext),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        contract::OwnerIdentity,
        runtime::{
            SnapshotRegistry,
            write_resource::{NativeWriteContext, WriteContextKind},
        },
    };
    use serde_json::json;
    #[test]
    fn original_day_postimages_and_receipts_survive_move_only_delta_extraction() {
        let data = crate::test_value_pool::decode(include_str!(
            "../../../../reference/day-write-golden.json"
        ));
        let registry = SnapshotRegistry::default();
        registry
            .reset_for_owner(&OwnerIdentity::new("calendar-delta", 1).unwrap())
            .unwrap();
        let owner = registry.utility_owner_marker().unwrap();
        let stamp = |changed| {
            WriteContextStamp::from_raw(&json!({"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":if changed{"22222222222222222222222222222222"}else{"11111111111111111111111111111111"},"databaseSchemaVersion":35})).unwrap()
        };
        let mut observed = std::collections::BTreeSet::new();
        for case in data["cases"].as_array().unwrap() {
            let input = &case["input"];
            let operation = input["operation"].as_str().unwrap();
            let sample = if operation == "BULK_SHIFT"
                && input["value"].as_array().is_some_and(Vec::is_empty)
            {
                "EMPTY_BULK"
            } else {
                operation
            };
            if case["expected"]["result"]["ok"] != true || !observed.insert(sample) {
                continue;
            }
            let context=NativeWriteContext::from_raw(owner.clone(),stamp(false),WriteContextKind::Day,&serde_json::to_vec(&json!({"shiftRows":input["before"]["shifts"],"appointmentRows":input["before"]["appointments"]})).unwrap()).unwrap();
            let permit = context
                .prepare_day(
                    operation,
                    &input["value"],
                    input["epochMilliseconds"].as_f64().unwrap(),
                    input["allocatedIds"][operation].as_str().unwrap_or(""),
                )
                .unwrap();
            context.take(&permit).unwrap();
            let changed = input["before"] != case["expected"]["after"];
            let mut committed = context.acknowledge(&permit, stamp(changed)).unwrap();
            let delta = context.take_calendar_delta(&mut committed).unwrap();
            let changes = delta.consume_for_owner(&owner).unwrap();
            assert_eq!(
                changes.is_empty(),
                !changed,
                "{} original SQL change",
                case["id"]
            );
            for change in changes {
                match change {
                    CommittedCalendarChange::UpsertShift(row)
                    | CommittedCalendarChange::UpsertAppointment(row) => {
                        let table = if operation == "APPOINTMENT" {
                            "appointments"
                        } else {
                            "shifts"
                        };
                        let expected = case["expected"]["after"][table]
                            .as_array()
                            .unwrap()
                            .iter()
                            .find(|r| r["id"] == row["id"])
                            .unwrap();
                        assert_eq!(
                            row.as_ref(),
                            expected,
                            "{} original physical postimage",
                            case["id"]
                        );
                    }
                    CommittedCalendarChange::DeleteEntry { kind, id } => {
                        assert_eq!(id, input["value"]["id"].as_str().unwrap());
                        assert_eq!(
                            kind,
                            if input["value"]["kind"] == "SHIFT" {
                                CommittedEntryKind::Shift
                            } else {
                                CommittedEntryKind::Appointment
                            }
                        );
                    }
                    CommittedCalendarChange::Template { .. } => panic!("not a day change"),
                }
            }
            assert_eq!(
                context.committed_day(committed).unwrap(),
                case["expected"]["result"]["value"]
            );
        }
        assert_eq!(
            observed,
            std::collections::BTreeSet::from([
                "SHIFT",
                "APPOINTMENT",
                "DELETE",
                "BULK_SHIFT",
                "EMPTY_BULK"
            ])
        );
    }
}
