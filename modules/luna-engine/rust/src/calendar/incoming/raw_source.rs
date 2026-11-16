use super::{
    cache::{CacheRecord, IncomingObservation, RetainedIncomingCache},
    raw_rows::{Budget, decode_rows, mapped_rest},
    visible::VisibilityContext,
};
use crate::{EngineError, contract::ContractError};
use serde_json::Value;
use std::{collections::HashMap, sync::Arc};

#[derive(Debug)]
pub enum IncomingSourceError {
    Input(ContractError),
    Projection(EngineError),
}
#[derive(Debug, Default)]
pub struct RawParseStatistics {
    pub metadata_parses: u32,
    pub entries_parses: u32,
    pub field_reuses: u32,
    pub joined_json_fields: u32,
    charged_wire_bytes: usize,
}
impl RawParseStatistics {
    pub fn charged_wire_bytes(&self) -> usize {
        self.charged_wire_bytes
    }
}
// These proofs are native-only: neither a host hash nor a cached UI value can
// provide a decoded owner or its previously checked resource cost.
#[derive(Clone)]
pub(super) struct RawProofs {
    account_id: String,
    records: Vec<RecordProof>,
}
#[derive(Clone)]
struct RecordProof {
    sql_id: String,
    calendar: FieldProof,
    entries: FieldProof,
}
#[derive(Clone)]
struct FieldProof {
    digest: [u8; 32],
    nodes: u32,
    value: Arc<Value>,
}
impl FieldProof {
    fn decode(
        budget: &mut Budget,
        row: &Value,
        field: &str,
        previous: Option<&Self>,
        stats: &mut RawParseStatistics,
    ) -> Result<Self, ContractError> {
        let text = budget.text(row, field)?;
        let digest = text.digest(field);
        if let Some(previous) = previous.filter(|previous| previous.digest == digest) {
            budget.charge_nodes(previous.nodes)?;
            stats.field_reuses += 1;
            return Ok(Self {
                digest,
                nodes: previous.nodes,
                value: Arc::clone(&previous.value),
            });
        }
        let (value, nodes) = budget.decode(&text)?;
        stats.joined_json_fields += u32::from(text.chunked);
        if field == "metadata_json" {
            stats.metadata_parses += 1;
        } else {
            stats.entries_parses += 1;
        }
        Ok(Self {
            digest,
            nodes,
            value: Arc::new(value),
        })
    }
}
impl RetainedIncomingCache {
    pub fn observe_sql(
        &mut self,
        account_id: &str,
        bytes: &[u8],
        context: &VisibilityContext<'_>,
    ) -> Result<(IncomingObservation, RawParseStatistics), IncomingSourceError> {
        let (rows, mut budget) = decode_rows(bytes).map_err(IncomingSourceError::Input)?;
        let previous: HashMap<_, _> = self
            .raw_proofs
            .as_ref()
            .filter(|proofs| proofs.account_id == account_id)
            .map(|proofs| {
                proofs
                    .records
                    .iter()
                    .map(|record| (record.sql_id.as_str(), record))
                    .collect()
            })
            .unwrap_or_default();
        let mut records = Vec::with_capacity(rows.len());
        let mut proofs = Vec::with_capacity(rows.len());
        let mut stats = RawParseStatistics::default();
        for row in rows {
            let rest = mapped_rest(account_id, &row).map_err(IncomingSourceError::Input)?;
            // mapped_rest checked this column's type before it becomes a key.
            let sql_id = row["calendar_id"]
                .as_str()
                .ok_or(IncomingSourceError::Input(ContractError::MalformedEnvelope))?;
            let old = previous.get(sql_id);
            let calendar = FieldProof::decode(
                &mut budget,
                &row,
                "metadata_json",
                old.map(|old| &old.calendar),
                &mut stats,
            )
            .map_err(IncomingSourceError::Input)?;
            let entries = FieldProof::decode(
                &mut budget,
                &row,
                "entries_json",
                old.map(|old| &old.entries),
                &mut stats,
            )
            .map_err(IncomingSourceError::Input)?;
            budget.charge_nodes(8).map_err(IncomingSourceError::Input)?;
            records.push(CacheRecord {
                rest,
                calendar: Arc::clone(&calendar.value),
                entries: Arc::clone(&entries.value),
            });
            proofs.push(RecordProof {
                sql_id: sql_id.into(),
                calendar,
                entries,
            });
        }
        stats.charged_wire_bytes = budget.charged_wire_bytes();
        let observation = self
            .observe_records(records, context)
            .map_err(IncomingSourceError::Projection)?;
        for (proof, record) in proofs.iter_mut().zip(self.current.iter()) {
            // Semantic retention may choose an older equal owner despite a
            // different JSON spelling. Do not retain a duplicate decoded tree.
            proof.calendar.value = Arc::clone(&record.calendar);
            proof.entries.value = Arc::clone(&record.entries);
        }
        self.raw_proofs = Some(RawProofs {
            account_id: account_id.into(),
            records: proofs,
        });
        Ok((observation, stats))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calendar::incoming::SharedDayWindow;
    use serde_json::json;

    #[test]
    fn fifty_thousand_raw_entries_keep_one_field_owner_and_release_all_provenance() {
        let entries = serde_json::to_string(&vec![json!({"id":"entry","startsAt":"2026-10-24T19:00:00Z","endsAt":"2026-10-25T06:00:00Z","allDay":false,"timeZone":"Europe/Berlin"}); 50000]).unwrap();
        let chunks: Vec<_> = entries
            .as_bytes()
            .chunks(65536)
            .map(|chunk| std::str::from_utf8(chunk).unwrap())
            .collect();
        let mut raw = json!([{"account_id":"viewer","calendar_id":"calendar","metadata_json":"{\"id\":\"calendar\",\"isOwner\":false}","entries_json_chunks":chunks,"fetched_at":"2026-10-25T11:00:00Z","visible":1,"local_color":null}]);
        let context = VisibilityContext {
            user_id: Some("viewer"),
            status: "signedIn",
            presentation_account_id: None,
            observed_epoch_milliseconds: 1_792_929_600_000,
        };
        let mut state = RetainedIncomingCache::new();
        let (first, _) = state
            .observe_sql("viewer", &serde_json::to_vec(&raw).unwrap(), &context)
            .unwrap();
        let weak = Arc::downgrade(&state.current[0].entries);
        raw[0]["fetched_at"] = json!("2026-10-25T11:00:01Z");
        let (second, stats) = state
            .observe_sql("viewer", &serde_json::to_vec(&raw).unwrap(), &context)
            .unwrap();
        assert_eq!(
            (
                stats.entries_parses,
                stats.joined_json_fields,
                stats.field_reuses
            ),
            (0, 0, 2)
        );
        assert!(Arc::ptr_eq(
            &weak.upgrade().unwrap(),
            &state.current[0].entries
        ));
        assert!(Arc::ptr_eq(
            &state.current[0].entries,
            &state.raw_proofs.as_ref().unwrap().records[0].entries.value
        ));
        let window = SharedDayWindow {
            start_date: "2027-01-01",
            end_date: "2027-02-01",
        };
        let projection = second
            .project(
                "Europe/Berlin",
                context.observed_epoch_milliseconds,
                Some(&window),
            )
            .unwrap();
        assert_eq!(serde_json::to_value(&projection).unwrap(), json!([]));
        drop(first);
        drop(second);
        drop(state);
        assert!(weak.upgrade().is_some());
        drop(projection);
        assert!(weak.upgrade().is_none());
    }
}
