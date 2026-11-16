//! V1 canonical envelope serialization without materializing another complete
//! Source/Target/Catalog Value tree. Static field order is lexicographic; raw
//! payload maps keep the existing borrowed canonical serializer.
use super::*;
use serde::ser::{SerializeMap, SerializeSeq};
use serde::{Serialize, Serializer};

macro_rules! object {
    ($serializer:expr, $count:expr, {$($key:literal => $value:expr),* $(,)?}) => {{
        let mut map = $serializer.serialize_map(Some($count))?;
        $(map.serialize_entry($key, &$value)?;)*
        map.end()
    }};
}
struct Packages<'a>(&'a PackageIds);
impl Serialize for Packages<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        object!(serializer,3,{"holiday"=>self.0.holiday,"legal"=>self.0.legal,"tariff"=>self.0.tariff})
    }
}
struct Ranges<'a>(&'a [DateRange]);
struct Range<'a>(&'a DateRange);
impl Serialize for Ranges<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut seq = serializer.serialize_seq(Some(self.0.len()))?;
        for value in self.0 {
            seq.serialize_element(&Range(value))?;
        }
        seq.end()
    }
}
impl Serialize for Range<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        object!(serializer,2,{"end"=>self.0.end,"start"=>self.0.start})
    }
}
struct CanonicalCoverage<'a>(&'a Coverage);
impl Serialize for CanonicalCoverage<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self.0 {
            Coverage::AllHistory => object!(serializer,1,{"kind"=>"ALL_HISTORY"}),
            Coverage::DateRanges { ranges } => {
                object!(serializer,2,{"kind"=>"DATE_RANGES","ranges"=>Ranges(ranges)})
            }
        }
    }
}
struct Presence<'a>(&'a DataPresence<Value>);
impl Serialize for Presence<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self.0 {
            DataPresence::Missing => object!(serializer,1,{"kind"=>"MISSING"}),
            DataPresence::Null => object!(serializer,1,{"kind"=>"NULL"}),
            DataPresence::Value { value } => {
                object!(serializer,2,{"kind"=>"VALUE","value"=>canonical::Borrowed(value)})
            }
        }
    }
}
struct Payload<'a>(&'a InputOnlyPayload);
impl Serialize for Payload<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        object!(serializer,2,{"data"=>Presence(&self.0.data),"schemaVersion"=>self.0.schema_version})
    }
}
struct Read<'a>(&'a SourceState);
impl Serialize for Read<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self.0 {
            SourceState::NotRequested => object!(serializer,1,{"state"=>"NOT_REQUESTED"}),
            SourceState::Loading => object!(serializer,1,{"state"=>"LOADING"}),
            SourceState::Failed { code } => object!(serializer,2,{"code"=>code,"state"=>"FAILED"}),
            SourceState::Ready {
                revision,
                coverage,
                payload,
            } => object!(serializer,4,{
                "coverage"=>CanonicalCoverage(coverage),"payload"=>Payload(payload),"revision"=>revision,"state"=>"READY"
            }),
        }
    }
}
struct Group<'a>(&'a SourceGroup);
struct Groups<'a>(&'a [SourceGroup]);
impl Serialize for Group<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        object!(serializer,2,{"kind"=>self.0.kind,"source"=>Read(&self.0.source)})
    }
}
impl Serialize for Groups<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut seq = serializer.serialize_seq(Some(self.0.len()))?;
        for value in self.0 {
            seq.serialize_element(&Group(value))?;
        }
        seq.end()
    }
}
struct Catalog<'a>(&'a CatalogSet);
impl Serialize for Catalog<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        object!(serializer,4,{
            "holiday"=>Read(&self.0.holiday),"legal"=>Read(&self.0.legal),
            "selectedPackageIds"=>Packages(&self.0.selected_package_ids),"tariff"=>Read(&self.0.tariff)
        })
    }
}
struct Cutoffs<'a>(&'a CompatibilityCutoffs);
impl Serialize for Cutoffs<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        object!(serializer,3,{"holiday"=>self.0.holiday,"legal"=>self.0.legal,"tariff"=>self.0.tariff})
    }
}
struct Historical<'a>(&'a HistoricalCatalog);
struct History<'a>(&'a [HistoricalCatalog]);
impl Serialize for Historical<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        object!(serializer,3,{
            "catalog"=>Catalog(&self.0.catalog),"compatiblePackageIds"=>Packages(&self.0.compatible_package_ids),"validBefore"=>Cutoffs(&self.0.valid_before)
        })
    }
}
impl Serialize for History<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut seq = serializer.serialize_seq(Some(self.0.len()))?;
        for value in self.0 {
            seq.serialize_element(&Historical(value))?;
        }
        seq.end()
    }
}
struct CatalogList<'a>(&'a Catalogs);
impl Serialize for CatalogList<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        object!(serializer,2,{"current"=>Catalog(&self.0.current),"history"=>History(&self.0.history)})
    }
}
struct Completeness<'a>(&'a ContextCompleteness);
impl Serialize for Completeness<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        object!(serializer,4,{
            "annexAEntries"=>self.0.annex_a_entries,"annexAPauseDetails"=>self.0.annex_a_pause_details,
            "entries"=>self.0.entries,"history"=>self.0.history
        })
    }
}
struct Identity<'a>(&'a SnapshotIdentity, &'a str);
impl Serialize for Identity<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        object!(serializer,5,{
            "catalogDigest"=>self.1,"ownerEpoch"=>self.0.owner_epoch,"ownerScope"=>self.0.owner_scope,
            "snapshotId"=>self.0.snapshot_id,"snapshotRevision"=>self.0.snapshot_revision
        })
    }
}
struct Snapshot<'a>(&'a SnapshotInput, &'a str);
struct ClockContext<'a>(&'a RawClockContext);
impl Serialize for ClockContext<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        object!(serializer,1,{"observedEpochMilliseconds"=>self.0.observed_epoch_milliseconds()})
    }
}
impl Serialize for Snapshot<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map =
            serializer.serialize_map(Some(if self.0.clock_context.is_some() { 6 } else { 5 }))?;
        map.serialize_entry("catalogs", &CatalogList(&self.0.catalogs))?;
        if let Some(clock) = &self.0.clock_context {
            map.serialize_entry("clockContext", &ClockContext(clock))?;
        }
        map.serialize_entry("completeness", &Completeness(&self.0.completeness))?;
        map.serialize_entry("identity", &Identity(&self.0.identity, self.1))?;
        map.serialize_entry("referenceDate", &self.0.reference_date)?;
        map.serialize_entry("sources", &Groups(&self.0.sources))?;
        map.end()
    }
}
pub(super) fn digests(input: &SnapshotInput) -> Result<SnapshotDigests, ContractError> {
    let catalog_digest = serialized_digest(b"LUNA-CATALOG-V1\0", &CatalogList(&input.catalogs))?;
    let input_digest = serialized_digest(b"LUNA-SNAPSHOT-V1\0", &Snapshot(input, &catalog_digest))?;
    Ok(SnapshotDigests {
        input_digest,
        catalog_digest,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn original(input: &SnapshotInput) -> SnapshotDigests {
        let catalog_digest = content_digest(
            b"LUNA-CATALOG-V1\0",
            &serde_json::to_value(&input.catalogs).unwrap(),
        )
        .unwrap();
        let mut value = serde_json::to_value(input).unwrap();
        let identity = value["identity"].as_object_mut().unwrap();
        identity.remove("inputDigest");
        identity.remove("catalogDigest");
        identity.insert("catalogDigest".into(), json!(catalog_digest));
        SnapshotDigests {
            input_digest: content_digest(b"LUNA-SNAPSHOT-V1\0", &value).unwrap(),
            catalog_digest,
        }
    }
    fn snapshot() -> SnapshotInput {
        serde_json::from_value(json!({
            "identity":{"ownerScope":"synthetic-borrowed","ownerEpoch":1,"snapshotId":"snapshot-1","snapshotRevision":1,"inputDigest":"a".repeat(64),"catalogDigest":"b".repeat(64)},
            "referenceDate":"2026-11-13","sources":ALL_SOURCE_KINDS.iter().map(|kind|json!({"kind":kind,"source":{"state":"NOT_REQUESTED"}})).collect::<Vec<_>>(),
            "catalogs":{"current":{"selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"tariff":{"state":"NOT_REQUESTED"},"legal":{"state":"NOT_REQUESTED"},"holiday":{"state":"NOT_REQUESTED"}},"history":[]},
            "completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}
        })).unwrap()
    }
    fn exact(input: &SnapshotInput) {
        let before = original(input);
        let after = digests(input).unwrap();
        assert_eq!(after.input_digest, before.input_digest);
        assert_eq!(after.catalog_digest, before.catalog_digest);
        assert_eq!(
            serde_json::to_vec(&CatalogList(&input.catalogs)).unwrap(),
            serde_json::to_vec(&canonical::Borrowed(
                &serde_json::to_value(&input.catalogs).unwrap()
            ))
            .unwrap()
        );
    }
    #[test]
    fn borrowed_snapshot_keeps_every_v1_read_presence_coverage_history_and_number_byte() {
        let mut snapshot = snapshot();
        exact(&snapshot);
        let ready = |data| SourceState::Ready {
            revision: 7,
            coverage: Coverage::DateRanges {
                ranges: vec![
                    DateRange::new("2026-01-01", "2026-06-01").unwrap(),
                    DateRange::new("2026-06-02", "2027-12-31").unwrap(),
                ],
            },
            payload: InputOnlyPayload {
                schema_version: 1,
                data,
            },
        };
        let states = [
            SourceState::NotRequested,
            SourceState::Loading,
            SourceState::Failed {
                code: SourceFailure::ReadFailed,
            },
            SourceState::Failed {
                code: SourceFailure::Unavailable,
            },
            SourceState::Failed {
                code: SourceFailure::InvalidStoredData,
            },
            ready(DataPresence::Missing),
            ready(DataPresence::Null),
            ready(DataPresence::Value {
                value: serde_json::from_str(
                    r#"{"z":-0.0,"a":[1.0,1.25e25,false,null,"\u0000ä🦀",{"z":1,"a":2}]}"#,
                )
                .unwrap(),
            }),
        ];
        for (index, state) in states.iter().enumerate() {
            for group in &mut snapshot.sources {
                group.source = state.clone();
            }
            snapshot.catalogs.current.tariff = state.clone();
            snapshot.catalogs.current.legal = state.clone();
            snapshot.catalogs.current.holiday = state.clone();
            snapshot.completeness.entries = DataPresence::Value {
                value: index % 2 == 0,
            };
            snapshot.completeness.history = DataPresence::Null;
            snapshot.completeness.annex_a_entries = DataPresence::Value { value: false };
            snapshot.catalogs.current.selected_package_ids = PackageIds {
                tariff: vec!["z".into(), "a".into()],
                legal: vec!["é".into(), "e\u{301}".into()],
                holiday: vec!["猫🦀".into()],
            };
            snapshot.catalogs.history = vec![HistoricalCatalog {
                catalog: snapshot.catalogs.current.clone(),
                compatible_package_ids: snapshot.catalogs.current.selected_package_ids.clone(),
                valid_before: CompatibilityCutoffs {
                    tariff: DataPresence::Value {
                        value: "2026-01-01".into(),
                    },
                    legal: DataPresence::Missing,
                    holiday: DataPresence::Null,
                },
            }];
            exact(&snapshot);
        }
    }
    #[test]
    fn fifty_thousand_source_facts_and_maximum_binding_hash_without_a_second_value_tree() {
        let mut snapshot = snapshot();
        let value = json!({"zBinding":"ä猫".repeat(50_000),"aFacts":(0..50_000).map(|i|json!({"date":format!("fact-{i}"),"rosterStatus":"FINAL","disposition":"ROSTER_FREE","zero":-0.0})).collect::<Vec<_>>()});
        snapshot.sources[0].source = SourceState::Ready {
            revision: 1,
            coverage: Coverage::AllHistory,
            payload: InputOnlyPayload {
                schema_version: 1,
                data: DataPresence::Value { value },
            },
        };
        let data = snapshot.sources[0].source.clone();
        exact(&snapshot);
        assert_eq!(snapshot.sources[0].source, data);
    }
    #[test]
    fn optional_raw_clock_is_exactly_bound_without_changing_absent_v1_bytes_or_catalog_digest() {
        let mut snapshot = snapshot();
        let absent = digests(&snapshot).unwrap();
        exact(&snapshot);
        snapshot.clock_context = Some(
            serde_json::from_value(json!({
                "observedEpochMilliseconds": 1_794_520_800_000_i64
            }))
            .unwrap(),
        );
        exact(&snapshot);
        let before = digests(&snapshot).unwrap();
        assert_ne!(before.input_digest, absent.input_digest);
        assert_eq!(before.catalog_digest, absent.catalog_digest);
        snapshot.clock_context = Some(
            serde_json::from_value(json!({
                "observedEpochMilliseconds": 1_794_520_800_001_i64
            }))
            .unwrap(),
        );
        exact(&snapshot);
        let after = digests(&snapshot).unwrap();
        assert_ne!(before.input_digest, after.input_digest);
        assert_eq!(before.catalog_digest, after.catalog_digest);
        snapshot.clock_context = None;
        assert_eq!(
            digests(&snapshot).unwrap().input_digest,
            absent.input_digest
        );
    }
}
