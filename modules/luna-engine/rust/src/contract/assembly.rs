//! Worker-side raw-source assembly. Large SQL JSON texts never need to become
//! JavaScript object trees or be escaped into another host JSON document.
pub mod calendar_only;
use super::*;

const MAX_HEADER_BYTES: usize = 128 * 1024;
const ENVELOPE_NODES: u32 = 6;
// REGISTER_SNAPSHOT envelope -> command -> snapshot -> sources/catalogs.
const GROUP_DEPTH: u32 = 4;
const DATA_DEPTH: u32 = 8;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Begin {
    owner_scope: String,
    owner_epoch: u64,
    snapshot_id: String,
    snapshot_revision: u64,
    #[serde(default, deserialize_with = "present_reference_date")]
    reference_date: Option<String>,
    selected_package_ids: PackageIds,
    completeness: ContextCompleteness,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Group<K> {
    kind: K,
    source: Read,
}
#[derive(Deserialize)]
#[serde(
    tag = "state",
    rename_all = "SCREAMING_SNAKE_CASE",
    deny_unknown_fields
)]
enum Read {
    NotRequested {},
    Loading {},
    Failed {
        code: SourceFailure,
    },
    Ready {
        revision: u64,
        coverage: Coverage,
        payload: Payload,
    },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Payload {
    schema_version: u32,
    data: Presence,
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
enum Presence {
    Missing {},
    Null {},
    Value {},
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CatalogKind {
    Tariff,
    Legal,
    Holiday,
}

pub struct SnapshotAssembly {
    snapshot: SnapshotInput,
    sources: BTreeSet<SourceKind>,
    catalogs: BTreeSet<CatalogKind>,
    bytes: usize,
    nodes: u32,
    reference_pending: bool,
}
fn present_reference_date<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    String::deserialize(deserializer).map(Some)
}

fn parse_at(bytes: &[u8], depth: u32, budget: &mut JsonBudget) -> Result<Value, ContractError> {
    let mut parser = serde_json::Deserializer::from_slice(bytes);
    let value = BoundedSeed { depth, budget }
        .deserialize(&mut parser)
        .map_err(|_| budget.error.unwrap_or(ContractError::InvalidJson))?;
    parser.end().map_err(|_| ContractError::InvalidJson)?;
    Ok(value)
}
fn header<K: serde::de::DeserializeOwned>(bytes: &[u8]) -> Result<(Group<K>, u32), ContractError> {
    if bytes.len() > MAX_HEADER_BYTES {
        return Err(ContractError::InputTooLarge);
    }
    let mut budget = JsonBudget::default();
    let value = parse_at(bytes, GROUP_DEPTH, &mut budget)?;
    let group = serde_json::from_value(value).map_err(|_| ContractError::MalformedEnvelope)?;
    Ok((group, budget.nodes))
}
impl Read {
    fn into_source(
        self,
        body: &[u8],
        budget: &mut JsonBudget,
    ) -> Result<SourceState, ContractError> {
        let source = match self {
            Self::Ready {
                revision,
                coverage,
                payload,
            } => {
                let data = match payload.data {
                    Presence::Value {} => DataPresence::Value {
                        value: parse_at(body, DATA_DEPTH, budget)?,
                    },
                    Presence::Null {} if body.is_empty() => DataPresence::Null,
                    Presence::Missing {} if body.is_empty() => DataPresence::Missing,
                    _ => return Err(ContractError::InvalidPresence),
                };
                SourceState::Ready {
                    revision,
                    coverage,
                    payload: InputOnlyPayload {
                        schema_version: payload.schema_version,
                        data,
                    },
                }
            }
            Self::NotRequested {} if body.is_empty() => SourceState::NotRequested,
            Self::Loading {} if body.is_empty() => SourceState::Loading,
            Self::Failed { code } if body.is_empty() => SourceState::Failed { code },
            _ => return Err(ContractError::InvalidPresence),
        };
        source.validate()?;
        Ok(source)
    }
}
impl SnapshotAssembly {
    pub fn begin(bytes: &[u8]) -> Result<Self, ContractError> {
        if bytes.len() > MAX_HEADER_BYTES {
            return Err(ContractError::InputTooLarge);
        }
        let begin: Begin = serde_json::from_value(bounded_json(bytes)?)
            .map_err(|_| ContractError::MalformedEnvelope)?;
        let reference_pending = begin.reference_date.is_none();
        let snapshot = SnapshotInput {
            identity: SnapshotIdentity {
                owner_scope: begin.owner_scope,
                owner_epoch: begin.owner_epoch,
                snapshot_id: begin.snapshot_id,
                snapshot_revision: begin.snapshot_revision,
                input_digest: "0".repeat(64),
                catalog_digest: "0".repeat(64),
            },
            reference_date: begin.reference_date.unwrap_or_else(|| "1900-01-01".into()),
            clock_context: None,
            sources: ALL_SOURCE_KINDS
                .iter()
                .map(|kind| SourceGroup {
                    kind: *kind,
                    source: SourceState::NotRequested,
                })
                .collect(),
            catalogs: Catalogs {
                current: CatalogSet {
                    selected_package_ids: begin.selected_package_ids,
                    tariff: SourceState::NotRequested,
                    legal: SourceState::NotRequested,
                    holiday: SourceState::NotRequested,
                },
                history: vec![],
            },
            completeness: begin.completeness,
        };
        snapshot.validate()?;
        // Only this small metadata template is serialized. Its sources are all
        // NOT_REQUESTED; no large source value is ever copied by this step.
        let template =
            serde_json::to_vec(&snapshot).map_err(|_| ContractError::MalformedEnvelope)?;
        let mut budget = JsonBudget::default();
        parse_at(&template, 2, &mut budget)?;
        let nodes = budget
            .nodes
            .checked_add(ENVELOPE_NODES)
            .ok_or(ContractError::TooManyJsonNodes)?;
        Ok(Self {
            snapshot,
            sources: BTreeSet::new(),
            catalogs: BTreeSet::new(),
            bytes: bytes.len().max(template.len()),
            nodes,
            reference_pending,
        })
    }
    pub fn fence(&self) -> RevisionFence {
        RevisionFence {
            owner: OwnerIdentity {
                scope: self.snapshot.identity.owner_scope.clone(),
                epoch: self.snapshot.identity.owner_epoch,
            },
            snapshot_revision: self.snapshot.identity.snapshot_revision,
        }
    }
    pub(crate) fn current_catalog(&self) -> &CatalogSet {
        &self.snapshot.catalogs.current
    }
    pub(crate) fn owner_scope(&self) -> &str {
        self.snapshot.identity.owner_scope()
    }
    pub(crate) fn source_state(&self, kind: SourceKind) -> &SourceState {
        &self
            .snapshot
            .sources
            .iter()
            .find(|v| v.kind == kind)
            .expect("complete source template")
            .source
    }
    pub(crate) fn bind_profile_clock(
        &mut self,
        epoch_milliseconds: i64,
        reference_date: &str,
    ) -> Result<(), ContractError> {
        date(reference_date)?;
        let clock = RawClockContext::from_epoch_milliseconds(epoch_milliseconds)?;
        if let Some(old) = &self.snapshot.clock_context {
            if old != &clock || self.snapshot.reference_date != reference_date {
                return Err(ContractError::IdentityMismatch);
            }
            self.reference_pending = false;
            return Ok(());
        }
        let before =
            serde_json::to_vec(&serde_json::json!({"referenceDate":self.snapshot.reference_date}))
                .map_err(|_| ContractError::MalformedEnvelope)?;
        let after = serde_json::to_vec(
            &serde_json::json!({"referenceDate":reference_date,"clockContext":clock}),
        )
        .map_err(|_| ContractError::MalformedEnvelope)?;
        let mut old = JsonBudget::default();
        parse_at(&before, 2, &mut old)?;
        let mut new = JsonBudget::default();
        parse_at(&after, 2, &mut new)?;
        let bytes = self
            .bytes
            .checked_add(after.len().saturating_sub(before.len()))
            .filter(|n| *n <= MAX_INPUT_BYTES as usize)
            .ok_or(ContractError::InputTooLarge)?;
        let nodes = self
            .nodes
            .checked_sub(old.nodes)
            .and_then(|n| n.checked_add(new.nodes))
            .filter(|n| *n <= MAX_JSON_NODES)
            .ok_or(ContractError::TooManyJsonNodes)?;
        self.snapshot.reference_date = reference_date.into();
        self.snapshot.clock_context = Some(clock);
        self.reference_pending = false;
        self.bytes = bytes;
        self.nodes = nodes;
        Ok(())
    }
    /// Only native derived defaults and platform collation can be inserted.
    /// No source read-state or original artifact chunk is rewritten.
    pub(crate) fn bind_catalog_metadata(
        &mut self,
        ids: [&str; 3],
        bytes: &[u8],
        required: &BTreeSet<String>,
        external: bool,
    ) -> Result<std::collections::BTreeMap<String, u32>, ContractError> {
        for id in ids {
            identifier(id)?;
        }
        let selected = PackageIds {
            tariff: vec![ids[0].to_owned()],
            legal: vec![ids[1].to_owned()],
            holiday: vec![ids[2].to_owned()],
        };
        let old = &self.snapshot.catalogs.current.selected_package_ids;
        if !(old.tariff.is_empty() && old.legal.is_empty() && old.holiday.is_empty())
            && *old != selected
        {
            return Err(ContractError::IdentityMismatch);
        }
        let old_bytes = serde_json::to_vec(old).map_err(|_| ContractError::MalformedEnvelope)?;
        let new_bytes =
            serde_json::to_vec(&selected).map_err(|_| ContractError::MalformedEnvelope)?;
        let mut old_budget = JsonBudget::default();
        parse_at(&old_bytes, GROUP_DEPTH, &mut old_budget)?;
        let mut new_budget = JsonBudget::default();
        parse_at(&new_bytes, GROUP_DEPTH, &mut new_budget)?;
        let next_bytes = self
            .bytes
            .checked_add(bytes.len())
            .and_then(|n| n.checked_add(new_bytes.len().saturating_sub(old_bytes.len())))
            .filter(|n| *n <= MAX_INPUT_BYTES as usize)
            .ok_or(ContractError::InputTooLarge)?;
        let mut budget = JsonBudget {
            nodes: self
                .nodes
                .checked_sub(old_budget.nodes)
                .and_then(|n| n.checked_add(new_budget.nodes))
                .and_then(|n| if external { n.checked_sub(1) } else { Some(n) })
                .ok_or(ContractError::TooManyJsonNodes)?,
            error: None,
        };
        let ranks = parse_at(bytes, DATA_DEPTH + 1, &mut budget)?;
        let object = ranks.as_object().ok_or(ContractError::InvalidPresence)?;
        if object.len() > MAX_SOURCE_ITEMS as usize {
            return Err(ContractError::CollectionTooLarge);
        }
        if (!external && !object.is_empty())
            || required.iter().any(|name| !object.contains_key(name))
        {
            return Err(ContractError::InvalidPresence);
        }
        let mut checked = std::collections::BTreeMap::new();
        for (name, rank) in object {
            let rank = rank
                .as_u64()
                .and_then(|n| u32::try_from(n).ok())
                .ok_or(ContractError::InvalidPresence)?;
            checked.insert(name.clone(), rank);
        }
        let mut rank_slot = None;
        if external {
            let SourceState::Ready {
                payload:
                    InputOnlyPayload {
                        data: DataPresence::Value { value },
                        ..
                    },
                ..
            } = &mut self.snapshot.catalogs.current.tariff
            else {
                return Err(ContractError::InvalidPresence);
            };
            if value.get("mode").and_then(Value::as_str) != Some("EXTERNAL") {
                return Err(ContractError::InvalidPresence);
            }
            let slot = value
                .get_mut("collationRanks")
                .ok_or(ContractError::InvalidPresence)?;
            if !slot.as_object().is_some_and(|map| map.is_empty()) {
                return Err(ContractError::InvalidPresence);
            }
            rank_slot = Some(slot);
        }
        if let Some(slot) = rank_slot {
            *slot = ranks;
        }
        self.snapshot.catalogs.current.selected_package_ids = selected;
        self.bytes = next_bytes;
        self.nodes = budget.nodes;
        Ok(checked)
    }
    /// Borrow the admitted raw calendar only; no other source is projected.
    pub(crate) fn calendar_source(&self) -> Option<&Value> {
        self.snapshot.sources.iter().find_map(|group| {
            if group.kind != SourceKind::CalendarEntries {
                return None;
            }
            match &group.source {
                SourceState::Ready {
                    payload:
                        InputOnlyPayload {
                            data: DataPresence::Value { value },
                            ..
                        },
                    ..
                } => Some(value),
                _ => None,
            }
        })
    }
    /// A single, explicit platform-fact insertion. No business field or source
    /// state can change, and the existing aggregate byte/node/depth limits apply.
    pub(crate) fn bind_calendar_ranks(&mut self, bytes: &[u8]) -> Result<(), ContractError> {
        let empty = self
            .calendar_source()
            .and_then(|value| value.get("platformCollationRanks"))
            .and_then(Value::as_object)
            .is_some_and(|ranks| ranks.is_empty());
        if !empty {
            return Err(ContractError::InvalidPresence);
        }
        let next_bytes = self
            .bytes
            .checked_add(bytes.len())
            .filter(|n| *n <= MAX_INPUT_BYTES as usize)
            .ok_or(ContractError::InputTooLarge)?;
        let mut budget = JsonBudget {
            nodes: self
                .nodes
                .checked_sub(1)
                .ok_or(ContractError::TooManyJsonNodes)?,
            error: None,
        };
        let ranks = parse_at(bytes, DATA_DEPTH + 1, &mut budget)?;
        let object = ranks.as_object().ok_or(ContractError::InvalidPresence)?;
        if object
            .values()
            .any(|rank| rank.as_u64().and_then(|n| u32::try_from(n).ok()).is_none())
        {
            return Err(ContractError::InvalidPresence);
        }
        let group = self
            .snapshot
            .sources
            .iter_mut()
            .find(|g| g.kind == SourceKind::CalendarEntries)
            .ok_or(ContractError::MissingSource)?;
        let SourceState::Ready {
            payload:
                InputOnlyPayload {
                    data: DataPresence::Value { value },
                    ..
                },
            ..
        } = &mut group.source
        else {
            return Err(ContractError::InvalidPresence);
        };
        let slot = value
            .get_mut("platformCollationRanks")
            .ok_or(ContractError::InvalidPresence)?;
        *slot = ranks;
        self.nodes = budget.nodes;
        self.bytes = next_bytes;
        Ok(())
    }
    fn prepare<K: serde::de::DeserializeOwned>(
        &self,
        header_bytes: &[u8],
        body: &[u8],
    ) -> Result<(Group<K>, JsonBudget, usize), ContractError> {
        let bytes = self
            .bytes
            .checked_add(header_bytes.len())
            .and_then(|n| n.checked_add(body.len()))
            .filter(|n| *n <= MAX_INPUT_BYTES as usize)
            .ok_or(ContractError::InputTooLarge)?;
        let (group, nodes) = header::<K>(header_bytes)?;
        // Each supplied header replaces either a four-node default source
        // group, or a two-node catalog state with two header-only kind nodes.
        let nodes = self
            .nodes
            .checked_add(nodes)
            .and_then(|n| n.checked_sub(4))
            .filter(|n| *n <= MAX_JSON_NODES)
            .ok_or(ContractError::TooManyJsonNodes)?;
        Ok((group, JsonBudget { nodes, error: None }, bytes))
    }
    pub fn source(&mut self, header_bytes: &[u8], body: &[u8]) -> Result<(), ContractError> {
        let (group, mut budget, bytes) = self.prepare::<SourceKind>(header_bytes, body)?;
        if self.sources.contains(&group.kind) {
            return Err(ContractError::DuplicateSource);
        }
        let source = group.source.into_source(body, &mut budget)?;
        let slot = self
            .snapshot
            .sources
            .iter_mut()
            .find(|v| v.kind == group.kind)
            .ok_or(ContractError::MissingSource)?;
        slot.source = source;
        self.sources.insert(group.kind);
        self.nodes = budget.nodes;
        self.bytes = bytes;
        Ok(())
    }
    pub fn catalog(&mut self, header_bytes: &[u8], body: &[u8]) -> Result<(), ContractError> {
        let (group, mut budget, bytes) = self.prepare::<CatalogKind>(header_bytes, body)?;
        if self.catalogs.contains(&group.kind) {
            return Err(ContractError::DuplicateSource);
        }
        let source = group.source.into_source(body, &mut budget)?;
        let slot = match group.kind {
            CatalogKind::Tariff => &mut self.snapshot.catalogs.current.tariff,
            CatalogKind::Legal => &mut self.snapshot.catalogs.current.legal,
            CatalogKind::Holiday => &mut self.snapshot.catalogs.current.holiday,
        };
        *slot = source;
        self.catalogs.insert(group.kind);
        self.nodes = budget.nodes;
        self.bytes = bytes;
        Ok(())
    }
    pub fn seal(mut self) -> Result<ImmutableSnapshot, ContractError> {
        if self.reference_pending {
            return Err(ContractError::InvalidDate);
        }
        self.snapshot.validate()?;
        let digests = self.snapshot.digests()?;
        self.snapshot.identity.input_digest = digests.input_digest;
        self.snapshot.identity.catalog_digest = digests.catalog_digest;
        Ok(ImmutableSnapshot(Arc::new(self.snapshot)))
    }
}

#[cfg(test)]
mod rank_budget_tests {
    use super::*;
    fn empty() -> SnapshotAssembly {
        let mut assembly = SnapshotAssembly::begin(br#"{"ownerScope":"rank-owner","ownerEpoch":1,"snapshotId":"ranks","snapshotRevision":1,"referenceDate":"2026-11-13","selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}}"#).unwrap();
        assembly.source(br#"{"kind":"CALENDAR_ENTRIES","source":{"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE"}}}}"#,br#"{"shiftRows":[],"appointmentRows":[],"platformCollationRanks":{}}"#).unwrap();
        assembly
    }
    #[test]
    fn ranks_share_the_global_input_and_node_budgets_without_partial_mutation() {
        let mut bytes = empty();
        bytes.bytes = MAX_INPUT_BYTES as usize - 3;
        assert_eq!(
            bytes.bind_calendar_ranks(br#"{"x":0}"#),
            Err(ContractError::InputTooLarge)
        );
        assert_eq!(
            bytes.calendar_source().unwrap()["platformCollationRanks"],
            serde_json::json!({})
        );
        let mut nodes = empty();
        nodes.nodes = MAX_JSON_NODES;
        assert_eq!(
            nodes.bind_calendar_ranks(br#"{"x":0}"#),
            Err(ContractError::TooManyJsonNodes)
        );
        assert_eq!(
            nodes.calendar_source().unwrap()["platformCollationRanks"],
            serde_json::json!({})
        );
    }
}

#[cfg(test)]
mod catalog_budget_tests {
    use super::*;
    fn empty() -> SnapshotAssembly {
        let mut assembly=SnapshotAssembly::begin(br#"{"ownerScope":"catalog-budget","ownerEpoch":1,"snapshotId":"budget","snapshotRevision":1,"referenceDate":"2026-11-13","selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}}"#).unwrap();
        assembly.catalog(br#"{"kind":"TARIFF","source":{"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE"}}}}"#,br#"{"mode":"EXTERNAL","collationRanks":{}}"#).unwrap();
        assembly
    }
    fn unchanged(assembly: &SnapshotAssembly) {
        assert!(
            assembly
                .current_catalog()
                .selected_package_ids()
                .tariff()
                .is_empty()
        );
        let SourceState::Ready {
            payload:
                InputOnlyPayload {
                    data: DataPresence::Value { value },
                    ..
                },
            ..
        } = assembly.current_catalog().tariff()
        else {
            panic!("raw catalog")
        };
        assert_eq!(value["collationRanks"], serde_json::json!({}));
    }
    #[test]
    fn catalog_defaults_and_rank_bindings_share_global_budgets_without_partial_mutation() {
        let required = BTreeSet::from(["x".to_owned()]);
        let ids = ["tariff", "legal", "holiday"];
        let mut bytes = empty();
        bytes.bytes = MAX_INPUT_BYTES as usize - 1;
        assert_eq!(
            bytes.bind_catalog_metadata(ids, br#"{"x":0}"#, &required, true),
            Err(ContractError::InputTooLarge)
        );
        unchanged(&bytes);
        let mut nodes = empty();
        nodes.nodes = MAX_JSON_NODES;
        assert_eq!(
            nodes.bind_catalog_metadata(ids, br#"{"x":0}"#, &required, true),
            Err(ContractError::TooManyJsonNodes)
        );
        unchanged(&nodes);
        let mut duplicate = empty();
        assert_eq!(
            duplicate.bind_catalog_metadata(ids, br#"{"x":0,"\u0078":1}"#, &required, true),
            Err(ContractError::DuplicateJsonKey)
        );
        unchanged(&duplicate);
        for raw in [
            br#"{}"#.as_slice(),
            br#"{"x":null}"#.as_slice(),
            br#"{"x":4294967296}"#.as_slice(),
            br#"{"x":0.5}"#.as_slice(),
        ] {
            let mut bad = empty();
            assert!(
                bad.bind_catalog_metadata(ids, raw, &required, true)
                    .is_err()
            );
            unchanged(&bad);
        }
        let mut valid = empty();
        assert_eq!(
            valid
                .bind_catalog_metadata(ids, br#"{"x":0}"#, &required, true)
                .unwrap()["x"],
            0
        );
        assert_eq!(
            valid.current_catalog().selected_package_ids().tariff(),
            &["tariff"]
        );
    }
}

#[cfg(test)]
mod profile_clock_budget_tests {
    use super::*;
    fn pending() -> SnapshotAssembly {
        SnapshotAssembly::begin(br#"{"ownerScope":"clock-budget","ownerEpoch":1,"snapshotId":"clock","snapshotRevision":1,"selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}}"#).unwrap()
    }
    fn unchanged(assembly: &SnapshotAssembly, bytes: usize, nodes: u32) {
        assert!(assembly.reference_pending);
        assert!(assembly.snapshot.clock_context.is_none());
        assert_eq!(assembly.snapshot.reference_date, "1900-01-01");
        assert_eq!(assembly.bytes, bytes);
        assert_eq!(assembly.nodes, nodes);
    }
    #[test]
    fn native_clock_fields_share_global_budgets_and_fail_atomically() {
        let epoch = 1_794_524_400_000;
        let mut bytes = pending();
        bytes.bytes = MAX_INPUT_BYTES as usize - 1;
        let old = (bytes.bytes, bytes.nodes);
        assert_eq!(
            bytes.bind_profile_clock(epoch, "2026-11-12"),
            Err(ContractError::InputTooLarge)
        );
        unchanged(&bytes, old.0, old.1);
        let mut nodes = pending();
        nodes.nodes = MAX_JSON_NODES;
        let old = (nodes.bytes, nodes.nodes);
        assert_eq!(
            nodes.bind_profile_clock(epoch, "2026-11-12"),
            Err(ContractError::TooManyJsonNodes)
        );
        unchanged(&nodes, old.0, old.1);
        let mut valid = pending();
        let old = (valid.bytes, valid.nodes);
        valid.bind_profile_clock(epoch, "2026-11-12").unwrap();
        assert!(!valid.reference_pending);
        assert!(valid.bytes > old.0 && valid.nodes > old.1);
        let after = (valid.bytes, valid.nodes);
        valid.bind_profile_clock(epoch, "2026-11-12").unwrap();
        assert_eq!(
            (valid.bytes, valid.nodes),
            after,
            "same native proof is idempotent"
        );
        assert_eq!(
            valid.bind_profile_clock(epoch + 1, "2026-11-12"),
            Err(ContractError::IdentityMismatch)
        );
        assert_eq!(
            valid.bind_profile_clock(epoch, "2026-11-13"),
            Err(ContractError::IdentityMismatch)
        );
        assert_eq!((valid.bytes, valid.nodes), after);
        assert_eq!(valid.snapshot.reference_date, "2026-11-12");
    }
}
