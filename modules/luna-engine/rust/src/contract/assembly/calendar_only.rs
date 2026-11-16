//! Independent CalendarOnly original-JSON input assembly, never a financial
//! snapshot or a deserializable ready calendar/profile/clock proof.
use super::*;
use std::collections::BTreeMap;
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum CalendarIntent {
    Rows {},
    Clock {
        #[serde(rename = "observedEpochMilliseconds")]
        observed_epoch_milliseconds: i64,
    },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Begin {
    wire_schema_version: u32,
    expected_engine_version: String,
    calculation_contract_version: String,
    owner_scope: String,
    owner_epoch: u64,
    source_revision: u64,
    intent: CalendarIntent,
}
pub enum CalendarInput {
    Rows {
        owner: OwnerIdentity,
        source_revision: u64,
        calendar: SourceState,
    },
    Clock {
        owner: OwnerIdentity,
        source_revision: u64,
        observed_epoch_milliseconds: i64,
        profile: SourceState,
        history: SourceState,
    },
}
pub struct CalendarOnlyAssembly {
    owner: OwnerIdentity,
    revision: u64,
    intent: CalendarIntent,
    sources: BTreeMap<SourceKind, SourceState>,
    bytes: usize,
    nodes: u32,
}
impl CalendarOnlyAssembly {
    pub fn begin(header: &[u8]) -> Result<Self, ContractError> {
        if header.len() > 8192 {
            return Err(ContractError::InputTooLarge);
        }
        // Reserve a small enclosing domain/control frame, as in R0 assembly.
        let mut budget = JsonBudget {
            nodes: 8,
            error: None,
        };
        let begin: Begin = serde_json::from_value(parse_at(header, 2, &mut budget)?)
            .map_err(|_| ContractError::MalformedEnvelope)?;
        if begin.wire_schema_version != SCHEMA_VERSION {
            return Err(ContractError::UnsupportedSchema);
        }
        if begin.expected_engine_version != crate::ENGINE_VERSION {
            return Err(ContractError::UnsupportedEngine);
        }
        if begin.calculation_contract_version != CONTRACT_VERSION {
            return Err(ContractError::UnsupportedContract);
        }
        let owner = OwnerIdentity::new(&begin.owner_scope, begin.owner_epoch)?;
        revision(begin.source_revision)?;
        if let CalendarIntent::Clock {
            observed_epoch_milliseconds,
        } = begin.intent
        {
            RawClockContext::from_epoch_milliseconds(observed_epoch_milliseconds)?;
        }
        Ok(Self {
            owner,
            revision: begin.source_revision,
            intent: begin.intent,
            sources: BTreeMap::new(),
            bytes: header.len(),
            nodes: budget.nodes,
        })
    }
    pub fn owner(&self) -> &OwnerIdentity {
        &self.owner
    }
    pub fn source_revision(&self) -> u64 {
        self.revision
    }
    pub fn intent(&self) -> &CalendarIntent {
        &self.intent
    }
    pub fn source(&mut self, source_header: &[u8], body: &[u8]) -> Result<(), ContractError> {
        self.source_frame(source_header, body, source_header.len())
    }
    /// A native pool supplies the original outer control-frame byte count;
    /// its ID/target bytes cannot disappear from the shared input budget.
    pub fn source_frame(
        &mut self,
        source_header: &[u8],
        body: &[u8],
        frame_header_bytes: usize,
    ) -> Result<(), ContractError> {
        if source_header.len() > 8192 {
            return Err(ContractError::InputTooLarge);
        }
        if frame_header_bytes < source_header.len() || frame_header_bytes > 8192 {
            return Err(ContractError::InputTooLarge);
        }
        let bytes = self
            .bytes
            .checked_add(frame_header_bytes)
            .and_then(|n| n.checked_add(body.len()))
            .filter(|n| *n <= MAX_INPUT_BYTES as usize)
            .ok_or(ContractError::InputTooLarge)?;
        let (group, header_nodes) = header::<SourceKind>(source_header)?;
        let allowed = match self.intent {
            CalendarIntent::Rows {} => group.kind == SourceKind::CalendarEntries,
            CalendarIntent::Clock { .. } => matches!(
                group.kind,
                SourceKind::WorkProfile | SourceKind::RemunerationProfiles
            ),
        };
        if !allowed {
            return Err(ContractError::InvalidRequest);
        }
        if self.sources.contains_key(&group.kind) {
            return Err(ContractError::DuplicateSource);
        }
        let mut budget = JsonBudget {
            nodes: self
                .nodes
                .checked_add(header_nodes)
                .filter(|n| *n <= MAX_JSON_NODES)
                .ok_or(ContractError::TooManyJsonNodes)?,
            error: None,
        };
        // Reuse exactly the original strict Read/Presence/duplicate/depth parser.
        let source = group.source.into_source(body, &mut budget)?;
        self.sources.insert(group.kind, source);
        self.bytes = bytes;
        self.nodes = budget.nodes;
        Ok(())
    }
    pub fn seal(mut self) -> Result<CalendarInput, ContractError> {
        Ok(match self.intent {
            CalendarIntent::Rows {} => CalendarInput::Rows {
                owner: self.owner,
                source_revision: self.revision,
                calendar: self
                    .sources
                    .remove(&SourceKind::CalendarEntries)
                    .ok_or(ContractError::MissingSource)?,
            },
            CalendarIntent::Clock {
                observed_epoch_milliseconds,
            } => CalendarInput::Clock {
                owner: self.owner,
                source_revision: self.revision,
                observed_epoch_milliseconds,
                profile: self
                    .sources
                    .remove(&SourceKind::WorkProfile)
                    .ok_or(ContractError::MissingSource)?,
                history: self
                    .sources
                    .remove(&SourceKind::RemunerationProfiles)
                    .ok_or(ContractError::MissingSource)?,
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn begin() -> CalendarOnlyAssembly {
        CalendarOnlyAssembly::begin(&serde_json::to_vec(&serde_json::json!({"wireSchemaVersion":1,"expectedEngineVersion":crate::ENGINE_VERSION,"calculationContractVersion":CONTRACT_VERSION,"ownerScope":"calendar-owner","ownerEpoch":1,"sourceRevision":1,"intent":{"kind":"CLOCK","observedEpochMilliseconds":1794480000000_i64}})).unwrap()).unwrap()
    }
    fn group(kind: SourceKind) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({"kind":kind,"source":{"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE"}}}})).unwrap()
    }
    #[test]
    fn aggregate_bytes_and_nodes_reject_atomically_across_distinct_raw_groups() {
        let mut a = begin();
        a.source(&group(SourceKind::WorkProfile), b"{}").unwrap();
        let before_nodes = MAX_JSON_NODES - 25;
        a.nodes = before_nodes;
        let before_sources = a.sources.len();
        let body = serde_json::to_vec(&vec![0; 100]).unwrap();
        assert_eq!(
            a.source(&group(SourceKind::RemunerationProfiles), &body)
                .err(),
            Some(ContractError::TooManyJsonNodes)
        );
        assert_eq!(a.nodes, before_nodes);
        assert_eq!(a.sources.len(), before_sources);
        a.nodes = 100;
        a.bytes = MAX_INPUT_BYTES as usize - 2;
        let before_bytes = a.bytes;
        assert_eq!(
            a.source(&group(SourceKind::RemunerationProfiles), b"[]")
                .err(),
            Some(ContractError::InputTooLarge)
        );
        assert_eq!(a.bytes, before_bytes);
        assert_eq!(a.sources.len(), before_sources);
    }
}
